#!/usr/bin/env python3
"""
hypewatch - 24/7 livestream moment hunter.

  yt-dlp probes the channel -> when it goes LIVE:
    ffmpeg #1  best quality, stream-copy into a 5s ring buffer on disk (the clip source)
    ffmpeg #2  lowest-bitrate audio  -> loudness (dB) every 250 ms        } cheap signals,
    ffmpeg #3  lowest-quality video  -> frame-diff "motion" 2x/sec        } all in numpy
    chat       Twitch IRC (anonymous) or YouTube live chat -> unique chatters/sec + emoji/keyword hype
  Every second a robust rolling z-score (median/MAD) is computed per signal, weighted and
  combined. Spike = several signals jumping together.  NO AI is involved in detection.
  Only after a spike: cut the clip -> Whisper transcript -> Groq / NVIDIA LLM judges + titles it.

Setup
  brew install ffmpeg deno                       # deno = JS runtime yt-dlp wants for YouTube
  pip install -U "yt-dlp[default]" numpy requests websockets chat-downloader faster-whisper
  pip install mlx-whisper                        # optional, much faster Whisper on Apple Silicon
  export GROQ_API_KEY=...  NVIDIA_API_KEY=...    # or put them in a .env next to this file

Run
  python hypewatch.py https://www.twitch.tv/STREAMER
  python hypewatch.py https://www.youtube.com/@HANDLE/live
  python hypewatch.py --selftest                 # offline test of the spike detector
  caffeinate -dimsu python hypewatch.py URL      # macOS: keep the Mac awake while it runs
"""
from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import logging
import math
import os
import random
import re
import shutil
import sys
import threading
import time
from collections import Counter, deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import numpy as np

log = logging.getLogger("hypewatch")
DEBUG = False
DEVNULL, PIPE = asyncio.subprocess.DEVNULL, asyncio.subprocess.PIPE

# --------------------------------------------------------------------------- #
# Chat reaction lexicon - edit freely (add your streamer's emotes / slang)
# --------------------------------------------------------------------------- #
LEXICON = {
    "pog": 2, "poggers": 2, "pogchamp": 2, "pogu": 2, "kekw": 2, "lul": 1.5, "lulw": 1.5,
    "omegalul": 2, "lmao": 1.5, "lmaoo": 1.5, "lmfao": 1.5, "clip": 3, "clipit": 3,
    "clutch": 2, "insane": 2, "cracked": 2, "crazy": 1.5, "wtf": 1.5, "omg": 1.5,
    "omgg": 1.5, "noo": 1.5, "sheesh": 1.5, "goat": 1.5, "gg": 1, "ggs": 1, "ww": 1.5,
    "w": 1, "icant": 1.5, "rip": 1, "holy": 1.5, "bruh": 1,
    # Hinglish - add your streamer's slang here
    "gajab": 2, "ghazab": 2, "bawal": 2, "dhamaal": 2, "op": 1.5, "legend": 1.5,
}
PHRASES = {"no way": 2, "let him cook": 2, "he cooked": 2, "clip that": 3, "clip it": 3,
           "oh my god": 2, "are you kidding": 2, "what the": 1.5, "kya baat": 2, "bhai kya": 1.5}
EMOJI = {"😂": 2, "🤣": 2, "💀": 2, "🔥": 1.5, "😱": 2, "🤯": 2, "😮": 1.5, "😭": 1.5, "👏": 1,
         "🐐": 2, "💯": 1.5, "🚨": 1.5, "🥶": 1.5, "❤": 0.5}

_STRETCH = re.compile(r"(.)\1{2,}")           # "nooooo" -> "noo", "wwwww" -> "ww"
_TOKEN = re.compile(r"[a-z0-9_']+")


def _norm(s: str) -> str:
    return _STRETCH.sub(r"\1\1", s.lower())


LEX = {_norm(k): w for k, w in LEXICON.items()}
PHR = [(_norm(k), w) for k, w in PHRASES.items()]


def hype(text: str) -> tuple[float, list[str]]:
    """Weighted reaction score of one chat message (capped so one spammer can't dominate)."""
    t = _norm(text)
    score, hits = 0.0, []
    for ph, w in PHR:
        if ph in t:
            score += w
            hits.append(ph)
    for tok in _TOKEN.findall(t)[:25]:
        w = LEX.get(tok)
        if w:
            score += w
            hits.append(tok)
    for ch in text[:200]:
        w = EMOJI.get(ch)
        if w:
            score += w
            hits.append(ch)
    return min(score, 6.0), hits


class ChatStats:
    """Thread-safe 1-second accumulator fed by whichever chat client is running."""

    def __init__(self):
        self._lock = threading.Lock()
        self._reset()

    def _reset(self):
        self.n, self.h, self.users, self.hits = 0, 0.0, set(), Counter()

    def add(self, text: str, user: str = ""):
        if not text:
            return
        s, hits = hype(text)
        with self._lock:
            self.n += 1
            self.h += s
            self.users.add(user)
            self.hits.update(hits)

    def take(self):
        with self._lock:
            out = (self.n, self.h, len(self.users), self.hits)
            self._reset()
        return out


# --------------------------------------------------------------------------- #
# Spike detector (pure code, no AI)
# --------------------------------------------------------------------------- #
class Detector:
    FLOOR = {"audio": 2.5, "motion": 2.0, "chat": 1.0, "hype": 1.5}    # min "std" per signal
    WEIGHT = {"audio": 1.0, "motion": 0.6, "chat": 1.2, "hype": 1.5}

    def __init__(self, threshold=8.0, window=240, warm=45, zcap=10.0, solo=9.0, agree=2.5):
        self.thr, self.warm, self.zcap, self.solo, self.agree = threshold, warm, zcap, solo, agree
        self.hist = {k: deque(maxlen=window) for k in self.FLOOR}      # ~4 min baseline @1Hz
        self.sm = {"chat": deque(maxlen=3), "hype": deque(maxlen=3)}   # 3s smoothing for chat

    def _z(self, k: str, x: float) -> float:
        h, z = self.hist[k], 0.0
        if len(h) >= self.warm:
            a = np.fromiter(h, dtype=np.float64, count=len(h))
            med = float(np.median(a))
            mad = 1.4826 * float(np.median(np.abs(a - med)))
            z = (x - med) / max(mad, self.FLOOR[k])
        h.append(x)
        return z

    def step(self, feats: dict):
        zs = {}
        for k in self.FLOOR:
            x = feats.get(k)
            if x is None:
                zs[k] = 0.0
                continue
            if k in self.sm:
                self.sm[k].append(x)
                x = sum(self.sm[k]) / len(self.sm[k])
            zs[k] = self._z(k, x)
        c = {k: min(max(v, 0.0), self.zcap) for k, v in zs.items()}
        score = sum(self.WEIGHT[k] * v for k, v in c.items())
        agree = sum(v >= self.agree for v in c.values())
        fire = score >= self.thr and (agree >= 2 or max(c.values()) >= self.solo)
        return zs, score, fire


@dataclass
class Moment:
    start: float
    trigger: float
    end: float
    peak: float = 0.0
    peak_z: dict = field(default_factory=dict)
    peak_chat: float = 0.0
    hits: Counter = field(default_factory=Counter)


# --------------------------------------------------------------------------- #
# yt-dlp: is the streamer live? which URLs do we feed ffmpeg?
# --------------------------------------------------------------------------- #
_last_err = None


def probe(url: str, cookies: str | None = None):
    global _last_err
    from yt_dlp import YoutubeDL
    opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True,
            "socket_timeout": 15, "retries": 1, "extractor_retries": 1}
    if cookies:
        opts["cookiefile"] = cookies
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:                       # yt-dlp raises when a channel is offline
        msg = (str(e).strip().splitlines() or ["?"])[-1][:160]
        if msg != _last_err:
            log.info("not live (%s)", msg)
            _last_err = msg
        return None
    _last_err = None
    if not info or info.get("_type") == "playlist":
        return None
    return info if (info.get("live_status") == "is_live" or info.get("is_live")) else None


def pick_formats(info: dict):
    """-> (record_urls, low_video_urls, low_audio_urls). Lists, because DASH needs 2 inputs."""
    fm = [f for f in info.get("formats") or []
          if f.get("url") and f.get("protocol") != "mhtml" and not str(f.get("format_id", "")).startswith("sb")]
    none = lambda c: (c or "") == "none"
    muxed = [f for f in fm if not none(f.get("vcodec")) and not none(f.get("acodec"))]
    vonly = [f for f in fm if not none(f.get("vcodec")) and none(f.get("acodec"))]
    aonly = [f for f in fm if none(f.get("vcodec")) and not none(f.get("acodec"))]
    q = lambda f: (f.get("height") or 0, f.get("tbr") or 0)
    ab = lambda f: f.get("tbr") or f.get("abr") or 0
    if muxed:
        rec, lowv = [max(muxed, key=q)["url"]], [min(muxed, key=q)["url"]]
        lowa = [min(aonly, key=ab)["url"]] if aonly else lowv
    elif vonly and aonly:
        rec = [max(vonly, key=q)["url"], max(aonly, key=ab)["url"]]
        lowv, lowa = [min(vonly, key=q)["url"]], [min(aonly, key=ab)["url"]]
    elif info.get("url"):
        rec = lowv = lowa = [info["url"]]
    else:
        raise RuntimeError("no playable formats")
    return rec, lowv, lowa


def ff_in(urls: list[str], ua: str | None) -> list[str]:
    a = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin"]
    for u in urls:
        if u.startswith("http"):
            a += ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"]
            if ua:
                a += ["-user_agent", ua]
        a += ["-i", u]
    return a


async def spawn(cmd: list[str], pipe: bool = False):
    return await asyncio.create_subprocess_exec(
        *cmd, stdin=DEVNULL, stdout=PIPE if pipe else DEVNULL, stderr=None if DEBUG else DEVNULL)


async def stop(proc):
    if proc is None or proc.returncode is not None:
        return
    try:
        proc.terminate()
        await asyncio.wait_for(proc.wait(), 5)
    except asyncio.TimeoutError:
        proc.kill()
    except ProcessLookupError:
        pass


# --------------------------------------------------------------------------- #
# Chat clients
# --------------------------------------------------------------------------- #
async def twitch_chat(channel: str, stats: ChatStats):
    import websockets
    while True:
        try:
            async with websockets.connect("wss://irc-ws.chat.twitch.tv:443", ping_interval=None) as ws:
                await ws.send(f"NICK justinfan{random.randint(10000, 99999)}")
                await ws.send(f"JOIN #{channel.lower()}")
                log.info("twitch chat connected: #%s", channel)
                async for raw in ws:
                    for line in str(raw).split("\r\n"):
                        if line.startswith("PING"):
                            await ws.send("PONG :tmi.twitch.tv")
                        elif " PRIVMSG " in line and " :" in line.split(" PRIVMSG ", 1)[1]:
                            user = line[1:line.index("!")] if "!" in line else ""
                            stats.add(line.split(" PRIVMSG ", 1)[1].split(" :", 1)[1], user)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("twitch chat error: %s (retry in 5s)", e)
            await asyncio.sleep(5)


def youtube_chat_thread(url: str, stats: ChatStats, halt: threading.Event):
    from chat_downloader import ChatDownloader
    while not halt.is_set():
        try:
            log.info("youtube chat connecting")
            for m in ChatDownloader().get_chat(url):
                if halt.is_set():
                    return
                if m.get("message_type") in ("text_message", "paid_message"):
                    stats.add(m.get("message") or "", (m.get("author") or {}).get("id", ""))
        except Exception as e:
            log.warning("youtube chat error: %s (retry in 10s)", e)
        halt.wait(10)


# --------------------------------------------------------------------------- #
# Post-spike: cut clip -> Whisper -> LLM
# --------------------------------------------------------------------------- #
SEG_RE = re.compile(r"seg-(\d{8}-\d{6})\.ts$")


def list_segments(d: Path):
    out = []
    for p in d.glob("seg-*.ts"):
        m = SEG_RE.search(p.name)
        if m:
            out.append((datetime.strptime(m.group(1), "%Y%m%d-%H%M%S").timestamp(), p))
    return sorted(out)


VCODEC = (["-c:v", "h264_videotoolbox", "-b:v", "6M"] if sys.platform == "darwin"
          else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22"])


async def cut_clip(cfg, segdir: Path, m: Moment, dest: Path) -> bool:
    deadline = time.time() + cfg.seg_time * 3 + 10          # wait until the segment holding m.end is closed
    while time.time() < deadline:
        segs = list_segments(segdir)
        if segs and segs[-1][0] > m.end:
            break
        await asyncio.sleep(1)
    segs = list_segments(segdir)
    sel = []
    for i, (t, p) in enumerate(segs):
        t_end = segs[i + 1][0] if i + 1 < len(segs) else t + cfg.seg_time * 2
        if t_end > m.start and t < m.end:
            sel.append((t, p))
    if not sel:
        log.warning("no buffered segments for this moment")
        return False
    lst = dest.with_name("concat.txt")
    lst.write_text("".join(f"file '{p.resolve().as_posix()}'\n" for _, p in sel))
    ss, dur = max(0.0, m.start - sel[0][0]), m.end - m.start
    enc = ["-c", "copy"] if cfg.fast_cut else [*VCODEC, "-c:a", "aac", "-b:a", "128k"]
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
           "-i", str(lst), "-ss", f"{ss:.2f}", "-t", f"{dur:.2f}", *enc, "-movflags", "+faststart", str(dest)]
    rc = await (await spawn(cmd)).wait()
    lst.unlink(missing_ok=True)
    return rc == 0 and dest.exists()


MLX_MODELS = {"tiny": "mlx-community/whisper-tiny-mlx", "base": "mlx-community/whisper-base-mlx",
              "small": "mlx-community/whisper-small-mlx", "medium": "mlx-community/whisper-medium-mlx",
              "large-v3-turbo": "mlx-community/whisper-large-v3-turbo"}
_asr_cache: dict = {}


def transcribe(audio: Path, cfg) -> tuple[str, str]:
    be = cfg.asr
    if be == "auto":
        be = "mlx" if importlib.util.find_spec("mlx_whisper") else "faster"
    if be == "mlx":
        import mlx_whisper
        r = mlx_whisper.transcribe(str(audio), path_or_hf_repo=MLX_MODELS.get(cfg.whisper_model, cfg.whisper_model))
        return r["text"].strip(), r.get("language", "?")
    if be == "groq":
        import requests
        with open(audio, "rb") as f:
            r = requests.post("https://api.groq.com/openai/v1/audio/transcriptions",
                              headers={"Authorization": f"Bearer {os.environ['GROQ_API_KEY']}"},
                              files={"file": (audio.name, f)},
                              data={"model": "whisper-large-v3-turbo", "response_format": "verbose_json"},
                              timeout=120)
        r.raise_for_status()
        j = r.json()
        return j["text"].strip(), j.get("language", "?")
    from faster_whisper import WhisperModel
    if "fw" not in _asr_cache:
        _asr_cache["fw"] = WhisperModel(cfg.whisper_model, device="auto", compute_type="auto")
    segs, info = _asr_cache["fw"].transcribe(str(audio), vad_filter=True, beam_size=1,
                                             condition_on_previous_text=False)
    return " ".join(s.text.strip() for s in segs).strip(), info.language


PROVIDERS = {
    "groq": ("https://api.groq.com/openai/v1", "GROQ_API_KEY", "GROQ_MODEL", "llama-3.3-70b-versatile"),
    "nvidia": ("https://integrate.api.nvidia.com/v1", "NVIDIA_API_KEY", "NVIDIA_MODEL", "meta/llama-3.3-70b-instruct"),
}


def llm_call(prompt: str) -> dict | None:
    """Tries providers in LLM_ORDER (default groq,nvidia); first one that answers wins."""
    import requests
    for name in os.getenv("LLM_ORDER", "groq,nvidia").split(","):
        base, key_env, model_env, default = PROVIDERS[name.strip()]
        key = os.getenv(key_env)
        if not key:
            continue
        model = os.getenv(model_env, default)
        try:
            r = requests.post(f"{base}/chat/completions", timeout=45,
                              headers={"Authorization": f"Bearer {key}"},
                              json={"model": model, "temperature": 0.3, "max_tokens": 400,
                                    "messages": [{"role": "system", "content": "You are a livestream highlight editor. Reply with ONLY compact JSON."},
                                                 {"role": "user", "content": prompt}]})
            r.raise_for_status()
            txt = r.json()["choices"][0]["message"]["content"]
            return {"provider": name, "model": model, **json.loads(re.search(r"\{.*\}", txt, re.S).group(0))}
        except Exception as e:
            log.warning("LLM %s failed: %s", name, e)
    return None


def build_prompt(m: Moment, info: dict, transcript: str, lang: str) -> str:
    top = ", ".join(f"{k} x{v}" for k, v in m.hits.most_common(8)) or "none"
    z = json.dumps({k: round(v, 1) for k, v in m.peak_z.items()})
    return (f"Streamer: {info.get('uploader') or info.get('channel')}\nStream title: {info.get('title')}\n"
            f"Clip length: {m.end - m.start:.0f}s\n"
            f"Spike detected by code (z-scores vs this stream's own baseline): {z}\n"
            f"Peak unique chatters/sec: {m.peak_chat:.0f}\nTop chat reactions: {top}\n"
            f"Transcript ({lang}): {transcript[:1500] or '(none)'}\n\n"
            "Decide if this is a genuinely clip-worthy moment. Reply with ONLY this JSON:\n"
            '{"is_highlight": true|false, "score": 1-10, "category": "funny|hype|clutch|fail|rage|wholesome|story|other", '
            '"title": "<=70 chars, accurate, no fake clickbait", "summary": "1-2 sentences", "hashtags": ["#a", "#b"]}')


ASR_LOCK = asyncio.Lock()
PENDING: set = set()


async def process_moment(cfg, sess: "Session", m: Moment):
    try:
        stamp = datetime.fromtimestamp(m.trigger).strftime("%Y%m%d-%H%M%S")
        d = cfg.out / sess.channel / f"{stamp}_s{m.peak:.0f}"
        d.mkdir(parents=True, exist_ok=True)
        clip = d / "clip.mp4"
        ok = await cut_clip(cfg, sess.segdir, m, clip)
        iso = lambda t: datetime.fromtimestamp(t).isoformat(timespec="seconds")
        rec = {"channel": sess.channel, "stream_title": sess.info.get("title"), "stream_url": sess.info.get("webpage_url"),
               "trigger": iso(m.trigger), "start": iso(m.start), "end": iso(m.end), "length_s": round(m.end - m.start, 1),
               "score": round(m.peak, 1), "peak_z": {k: round(v, 1) for k, v in m.peak_z.items()},
               "peak_chat_users_per_s": m.peak_chat, "top_reactions": m.hits.most_common(10),
               "clip": str(clip) if ok else None}
        transcript, lang = "", "?"
        if ok and cfg.whisper:
            audio = d / "audio.m4a"
            rc = await (await spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(clip), "-vn",
                                     "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "48k", str(audio)])).wait()
            if rc == 0:
                try:
                    async with ASR_LOCK:
                        transcript, lang = await asyncio.to_thread(transcribe, audio, cfg)
                except Exception as e:
                    rec["transcript_error"] = str(e)
                    log.warning("transcription failed: %s", e)
        rec["transcript"], rec["language"] = transcript, lang
        if cfg.llm:
            rec["llm"] = await asyncio.to_thread(llm_call, build_prompt(m, sess.info, transcript, lang))
            sc = (rec["llm"] or {}).get("score")
            if cfg.min_llm and isinstance(sc, (int, float)) and sc < cfg.min_llm and ok:
                clip.unlink(missing_ok=True)
                rec["clip"], rec["discarded"] = None, f"llm score {sc} < {cfg.min_llm}"
        (d / "moment.json").write_text(json.dumps(rec, ensure_ascii=False, indent=2))
        with open(cfg.out / "moments.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        llm = rec.get("llm") or {}
        log.info("clip saved: %s | %s | llm=%s/10 %s", d, f"{rec['length_s']}s", llm.get("score", "-"), llm.get("title", ""))
    except Exception:
        log.exception("moment processing failed")


# --------------------------------------------------------------------------- #
# One live session
# --------------------------------------------------------------------------- #
def safe(s: str) -> str:
    return re.sub(r"[^\w\-]+", "_", s or "stream").strip("_")[:60] or "stream"


class Session:
    def __init__(self, cfg, info: dict):
        self.cfg, self.info = cfg, info
        self.channel = safe(info.get("uploader") or info.get("channel") or info.get("uploader_id") or "stream")
        self.segdir = cfg.out / "_buffer" / self.channel
        self.audio: list[float] = []
        self.motion: list[float] = []
        self.chat = ChatStats()
        self.det = Detector(cfg.threshold)
        self.cur: Moment | None = None
        self.refractory = 0.0
        self.recent: deque = deque(maxlen=max(1, int(cfg.pre)))
        self.ticks = 0

    async def _audio(self, proc):
        CH = 8000                                           # 250 ms of 16 kHz s16 mono
        while True:
            try:
                b = await proc.stdout.readexactly(CH)
            except asyncio.IncompleteReadError:
                return
            x = np.frombuffer(b, dtype=np.int16).astype(np.float32) / 32768.0
            rms = float(np.sqrt(np.mean(x * x)))
            self.audio.append(max(20 * math.log10(rms + 1e-6), -80.0))

    async def _video(self, proc):
        N, prev = 64 * 36, None
        while True:
            try:
                b = await proc.stdout.readexactly(N)
            except asyncio.IncompleteReadError:
                return
            cur = np.frombuffer(b, dtype=np.uint8).astype(np.int16)
            if prev is not None:
                self.motion.append(float(np.mean(np.abs(cur - prev))))
            prev = cur

    async def _tick_loop(self):
        while True:
            await asyncio.sleep(max(0.05, 1.0 - (time.time() % 1.0)))
            self._tick(time.time())

    def _tick(self, now: float):
        cfg = self.cfg
        a, self.audio = self.audio, []
        v, self.motion = self.motion, []
        n, hy, users, hits = self.chat.take()
        feats = {"audio": max(a) if a else None, "motion": float(np.mean(v)) if v else None,
                 "chat": float(users), "hype": float(hy)}
        zs, score, fire = self.det.step(feats)
        self.ticks += 1
        log.debug("t=%d score=%.1f z=%s chat=%d", self.ticks, score, {k: round(z, 1) for k, z in zs.items()}, users)
        if self.ticks % 60 == 0:
            log.info("[%s] watching - baseline %s, last score %.1f", self.channel,
                     "ready" if len(self.det.hist["audio"]) >= self.det.warm else "calibrating", score)
        m, fresh = self.cur, False
        if fire and m is None and now >= self.refractory:
            m = self.cur = Moment(start=now - cfg.pre, trigger=now, end=now + cfg.post)
            for h in self.recent:
                m.hits.update(h)
            m.hits.update(hits)
            fresh = True
            log.info("SPIKE score=%.1f z=%s chat=%d top=%s", score, {k: round(z, 1) for k, z in zs.items()},
                     users, dict(hits.most_common(3)))
        if m:
            if fire:
                m.end = min(now + cfg.post, m.start + cfg.max_len)
            if not fresh:
                m.hits.update(hits)
            m.peak = max(m.peak, score)
            for k, z in zs.items():
                m.peak_z[k] = max(m.peak_z.get(k, 0.0), z)
            m.peak_chat = max(m.peak_chat, users)
            if now >= m.end:
                self._finish(m)
        self.recent.append(hits)

    def _finish(self, m: Moment):
        self.cur = None
        self.refractory = time.time() + 5
        t = asyncio.create_task(process_moment(self.cfg, self, m))
        PENDING.add(t)
        t.add_done_callback(PENDING.discard)

    def _chat_kind(self) -> str:
        if self.cfg.chat != "auto":
            return self.cfg.chat
        u = (self.info.get("webpage_url") or self.cfg.url).lower()
        return "twitch" if "twitch.tv" in u else "youtube" if ("youtube.com" in u or "youtu.be" in u) else "none"

    async def run(self):
        cfg = self.cfg
        rec, lowv, lowa = pick_formats(self.info)
        ua = (self.info.get("http_headers") or {}).get("User-Agent")
        self.segdir.mkdir(parents=True, exist_ok=True)
        log.info("LIVE: %s - %s", self.channel, self.info.get("title"))
        procs, tasks, halt = [], [], threading.Event()
        try:
            recp = await spawn([*ff_in(rec, ua), "-c", "copy", "-f", "segment", "-segment_time", str(cfg.seg_time),
                                "-segment_format", "mpegts", "-reset_timestamps", "1", "-strftime", "1",
                                str(self.segdir / "seg-%Y%m%d-%H%M%S.ts")])
            audp = await spawn([*ff_in(lowa, ua), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"], pipe=True)
            procs += [recp, audp]
            tasks += [asyncio.create_task(self._audio(audp)), asyncio.create_task(self._tick_loop())]
            if cfg.motion:
                vidp = await spawn([*ff_in(lowv, ua), "-an", "-vf", "fps=2,scale=64:36,format=gray",
                                    "-f", "rawvideo", "pipe:1"], pipe=True)
                procs.append(vidp)
                tasks.append(asyncio.create_task(self._video(vidp)))
            kind = self._chat_kind()
            if kind == "twitch":
                mt = re.search(r"twitch\.tv/([^/?#]+)", cfg.url) or re.search(r"twitch\.tv/([^/?#]+)", self.info.get("webpage_url", ""))
                if mt:
                    tasks.append(asyncio.create_task(twitch_chat(mt.group(1), self.chat)))
            elif kind == "youtube":
                threading.Thread(target=youtube_chat_thread, daemon=True,
                                 args=(self.info.get("webpage_url") or cfg.url, self.chat, halt)).start()
            else:
                log.info("chat disabled - using audio/motion only (consider --threshold 6)")
            waits = {asyncio.create_task(audp.wait()), asyncio.create_task(recp.wait())}
            await asyncio.wait(waits, return_when=asyncio.FIRST_COMPLETED)
            log.info("stream ended or ffmpeg exited")
        finally:
            halt.set()
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await asyncio.gather(*(stop(p) for p in procs))
            if self.cur:
                self.cur.end = min(self.cur.end, time.time())
                self._finish(self.cur)


async def buffer_cleaner(cfg):
    keep = cfg.pre + cfg.max_len + cfg.post + 120
    while True:
        await asyncio.sleep(30)
        cutoff = time.time() - keep
        for p in (cfg.out / "_buffer").glob("*/seg-*.ts"):
            try:
                if p.stat().st_mtime < cutoff:
                    p.unlink()
            except OSError:
                pass


async def supervisor(cfg):
    shutil.rmtree(cfg.out / "_buffer", ignore_errors=True)
    cfg.out.mkdir(parents=True, exist_ok=True)
    cleaner = asyncio.create_task(buffer_cleaner(cfg))
    log.info("watching %s (poll ~%ss)", cfg.url, cfg.poll)
    fails = 0
    try:
        while True:
            info = await asyncio.to_thread(probe, cfg.url, cfg.cookies)
            if not info:
                await asyncio.sleep(cfg.poll + random.uniform(0, 5))
                continue
            t0 = time.time()
            try:
                await Session(cfg, info).run()
            except Exception:
                log.exception("session crashed")
            if time.time() - t0 < 60:                       # ffmpeg dying right away -> back off
                fails += 1
                await asyncio.sleep(min(30 * fails, 300))
            else:
                fails = 0
                await asyncio.sleep(10)
    finally:
        cleaner.cancel()
        if PENDING:
            log.info("finishing %d clip job(s)...", len(PENDING))
            await asyncio.gather(*PENDING, return_exceptions=True)


# --------------------------------------------------------------------------- #
def selftest() -> int:
    rng = np.random.default_rng(7)
    det, fired = Detector(8.0), []
    for t in range(420):
        burst = 300 <= t < 306
        chat_b = 302 <= t < 309
        f = {"audio": -30 + rng.normal(0, 1.5) + (14 if burst else 0),
             "motion": 4 + abs(rng.normal(0, 1)) + (9 if burst else 0),
             "chat": float(rng.poisson(1.0) + (rng.poisson(9) if chat_b else 0)),
             "hype": float(rng.poisson(0.5) * 1.5 + (rng.poisson(8) * 1.5 if chat_b else 0))}
        _, score, fire = det.step(f)
        if fire:
            fired.append(t)
    # a loud-only blip (e.g. streamer coughs / game SFX) must NOT fire
    det2, false_pos = Detector(8.0), []
    for t in range(200):
        f = {"audio": -30 + rng.normal(0, 1.5) + (10 if t == 150 else 0), "motion": 4 + abs(rng.normal(0, 1)),
             "chat": float(rng.poisson(1.0)), "hype": float(rng.poisson(0.5) * 1.5)}
        if det2.step(f)[2]:
            false_pos.append(t)
    print(f"burst@300-309 fired at t={fired}")
    print(f"audio-only blip false positives: {false_pos}")
    ok = bool(fired) and all(300 <= t <= 312 for t in fired) and not false_pos
    print("SELFTEST", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def load_env(path=".env"):
    p = Path(path)
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("'\""))


def main():
    global DEBUG
    load_env()
    p = argparse.ArgumentParser(description="24/7 livestream moment hunter")
    p.add_argument("url", nargs="?", help="https://twitch.tv/NAME  or  https://www.youtube.com/@HANDLE/live")
    p.add_argument("--poll", type=int, default=45, help="seconds between 'are they live?' checks")
    p.add_argument("--threshold", type=float, default=8.0, help="spike score needed (lower = more clips)")
    p.add_argument("--pre", type=float, default=30, help="seconds kept before the spike")
    p.add_argument("--post", type=float, default=15, help="seconds kept after the last spike tick")
    p.add_argument("--max-len", type=float, default=90, help="hard cap on one clip's length")
    p.add_argument("--seg-time", type=int, default=5)
    p.add_argument("--out", type=Path, default=Path("moments"))
    p.add_argument("--chat", choices=["auto", "twitch", "youtube", "none"], default="auto")
    p.add_argument("--no-motion", dest="motion", action="store_false", help="skip the video-motion signal")
    p.add_argument("--no-whisper", dest="whisper", action="store_false")
    p.add_argument("--asr", choices=["auto", "mlx", "faster", "groq"], default="auto")
    p.add_argument("--whisper-model", default="small", help="tiny|base|small|medium|large-v3-turbo")
    p.add_argument("--no-llm", dest="llm", action="store_false")
    p.add_argument("--min-llm", type=float, default=0, help="delete clips the LLM scores below this (1-10)")
    p.add_argument("--fast-cut", action="store_true", help="stream-copy clips (instant, keyframe-aligned start)")
    p.add_argument("--cookies", default=None, help="cookies.txt for yt-dlp")
    p.add_argument("--debug", action="store_true")
    p.add_argument("--selftest", action="store_true")
    cfg = p.parse_args()
    DEBUG = cfg.debug
    logging.basicConfig(level=logging.DEBUG if cfg.debug else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    if cfg.selftest:
        sys.exit(selftest())
    if not cfg.url:
        p.error("url required")
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not found on PATH (brew install ffmpeg)")
    try:
        asyncio.run(supervisor(cfg))
    except KeyboardInterrupt:
        log.info("stopped")


if __name__ == "__main__":
    main()

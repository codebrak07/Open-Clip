#!/usr/bin/env python3
"""
stream_spike_hunter.py  --  24/7 live-stream moment catcher

  yt-dlp (live detection + stream URLs)
    |- ffmpeg -> 16 kHz mono PCM  -> loudness (numpy)  --------+
    |                            \-> faster-whisper (local)    |  real-time fusion
    |- ffmpeg -> 160x90 gray frames @2fps -> motion (numpy) ---+  (pure code, no AI)
    |- live chat (Twitch IRC / YouTube) -> msg rate + emoji/keyword score -+
    \- ffmpeg -c copy -> rolling segment buffer -> instant clip cutting
  spike confirmed -> clip + Groq (fast analysis) / NVIDIA NIM (fallback + optional vision)

INSTALL
  pip install -U yt-dlp faster-whisper numpy httpx chat-downloader
  ffmpeg must be on PATH.  (GPU Whisper: install CUDA 12 + cuDNN; otherwise it runs on CPU.)

ENV (all optional)
  GROQ_API_KEY, GROQ_MODEL            Groq analysis       (default llama-3.3-70b-versatile)
  NVIDIA_API_KEY, NVIDIA_MODEL        NVIDIA NIM analysis (default meta/llama-3.3-70b-instruct)
  NVIDIA_VISION_MODEL                 set to a NIM vision model id to caption the peak frame
  LLM_ORDER=groq,nvidia               which provider is tried first
  WHISPER_MODEL, WHISPER_LANG         default: large-v3-turbo on GPU, small on CPU; lang auto
  CLIP_VCODEC=copy|h264_nvenc|libx264 copy = instant, keyframe-accurate cuts
  YT_COOKIES=/path/cookies.txt        helps with YouTube bot checks
  Tuning: HIGH, LOW, AGREE_Z, PRE_ROLL, POST_ROLL, BUFFER_S, POLL_OFFLINE ...

RUN
  python stream_spike_hunter.py https://www.twitch.tv/NAME
  python stream_spike_hunter.py https://www.youtube.com/@NAME/live --debug
  (several URLs at once works too; --debug prints per-second z-scores for tuning)
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import logging
import math
import os
import queue
import random
import re
import shutil
import subprocess
import threading
import time
from collections import Counter, deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

import httpx
import numpy as np
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

log = logging.getLogger("spike")


def _f(k, d):
    return float(os.getenv(k, d))


def _s(k, d=""):
    return os.getenv(k, d)


# ───────────────────────────── tunables ─────────────────────────────
FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
POLL_OFFLINE = _f("POLL_OFFLINE", 45)      # seconds between "is it live?" checks
SEG_SECONDS = 6                            # ring-buffer segment length
BUFFER_S = _f("BUFFER_S", 300)             # how much past footage is kept for clipping
PRE_ROLL = _f("PRE_ROLL", 20)              # seconds before the spike included in the clip
POST_ROLL = _f("POST_ROLL", 8)
CLIP_MAX_H = int(_f("CLIP_MAX_H", 720))
CLIP_VCODEC = _s("CLIP_VCODEC", "copy")
SR = 16000                                 # audio sample rate fed to numpy/Whisper
VW, VH, MOTION_FPS = 160, 90, 2            # tiny gray frames for motion

HIGH = _f("HIGH", 2.4)                     # fused score needed to start an event
LOW = _f("LOW", 1.4)                       # event stays alive while fused >= LOW
AGREE_Z = _f("AGREE_Z", 2.0)               # a signal "agrees" when its z-score >= this
MIN_AGREE = int(_f("MIN_AGREE", 2))        # how many signals must agree
MIN_SUSTAIN = int(_f("MIN_SUSTAIN", 2))    # consecutive seconds above HIGH
COOLDOWN = _f("COOLDOWN", 8)               # seconds below LOW before the event closes
MAX_EVENT = _f("MAX_EVENT", 90)
ZCAP = 6.0
FREEZE_Z = 2.5                             # baselines don't learn from spikes

WHISPER_CHUNK_S = int(_f("WHISPER_CHUNK_S", 12))
SPEECH_TRIGGER = _f("SPEECH_TRIGGER", 7)   # keyword points in one chunk that trigger on speech alone
DROP_REJECTS = _s("DROP_REJECTS", "0") == "1"

GROQ_BASE, NVIDIA_BASE = "https://api.groq.com/openai/v1", "https://integrate.api.nvidia.com/v1"
GROQ_KEY, NVIDIA_KEY = _s("GROQ_API_KEY"), _s("NVIDIA_API_KEY")
GROQ_MODEL = _s("GROQ_MODEL", "llama-3.3-70b-versatile")
NVIDIA_MODEL = _s("NVIDIA_MODEL", "meta/llama-3.3-70b-instruct")
NVIDIA_VISION_MODEL = _s("NVIDIA_VISION_MODEL")
LLM_ORDER = [p.strip() for p in _s("LLM_ORDER", "groq,nvidia").split(",") if p.strip()]
COOKIES = _s("YT_COOKIES")

# weight, noise floor for the z-score, minimum raw value that can count at all
SIG = {
    "audio":      dict(w=0.30, min_sd=2.0, abs_min=-45.0),   # dBFS
    "motion":     dict(w=0.15, min_sd=0.8, abs_min=0.0),     # mean abs pixel diff
    "chat_rate":  dict(w=0.20, min_sd=0.4, abs_min=1.0),     # msgs / sec (5 s window)
    "chat_react": dict(w=0.35, min_sd=0.8, abs_min=2.0),     # reaction points / sec
}

# ───────────────────── lexicon: chat + speech reaction scoring ─────────────────────
LEX = {
    "pog": (3, "hype"), "poggers": (3, "hype"), "pogchamp": (3, "hype"), "pogu": (3, "hype"),
    "let's go": (3, "hype"), "lets go": (3, "hype"), "letsgo": (3, "hype"),
    "clutch": (3, "hype"), "insane": (2, "hype"), "cracked": (2, "hype"), "sheesh": (2, "hype"),
    "gg": (1.5, "hype"), "clap": (2, "hype"), "ez": (1.5, "hype"), "crazy": (1.5, "hype"), "goated": (2, "hype"),
    "clip": (4, "clip"), "clip it": (5, "clip"), "clip that": (5, "clip"),
    "lul": (2, "funny"), "lulw": (2, "funny"), "omegalul": (3, "funny"), "kekw": (3, "funny"),
    "lmao": (2, "funny"), "lmfao": (2, "funny"), "lol": (1, "funny"), "haha": (1, "funny"), "pepelaugh": (2, "funny"),
    "omg": (2, "shock"), "oh my god": (3, "shock"), "wtf": (2, "shock"), "no way": (3, "shock"),
    "noway": (3, "shock"), "monkas": (2, "shock"), "holy": (2, "shock"), "what the": (2, "shock"),
    "wow": (1.5, "shock"), "damn": (1.5, "shock"), "rip": (1.5, "shock"), "are you kidding": (3, "shock"),
}
LEX_RE = re.compile(
    r"(?<![\w'])(" + "|".join(sorted((re.escape(k) for k in LEX), key=len, reverse=True)) + r")(?![\w'])"
)
EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF\u2600-\u27BF]")
SHORTCODE_RE = re.compile(r":[\w\-]{3,}:")          # YouTube custom emoji text
STRETCH_RE = re.compile(r"(\w)\1{3,}")               # noooooo, AAAAAA
EMOJI_CAT = {
    "😂": "funny", "🤣": "funny", "💀": "funny", "😭": "funny",
    "😱": "shock", "😳": "shock", "🤯": "shock", "😮": "shock", "😲": "shock",
    "🔥": "hype", "🙌": "hype", "👏": "hype", "🎉": "hype", "💯": "hype", "🚀": "hype", "🏆": "hype", "🐐": "hype",
}


def score_text(text: str):
    """Return (points, Counter of reaction categories) for one chat message / speech line."""
    t = text.lower()
    pts, cats = 0.0, Counter()
    for m in LEX_RE.findall(t):
        p, c = LEX[m]
        pts += p
        cats[c] += 1
    emojis = EMOJI_RE.findall(text)
    for e in emojis[:3]:
        pts += 1.5
        cats[EMOJI_CAT.get(e, "react")] += 1
    codes = SHORTCODE_RE.findall(text)
    pts += min(len(codes), 3) * 1.0
    if codes:
        cats["react"] += min(len(codes), 3)
    letters = [c for c in text if c.isalpha()]
    if len(letters) >= 5 and sum(c.isupper() for c in letters) / len(letters) > 0.7:
        pts += 1
    if STRETCH_RE.search(t):
        pts += 1
        cats["shock"] += 1
    return min(pts, 8.0), cats      # cap so one spammer can't dominate


# ───────────────────────────── signal math ─────────────────────────────
class Baseline:
    """EWMA mean/variance (~5 min memory). Freezes while a spike is happening so it isn't learned as 'normal'."""

    def __init__(self, horizon=300.0, warmup=45, min_sd=1.0):
        self.alpha, self.warmup, self.min_sd = 1.0 / horizon, warmup, min_sd
        self.n, self.mean, self.var, self.frozen = 0, 0.0, 0.0, 0

    def z(self, x: float) -> float:
        if self.n < self.warmup:
            return 0.0
        return (x - self.mean) / max(math.sqrt(self.var), self.min_sd)

    def update(self, x: float, z: float):
        if self.n >= self.warmup and z > FREEZE_Z and self.frozen < 90:
            self.frozen += 1        # after 90 s of "spike" we accept it as the new normal
            return
        self.frozen = 0
        a = max(self.alpha, 1.0 / (self.n + 1))
        d = x - self.mean
        self.mean += a * d
        self.var = (1 - a) * (self.var + a * d * d)
        self.n += 1


class ChatMeter:
    def __init__(self):
        self.ev = deque()           # (ts, pts, cats, user, text)
        self.lock = threading.Lock()

    def add(self, user: str, text: str):
        pts, cats = score_text(text)
        now = time.time()
        with self.lock:
            self.ev.append((now, pts, cats, user, text[:200]))
            while self.ev and self.ev[0][0] < now - 180:
                self.ev.popleft()

    def window(self, now: float, secs: float):
        with self.lock:
            sel = [e for e in self.ev if e[0] >= now - secs]
        return len(sel), sum(e[1] for e in sel)

    def slice(self, t0: float, t1: float):
        with self.lock:
            return [e for e in self.ev if t0 <= e[0] <= t1]


@dataclass
class Event:
    start: float
    last_hot: float
    peak: float = 0.0
    peak_ts: float = 0.0
    peak_z: dict = field(default_factory=dict)
    source: str = "signals"


# ───────────────────────────── yt-dlp ─────────────────────────────
def probe(url: str):
    """Return yt-dlp info if the channel/stream is live right now, else None."""
    opts = {"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True,
            "socket_timeout": 15, "format": "best/worst"}
    if COOKIES:
        opts["cookiefile"] = COOKIES
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return info if info and info.get("is_live") else None


def pick_urls(info: dict):
    """Choose a tiny video (motion), an audio feed (loudness+Whisper) and a clip-quality muxed feed."""
    fm = [f for f in info.get("formats", []) if f.get("url") and f.get("ext") != "mhtml"]
    has_v = lambda f: f.get("vcodec") != "none"
    has_a = lambda f: f.get("acodec") != "none"
    H = lambda f: f.get("height") or 0
    T = lambda f: f.get("tbr") or 0
    vids = [f for f in fm if has_v(f)]
    if not vids:
        return None
    muxed = [f for f in vids if has_a(f)]
    auds = [f for f in fm if has_a(f) and not has_v(f)]
    small = [f for f in vids if H(f) >= 144] or vids
    video = min(small, key=lambda f: (H(f), T(f)))
    auds_ok = [f for f in auds if (f.get("abr") or T(f)) <= 130] or auds
    audio = max(auds_ok, key=T) if auds_ok else min(muxed or vids, key=lambda f: (H(f), T(f)))
    pool = [f for f in (muxed or vids) if H(f) <= CLIP_MAX_H] or (muxed or vids)
    clip = max(pool, key=lambda f: (H(f), T(f)))
    return dict(video=video["url"], audio=audio["url"], clip=clip["url"])


def net_opts(ua):
    o = ["-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5", "-rw_timeout", "15000000"]
    return o + (["-user_agent", ua] if ua else [])


# ───────────────────────────── Whisper (local, free) ─────────────────────────────
def _has_cuda():
    try:
        import ctranslate2
        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


class Transcriber:
    """One shared faster-whisper model, fed through a bounded queue so it can never stall the real-time path."""

    def __init__(self):
        from faster_whisper import WhisperModel
        cuda = _has_cuda()
        name = _s("WHISPER_MODEL", "large-v3-turbo" if cuda else "small")
        self.lang = _s("WHISPER_LANG") or None
        log.info("Whisper: %s on %s", name, "CUDA" if cuda else "CPU")
        self.model = WhisperModel(name, device="cuda" if cuda else "cpu",
                                  compute_type="float16" if cuda else "int8")
        self.q = queue.Queue(maxsize=8)
        threading.Thread(target=self._run, daemon=True, name="whisper").start()

    def submit(self, cb, t0, pcm):
        try:
            self.q.put_nowait((cb, t0, pcm))
        except queue.Full:
            log.warning("Whisper is behind; dropping a chunk")

    def _run(self):
        while True:
            cb, t0, pcm = self.q.get()
            try:
                audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0
                segs, _ = self.model.transcribe(audio, language=self.lang, beam_size=1, vad_filter=True,
                                                condition_on_previous_text=False)
                cb([(t0 + s.start, t0 + s.end, s.text.strip()) for s in segs])
            except Exception as e:
                log.warning("Whisper error: %s", e)


# ───────────────────────────── LLM analysis (Groq / NVIDIA) ─────────────────────────────
def llm_chat(base, key, model, messages, json_mode=True, timeout=40):
    body = {"model": model, "messages": messages, "temperature": 0.2, "max_tokens": 500}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    r = httpx.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"}, json=body, timeout=timeout)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


SYSTEM_PROMPT = (
    "You are a live-stream highlight editor. A spike detector (pure code: loudness, motion, chat rate, "
    "emoji/keyword reactions) already flagged this moment, so the numbers are real. Using the data, decide "
    "if it is a clip-worthy moment. Reply with ONLY JSON: "
    '{"title": str (max 70 chars), "category": "hype|funny|clutch|rage|fail|wholesome|story|other", '
    '"why": str (1-2 sentences), "hype_score": int 1-10, "keep": bool, "tags": [str]}'
)


def analyze(ctx: dict):
    providers = {"groq": (GROQ_BASE, GROQ_KEY, GROQ_MODEL, True), "nvidia": (NVIDIA_BASE, NVIDIA_KEY, NVIDIA_MODEL, False)}
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": json.dumps(ctx, ensure_ascii=False)}]
    for name in LLM_ORDER:
        base, key, model, jm = providers.get(name, (None, None, None, None))
        if not key:
            continue
        try:
            txt = llm_chat(base, key, model, msgs, json_mode=jm)
            m = re.search(r"\{.*\}", txt, re.S)
            return {**json.loads(m.group(0)), "llm": f"{name}:{model}"}
        except Exception as e:
            log.warning("%s analysis failed: %s", name, e)
    return None


def caption_frame(frame: Path):
    """Optional: NVIDIA vision model describes the peak frame."""
    if not (NVIDIA_KEY and NVIDIA_VISION_MODEL and frame.exists()):
        return None
    b64 = base64.b64encode(frame.read_bytes()).decode()
    msgs = [{"role": "user", "content": [
        {"type": "text", "text": "One sentence: what is happening in this live-stream frame (game action, reaction, scene)?"},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}]}]
    try:
        return llm_chat(NVIDIA_BASE, NVIDIA_KEY, NVIDIA_VISION_MODEL, msgs, json_mode=False)
    except Exception as e:
        log.warning("vision caption failed: %s", e)
        return None


# ───────────────────────────── clip cutting from the ring buffer ─────────────────────────────
SEG_RE = re.compile(r"seg_(\d{8}_\d{6})\.ts$")


def list_segments(buf: Path):
    out = []
    for p in buf.glob("seg_*.ts"):
        m = SEG_RE.search(p.name)
        if m:
            out.append((time.mktime(time.strptime(m.group(1), "%Y%m%d_%H%M%S")), p))
    return sorted(out)


def cut_clip(buf: Path, t0: float, t1: float, dest: Path):
    segs = list_segments(buf)
    chosen = []
    for i, (st, p) in enumerate(segs):
        en = segs[i + 1][0] if i + 1 < len(segs) else st + SEG_SECONDS + 2
        if en > t0 and st < t1:
            chosen.append((st, p))
    if not chosen:
        return None
    lst = dest.with_suffix(".txt")
    lst.write_text("".join(f"file '{p.resolve().as_posix()}'\n" for _, p in chosen))
    codec = ["-c", "copy"] if CLIP_VCODEC == "copy" else ["-c:v", CLIP_VCODEC, "-c:a", "aac"]
    cmd = [FFMPEG, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
           "-ss", f"{max(0.0, t0 - chosen[0][0]):.2f}", "-t", f"{t1 - t0:.2f}", *codec,
           "-movflags", "+faststart", str(dest)]
    try:
        subprocess.run(cmd, check=True, timeout=180)
        return dest
    except Exception as e:
        log.warning("clip cut failed: %s", e)
        return None
    finally:
        lst.unlink(missing_ok=True)


# ───────────────────────────── one live session ─────────────────────────────
TWITCH_RE = re.compile(r"^:(\w+)!\w+@\S+ PRIVMSG #\S+ :(.*)$")


class Session:
    def __init__(self, url, info, out_root: Path, tr: Transcriber | None):
        self.url, self.info, self.tr = url, info, tr
        self.platform = "twitch" if "twitch.tv" in url else "youtube"
        raw = urlparse(url).path.strip("/").split("/")[0] if self.platform == "twitch" else (info.get("uploader") or info.get("id"))
        self.name = re.sub(r"[^\w\-]+", "_", str(raw))
        self.out = out_root / self.name
        self.out.mkdir(parents=True, exist_ok=True)
        self.buf = out_root / ".buffer" / f"{self.name}_{int(time.time())}"
        self.buf.mkdir(parents=True, exist_ok=True)
        self.base = {k: Baseline(min_sd=v["min_sd"]) for k, v in SIG.items()}
        self.chat, self.chat_up = ChatMeter(), False
        self.audio_blk, self.motion_blk = [], []
        self.ev, self.hot_run = None, 0
        self.transcript = deque(maxlen=400)
        self.recent = deque(maxlen=50)
        self.lock = threading.Lock()
        self.pool = ThreadPoolExecutor(2)
        self.procs, self.stopped = [], threading.Event()

    # ---- subprocess helpers
    async def _spawn(self, args, stdout):
        p = await asyncio.create_subprocess_exec(FFMPEG, "-nostdin", "-loglevel", "error", *args, stdout=stdout)
        self.procs.append(p)
        return p

    # ---- audio: loudness + Whisper feed
    async def _pipe_audio(self, cmd):
        p = await self._spawn(cmd, asyncio.subprocess.PIPE)
        blk = SR // 4 * 2                                  # 0.25 s of int16
        wbuf, wt0 = bytearray(), None
        try:
            while True:
                data = await p.stdout.readexactly(blk)
                now = time.time()
                x = np.frombuffer(data, np.int16).astype(np.float32) / 32768.0
                db = 20 * math.log10(float(np.sqrt(np.mean(x * x))) + 1e-9)
                self.audio_blk.append(max(db, -80.0))
                if self.tr:
                    wt0 = wt0 if wt0 is not None else now - 0.25
                    wbuf += data
                    if len(wbuf) >= SR * 2 * WHISPER_CHUNK_S:
                        self.tr.submit(self.on_transcript, wt0, bytes(wbuf))
                        wbuf.clear()
                        wt0 = None
        except asyncio.IncompleteReadError:
            log.info("[%s] audio feed ended", self.name)

    # ---- video: frame-difference motion
    async def _pipe_video(self, cmd):
        p = await self._spawn(cmd, asyncio.subprocess.PIPE)
        prev = None
        try:
            while True:
                data = await p.stdout.readexactly(VW * VH)
                f = np.frombuffer(data, np.uint8).astype(np.int16)
                if prev is not None:
                    self.motion_blk.append(float(np.abs(f - prev).mean()))
                prev = f
        except asyncio.IncompleteReadError:
            log.info("[%s] video feed ended", self.name)

    async def _recorder(self, cmd):
        p = await self._spawn(cmd, asyncio.subprocess.DEVNULL)
        await p.wait()
        log.info("[%s] recorder exited", self.name)

    async def _cleaner(self):
        while True:
            await asyncio.sleep(30)
            cutoff = time.time() - BUFFER_S
            for st, p in list_segments(self.buf):
                if st < cutoff:
                    p.unlink(missing_ok=True)

    # ---- chat
    async def _twitch_chat(self, channel):
        while True:
            try:
                r, w = await asyncio.open_connection("irc.chat.twitch.tv", 6697, ssl=True)
                w.write(f"NICK justinfan{random.randint(10000, 99999)}\r\nJOIN #{channel.lower()}\r\n".encode())
                await w.drain()
                while True:
                    line = await asyncio.wait_for(r.readline(), timeout=420)
                    if not line:
                        break
                    self.chat_up = True
                    s = line.decode("utf-8", "ignore").strip()
                    if s.startswith("PING"):
                        w.write(b"PONG :tmi.twitch.tv\r\n")
                        await w.drain()
                        continue
                    m = TWITCH_RE.match(s)
                    if m:
                        self.chat.add(m.group(1), m.group(2))
            except Exception as e:
                log.warning("[%s] twitch chat: %s", self.name, e)
            self.chat_up = False
            await asyncio.sleep(5)

    def _yt_chat_thread(self, loop, url):
        try:
            from chat_downloader import ChatDownloader
            chat = ChatDownloader().get_chat(url, message_types=["text_message"], retry_timeout=30)
            self.chat_up = True
            for m in chat:
                if self.stopped.is_set():
                    break
                loop.call_soon_threadsafe(self.chat.add, (m.get("author") or {}).get("name", "?"), m.get("message", ""))
        except Exception as e:
            log.warning("[%s] YouTube chat unavailable: %s", self.name, e)
        self.chat_up = False

    # ---- real-time fusion (the actual spike detector)
    async def _ticker(self, debug):
        while True:
            await asyncio.sleep(1)
            now = time.time()
            vals = {}
            if self.audio_blk:
                vals["audio"] = sum(self.audio_blk) / len(self.audio_blk)
                self.audio_blk.clear()
            if self.motion_blk:
                vals["motion"] = sum(self.motion_blk) / len(self.motion_blk)
                self.motion_blk.clear()
            if self.chat_up:
                msgs, pts = self.chat.window(now, 5.0)
                vals["chat_rate"], vals["chat_react"] = msgs / 5.0, pts / 5.0
            zs = {}
            for k, v in vals.items():
                b = self.base[k]
                z = 0.0 if v < SIG[k]["abs_min"] else b.z(v)
                b.update(v, z)
                zs[k] = z
            if not zs:
                continue
            wsum = sum(SIG[k]["w"] for k in zs)
            fused = sum(SIG[k]["w"] * min(max(z, 0.0), ZCAP) for k, z in zs.items()) / wsum
            agree = sum(1 for z in zs.values() if z >= AGREE_Z) >= min(MIN_AGREE, len(zs))
            if debug:
                log.debug("[%s] fused=%.2f agree=%s z=%s raw=%s", self.name, fused, agree,
                          {k: round(z, 1) for k, z in zs.items()}, {k: round(v, 1) for k, v in vals.items()})
            self._advance(now, fused, agree, zs)

    def _advance(self, now, fused, agree, zs):
        if self.ev is None:
            self.hot_run = self.hot_run + 1 if (fused >= HIGH and agree) else 0
            if self.hot_run < MIN_SUSTAIN:
                return
            self.ev = Event(start=now - self.hot_run, last_hot=now)
            log.info("[%s] SPIKE started (fused=%.2f)", self.name, fused)
        ev = self.ev
        if fused >= LOW:
            ev.last_hot = now
        if fused > ev.peak:
            ev.peak, ev.peak_ts = fused, now
        for k, z in zs.items():
            ev.peak_z[k] = max(ev.peak_z.get(k, 0.0), z)
        if now - ev.last_hot >= COOLDOWN or now - ev.start >= MAX_EVENT:
            self.ev, self.hot_run = None, 0
            self._finalize(ev, now)

    def _finalize(self, ev, now):
        t0, t1 = ev.start - PRE_ROLL, min(now, ev.last_hot + POST_ROLL)
        self._submit(ev, t0, t1)

    def _submit(self, ev, t0, t1):
        with self.lock:
            self.recent.append((t0, t1))
        msgs = self.chat.slice(t0, t1)
        log.info("[%s] SPIKE ended: peak=%.2f z=%s -> clipping", self.name, ev.peak,
                 {k: round(v, 1) for k, v in ev.peak_z.items()})
        self.pool.submit(self._process, ev, t0, t1, msgs)

    # ---- Whisper callback (arrives ~15-25 s late, so it enriches events and can trigger on speech alone)
    def on_transcript(self, segs):
        for a, b, text in segs:
            if not text:
                continue
            pts, _ = score_text(text)
            with self.lock:
                self.transcript.append((a, b, text))
                covered = any(r0 < b and a < r1 for r0, r1 in self.recent) or (self.ev and self.ev.start - 5 < b)
            if pts >= SPEECH_TRIGGER and not covered:
                log.info("[%s] speech-triggered moment: %r", self.name, text[:80])
                self._submit(Event(start=a, last_hot=b, source="speech"), a - 8, min(time.time(), b + 6))

    def transcript_slice(self, t0, t1):
        with self.lock:
            return [s for s in self.transcript if s[1] >= t0 and s[0] <= t1]

    # ---- worker thread: cut clip -> gather context -> Groq/NVIDIA -> write report
    def _process(self, ev, t0, t1, chat_msgs):
        stamp = time.strftime("%Y%m%d_%H%M%S", time.localtime(ev.start))
        clip = self.out / f"{stamp}_{ev.source}_{ev.peak:.1f}.mp4"
        cut = cut_clip(self.buf, t0, t1, clip)
        if ev.source != "speech" and self.tr:
            time.sleep(WHISPER_CHUNK_S + 8)               # let Whisper catch up so the transcript is included
        tx = self.transcript_slice(t0, t1)
        cats = Counter()
        for e in chat_msgs:
            cats.update(e[2])
        top = sorted(chat_msgs, key=lambda e: -e[1])[:12]
        ctx = dict(streamer=self.name, platform=self.platform, stream_title=self.info.get("title"),
                   clip_seconds=round(t1 - t0, 1), trigger=ev.source, fused_peak=round(ev.peak, 2),
                   peak_z={k: round(v, 1) for k, v in ev.peak_z.items()}, chat_messages=len(chat_msgs),
                   chat_reactions=dict(cats), chat_top=[e[4] for e in top],
                   transcript=" ".join(s[2] for s in tx)[:1500])
        if cut and NVIDIA_VISION_MODEL:
            frame = clip.with_suffix(".jpg")
            subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-ss", f"{max(0, ev.peak_ts - t0):.1f}", "-i", str(cut),
                            "-frames:v", "1", "-vf", "scale=640:-1", "-q:v", "4", str(frame)], timeout=60)
            ctx["frame_caption"] = caption_frame(frame)
            frame.unlink(missing_ok=True)
        verdict = analyze(ctx)
        meta = dict(clip=str(cut) if cut else None, window=[t0, t1], context=ctx, verdict=verdict)
        (self.out / f"{stamp}_{ev.source}_{ev.peak:.1f}.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
        if verdict and not verdict.get("keep", True) and DROP_REJECTS and cut:
            cut.unlink(missing_ok=True)
        log.info("[%s] saved %s | %s", self.name, clip.name, (verdict or {}).get("title", "(no LLM verdict)"))

    # ---- lifecycle
    async def run(self, debug=False):
        urls = pick_urls(self.info)
        if not urls:
            log.warning("[%s] no usable formats", self.name)
            return
        ua = (self.info.get("http_headers") or {}).get("User-Agent")
        net = net_opts(ua)
        a_cmd = ["-threads", "1", *net, "-i", urls["audio"], "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "pipe:1"]
        v_cmd = ["-threads", "1", *net, "-i", urls["video"], "-an", "-vf",
                 f"fps={MOTION_FPS},scale={VW}:{VH}:flags=fast_bilinear,format=gray", "-f", "rawvideo", "pipe:1"]
        r_cmd = [*net, "-i", urls["clip"], "-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy", "-f", "segment",
                 "-segment_time", str(SEG_SECONDS), "-segment_format", "mpegts", "-reset_timestamps", "1",
                 "-strftime", "1", str(self.buf / "seg_%Y%m%d_%H%M%S.ts")]
        loop = asyncio.get_running_loop()
        core = [asyncio.create_task(self._pipe_audio(a_cmd)), asyncio.create_task(self._pipe_video(v_cmd)),
                asyncio.create_task(self._recorder(r_cmd))]
        aux = [asyncio.create_task(self._ticker(debug)), asyncio.create_task(self._cleaner())]
        if self.platform == "twitch":
            aux.append(asyncio.create_task(self._twitch_chat(self.name)))
        else:
            threading.Thread(target=self._yt_chat_thread, args=(loop, self.info.get("webpage_url") or self.url),
                             daemon=True).start()
        try:
            await asyncio.wait(core, return_when=asyncio.FIRST_COMPLETED)
        finally:
            self.stopped.set()
            for t in core + aux:
                t.cancel()
            for p in self.procs:
                if p.returncode is None:
                    p.kill()
            await asyncio.gather(*core, *aux, return_exceptions=True)
            if self.ev:
                self._finalize(self.ev, time.time())
                self.ev = None
            self.pool.shutdown(wait=False)


# ───────────────────────────── 24/7 supervisor ─────────────────────────────
OFFLINE_HINTS = ("offline", "not currently live", "no live", "will begin", "is not live", "premieres")


async def supervisor(url, out_root, tr, debug):
    while True:
        try:
            info = await asyncio.to_thread(probe, url)
        except DownloadError as e:
            msg = str(e).lower()
            (log.debug if any(h in msg for h in OFFLINE_HINTS) else log.warning)("probe: %s", str(e)[:200])
            info = None
        except Exception as e:
            log.warning("probe failed: %s", e)
            info = None
        if not info:
            await asyncio.sleep(POLL_OFFLINE + random.uniform(0, 10))
            continue
        log.info("LIVE: %s", info.get("title") or url)
        started = time.time()
        try:
            await Session(url, info, out_root, tr).run(debug)
        except Exception:
            log.exception("session crashed")
        # stream URL expired or stream ended; if it is still live we re-probe and restart quickly
        await asyncio.sleep(30 if time.time() - started < 30 else 5)


async def amain(urls, out_root, no_whisper, debug):
    shutil.rmtree(out_root / ".buffer", ignore_errors=True)
    tr = None if no_whisper else await asyncio.to_thread(Transcriber)
    await asyncio.gather(*(supervisor(u, out_root, tr, debug) for u in urls))


def main():
    ap = argparse.ArgumentParser(description="24/7 live-stream spike catcher")
    ap.add_argument("urls", nargs="+", help="twitch.tv/NAME or youtube.com/@NAME/live")
    ap.add_argument("--out", default="clips")
    ap.add_argument("--no-whisper", action="store_true")
    ap.add_argument("--debug", action="store_true", help="print per-second z-scores for tuning")
    a = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if a.debug else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not found on PATH")
    try:
        asyncio.run(amain(a.urls, Path(a.out), a.no_whisper, a.debug))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()

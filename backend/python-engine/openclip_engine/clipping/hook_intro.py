"""
Viral Cold-Open Preview + Male AI Narrator Hook Intro generator.

Before the main clip starts, prepends a punchy 2.5-4.5s cold-open teaser:
  1. Visual: Peak-energy climax preview slice taken directly from the clean
     (caption-free) source clip, rendered in the matching layout with a subtle
     punch-in zoom and sleek "PREVIEW" pill badge.
  2. Audio: Male AI Narrator voiceover (Tier 1: Microsoft Edge Neural Male
     `en-US-ChristopherNeural` with exact WordBoundary timestamps; Tier 2:
     Groq Orpheus `troy`; Tier 3: macOS `say -v Daniel` offline fallback)
     delivering a tailored 1-sentence hook ("This is what happened when
     IShowSpeed..."), mixed over ducked (-17 dB) preview ambience plus a
     crisp transition whoosh into the main clip.
  3. Captions: High-contrast Montserrat ExtraBold active-word captions synced
     to the narrator's exact word timings.
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
import re
import subprocess
import tempfile
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from openclip_engine.clipping.llm_helper import call_llm_json

logger = logging.getLogger(__name__)

_DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]+")
_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002700-\U000027BF"
    "\U00002600-\U000026FF"
    "]+",
    flags=re.UNICODE,
)

DEFAULT_MALE_VOICE = "en-US-ChristopherNeural"
MALE_VOICE_FALLBACKS = (
    "en-US-ChristopherNeural",
    "en-US-GuyNeural",
    "en-US-EricNeural",
    "en-US-RogerNeural",
)


def _clean_english(text: str) -> str:
    txt = _DEVANAGARI_RE.sub(" ", text or "")
    txt = _EMOJI_RE.sub(" ", txt)
    txt = re.sub(r"#[A-Za-z0-9_]+", " ", txt)
    txt = txt.replace('"', "").replace("“", "").replace("”", "")
    txt = re.sub(r"\s+", " ", txt).strip()
    return txt


def _clean_streamer_name(uploader: str, video_title: str = "") -> str:
    up = _clean_english(uploader)
    if up and up.lower() not in ("youtube creator", "unknown", "channel", "creator", "user"):
        # Trim noisy suffixes like "Live", "Official", "Gaming" only if long
        if len(up) <= 28:
            return up
        return " ".join(up.split()[:3])
    # Try to infer from title patterns like "IShowSpeed ..." or "... | Mythpat"
    t = _clean_english(video_title)
    if "|" in t:
        tail = t.split("|")[-1].strip()
        if 2 <= len(tail) <= 24:
            return tail
    return ""


def _fallback_hook_narration(
    transcript: str,
    video_title: str,
    uploader: str = "",
    hook_sentence: str = "",
    is_live: bool = False,
) -> str:
    streamer = _clean_streamer_name(uploader, video_title)
    hook = _clean_english(hook_sentence) or _clean_english(transcript)
    low = f"{video_title} {hook}".lower()

    if any(k in low for k in ("clutch", "1v4", "1v3", "1 hp", "one hp", "win", "victory", "goal")):
        action = "pulled off the craziest clutch"
    elif any(k in low for k in ("rage", "angry", "scream", "mad", "lost his mind", "crazy", "insane")):
        action = "completely lost it"
    elif any(k in low for k in ("fail", "died", "broke", "destroyed", "mistake", "wrong", "disaster")):
        action = "watched everything go completely wrong"
    elif any(k in low for k in ("scared", "horror", "ghost", "jumpscare", "terrified")):
        action = "got scared out of nowhere"
    elif any(k in low for k in ("money", "$", "dollar", "million", "thousand", "prize")):
        action = "put everything on the line"
    else:
        action = "had the wildest moment"

    if streamer and is_live:
        return f"This is what happened when {streamer} {action} live on stream!"
    if streamer:
        return f"This is what happened when {streamer} {action}, watch this!"
    if is_live:
        return f"This is what happened live on stream right before it got crazy!"
    return "This is what happened right before everything went completely crazy!"


def generate_hook_narration(
    transcript: str,
    video_title: str,
    uploader: str = "",
    hook_sentence: str = "",
    is_live: bool = False,
    use_llm: bool = True,
    custom_context: str = "",
) -> str:
    """
    Writes a punchy 1-sentence English Male Narrator cold-open hook (8-15 words, ~2.8-3.8s)
    telling viewers specifically what happened with the streamer/creator in THIS clip.
    """
    fallback = _fallback_hook_narration(
        transcript=transcript,
        video_title=video_title,
        uploader=uploader,
        hook_sentence=hook_sentence,
        is_live=is_live,
    )
    if not use_llm:
        return fallback

    streamer = _clean_streamer_name(uploader, video_title)
    sys_prompt = (
        "You write ultra-punchy 1-sentence cold-open narrator hooks for viral YouTube Shorts, Reels, "
        "and TikTok streamer clip channels (like IShowSpeed, Kai Cenat, Mythpat highlight channels). "
        "Return ONLY valid JSON: {\"narration\": \"...\"}. "
        "Rules:\n"
        "- STRICTLY ONE short English sentence, 8 to 14 words total (2.8 to 3.8 seconds spoken).\n"
        "- Start with a natural narrator setup like 'This is what happened when <streamer>...', "
        "'This is what happened with <streamer> when...', or 'Watch what happened when <streamer>...'.\n"
        "- Focus on the SPECIFIC crazy event/quote/reaction in THIS clip's transcript or custom note — "
        "NEVER just repeat the generic stream title.\n"
        "- Mention the streamer/creator name naturally if provided.\n"
        "- Build instant curiosity WITHOUT spoiling the punchline.\n"
        "- Pure English only, no emojis, no hashtags, no quotes, no Devanagari."
    )
    custom_block = f"Custom What Happened Note (PRIORITIZE THIS): {_clean_english(custom_context)[:220]}\n" if custom_context else ""
    user_prompt = (
        f"Creator/Streamer: {streamer or 'Unknown'}\n"
        f"Format: {'Live Stream' if is_live else 'Video'}\n"
        f"{custom_block}"
        f"Source Title (background only, do NOT copy verbatim): {_clean_english(video_title)[:120]}\n"
        f"Opening Hook: {_clean_english(hook_sentence)[:160]}\n"
        f"Clip Transcript (focus on what ACTUALLY happens here): {_clean_english(transcript)[:550]}\n\n"
        "Return strict JSON with key: narration."
    )

    try:
        raw = call_llm_json(user_prompt, system_prompt=sys_prompt, timeout_s=10.0)
        if isinstance(raw, dict):
            cand = _clean_english(str(raw.get("narration") or ""))
            words = cand.split()
            if 5 <= len(words) <= 20 and len(cand) <= 130:
                if cand[-1] not in ".!?":
                    cand += "!"
                return cand
    except Exception as exc:
        logger.debug("LLM hook narration fallback: %s", exc)

    return fallback


def _probe_media_info(media_path: Path, ffmpeg_bin: str = "ffmpeg") -> Dict[str, Any]:
    ffprobe_bin = ffmpeg_bin.replace("ffmpeg", "ffprobe")
    out: Dict[str, Any] = {
        "duration": 0.0,
        "width": 1080,
        "height": 1920,
        "fps": 30.0,
        "has_audio": False,
    }
    try:
        res = subprocess.run(
            [
                ffprobe_bin, "-v", "error",
                "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate,avg_frame_rate",
                "-of", "json",
                str(media_path),
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if res.returncode == 0:
            import json
            data = json.loads(res.stdout)
            dur = float((data.get("format") or {}).get("duration") or 0.0)
            if dur > 0:
                out["duration"] = dur
            for s in data.get("streams") or []:
                ctype = s.get("codec_type")
                if ctype == "video":
                    out["width"] = int(s.get("width") or out["width"])
                    out["height"] = int(s.get("height") or out["height"])
                    rate_str = s.get("avg_frame_rate") or s.get("r_frame_rate") or "30/1"
                    if "/" in str(rate_str):
                        num, den = str(rate_str).split("/", 1)
                        if float(den) > 0 and float(num) > 0:
                            fps_val = float(num) / float(den)
                            if 10.0 <= fps_val <= 120.0:
                                out["fps"] = fps_val
                elif ctype == "audio":
                    out["has_audio"] = True
    except Exception:
        pass
    return out


def _proportional_word_timings(text: str, duration_s: float) -> List[Dict[str, Any]]:
    words = [w for w in text.split() if w.strip()]
    if not words:
        return []
    start_pad = min(0.08, duration_s * 0.04)
    end_pad = min(0.10, duration_s * 0.05)
    usable = max(0.3, duration_s - start_pad - end_pad)
    weights = [max(2, len(re.sub(r"[^A-Za-z0-9]", "", w))) for w in words]
    total_w = float(sum(weights))
    cur = start_pad
    out: List[Dict[str, Any]] = []
    for w, wt in zip(words, weights):
        dur = usable * (wt / total_w)
        out.append({"word": w, "start": round(cur, 3), "end": round(cur + dur, 3)})
        cur += dur
    return out


def _synthesize_edge_tts(
    text: str,
    mp3_path: Path,
    voice: str = DEFAULT_MALE_VOICE,
    rate: str = "+8%",
) -> Optional[List[Dict[str, Any]]]:
    try:
        import edge_tts
    except Exception:
        return None

    candidates: List[str] = []
    for v in (voice, *MALE_VOICE_FALLBACKS):
        if v and v not in candidates:
            candidates.append(v)

    async def _run_voice(v_name: str) -> Tuple[bytes, List[Dict[str, Any]]]:
        comm = edge_tts.Communicate(text, voice=v_name, rate=rate, boundary="WordBoundary")
        buf = bytearray()
        words: List[Dict[str, Any]] = []
        async for msg in comm.stream():
            mtype = msg.get("type")
            if mtype == "audio":
                data = msg.get("data")
                if isinstance(data, (bytes, bytearray)):
                    buf.extend(data)
            elif mtype == "WordBoundary":
                w_txt = str(msg.get("text") or "").strip()
                if w_txt:
                    off = float(msg.get("offset") or 0) / 1e7
                    dur = float(msg.get("duration") or 0) / 1e7
                    words.append({
                        "word": w_txt,
                        "start": round(off, 3),
                        "end": round(off + max(0.08, dur), 3),
                    })
        return bytes(buf), words

    for v_name in candidates:
        try:
            # Handle both main-thread and worker-thread execution cleanly
            loop = asyncio.new_event_loop()
            try:
                audio_bytes, words = loop.run_until_complete(asyncio.wait_for(_run_voice(v_name), timeout=14.0))
            finally:
                loop.close()
            if len(audio_bytes) > 1000:
                mp3_path.write_bytes(audio_bytes)
                return words
        except Exception as exc:
            logger.debug("edge-tts voice %s failed: %s", v_name, exc)
            continue
    return None


def _synthesize_groq_orpheus(text: str, raw_wav_path: Path, voice: str = "troy") -> bool:
    key = (os.environ.get("GROQ_API_KEY") or "").strip()
    if not key:
        return False
    try:
        import httpx

        resp = httpx.post(
            "https://api.groq.com/openai/v1/audio/speech",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": "canopylabs/orpheus-v1-english",
                "voice": voice,
                "input": text,
                "response_format": "wav",
            },
            timeout=14.0,
        )
        if resp.status_code == 200 and len(resp.content) > 1000:
            raw_wav_path.write_bytes(resp.content)
            return True
    except Exception as exc:
        logger.debug("Groq Orpheus TTS failed: %s", exc)
    return False


def _synthesize_macos_say(text: str, aiff_path: Path) -> bool:
    for mac_voice in ("Daniel", "Reed (English (US))", "Eddy (English (US))"):
        try:
            res = subprocess.run(
                ["say", "-v", mac_voice, "-r", "195", "-o", str(aiff_path), text],
                capture_output=True,
                text=True,
                timeout=15,
            )
            if res.returncode == 0 and aiff_path.exists() and aiff_path.stat().st_size > 1000:
                return True
        except Exception:
            continue
    return False


def synthesize_male_narrator_voice(
    text: str,
    out_wav: Path,
    voice: str = DEFAULT_MALE_VOICE,
    rate: str = "+8%",
    ffmpeg_bin: str = "ffmpeg",
    allow_network: bool = True,
) -> Tuple[Path, float, List[Dict[str, Any]], str]:
    """
    Synthesizes crisp Male AI Narrator voiceover into a 48kHz stereo mastered WAV.
    Returns `(wav_path, duration_s, word_timings, backend_used)`.
    """
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    tmp_mp3 = out_wav.with_suffix(".edge.mp3")
    tmp_raw_wav = out_wav.with_suffix(".groq.wav")
    tmp_aiff = out_wav.with_suffix(".say.aiff")

    src_audio: Optional[Path] = None
    word_timings: List[Dict[str, Any]] = []
    backend = "none"

    try:
        # Tier 1: Edge Neural Male Voice (fast, realistic, exact WordBoundary timings)
        if allow_network and os.getenv("OPENCLIP_DISABLE_TTS_NETWORK", "").lower() not in ("1", "true", "yes"):
            edge_words = _synthesize_edge_tts(text, tmp_mp3, voice=voice, rate=rate)
            if edge_words is not None and tmp_mp3.exists():
                src_audio = tmp_mp3
                word_timings = edge_words
                backend = f"edge_tts:{voice}"

        # Tier 2: Groq Orpheus Male Voice (if Edge fails and Groq TTS terms accepted)
        if src_audio is None and allow_network and os.getenv("OPENCLIP_DISABLE_TTS_NETWORK", "").lower() not in ("1", "true", "yes"):
            if _synthesize_groq_orpheus(text, tmp_raw_wav, voice="troy"):
                src_audio = tmp_raw_wav
                backend = "groq_orpheus:troy"

        # Tier 3: Offline macOS Male Voice (`say -v Daniel`)
        if src_audio is None:
            if _synthesize_macos_say(text, tmp_aiff):
                src_audio = tmp_aiff
                backend = "macos_say:Daniel"

        if src_audio is None:
            raise RuntimeError("No TTS backend available to synthesize male narrator voice")

        # Master voiceover: clean 85 Hz HPF, gentle presence & loudness targeting -13.5 LUFS,
        # 48 kHz stereo PCM. Keep start aligned at t=0 so Edge WordBoundary timestamps stay exact!
        af = (
            "highpass=f=85,"
            "equalizer=f=2800:t=q:w=1.2:g=2.5,"
            "acompressor=threshold=-18dB:ratio=3:attack=5:release=60:makeup=2,"
            "loudnorm=I=-13.5:TP=-1.0:LRA=6,"
            "aresample=48000"
        )
        res = subprocess.run(
            [
                ffmpeg_bin, "-y", "-loglevel", "error",
                "-i", str(src_audio),
                "-af", af,
                "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le",
                str(out_wav),
            ],
            capture_output=True,
            text=True,
            timeout=25,
        )
        if res.returncode != 0 or not out_wav.exists() or out_wav.stat().st_size < 1000:
            raise RuntimeError(f"FFmpeg narrator audio mastering failed: {res.stderr[-250:]}")

        dur_s = _probe_media_info(out_wav, ffmpeg_bin=ffmpeg_bin)["duration"]
        if dur_s <= 0.2:
            dur_s = 3.0
        if not word_timings:
            word_timings = _proportional_word_timings(text, dur_s)

        return out_wav, dur_s, word_timings, backend
    finally:
        for p in (tmp_mp3, tmp_raw_wav, tmp_aiff):
            try:
                p.unlink(missing_ok=True)
            except Exception:
                pass


def find_preview_window(
    source_video_path: Path,
    preview_dur: float,
    ffmpeg_bin: str = "ffmpeg",
) -> float:
    """
    Finds the highest-energy climax moment inside the clip (preferring 35%-88% of
    the clip duration) so the cold-open teaser shows a thrilling flash-forward of
    what is about to happen without repeating the opening second.
    """
    info = _probe_media_info(source_video_path, ffmpeg_bin=ffmpeg_bin)
    total_dur = float(info.get("duration") or 0.0)
    if total_dur <= preview_dur + 0.5:
        return 0.0

    search_start = max(0.0, total_dur * 0.35)
    search_end = max(search_start + 0.5, total_dur - preview_dur - 0.15)
    if search_end <= search_start:
        return max(0.0, (total_dur - preview_dur) * 0.5)

    try:
        # Fast 16 kHz mono PCM decode to compute 0.25s RMS energy windows (~50ms total)
        res = subprocess.run(
            [
                ffmpeg_bin, "-v", "error",
                "-i", str(source_video_path),
                "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1",
            ],
            capture_output=True,
            timeout=15,
        )
        if res.returncode == 0 and len(res.stdout) >= 8000:
            samples = np.frombuffer(res.stdout, dtype=np.int16).astype(np.float32)
            hop = 4000  # 0.25s at 16kHz
            n_frames = len(samples) // hop
            if n_frames > 4:
                trimmed = samples[: n_frames * hop].reshape(n_frames, hop)
                rms = np.sqrt(np.mean(trimmed * trimmed, axis=1) + 1e-6)
                win_frames = max(1, int(round(preview_dur / 0.25)))
                i_start = max(0, int(search_start / 0.25))
                i_end = min(n_frames - win_frames, int(search_end / 0.25))
                if i_end >= i_start:
                    # Prefer peak excitement (70% max spike + 30% mean energy)
                    best_i = i_start
                    best_score = -1.0
                    for i in range(i_start, i_end + 1):
                        sl = rms[i : i + win_frames]
                        sc = 0.70 * float(np.max(sl)) + 0.30 * float(np.mean(sl))
                        if sc > best_score:
                            best_score = sc
                            best_i = i
                    return round(best_i * 0.25, 3)
    except Exception as exc:
        logger.debug("Preview window energy scan fallback: %s", exc)

    return round(min(search_end, max(search_start, total_dur * 0.52)), 3)


def _write_transition_whoosh_wav(out_wav: Path, duration_s: float = 0.24, sr: int = 48000) -> Path:
    """Generates a clean, punchy cinematic whoosh + soft sub-thump SFX for the intro->clip cut."""
    n = max(1, int(round(duration_s * sr)))
    t = np.linspace(0.0, duration_s, n, endpoint=False, dtype=np.float32)

    rng = np.random.default_rng(77)
    noise = rng.standard_normal(n).astype(np.float32)
    # Smooth rising air whoosh envelope peaking near 80% then sharp cutoff
    env = np.sin(np.pi * np.clip(t / duration_s, 0.0, 1.0)) ** 1.4
    # Simple moving-average low-pass for silky air texture
    k = 19
    kernel = np.ones(k, dtype=np.float32) / k
    whoosh = np.convolve(noise, kernel, mode="same") * env * 0.38

    # Soft cinematic sub-drop thump in the final 90ms
    thump_start = max(0.0, duration_s - 0.10)
    thump_mask = t >= thump_start
    t_th = np.clip(t - thump_start, 0.0, 1.0)
    freq = 110.0 * np.exp(-16.0 * t_th) + 42.0
    phase = 2.0 * np.pi * np.cumsum(freq) / sr
    thump = np.where(thump_mask, np.sin(phase) * np.exp(-26.0 * t_th) * 0.34, 0.0)

    sig = np.clip(whoosh + thump, -0.85, 0.85)
    pcm = (sig * 32767.0).astype(np.int16)
    stereo = np.column_stack([pcm, pcm]).ravel()

    with wave.open(str(out_wav), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(stereo.tobytes())
    return out_wav


def _load_bold_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/Users/brak/Library/Fonts/Montserrat-ExtraBold.ttf",
        "/Library/Fonts/Montserrat-ExtraBold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Black.ttf",
        "/System/Library/Fonts/Supplemental/Impact.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for fp in candidates:
        if Path(fp).exists():
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _chunk_narrator_words(words: Sequence[Dict[str, Any]], max_words: int = 3) -> List[Dict[str, Any]]:
    """Groups narrator words into punchy 2-3 word display chunks preserving exact word timings."""
    chunks: List[Dict[str, Any]] = []
    buf: List[Dict[str, Any]] = []
    for w in words:
        buf.append(dict(w))
        w_txt = str(w.get("word") or "")
        if len(buf) >= max_words or w_txt.endswith((".", "!", "?", ",")):
            chunks.append({
                "start": float(buf[0]["start"]),
                "end": float(buf[-1]["end"]),
                "words": list(buf),
            })
            buf = []
    if buf:
        chunks.append({
            "start": float(buf[0]["start"]),
            "end": float(buf[-1]["end"]),
            "words": list(buf),
        })
    return chunks


def _render_intro_overlay_frame(
    width: int,
    height: int,
    t: float,
    chunks: Sequence[Dict[str, Any]],
    font_cap: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    font_badge: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    is_live_layout: bool,
) -> bytes:
    """
    Renders a single full-frame RGBA overlay containing:
      - Sleek top-center "⚡ PREVIEW" cold-open pill badge
      - Bold active-word highlighted narrator hook captions
    """
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    is_vertical = height > width

    # 1. Sleek "PREVIEW" cold-open pill badge near top
    badge_txt = "PREVIEW"
    bx0, by0, bx1, by1 = draw.textbbox((0, 0), badge_txt, font=font_badge)
    bw, bh = bx1 - bx0, by1 - by0
    pad_x, pad_y = max(18, int(width * 0.022)), max(9, int(height * 0.007))
    pill_w = bw + pad_x * 2 + 16
    pill_h = bh + pad_y * 2
    pill_x = (width - pill_w) // 2
    pill_y = int(height * (0.14 if is_live_layout else (0.10 if is_vertical else 0.08)))

    draw.rounded_rectangle(
        [pill_x, pill_y, pill_x + pill_w, pill_y + pill_h],
        radius=pill_h // 2,
        fill=(14, 14, 18, 215),
        outline=(255, 212, 0, 235),
        width=3,
    )
    # Red/gold pulse dot inside pill
    dot_r = max(5, pill_h // 6)
    dot_cx = pill_x + pad_x + dot_r
    dot_cy = pill_y + pill_h // 2
    draw.ellipse([dot_cx - dot_r, dot_cy - dot_r, dot_cx + dot_r, dot_cy + dot_r], fill=(255, 59, 48, 255))
    draw.text(
        (dot_cx + dot_r + 10, pill_y + (pill_h - bh) // 2 - by0),
        badge_txt,
        font=font_badge,
        fill=(255, 255, 255, 255),
    )

    # 2. Active chunk caption with yellow active-word highlight + thick black outline
    active_chunk: Optional[Dict[str, Any]] = None
    for ch in chunks:
        if float(ch["start"]) - 0.04 <= t <= float(ch["end"]) + 0.14:
            active_chunk = ch
            break
    if active_chunk is None and chunks and t < float(chunks[0]["start"]):
        active_chunk = chunks[0]

    if active_chunk is not None:
        chunk_words = active_chunk["words"]
        # Determine active spoken word index inside the chunk
        active_wi = len(chunk_words) - 1
        for wi, wobj in enumerate(chunk_words):
            if t <= float(wobj["end"]) + 0.03:
                active_wi = wi
                break

        # Measure words side-by-side (wrap into 2 lines if wider than 86% of canvas)
        space_w = int(draw.textlength(" ", font=font_cap))
        max_line_w = int(width * 0.86)
        lines: List[List[Tuple[int, str, float]]] = []
        cur_line: List[Tuple[int, str, float]] = []
        cur_w = 0.0
        for wi, wobj in enumerate(chunk_words):
            txt = str(wobj["word"]).upper()
            tw = float(draw.textlength(txt, font=font_cap))
            add_w = tw if not cur_line else (space_w + tw)
            if cur_line and cur_w + add_w > max_line_w:
                lines.append(cur_line)
                cur_line = [(wi, txt, tw)]
                cur_w = tw
            else:
                cur_line.append((wi, txt, tw))
                cur_w += add_w
        if cur_line:
            lines.append(cur_line)

        stroke_w = max(5, int(width * 0.0075))
        sample_bb = draw.textbbox((0, 0), "Hg", font=font_cap)
        line_h = int((sample_bb[3] - sample_bb[1]) * 1.24)
        total_h = line_h * len(lines)
        # Place boldly below the live horizontal window or lower-third of vertical frame
        center_y = int(height * (0.72 if is_live_layout else (0.76 if is_vertical else 0.80)))
        start_y = center_y - total_h // 2

        for li, line_items in enumerate(lines):
            line_w = sum(item[2] for item in line_items) + space_w * max(0, len(line_items) - 1)
            x = (width - line_w) / 2.0
            y = start_y + li * line_h
            for wi, txt, tw in line_items:
                fill_col = (255, 216, 20, 255) if wi == active_wi else (255, 255, 255, 255)
                # Drop shadow
                draw.text(
                    (x, y + 4),
                    txt,
                    font=font_cap,
                    fill=(0, 0, 0, 180),
                    stroke_width=stroke_w,
                    stroke_fill=(0, 0, 0, 180),
                )
                draw.text(
                    (x, y),
                    txt,
                    font=font_cap,
                    fill=fill_col,
                    stroke_width=stroke_w,
                    stroke_fill=(0, 0, 0, 255),
                )
                x += tw + space_w

    return img.tobytes()


def prepend_ai_hook_intro(
    main_clip_path: Path,
    raw_source_path: Optional[Path] = None,
    transcript: str = "",
    video_title: str = "",
    uploader: str = "",
    hook_sentence: str = "",
    is_live: bool = False,
    aspect_ratio: str = "9:16",
    narrator_voice: str = DEFAULT_MALE_VOICE,
    narration_override: Optional[str] = None,
    ffmpeg_bin: str = "ffmpeg",
    use_llm: bool = True,
    allow_tts_network: bool = True,
) -> Dict[str, Any]:
    """
    Prepends a viral Cold-Open Preview + Male AI Narrator Hook Intro onto `main_clip_path`
    in-place (atomically via temp file).

    Returns metadata dict:
      {
        "applied": bool,
        "hook_narration": str,
        "intro_duration": float,
        "preview_start": float,
        "voice_backend": str,
        "narrator_words": list[dict],
      }
    """
    main_clip_path = Path(main_clip_path)
    src_for_preview = Path(raw_source_path) if (raw_source_path and Path(raw_source_path).exists()) else main_clip_path

    main_info = _probe_media_info(main_clip_path, ffmpeg_bin=ffmpeg_bin)
    target_w = int(main_info["width"])
    target_h = int(main_info["height"])
    fps_val = float(main_info["fps"] or 30.0)
    fps_int = max(24, min(60, int(round(fps_val))))
    main_has_audio = bool(main_info["has_audio"])

    # 1. Generate tailored 1-sentence Male Narrator hook script
    narration = (
        _clean_english(narration_override)
        if narration_override
        else generate_hook_narration(
            transcript=transcript,
            video_title=video_title,
            uploader=uploader,
            hook_sentence=hook_sentence,
            is_live=is_live,
            use_llm=use_llm,
        )
    )

    with tempfile.TemporaryDirectory(prefix="openclip_hook_intro_") as tmpdir:
        tmp_dir = Path(tmpdir)
        voice_wav = tmp_dir / "narrator.wav"
        whoosh_wav = tmp_dir / "whoosh.wav"
        intro_mp4 = tmp_dir / "intro_seg.mp4"
        concat_mp4 = main_clip_path.with_suffix(".with_intro.mp4")

        # 2. Synthesize Male AI Voiceover + exact word timings
        _, voice_dur, narrator_words, voice_backend = synthesize_male_narrator_voice(
            text=narration,
            out_wav=voice_wav,
            voice=narrator_voice,
            ffmpeg_bin=ffmpeg_bin,
            allow_network=allow_tts_network,
        )

        # Trim trailing TTS silence after final spoken word + add 0.24s for crisp whoosh transition
        if narrator_words:
            last_end = max(float(w.get("end") or 0.0) for w in narrator_words)
            eff_voice_dur = min(voice_dur, max(1.4, last_end + 0.14))
        else:
            eff_voice_dur = voice_dur
        intro_dur = round(max(1.8, min(6.0, eff_voice_dur + 0.24)), 3)
        _write_transition_whoosh_wav(whoosh_wav, duration_s=0.24, sr=48000)

        # 3. Pick peak-energy climax preview slice from clean raw source
        src_info = _probe_media_info(src_for_preview, ffmpeg_bin=ffmpeg_bin)
        src_dur = float(src_info["duration"] or 0.0)
        preview_start = find_preview_window(src_for_preview, intro_dur, ffmpeg_bin=ffmpeg_bin)
        # Ensure we don't run past source EOF
        if src_dur > 0 and preview_start + intro_dur > src_dur:
            preview_start = max(0.0, src_dur - intro_dur)

        # 4. Build matching video layout filter for the preview slice (caption-free!)
        is_vertical = target_h > target_w
        is_live_layout = bool(is_live and is_vertical)
        if is_live_layout:
            # Match LIVE_HORIZONTAL_BLUR_LAYOUT: zoomed blurred BG + centered 16:9 horizontal preview (+6% zoom)
            # If source is already a 9:16 live-layout clip (no separate raw_source_path), isolate the center
            # 16:9 gameplay window first so old top/bottom captions never ghost into the blurred background.
            src_w = int(src_info.get("width") or target_w)
            src_h = int(src_info.get("height") or target_h)
            pre_crop = "crop=iw:trunc(iw*9/16/2)*2:0:trunc((ih-trunc(iw*9/16/2)*2)/2)," if src_h > src_w else ""
            fg_h = int(round(target_w * 9 / 16))
            fg_h -= fg_h % 2
            fg_y = (target_h - fg_h) // 2
            zw = int(round(target_w * 1.06))
            zh = int(round(fg_h * 1.06))
            zw += zw % 2
            zh += zh % 2
            base_vf = (
                f"[0:v]{pre_crop}split=2[bg0][fg0];"
                f"[bg0]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
                f"crop={target_w}:{target_h},gblur=sigma=28,eq=brightness=-0.10:saturation=1.1,setsar=1[bg];"
                f"[fg0]scale={zw}:{zh}:force_original_aspect_ratio=increase,"
                f"crop={target_w}:{fg_h},setsar=1[fg];"
                f"[bg][fg]overlay=0:{fg_y},fps={fps_int}[vbase]"
            )
        else:
            # Full-bleed punch-in teaser crop (1.06x zoom) matching exact target_w x target_h
            zw = int(round(target_w * 1.06))
            zh = int(round(target_h * 1.06))
            zw += zw % 2
            zh += zh % 2
            base_vf = (
                f"[0:v]scale={zw}:{zh}:force_original_aspect_ratio=increase,"
                f"crop={target_w}:{target_h},fps={fps_int},setsar=1[vbase]"
            )

        # Audio filter: ducked preview source ambience (-17 dB) + Male AI Narrator + transition whoosh
        whoosh_delay_ms = max(0, int(round((intro_dur - 0.22) * 1000)))
        src_has_audio = bool(src_info["has_audio"])
        if src_has_audio:
            audio_fc = (
                f"[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                f"lowpass=f=3200,volume=0.14,apad=whole_dur={intro_dur:.3f},atrim=0:{intro_dur:.3f}[amb];"
                f"[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                f"volume=1.08,apad=whole_dur={intro_dur:.3f},atrim=0:{intro_dur:.3f}[vox];"
                f"[3:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                f"adelay={whoosh_delay_ms}|{whoosh_delay_ms},volume=0.72,"
                f"apad=whole_dur={intro_dur:.3f},atrim=0:{intro_dur:.3f}[sfx];"
                f"[amb][vox][sfx]amix=inputs=3:duration=first:normalize=0,"
                f"alimiter=limit=0.92:level=disabled[aout]"
            )
        else:
            audio_fc = (
                f"[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                f"volume=1.08,apad=whole_dur={intro_dur:.3f},atrim=0:{intro_dur:.3f}[vox];"
                f"[3:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
                f"adelay={whoosh_delay_ms}|{whoosh_delay_ms},volume=0.72,"
                f"apad=whole_dur={intro_dur:.3f},atrim=0:{intro_dur:.3f}[sfx];"
                f"[vox][sfx]amix=inputs=2:duration=first:normalize=0,"
                f"alimiter=limit=0.92:level=disabled[aout]"
            )

        filter_complex = f"{base_vf};[vbase][1:v]overlay=0:0:shortest=1[vout];{audio_fc}"

        # 5. Pipe lightweight 30fps RGBA narrator caption + PREVIEW badge frames into FFmpeg
        total_frames = max(1, int(math.ceil(intro_dur * fps_int)))
        chunks = _chunk_narrator_words(narrator_words, max_words=3)
        cap_font_size = max(44, int(target_w * (0.068 if is_vertical else 0.044)))
        badge_font_size = max(22, int(target_w * (0.028 if is_vertical else 0.018)))
        font_cap = _load_bold_font(cap_font_size)
        font_badge = _load_bold_font(badge_font_size)

        # Cache identical frames keyed by (chunk_idx, active_word_idx) -> blazing fast (~0.25s!)
        frame_cache: Dict[Tuple[int, int], bytes] = {}

        def _frame_key(t_now: float) -> Tuple[int, int]:
            for ci, ch in enumerate(chunks):
                if float(ch["start"]) - 0.04 <= t_now <= float(ch["end"]) + 0.14:
                    cwords = ch["words"]
                    awi = len(cwords) - 1
                    for wi, wobj in enumerate(cwords):
                        if t_now <= float(wobj["end"]) + 0.03:
                            awi = wi
                            break
                    return (ci, awi)
            if chunks and t_now < float(chunks[0]["start"]):
                return (0, 0)
            return (-1, -1)

        cmd_intro = [
            ffmpeg_bin, "-y", "-loglevel", "error",
            "-ss", f"{preview_start:.3f}", "-t", f"{intro_dur:.3f}", "-i", str(src_for_preview),
            "-f", "rawvideo", "-pix_fmt", "rgba",
            "-s", f"{target_w}x{target_h}", "-r", str(fps_int), "-i", "pipe:0",
            "-i", str(voice_wav),
            "-i", str(whoosh_wav),
            "-filter_complex", filter_complex,
            "-map", "[vout]", "-map", "[aout]",
            "-t", f"{intro_dur:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
            "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart",
            str(intro_mp4),
        ]

        proc = subprocess.Popen(
            cmd_intro,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        try:
            assert proc.stdin is not None
            for fi in range(total_frames):
                t_now = fi / float(fps_int)
                fkey = _frame_key(t_now)
                if fkey not in frame_cache:
                    frame_cache[fkey] = _render_intro_overlay_frame(
                        width=target_w,
                        height=target_h,
                        t=t_now,
                        chunks=chunks,
                        font_cap=font_cap,
                        font_badge=font_badge,
                        is_live_layout=is_live_layout,
                    )
                proc.stdin.write(frame_cache[fkey])
            proc.stdin.close()
            err_txt = proc.stderr.read().decode("utf-8", errors="ignore") if proc.stderr else ""
            rc = proc.wait(timeout=60)
            if rc != 0 or not intro_mp4.exists() or intro_mp4.stat().st_size < 1000:
                raise RuntimeError(f"FFmpeg intro render failed (rc={rc}): {err_txt[-300:]}")
        except BrokenPipeError:
            err_txt = proc.stderr.read().decode("utf-8", errors="ignore") if proc.stderr else ""
            proc.wait(timeout=30)
            if not intro_mp4.exists() or intro_mp4.stat().st_size < 1000:
                raise RuntimeError(f"FFmpeg intro pipe error: {err_txt[-300:]}")
        finally:
            if proc.poll() is None:
                proc.kill()

        # 6. Seamlessly concatenate [intro_mp4] + [main_clip_path] with exact monotonic PTS & 48kHz audio
        if main_has_audio:
            concat_fc = (
                f"[0:v]fps={fps_int},scale={target_w}:{target_h}:flags=lanczos,setsar=1,setpts=PTS-STARTPTS[v0];"
                f"[1:v]fps={fps_int},scale={target_w}:{target_h}:flags=lanczos,setsar=1,setpts=PTS-STARTPTS[v1];"
                f"[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a0];"
                f"[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a1];"
                f"[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]"
            )
        else:
            main_dur = max(1.0, float(main_info["duration"] or 10.0))
            concat_fc = (
                f"[0:v]fps={fps_int},scale={target_w}:{target_h}:flags=lanczos,setsar=1,setpts=PTS-STARTPTS[v0];"
                f"[1:v]fps={fps_int},scale={target_w}:{target_h}:flags=lanczos,setsar=1,setpts=PTS-STARTPTS[v1];"
                f"[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a0];"
                f"anullsrc=r=48000:cl=stereo,atrim=0:{main_dur:.3f},asetpts=PTS-STARTPTS[a1];"
                f"[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]"
            )

        cmd_concat = [
            ffmpeg_bin, "-y", "-loglevel", "error",
            "-i", str(intro_mp4),
            "-i", str(main_clip_path),
            "-filter_complex", concat_fc,
            "-map", "[vout]", "-map", "[aout]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
            "-profile:v", "high", "-pix_fmt", "yuv420p",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart",
            str(concat_mp4),
        ]
        res_c = subprocess.run(cmd_concat, capture_output=True, text=True, timeout=120)
        if res_c.returncode != 0 or not concat_mp4.exists() or concat_mp4.stat().st_size < 1000:
            raise RuntimeError(f"FFmpeg intro+clip concat failed: {res_c.stderr[-300:]}")

        os.replace(concat_mp4, main_clip_path)

    return {
        "applied": True,
        "hook_narration": narration,
        "intro_duration": intro_dur,
        "preview_start": preview_start,
        "voice_backend": voice_backend,
        "narrator_words": narrator_words,
    }

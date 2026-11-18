"""
M4 Sound Effects Library Indexer, Director, and FFmpeg Mixer:
  - Auto-populates empty assets/sfx/{whoosh,riser,boom,hit,pop}/ categories via tools/generate_sfx.py
  - Builds assets/sfx/.index.json ({category, duration, peak_offset_s, first_transient_s, sha1})
    and caches -3 dBFS peak-normalized 44.1 kHz stereo/mono WAV copies; re-indexes on change.
  - Detects scene cuts (`select='gt(scene,0.4)'`, >= 0.5 s apart).
  - Plans deterministic SFX cues (rules or optional LLM with fallback), enforcing spacing,
    budget (ceil(duration/2.5)), cooldowns, priority drops, and no consecutive duplicate files.
  - Builds single-graph FFmpeg audio filter (`adelay` + `volume` + `amix=inputs=N+1:normalize=0`
    + `alimiter=limit=0.89:level=disabled`) and writes `<out>.sfx_cues.json`.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import re
import subprocess
import sys
import wave
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from openclip_engine.clipping.config_styles import (
    DEFAULT_SFX_CONFIG,
    KARAOKE_POP,
    REPO_ROOT,
    CaptionStyle,
    SfxConfig,
)
from openclip_engine.clipping.karaoke_pop import classify_word_chunks, clean_word_text, is_acronym
from openclip_engine.clipping.llm_helper import call_llm_json

CATEGORIES = ("whoosh", "riser", "boom", "hit", "pop")
AUDIO_EXTS = {".wav", ".mp3", ".ogg", ".m4a"}


def _load_generate_sfx_module():
    gen_path = REPO_ROOT / "tools" / "generate_sfx.py"
    spec = importlib.util.spec_from_file_location("openclip_generate_sfx", str(gen_path))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load fallback SFX synthesizer at {gen_path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _sha1_file(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _decode_audio_to_float_mono(path: Path, sr: int = 44100, ffmpeg_bin: str = "ffmpeg") -> np.ndarray:
    """Decodes any .wav/.mp3/.ogg/.m4a to mono float32 [-1, 1] at `sr` Hz."""
    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as wf:
                ch = wf.getnchannels()
                sw = wf.getsampwidth()
                rate = wf.getframerate()
                if sw == 2 and rate == sr:
                    raw = wf.readframes(wf.getnframes())
                    arr = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
                    if ch > 1:
                        arr = arr.reshape(-1, ch).mean(axis=1)
                    return arr
        except Exception:
            pass

    cmd = [
        ffmpeg_bin, "-v", "error", "-i", str(path),
        "-ac", "1", "-ar", str(sr), "-f", "f32le", "pipe:1",
    ]
    res = subprocess.run(cmd, capture_output=True, timeout=30)
    if res.returncode != 0 or not res.stdout:
        return np.zeros(sr // 10, dtype=np.float32)
    return np.frombuffer(res.stdout, dtype=np.float32)


def _write_norm_wav(samples: np.ndarray, out_path: Path, target_dbfs: float = -3.0, sr: int = 44100) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    target_amp = 10.0 ** (target_dbfs / 20.0)
    if peak > 1e-9:
        norm = samples * (target_amp / peak)
    else:
        norm = samples
    pcm = np.clip(norm * 32767.0, -32768, 32767).astype(np.int16)
    tmp = out_path.with_suffix(".tmp.wav")
    with wave.open(str(tmp), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())
    tmp.replace(out_path)


def _analyze_sfx_envelope(samples: np.ndarray, sr: int = 44100) -> Tuple[float, float, float]:
    """Returns (duration_s, peak_offset_s, first_transient_s)."""
    n = len(samples)
    if n == 0:
        return 0.1, 0.05, 0.0
    dur = n / float(sr)
    abs_s = np.abs(samples)
    # Smoothed 10ms RMS envelope for stable peak & transient detection
    win = max(1, int(round(0.010 * sr)))
    sq = samples.astype(np.float64) ** 2
    csum = np.cumsum(np.pad(sq, (1, 0)))
    rms = np.sqrt(np.maximum(0.0, (csum[win:] - csum[:-win]) / win))
    if rms.size == 0:
        return dur, dur * 0.5, 0.0

    peak_idx = int(np.argmax(rms))
    peak_offset_s = min(dur, (peak_idx + win * 0.5) / float(sr))

    # First transient = first point exceeding 20% of peak RMS (or 25% of peak abs)
    max_rms = float(rms[peak_idx])
    thresh = max(1e-5, max_rms * 0.20)
    above = np.where(rms >= thresh)[0]
    first_transient_s = float(above[0] / float(sr)) if above.size else 0.0
    # Clamp transient sanity for punchy starts
    if float(np.max(abs_s[: min(n, int(0.02 * sr))])) >= float(np.max(abs_s)) * 0.3:
        first_transient_s = min(first_transient_s, 0.005)
    return round(dur, 5), round(peak_offset_s, 5), round(first_transient_s, 5)


def ensure_sfx_index(
    sfx_config: SfxConfig = DEFAULT_SFX_CONFIG,
    ffmpeg_bin: str = "ffmpeg",
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Ensures all 5 SFX categories exist (running tools/generate_sfx.py fallback for any empty category),
    maintains `assets/sfx/.index.json`, and caches -3 dBFS peak-normalized WAVs in `assets/sfx/.norm/`.
    Returns {category: [entry_dict, ...]}.
    """
    sfx_root = Path(sfx_config.sfx_dir)
    sfx_root.mkdir(parents=True, exist_ok=True)
    norm_dir = sfx_root / ".norm"
    norm_dir.mkdir(parents=True, exist_ok=True)
    index_path = sfx_root / ".index.json"

    # Auto-run fallback synth for any empty category
    gen_mod = _load_generate_sfx_module()
    gen_mod.ensure_sfx_library(sfx_root, categories=CATEGORIES, seed=sfx_config.seed, variants=3)

    existing_by_key: Dict[str, Dict[str, Any]] = {}
    if index_path.exists():
        try:
            old = json.loads(index_path.read_text(encoding="utf-8"))
            if isinstance(old, list):
                for item in old:
                    if isinstance(item, dict) and item.get("file") and item.get("sha1"):
                        existing_by_key[item["file"]] = item
        except Exception:
            pass

    entries: List[Dict[str, Any]] = []
    by_cat: Dict[str, List[Dict[str, Any]]] = {c: [] for c in CATEGORIES}
    changed = False

    for cat in CATEGORIES:
        cat_dir = sfx_root / cat
        files = sorted(
            [p for p in cat_dir.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_EXTS],
            key=lambda p: p.name,
        )
        for fp in files:
            rel_key = f"{cat}/{fp.name}"
            sha1 = _sha1_file(fp)
            cached = existing_by_key.get(rel_key)
            norm_wav = norm_dir / f"{cat}_{sha1[:12]}.wav"

            if cached and cached.get("sha1") == sha1 and norm_wav.exists():
                entry = dict(cached)
                entry["norm_path"] = str(norm_wav)
                entry["abs_path"] = str(fp)
            else:
                changed = True
                samples = _decode_audio_to_float_mono(fp, sr=sfx_config.sample_rate, ffmpeg_bin=ffmpeg_bin)
                dur, peak_off, first_tr = _analyze_sfx_envelope(samples, sr=sfx_config.sample_rate)
                _write_norm_wav(samples, norm_wav, target_dbfs=sfx_config.normalize_target_dbfs, sr=sfx_config.sample_rate)
                entry = {
                    "file": rel_key,
                    "category": cat,
                    "duration": dur,
                    "peak_offset_s": peak_off,
                    "first_transient_s": first_tr,
                    "sha1": sha1,
                    "norm_path": str(norm_wav),
                    "abs_path": str(fp),
                }
            entries.append(entry)
            by_cat[cat].append(entry)

    if changed or len(entries) != len(existing_by_key) or not index_path.exists():
        index_path.write_text(json.dumps(entries, indent=2), encoding="utf-8")

    return by_cat


def detect_opening_stray_frames(
    video_in: Path,
    clip_start: float = 0.0,
    fps: float = 30.0,
    max_check_frames: int = 6,
    threshold: float = 0.28,
    ffmpeg_bin: str = "ffmpeg",
) -> int:
    """
    Detects a stray 1..max_check_frames flash of a previous shot at the very start of a clip.
    Returns the integer frame index k (1 <= k <= max_check_frames) of the opening shot's true
    first frame, or 0 if frame 0 already belongs to the opening shot.
    """
    check_dur = max(0.30, (max_check_frames + 3) / max(1.0, fps))
    cmd = [ffmpeg_bin, "-hide_banner", "-v", "info"]
    if clip_start > 0.001:
        cmd.extend(["-ss", f"{clip_start:.6f}"])
    cmd.extend([
        "-t", f"{check_dur:.4f}",
        "-i", str(video_in),
        "-an",
        "-vf", f"scale=320:-2:flags=fast_bilinear,select='gt(scene,{threshold})',showinfo",
        "-f", "null", "-",
    ])
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    except Exception:
        return 0

    best_k = 0
    for line in res.stderr.splitlines():
        if "pts_time:" not in line:
            continue
        m = re.search(r"pts_time:([0-9.]+)", line)
        if not m:
            continue
        t = float(m.group(1))
        k = int(round(t * fps))
        if 1 <= k <= max_check_frames:
            best_k = k
    return best_k


def detect_scene_cuts(
    video_in: Path,
    clip_start: float = 0.0,
    duration: Optional[float] = None,
    threshold: float = 0.4,
    min_gap_s: float = 0.5,
    ffmpeg_bin: str = "ffmpeg",
) -> List[float]:
    """Detects clip-relative scene cut timestamps (`select='gt(scene,0.4)'`, >= 0.5 s apart)."""
    cmd = [ffmpeg_bin, "-hide_banner", "-v", "info"]
    if clip_start > 0.001:
        cmd.extend(["-ss", f"{clip_start:.6f}"])
    if duration is not None and duration > 0:
        cmd.extend(["-t", f"{duration:.6f}"])
    cmd.extend([
        "-i", str(video_in),
        "-an",
        "-vf", f"scale=320:-2:flags=fast_bilinear,select='gt(scene,{threshold})',showinfo",
        "-f", "null", "-",
    ])
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except Exception:
        return []

    cuts: List[float] = []
    for line in res.stderr.splitlines():
        if "pts_time:" not in line:
            continue
        m = re.search(r"pts_time:([0-9.]+)", line)
        if not m:
            continue
        t = float(m.group(1))
        if t < 0.25:
            continue
        if not cuts or (t - cuts[-1]) >= min_gap_s:
            cuts.append(round(t, 6))
    return cuts


@dataclass
class PlannedCue:
    t: float                             # semantic anchor time (clip-relative seconds)
    category: str                        # whoosh | riser | boom | hit | pop
    intensity: float                     # 0..1
    priority: int                        # 1=pop .. 5=boom/riser
    file: str                            # relative file key in assets/sfx
    norm_path: str                       # absolute path to -3 dBFS normalized WAV
    gain_db: float                       # final gain applied on top of -3 dBFS file
    play_start_s: float                  # when playback starts in clip time
    trim_start_s: float                  # how much to trim from start of SFX WAV
    play_duration_s: float               # how long SFX plays
    paired_boom_t: Optional[float] = None
    source_rule: str = "rule"


def _is_shout_word(word_raw: str, item: Dict[str, Any], cfg: SfxConfig, caption_style: CaptionStyle = KARAOKE_POP) -> bool:
    if item.get("impact") is True or str(item.get("tag", "")).lower() == "impact":
        return True
    cleaned = clean_word_text(word_raw)
    if not cleaned:
        return False
    if cleaned.endswith("!"):
        return True
    # Acronyms (GTA, NASA, USA) are caption emphasis words (pop), not shouted words (boom)
    if is_acronym(cleaned, caption_style):
        return False
    letters = re.sub(r"[^A-Za-z]+", "", cleaned)
    if len(letters) >= cfg.shout_min_letters and letters.isupper():
        return True
    return False


def _pick_non_repeating_file(
    pool: Sequence[Dict[str, Any]],
    last_file: Optional[str],
    seed: int,
    step_idx: int,
) -> Dict[str, Any]:
    candidates = [p for p in pool if p["file"] != last_file] or list(pool)
    digest = hashlib.sha256(f"{seed}:{step_idx}:{candidates[0]['category']}".encode("utf-8")).digest()
    return candidates[int.from_bytes(digest[:4], "big") % len(candidates)]


def _overlaps_speech(t_start: float, t_end: float, speech_spans: Sequence[Tuple[float, float]]) -> bool:
    for s0, s1 in speech_spans:
        if t_start < s1 and t_end > s0:
            return True
    return False


def _enforce_constraints(
    raw_events: List[Dict[str, Any]],
    duration: float,
    sfx_index: Dict[str, List[Dict[str, Any]]],
    speech_spans: Sequence[Tuple[float, float]],
    cfg: SfxConfig,
) -> List[PlannedCue]:
    """
    Enforces bounds (0 <= t <= duration - end_guard_s), priority ordering, min spacing (0.6s),
    max cue budget (ceil(duration / 2.5)), per-category cooldowns, no consecutive duplicate files,
    and riser+boom pairing (riser ends on boom.t within <1ms).
    """
    max_t = max(0.0, duration - cfg.end_guard_s)
    max_budget = max(1, int(math.ceil(max(0.5, duration) / cfg.max_cue_interval_s)))

    # Filter out-of-bounds
    valid = [e for e in raw_events if 0.0 <= float(e["t"]) <= max_t and e["category"] in CATEGORIES]

    # Sort highest priority first, then earliest time
    valid.sort(key=lambda e: (-int(e["priority"]), float(e["t"])))

    accepted: List[Dict[str, Any]] = []
    for cand in valid:
        t = float(cand["t"])
        cat = cand["category"]

        # Budget check (riser+boom counts as one unit)
        if len(accepted) >= max_budget:
            continue

        # Min spacing check against all already accepted events
        if any(abs(t - float(a["t"])) < cfg.min_spacing_s - 1e-6 for a in accepted):
            continue

        # Category cooldown check
        cd = cfg.cooldowns.get(cat, 1.0)
        if any(a["category"] == cat and abs(t - float(a["t"])) < cd - 1e-6 for a in accepted):
            # If boom blocked by boom cooldown (<2.5s), downgrade shout to hit if hit cooldown allows
            if cat == "boom" and cand.get("allow_hit_fallback"):
                hit_cd = cfg.cooldowns.get("hit", 2.0)
                if not any(a["category"] == "hit" and abs(t - float(a["t"])) < hit_cd - 1e-6 for a in accepted):
                    cand = dict(cand, category="hit", priority=cfg.priority["hit"], riser_gap=0.0)
                else:
                    continue
            else:
                continue

        accepted.append(cand)

    # Chronological order for file assignment (never same file twice in a row) & riser attachment
    accepted.sort(key=lambda e: float(e["t"]))

    cues: List[PlannedCue] = []
    last_file_global: Optional[str] = None
    last_file_by_cat: Dict[str, Optional[str]] = {}
    last_riser_t: Optional[float] = None
    step = 0

    for ev in accepted:
        t = float(ev["t"])
        cat = ev["category"]
        intensity = max(0.0, min(1.0, float(ev["intensity"])))
        prio = int(ev["priority"])
        riser_gap = float(ev.get("riser_gap", 0.0))

        # Attach paired riser if boom has buildup gap >= 0.5s and riser cooldown allows
        if cat == "boom" and riser_gap >= cfg.buildup_min_gap_s:
            riser_len = min(riser_gap, cfg.buildup_max_riser_s, t)
            riser_cd = cfg.cooldowns.get("riser", 6.0)
            if riser_len >= 0.35 and (last_riser_t is None or (t - last_riser_t) >= riser_cd - 1e-6):
                r_pool = sfx_index.get("riser") or []
                if r_pool:
                    r_entry = _pick_non_repeating_file(r_pool, last_file_by_cat.get("riser") or last_file_global, cfg.seed, step)
                    step += 1
                    r_dur = float(r_entry["duration"])
                    eff_len = min(riser_len, r_dur)
                    trim_start = max(0.0, r_dur - eff_len)
                    play_start = max(0.0, t - eff_len)
                    # Exact end alignment on boom.t
                    eff_len = max(0.05, t - play_start)
                    trim_start = max(0.0, r_dur - eff_len)

                    gain = cfg.base_gains_db["riser"] + cfg.intensity_atten_db * (1.0 - intensity) + cfg.master_db
                    if "riser" in cfg.speech_duck_categories and _overlaps_speech(play_start, t, speech_spans):
                        gain += cfg.speech_duck_db

                    cues.append(PlannedCue(
                        t=round(t, 4),
                        category="riser",
                        intensity=round(intensity, 3),
                        priority=cfg.priority["riser"],
                        file=r_entry["file"],
                        norm_path=r_entry["norm_path"],
                        gain_db=round(gain, 2),
                        play_start_s=round(play_start, 5),
                        trim_start_s=round(trim_start, 5),
                        play_duration_s=round(eff_len, 5),
                        paired_boom_t=round(t, 5),
                        source_rule="buildup_riser",
                    ))
                    last_file_global = r_entry["file"]
                    last_file_by_cat["riser"] = r_entry["file"]
                    last_riser_t = t

        pool = sfx_index.get(cat) or []
        if not pool:
            continue
        exclude = last_file_by_cat.get(cat) or last_file_global
        entry = _pick_non_repeating_file(pool, exclude, cfg.seed, step)
        step += 1

        f_dur = float(entry["duration"])
        peak_off = float(entry["peak_offset_s"])
        first_tr = float(entry["first_transient_s"])

        if cat == "whoosh":
            raw_start = t - peak_off
            if raw_start < 0.0:
                trim_start = min(f_dur * 0.8, -raw_start)
                play_start = 0.0
            else:
                trim_start = 0.0
                play_start = raw_start
            play_dur = max(0.05, min(f_dur - trim_start, duration - play_start))
        elif cat == "riser":
            eff_len = min(cfg.buildup_max_riser_s, f_dur, t)
            play_start = max(0.0, t - eff_len)
            trim_start = max(0.0, f_dur - eff_len)
            play_dur = max(0.05, eff_len)
        else:
            # boom, hit, pop anchored on first_transient_s
            raw_start = t - first_tr
            if raw_start < 0.0:
                trim_start = min(f_dur * 0.5, -raw_start)
                play_start = 0.0
            else:
                trim_start = 0.0
                play_start = raw_start
            play_dur = max(0.05, min(f_dur - trim_start, duration - play_start))

        gain = cfg.base_gains_db[cat] + cfg.intensity_atten_db * (1.0 - intensity) + cfg.master_db
        if cat in cfg.speech_duck_categories and _overlaps_speech(play_start, play_start + play_dur, speech_spans):
            gain += cfg.speech_duck_db

        cues.append(PlannedCue(
            t=round(t, 4),
            category=cat,
            intensity=round(intensity, 3),
            priority=prio,
            file=entry["file"],
            norm_path=entry["norm_path"],
            gain_db=round(gain, 2),
            play_start_s=round(play_start, 5),
            trim_start_s=round(trim_start, 5),
            play_duration_s=round(play_dur, 5),
            paired_boom_t=None,
            source_rule=str(ev.get("source_rule", "rule")),
        ))
        last_file_global = entry["file"]
        last_file_by_cat[cat] = entry["file"]

    return cues


def plan_sfx_cues(
    words: Sequence[Dict[str, Any]],
    duration: float,
    clip_start: float = 0.0,
    scene_cuts: Sequence[float] = (),
    title_enabled: bool = True,
    sfx_config: SfxConfig = DEFAULT_SFX_CONFIG,
    caption_style: CaptionStyle = KARAOKE_POP,
    ffmpeg_bin: str = "ffmpeg",
) -> List[PlannedCue]:
    """
    Plans deterministic SFX cues for a clip (rules mode, optional llm mode with fallback, or off).
    """
    if (sfx_config.mode or "rules").strip().lower() == "off":
        return []

    sfx_index = ensure_sfx_index(sfx_config, ffmpeg_bin=ffmpeg_bin)

    # Convert words to clip-relative speech spans
    rel_words: List[Dict[str, Any]] = []
    for item in words:
        raw = str(item.get("word") if "word" in item else item.get("text", ""))
        cleaned = clean_word_text(raw)
        if not cleaned:
            continue
        ws = float(item["start"]) - clip_start
        we = float(item.get("end", float(item["start"]) + 0.15)) - clip_start
        if ws < -1e-6 or ws >= duration:
            continue
        rel_words.append({
            "word": cleaned,
            "raw": raw,
            "start": max(0.0, ws),
            "end": min(duration, max(ws + 0.05, we)),
            "item": item,
        })
    rel_words.sort(key=lambda w: w["start"])
    speech_spans = [(w["start"], w["end"]) for w in rel_words]

    raw_events: List[Dict[str, Any]] = []

    # Optional LLM mode (falls back cleanly to rules on any error or empty result)
    used_llm = False
    if (sfx_config.mode or "").strip().lower() == "llm" and rel_words:
        transcript_lines = [
            f"{w['start']:.2f}-{w['end']:.2f}: {w['word']}"
            + (" [SHOUT]" if _is_shout_word(w["raw"], w["item"], sfx_config, caption_style) else "")
            + (" [EMPHASIS]" if classify_word_chunks(w["word"], caption_style)[0] else "")
            for w in rel_words[:120]
        ]
        prompt = (
            "Select sound effect cue timestamps for this short vertical video clip.\n"
            f"Clip duration: {duration:.2f}s. Scene cuts: {list(scene_cuts)}.\n"
            "Words:\n" + "\n".join(transcript_lines) + "\n\n"
            'Return ONLY a JSON array: [{"t": float, "category": "whoosh|riser|boom|hit|pop", "intensity": 0.0..1.0}]'
        )
        resp = call_llm_json(prompt, system_prompt="Return ONLY valid raw JSON array of SFX cues.")
        if isinstance(resp, list) and resp:
            for obj in resp:
                if not isinstance(obj, dict):
                    continue
                cat = str(obj.get("category", "")).strip().lower()
                if cat not in CATEGORIES:
                    continue
                try:
                    t_val = float(obj["t"])
                    inten = max(0.0, min(1.0, float(obj.get("intensity", 0.6))))
                except Exception:
                    continue
                prio = sfx_config.priority.get(cat, 2)
                if cat == "whoosh":
                    prio = sfx_config.priority["scene_whoosh"]
                raw_events.append({
                    "t": t_val,
                    "category": cat,
                    "intensity": inten,
                    "priority": prio,
                    "source_rule": "llm",
                    "allow_hit_fallback": cat == "boom",
                })
            used_llm = len(raw_events) > 0

    if not used_llm:
        # 1. Title in: whoosh peaking at t=0.10 s
        if title_enabled and duration >= 0.3:
            raw_events.append({
                "t": sfx_config.title_whoosh_t,
                "category": "whoosh",
                "intensity": sfx_config.title_whoosh_intensity,
                "priority": sfx_config.priority["title_whoosh"],
                "source_rule": "title_in",
            })

        # 2. Scene cuts: whoosh with peak ON the cut
        for ct in scene_cuts:
            raw_events.append({
                "t": float(ct),
                "category": "whoosh",
                "intensity": sfx_config.scene_whoosh_intensity,
                "priority": sfx_config.priority["scene_whoosh"],
                "source_rule": "scene_cut",
            })

        # 3 & 4 & 5. Shout words (boom/hit + buildup riser) & emphasis words (pop)
        prev_end = 0.0
        for idx, w in enumerate(rel_words):
            gap_before = w["start"] - prev_end if idx > 0 else w["start"]
            is_shout = _is_shout_word(w["raw"], w["item"], sfx_config, caption_style)
            is_emph, _ = classify_word_chunks(w["word"], caption_style)

            if is_shout:
                raw_events.append({
                    "t": w["start"],
                    "category": "boom",
                    "intensity": sfx_config.shout_intensity,
                    "priority": sfx_config.priority["boom"],
                    "source_rule": "shout_word",
                    "allow_hit_fallback": True,
                    "riser_gap": gap_before if gap_before >= sfx_config.buildup_min_gap_s else 0.0,
                })
            elif is_emph:
                raw_events.append({
                    "t": w["start"],
                    "category": "pop",
                    "intensity": sfx_config.emphasis_pop_intensity,
                    "priority": sfx_config.priority["pop"],
                    "source_rule": "emphasis_word",
                })
            prev_end = max(prev_end, w["end"])

    return _enforce_constraints(raw_events, duration, sfx_index, speech_spans, sfx_config)


def build_sfx_audio_filter(
    cues: Sequence[PlannedCue],
    first_input_idx: int,
    has_source_audio: bool = True,
    sfx_config: SfxConfig = DEFAULT_SFX_CONFIG,
) -> Tuple[List[str], Optional[str], Optional[str]]:
    """
    Builds FFmpeg extra input args + audio filtergraph fragment for mixing SFX onto source audio.
    Returns (extra_input_args, audio_filter_str, out_label).
    Original speech stays at 0 dB untouched; SFX mix uses `amix=inputs=N+1:normalize=0`
    followed by `alimiter=limit=0.89:level=disabled`.
    """
    if not cues:
        return [], None, None

    extra_inputs: List[str] = []
    chains: List[str] = []
    mix_labels: List[str] = []

    if has_source_audio:
        chains.append(f"[0:a]aresample={sfx_config.sample_rate},aformat=channel_layouts=stereo[base_a]")
        mix_labels.append("[base_a]")

    for i, cue in enumerate(cues):
        inp_idx = first_input_idx + i
        extra_inputs.extend(["-i", cue.norm_path])
        delay_ms = max(0, int(round(cue.play_start_s * 1000.0)))
        trim_end = cue.trim_start_s + cue.play_duration_s
        lbl = f"[sfx{i}]"
        parts = [f"[{inp_idx}:a]"]
        filters = [
            f"atrim=start={cue.trim_start_s:.5f}:end={trim_end:.5f}",
            "asetpts=PTS-STARTPTS",
            f"aresample={sfx_config.sample_rate}",
            "aformat=channel_layouts=stereo",
            f"volume={cue.gain_db:.2f}dB",
        ]
        if delay_ms > 0:
            filters.append(f"adelay={delay_ms}|{delay_ms}")
        chains.append("".join(parts) + ",".join(filters) + lbl)
        mix_labels.append(lbl)

    n_inputs = len(mix_labels)
    dur_mode = "first" if has_source_audio else "longest"
    chains.append(
        "".join(mix_labels)
        + f"amix=inputs={n_inputs}:duration={dur_mode}:dropout_transition=0:normalize=0,"
        + f"alimiter=limit={sfx_config.limiter_limit:.2f}:attack=2:release=40:level=disabled[aout]"
    )
    return extra_inputs, ";".join(chains), "[aout]"


def write_sfx_cues_json(out_video_path: Path, cues: Sequence[PlannedCue]) -> Path:
    """Writes `<out>.sfx_cues.json` alongside the rendered video."""
    cues_path = Path(f"{out_video_path}.sfx_cues.json")
    payload = [
        {
            "time": c.t,
            "file": c.file,
            "category": c.category,
            "gain": c.gain_db,
            "gain_db": c.gain_db,
            "intensity": c.intensity,
            "play_start_s": c.play_start_s,
            "play_end_s": round(c.play_start_s + c.play_duration_s, 5),
            "trim_start_s": c.trim_start_s,
            "paired_boom_t": c.paired_boom_t,
            "source_rule": c.source_rule,
        }
        for c in cues
    ]
    cues_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return cues_path

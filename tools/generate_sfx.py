#!/usr/bin/env python3
"""
Procedural fallback SFX synthesizer (NumPy, 44.1 kHz, 16-bit mono WAV, seeded).
Generates 3 variants for each category in assets/sfx/{whoosh,riser,boom,hit,pop}/:
  - whoosh (0.7 s): band-passed white noise sweeping 300 -> 3500 Hz exp, sin^2 env peaking at 55%
  - riser  (2.5 s): noise + sawtooth sweeping 150 -> 3000 Hz exp, amp ~ t^2, 5 ms hard-end fade
  - boom   (1.6 s): sine 90 -> 40 Hz, exp decay tau ~0.5 s + 30 ms noise transient, tanh soft clip
  - hit    (0.5 s): 40 ms noise burst + 70 Hz sine thump decaying over 0.25 s
  - pop    (0.09 s): sine 900 -> 350 Hz, 25 ms decay
"""
from __future__ import annotations

import argparse
import math
import wave
from pathlib import Path
from typing import Iterable, List, Optional

import numpy as np

SR = 44100
CATEGORIES = ("whoosh", "riser", "boom", "hit", "pop")


def _write_wav16(path: Path, samples: np.ndarray, sr: int = SR) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    peak = float(np.max(np.abs(samples))) if samples.size else 1.0
    if peak > 1e-9:
        # Normalize synth output to -3 dBFS (~0.708)
        samples = samples * (0.707946 / peak)
    pcm = np.clip(samples * 32767.0, -32768, 32767).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(pcm.tobytes())
    return path


def _stft_bandpass_sweep(
    noise: np.ndarray,
    f_start: float,
    f_end: float,
    q: float = 1.6,
    sr: int = SR,
) -> np.ndarray:
    """Fast pure-NumPy overlap-add time-varying bandpass sweep (exponential frequency trajectory)."""
    n = len(noise)
    win_len = 1024
    hop = 256
    window = np.hanning(win_len).astype(np.float64)
    freqs = np.fft.rfftfreq(win_len, d=1.0 / sr)
    out = np.zeros(n + win_len, dtype=np.float64)
    norm = np.zeros(n + win_len, dtype=np.float64)
    padded = np.pad(noise, (0, win_len), mode="constant")

    for pos in range(0, n, hop):
        frac = min(1.0, max(0.0, pos / max(1, n - 1)))
        fc = f_start * ((f_end / f_start) ** frac)
        bw = max(80.0, fc / q)
        # Smooth bell-shaped bandpass response around fc
        resp = np.exp(-0.5 * ((freqs - fc) / (0.5 * bw)) ** 2)
        frame = padded[pos : pos + win_len] * window
        spec = np.fft.rfft(frame) * resp
        y = np.fft.irfft(spec, n=win_len) * window
        out[pos : pos + win_len] += y
        norm[pos : pos + win_len] += window * window

    valid = norm[:n] > 1e-8
    res = np.zeros(n, dtype=np.float64)
    res[valid] = out[:n][valid] / norm[:n][valid]
    return res


def synth_whoosh(rng: np.random.Generator, variant: int, sr: int = SR) -> np.ndarray:
    dur = 0.70
    n = int(round(dur * sr))
    t = np.linspace(0.0, 1.0, n, endpoint=False)
    f0 = 300.0 * (0.9 + 0.1 * variant)
    f1 = 3500.0 * (0.92 + 0.08 * variant)
    noise = rng.standard_normal(n)
    swept = _stft_bandpass_sweep(noise, f0, f1, q=1.5 + 0.2 * variant, sr=sr)
    # Piecewise sin^2 envelope peaking at 55% of duration
    peak_frac = 0.55
    phase = np.where(
        t <= peak_frac,
        (t / peak_frac) * (math.pi / 2.0),
        (math.pi / 2.0) + ((t - peak_frac) / (1.0 - peak_frac)) * (math.pi / 2.0),
    )
    env = np.sin(phase) ** 2
    return swept * env


def synth_riser(rng: np.random.Generator, variant: int, sr: int = SR) -> np.ndarray:
    dur = 2.50
    n = int(round(dur * sr))
    t = np.linspace(0.0, dur, n, endpoint=False)
    frac = t / dur
    f0 = 150.0 * (0.95 + 0.05 * variant)
    f1 = 3000.0 * (0.95 + 0.05 * variant)

    # Exponential frequency trajectory for sawtooth: f(t) = f0 * (f1/f0)^(t/dur)
    k = math.log(f1 / f0)
    inst_phase = (f0 * dur / k) * (np.exp(k * frac) - 1.0)
    saw = 2.0 * (inst_phase - np.floor(inst_phase + 0.5))

    # Swept noise layer
    noise = rng.standard_normal(n)
    swept_noise = _stft_bandpass_sweep(noise, f0 * 1.5, f1 * 1.1, q=1.8, sr=sr)

    # Blend saw + swept noise, amplitude ~ t^2, hard end with 5 ms fade
    sig = 0.55 * saw + 0.45 * swept_noise
    env = frac ** 2
    fade_n = max(1, int(round(0.005 * sr)))
    env[-fade_n:] *= np.linspace(1.0, 0.0, fade_n)
    return sig * env


def synth_boom(rng: np.random.Generator, variant: int, sr: int = SR) -> np.ndarray:
    dur = 1.60
    n = int(round(dur * sr))
    t = np.linspace(0.0, dur, n, endpoint=False)
    f0 = 90.0 + 4.0 * (variant - 1)
    f1 = 40.0 + 2.0 * (variant - 1)
    tau = 0.50
    # Smooth pitch drop 90 -> 40 Hz
    drop_tau = 0.18
    freq = f1 + (f0 - f1) * np.exp(-t / drop_tau)
    phase = 2.0 * math.pi * np.cumsum(freq) / sr
    sub = np.sin(phase) * np.exp(-t / tau)

    # 30 ms noise transient at start
    tr_n = int(round(0.030 * sr))
    transient = np.zeros(n, dtype=np.float64)
    transient[:tr_n] = rng.standard_normal(tr_n) * np.exp(-np.linspace(0.0, 4.0, tr_n)) * 0.65

    # Fast 2 ms attack to avoid DC click, then tanh soft clip
    att_n = max(1, int(round(0.002 * sr)))
    sig = sub + transient
    sig[:att_n] *= np.linspace(0.0, 1.0, att_n)
    return np.tanh(sig * 1.8)


def synth_hit(rng: np.random.Generator, variant: int, sr: int = SR) -> np.ndarray:
    dur = 0.50
    n = int(round(dur * sr))
    t = np.linspace(0.0, dur, n, endpoint=False)
    # 40 ms noise burst
    burst_n = int(round(0.040 * sr))
    burst = np.zeros(n, dtype=np.float64)
    burst[:burst_n] = rng.standard_normal(burst_n) * np.exp(-np.linspace(0.0, 3.5, burst_n)) * 0.9

    # 70 Hz sine thump decaying over 0.25 s
    f0 = 70.0 + 5.0 * (variant - 1)
    thump = np.sin(2.0 * math.pi * f0 * t) * np.exp(-t / 0.09)
    thump *= (t <= 0.28).astype(np.float64) + (t > 0.28).astype(np.float64) * np.exp(-(t - 0.28) / 0.03)
    sig = burst + 0.85 * thump
    return np.tanh(sig * 1.4)


def synth_pop(rng: np.random.Generator, variant: int, sr: int = SR) -> np.ndarray:
    dur = 0.090
    n = int(round(dur * sr))
    t = np.linspace(0.0, dur, n, endpoint=False)
    f0 = 900.0 + 40.0 * (variant - 1)
    f1 = 350.0 + 20.0 * (variant - 1)
    freq = f1 + (f0 - f1) * np.exp(-t / 0.015)
    phase = 2.0 * math.pi * np.cumsum(freq) / sr
    env = np.exp(-t / 0.025)
    att_n = max(1, int(round(0.0015 * sr)))
    env[:att_n] *= np.linspace(0.0, 1.0, att_n)
    return np.sin(phase) * env


_SYNTH_MAP = {
    "whoosh": synth_whoosh,
    "riser": synth_riser,
    "boom": synth_boom,
    "hit": synth_hit,
    "pop": synth_pop,
}


def generate_category(
    sfx_dir: Path,
    category: str,
    seed: int = 42,
    variants: int = 3,
    sr: int = SR,
) -> List[Path]:
    """Generates `variants` seeded WAV files for a single SFX category."""
    cat_dir = sfx_dir / category
    cat_dir.mkdir(parents=True, exist_ok=True)
    fn = _SYNTH_MAP[category]
    created: List[Path] = []
    cat_offset = CATEGORIES.index(category) * 100
    for v in range(variants):
        rng = np.random.default_rng(seed + cat_offset + v)
        samples = fn(rng, v, sr=sr)
        out_p = cat_dir / f"synth_{category}_{v + 1:02d}.wav"
        _write_wav16(out_p, samples, sr=sr)
        created.append(out_p)
    return created


def ensure_sfx_library(
    sfx_dir: Path,
    categories: Iterable[str] = CATEGORIES,
    seed: int = 42,
    variants: int = 3,
) -> List[Path]:
    """Populates any empty SFX category folder with procedural fallback WAVs."""
    audio_exts = {".wav", ".mp3", ".ogg", ".m4a"}
    created: List[Path] = []
    for cat in categories:
        cat_dir = sfx_dir / cat
        cat_dir.mkdir(parents=True, exist_ok=True)
        existing = [p for p in cat_dir.iterdir() if p.is_file() and p.suffix.lower() in audio_exts]
        if not existing:
            created.extend(generate_category(sfx_dir, cat, seed=seed, variants=variants))
    return created


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate procedural fallback SFX library.")
    parser.add_argument("--sfx-dir", default="assets/sfx", help="Root SFX folder")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--variants", type=int, default=3, help="Variants per category")
    parser.add_argument("--force", action="store_true", help="Regenerate even if files exist")
    args = parser.parse_args()

    sfx_root = Path(args.sfx_dir)
    if args.force:
        created: List[Path] = []
        for cat in CATEGORIES:
            created.extend(generate_category(sfx_root, cat, seed=args.seed, variants=args.variants))
    else:
        created = ensure_sfx_library(sfx_root, seed=args.seed, variants=args.variants)
    print(f"Generated {len(created)} SFX files in {sfx_root}")


if __name__ == "__main__":
    main()

import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, Any, List, Optional, Sequence, Tuple
from openclip_engine.core.config import UPLOADS_DIR, OUTPUTS_DIR, FFMPEG_PATH
from openclip_engine.ingestion.url_validator import URLValidator
from openclip_engine.clipping.caption_burner import (
    fetch_youtube_captions,
    slice_and_chunk_cues,
    write_vtt,
    build_reframe_and_caption_clip,
)


def _load_groq_api_key() -> str:
    """Reads GROQ_API_KEY from environment or backend/.env without failing."""
    env_key = (os.environ.get("GROQ_API_KEY") or "").strip()
    if env_key:
        return env_key
    try:
        repo_root = Path(__file__).resolve().parents[4]
        for env_p in (repo_root / "backend" / ".env", repo_root / ".env"):
            if env_p.exists():
                for line in env_p.read_text(encoding="utf-8", errors="ignore").splitlines():
                    if "=" in line and not line.strip().startswith("#"):
                        k, v = line.split("=", 1)
                        if k.strip() == "GROQ_API_KEY":
                            val = v.strip().strip('"').strip("'")
                            if val:
                                return val
    except Exception:
        pass
    return ""


def _parse_hls_dvr_segments(m3u8_url: str, timeout_s: float = 15.0) -> Tuple[List[Tuple[float, float, str]], float]:
    """
    Fetches a YouTube Live/DVR HLS playlist and returns:
      (segments, total_duration_s)
    where each segment is (start_offset_s, dur_s, absolute_seg_url).
    """
    req = urllib.request.Request(m3u8_url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        text = resp.read().decode("utf-8", errors="ignore")

    segments: List[Tuple[float, float, str]] = []
    cur_t = 0.0
    pending_dur: Optional[float] = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#EXTINF:"):
            m = re.match(r"#EXTINF:([0-9.]+)", line)
            pending_dur = float(m.group(1)) if m else 5.0
        elif not line.startswith("#"):
            dur = pending_dur if pending_dur is not None else 5.0
            segments.append((cur_t, dur, line))
            cur_t += dur
            pending_dur = None
    return segments, cur_t


def _write_vod_subplaylist(
    segments: Sequence[Tuple[float, float, str]],
    start_sec: float,
    end_sec: float,
    out_m3u8: Path,
) -> Tuple[Path, float]:
    """
    Writes a tiny local VOD HLS `.m3u8` (with `#EXT-X-ENDLIST`) containing ONLY the segments
    overlapping `[start_sec, end_sec]`. Returns `(m3u8_path, local_trim_offset_s)`.
    """
    chosen: List[Tuple[float, float, str]] = []
    for seg_st, seg_dur, seg_url in segments:
        seg_en = seg_st + seg_dur
        if seg_en > start_sec - 0.05 and seg_st < end_sec + 0.05:
            chosen.append((seg_st, seg_dur, seg_url))
    if not chosen and segments:
        # Fallback to nearest tail segments
        chosen = list(segments[-4:])

    target_dur = max(1, int(round(max((d for _, d, _ in chosen), default=5.0))))
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:3",
        "#EXT-X-PLAYLIST-TYPE:VOD",
        f"#EXT-X-TARGETDURATION:{target_dur}",
        "#EXT-X-MEDIA-SEQUENCE:0",
    ]
    for _, seg_dur, seg_url in chosen:
        lines.append(f"#EXTINF:{seg_dur:.3f},")
        lines.append(seg_url)
    lines.append("#EXT-X-ENDLIST")
    out_m3u8.write_text("\n".join(lines) + "\n", encoding="utf-8")

    first_seg_start = chosen[0][0] if chosen else start_sec
    trim_offset = max(0.0, start_sec - first_seg_start)
    return out_m3u8, trim_offset


def _transcribe_wav_groq_whisper(wav_path: Path, api_key: str) -> List[Dict[str, Any]]:
    """
    Translates ANY spoken language (Hindi, Hinglish, Spanish, English, etc.) directly into clean
    English word-timed cues via Groq `/openai/v1/audio/translations` (`whisper-large-v3`).
    """
    if not api_key or not wav_path.exists() or wav_path.stat().st_size < 1000:
        return []
    try:
        import httpx

        with wav_path.open("rb") as f:
            resp = httpx.post(
                "https://api.groq.com/openai/v1/audio/translations",
                headers={"Authorization": f"Bearer {api_key}"},
                data={
                    "model": "whisper-large-v3",
                    "response_format": "verbose_json",
                },
                files={"file": (wav_path.name, f, "audio/wav")},
                timeout=25.0,
            )
        if resp.status_code != 200:
            return []
        data = resp.json()

        # Build clean English word list with timestamps (directly from words if present, else proportional per segment)
        flat_words: List[Dict[str, Any]] = []
        raw_words = data.get("words") or []
        if raw_words:
            for w in raw_words:
                tok = str(w.get("word", "")).strip()
                if not tok:
                    continue
                ws = float(w.get("start", 0.0))
                we = max(ws + 0.06, float(w.get("end", ws + 0.14)))
                flat_words.append({"word": tok, "start": ws, "end": we})
        else:
            for seg in (data.get("segments") or []):
                txt = str(seg.get("text", "")).strip()
                if not txt:
                    continue
                # Strip any stray non-Latin Devanagari if model ever leaks a token
                txt = re.sub(r"[\u0900-\u097f]+", "", txt).strip()
                toks = txt.split()
                if not toks:
                    continue
                s0 = float(seg.get("start", 0.0))
                s1 = max(s0 + 0.12, float(seg.get("end", s0 + 1.0)))
                span = s1 - s0
                weights = [max(2, len(t)) for t in toks]
                tw = float(sum(weights))
                cur = s0
                for tk, wt in zip(toks, weights):
                    d = span * (wt / tw)
                    flat_words.append({"word": tk, "start": round(cur, 3), "end": round(cur + d, 3)})
                    cur += d

        if not flat_words:
            return []

        cues: List[Dict[str, Any]] = []
        buf: List[Dict[str, Any]] = []
        for w in flat_words:
            buf.append(w)
            if len(buf) >= 4 or w["word"].endswith((".", "?", "!")):
                cues.append({
                    "start": buf[0]["start"],
                    "end": buf[-1]["end"],
                    "text": " ".join(x["word"] for x in buf),
                    "words": list(buf),
                })
                buf.clear()
        if buf:
            cues.append({
                "start": buf[0]["start"],
                "end": buf[-1]["end"],
                "text": " ".join(x["word"] for x in buf),
                "words": list(buf),
            })
        return cues
    except Exception:
        return []


def _transcribe_clip_groq_whisper(raw_path: Path, ffmpeg_bin: str = "ffmpeg") -> List[Dict[str, Any]]:
    """
    Fast optional word-level speech transcription via Groq Whisper (`whisper-large-v3-turbo`)
    for live streams that don't carry static YouTube VOD captions. Returns clip-relative cues.
    """
    api_key = _load_groq_api_key()
    if not api_key or not raw_path.exists():
        return []
    wav_path = raw_path.with_suffix(".whisper.wav")
    try:
        subprocess.run(
            [ffmpeg_bin, "-y", "-v", "error", "-i", str(raw_path), "-vn", "-ac", "1", "-ar", "16000", str(wav_path)],
            check=True,
            timeout=20,
            capture_output=True,
        )
        return _transcribe_wav_groq_whisper(wav_path, api_key)
    except Exception:
        return []
    finally:
        wav_path.unlink(missing_ok=True)


def _scan_live_dvr_hype_peaks(
    aud_segments: Sequence[Tuple[float, float, str]],
    window_start: float,
    window_end: float,
    top_k: int = 8,
    min_gap_s: float = 28.0,
    ffmpeg_bin: str = "ffmpeg",
) -> Tuple[List[Tuple[float, float]], Dict[int, bytes]]:
    """
    Lightning-fast live DVR hype detector (~1.8-2.5s for 10+ minutes of livestream!):
      - Downloads lightweight audio-only HLS `.ts` segments in parallel (16 threads, capped to 120 segs).
      - Decodes RMS energy per segment + 1s spikes via FFmpeg in one pass.
      - Returns ([(peak_time_s, hype_ratio), ...], seg_bytes_by_idx) sorted highest-hype first!
    """
    import httpx
    import numpy as np

    win_indices = [
        i for i, (st, dur, _) in enumerate(aud_segments)
        if (st + dur) > window_start and st < window_end
    ]
    if not win_indices:
        return [], {}

    # Cap download to <= 60 segments (~1.8 MB, ~1.5s) using even stride for long lookbacks (15m-60m)
    max_scan_segs = 60
    if len(win_indices) > max_scan_segs:
        step = len(win_indices) / float(max_scan_segs)
        sample_indices = [win_indices[min(len(win_indices) - 1, int(i * step))] for i in range(max_scan_segs)]
    else:
        sample_indices = win_indices

    seg_bytes: Dict[int, bytes] = {}
    try:
        with httpx.Client(timeout=8.0, headers={"User-Agent": "Mozilla/5.0"}) as client:
            def _dl(idx: int) -> Tuple[int, bytes]:
                try:
                    r = client.get(aud_segments[idx][2])
                    return idx, r.content if r.status_code == 200 else b""
                except Exception:
                    return idx, b""

            with ThreadPoolExecutor(max_workers=16) as pool:
                for idx, blob in pool.map(_dl, sample_indices):
                    if blob:
                        seg_bytes[idx] = blob
    except Exception:
        return [], {}

    if not seg_bytes:
        return [], {}

    # Compute RMS energy & burst peak per downloaded segment in parallel via lightweight FFmpeg decode
    def _seg_energy(idx: int) -> Tuple[int, float, float]:
        blob = seg_bytes.get(idx, b"")
        if not blob:
            return idx, 0.0, 0.0
        try:
            proc = subprocess.run(
                [ffmpeg_bin, "-v", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"],
                input=blob,
                capture_output=True,
                timeout=8,
            )
            if proc.returncode != 0 or len(proc.stdout) < 3200:
                return idx, 0.0, 0.0
            pcm = np.frombuffer(proc.stdout, dtype=np.float32)
            # 1s windows inside the 5s segment -> peak 1s RMS catches sudden screams/reactions!
            n_sec = max(1, pcm.size // 8000)
            mat = pcm[: n_sec * 8000].reshape(n_sec, 8000)
            sec_rms = np.sqrt(np.mean(mat * mat, axis=1) + 1e-12)
            mean_rms = float(np.mean(sec_rms))
            peak_rms = float(np.max(sec_rms))
            return idx, mean_rms, peak_rms
        except Exception:
            return idx, 0.0, 0.0

    energies: List[Tuple[int, float, float]] = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for idx, m_rms, p_rms in pool.map(_seg_energy, sorted(seg_bytes.keys())):
            if p_rms > 1e-5:
                energies.append((idx, m_rms, p_rms))

    if not energies:
        return [], seg_bytes

    med_rms = float(np.median([e[1] for e in energies])) + 1e-6
    scored: List[Tuple[float, float]] = []
    for idx, m_rms, p_rms in energies:
        seg_st, seg_dur, _ = aud_segments[idx]
        # Hype score rewards loud sustained reaction + sharp shout spike above stream baseline
        hype_ratio = 0.55 * (p_rms / med_rms) + 0.45 * (m_rms / med_rms)
        scored.append((seg_st + seg_dur * 0.35, hype_ratio))

    scored.sort(key=lambda x: x[1], reverse=True)
    peaks: List[Tuple[float, float]] = []
    for pt, h_ratio in scored:
        if len(peaks) >= top_k:
            break
        if any(abs(pt - prev_t) < min_gap_s for prev_t, _ in peaks):
            continue
        peaks.append((pt, round(h_ratio, 2)))
    return peaks, seg_bytes


def _select_goated_live_specs(
    aud_low_segs: Sequence[Tuple[float, float, str]],
    aud_hi_segs: Sequence[Tuple[float, float, str]],
    dvr_duration_s: float,
    clip_count: int,
    live_mode: str,
    dvr_behind_sec: int,
    stream_title: str,
    work_dir: Path,
    ffmpeg_bin: str = "ffmpeg",
) -> List[Dict[str, Any]]:
    """
    Finds the genuinely GOATED (highest hype + strongest spoken hook) moments from an active
    live stream's DVR buffer, always respecting `live_mode` (`live_and_behind` | `live` | `behind`):
      1. Fast parallel audio-only hype scan across the lookback window (~2s).
      2. Parallel Groq Whisper transcription on the top candidate hype peaks + live edge (~0.8s).
      3. Hook + hype ranking using `hook_selector.score_sentence_hook` + energy spike ratio,
         reusing the Whisper word cues directly during final clip rendering!
    """
    from openclip_engine.scoring.hook_selector import score_sentence_hook
    from openclip_engine.clipping.title_renderer import resolve_title_and_keyword

    clip_len = min(22.0, max(12.0, dvr_duration_s * 0.5))
    live_end = max(clip_len, dvr_duration_s - 2.0)
    behind_span = max(clip_len * 2.0, min(float(dvr_behind_sec), live_end))
    window_start = max(0.0, live_end - behind_span)
    mode_norm = (live_mode or "live_and_behind").strip().lower()

    scan_segs = aud_low_segs if aud_low_segs else aud_hi_segs
    cand_windows: List[Tuple[float, float, str, float, bool]] = []  # (st, en, tag, hype_ratio, is_live_edge)

    if mode_norm in ("live", "live_and_behind"):
        live_st = max(0.0, live_end - clip_len)
        cand_windows.append((live_st, min(dvr_duration_s, live_st + clip_len), "LIVE NOW", 1.8, True))

    if mode_norm == "live":
        # Additional slots right behind the live edge
        for i in range(1, clip_count):
            st = max(0.0, live_end - clip_len * (i + 1) - i * 3.0)
            tag = f"-{int(round(live_end - st))}s behind live"
            cand_windows.append((st, min(dvr_duration_s, st + clip_len), tag, 1.3, False))
    else:
        # Scan behind-live DVR window for GOATED hype/reaction peaks!
        behind_end = max(window_start + clip_len, live_end - (clip_len + 8.0 if mode_norm == "live_and_behind" else 10.0))
        want_peaks = min(5, max(clip_count + 1, 3))
        peaks, _ = _scan_live_dvr_hype_peaks(
            scan_segs,
            window_start=window_start,
            window_end=behind_end,
            top_k=want_peaks,
            min_gap_s=max(25.0, clip_len + 5.0),
            ffmpeg_bin=ffmpeg_bin,
        )
        for pt, h_ratio in peaks:
            # Start 4s BEFORE the hype peak so the buildup/hook leads straight into the scream/payoff!
            st = max(window_start, min(behind_end - clip_len, pt - 4.0))
            en = min(dvr_duration_s, st + clip_len)
            secs_ago = int(round(live_end - st))
            tag = f"-{secs_ago // 60}m behind live" if secs_ago >= 90 else f"-{secs_ago}s behind live"
            cand_windows.append((st, en, tag, h_ratio, False))

        # Backfill if DVR scan yielded fewer candidates than clip_count
        if len(cand_windows) < clip_count:
            usable = max(0.0, behind_end - clip_len - window_start)
            needed = clip_count - len(cand_windows)
            for i in range(needed):
                frac = (i + 0.5) / max(1, needed)
                st = max(0.0, min(behind_end - clip_len, window_start + frac * usable))
                if any(abs(st - c[0]) < clip_len * 0.7 for c in cand_windows):
                    continue
                secs_ago = int(round(live_end - st))
                tag = f"-{secs_ago // 60}m behind live" if secs_ago >= 90 else f"-{secs_ago}s behind live"
                cand_windows.append((st, min(dvr_duration_s, st + clip_len), tag, 1.0, False))

    # Transcribe candidate audio snippets in parallel with Groq Whisper to rank by spoken hook + hype!
    api_key = _load_groq_api_key()
    hls_flags = ["-protocol_whitelist", "file,http,https,tcp,tls,crypto", "-allowed_extensions", "ALL"]

    def _eval_cand(idx: int, cw: Tuple[float, float, str, float, bool]) -> Dict[str, Any]:
        st, en, tag, hype_ratio, is_edge = cw
        seg_dur = max(5.0, en - st)
        cues: List[Dict[str, Any]] = []
        hook_score = 5.0
        hook_sent = ""
        title_txt = f"[{tag}] {stream_title[:48]}"

        if api_key and scan_segs:
            pl_p = work_dir / f".live_cand_{idx}.m3u8"
            wav_p = work_dir / f".live_cand_{idx}.wav"
            try:
                sub_pl, trim_off = _write_vod_subplaylist(scan_segs, st, en, pl_p)
                subprocess.run(
                    [
                        ffmpeg_bin, "-y", "-v", "error",
                        *hls_flags, "-i", str(sub_pl),
                        "-ss", f"{trim_off:.3f}", "-t", f"{seg_dur:.3f}",
                        "-vn", "-ac", "1", "-ar", "16000", str(wav_p),
                    ],
                    check=True,
                    timeout=25,
                    capture_output=True,
                )
                cues = _transcribe_wav_groq_whisper(wav_p, api_key)
                if cues:
                    full_spoken = " ".join(c["text"] for c in cues)
                    first_spoken = " ".join(c["text"] for c in cues[:2])
                    hook_score, _ = score_sentence_hook(first_spoken)
                    # Check if a later cue in the first 7s is an even stronger hook sentence
                    best_c_sc = hook_score
                    best_c_txt = cues[0]["text"]
                    for c in cues:
                        if c["start"] > 7.0:
                            break
                        sc_c, _ = score_sentence_hook(c["text"])
                        if sc_c > best_c_sc:
                            best_c_sc = sc_c
                            best_c_txt = c["text"]
                    hook_score = max(hook_score, best_c_sc)
                    hook_sent = best_c_txt
                    t_gen, _ = resolve_title_and_keyword(full_spoken, hook_sentence=hook_sent, use_llm=False)
                    if t_gen:
                        title_txt = t_gen
            except Exception:
                pass
            finally:
                pl_p.unlink(missing_ok=True)
                wav_p.unlink(missing_ok=True)

        speech_bonus = 1.5 if len(cues) >= 3 else (0.5 if cues else -1.0)
        hype_pts = min(10.0, 4.5 + (hype_ratio - 1.0) * 3.0)
        combined = 0.55 * hype_pts + 0.45 * hook_score + speech_bonus
        score_100 = int(round(max(65.0, min(99.0, combined * 9.5))))
        return {
            "start_sec": round(st, 2),
            "end_sec": round(en, 2),
            "hook_sentence": hook_sent,
            "title": title_txt,
            "score": score_100,
            "reason": f"Live GOATED moment ({tag}, hype {hype_ratio:.1f}x, hook {hook_score:.1f}/10)",
            "precomputed_cues": cues,
            "_rank": combined,
            "_is_edge": is_edge,
        }

    evaluated: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=min(6, max(1, len(cand_windows)))) as pool:
        futs = [pool.submit(_eval_cand, i, cw) for i, cw in enumerate(cand_windows)]
        for fut in as_completed(futs):
            evaluated.append(fut.result())

    # Always keep the LIVE NOW clip first in live_and_behind mode, then fill remaining slots with highest-ranked GOATED behind moments!
    edge_clips = [e for e in evaluated if e["_is_edge"]]
    behind_clips = sorted([e for e in evaluated if not e["_is_edge"]], key=lambda x: x["_rank"], reverse=True)

    picked: List[Dict[str, Any]] = []
    if mode_norm == "live_and_behind" and edge_clips:
        picked.append(edge_clips[0])
    for b in behind_clips:
        if len(picked) >= clip_count:
            break
        if any(abs(b["start_sec"] - p["start_sec"]) < clip_len * 0.6 for p in picked):
            continue
        picked.append(b)
    if len(picked) < clip_count:
        for e in edge_clips[1:]:
            if len(picked) < clip_count:
                picked.append(e)

    for p in picked:
        p.pop("_rank", None)
        p.pop("_is_edge", None)
    return picked


class YtDlpClient:
    @staticmethod
    def _select_best_streams(
        info: Dict[str, Any],
        max_height: int = 720,
    ) -> Tuple[Optional[str], Optional[str], bool, bool]:
        """
        Selects best video + audio stream URLs for both VOD (HTTPS/MP4) and Live/DVR (HLS m3u8).
        Returns (video_url, audio_url, is_progressive, is_hls).
        """
        formats = info.get("formats", []) or []
        is_live = bool(info.get("is_live") or info.get("live_status") == "is_live")
        allowed_protos = ("m3u8_native", "m3u8", "https", "http") if is_live else ("https", "http")

        def _is_video_fmt(f: Dict[str, Any]) -> bool:
            return (
                bool(f.get("url"))
                and (f.get("vcodec") not in (None, "none"))
                and 0 < (f.get("height") or 0) <= max_height
            )

        def _is_audio_only_fmt(f: Dict[str, Any]) -> bool:
            if not f.get("url"):
                return False
            vc = f.get("vcodec")
            ac = f.get("acodec")
            aext = f.get("audio_ext")
            # Live HLS audio tracks (e.g. itag 233/234) have vcodec='none', acodec=None, audio_ext='mp4'
            has_audio = (ac not in (None, "none")) or (aext not in (None, "none"))
            return vc in (None, "none") and has_audio

        # 1. Prefer H.264 (avc1) video <= max_height in preferred protocols
        h264_vids = [
            f for f in formats
            if _is_video_fmt(f)
            and f.get("protocol") in allowed_protos
            and (f.get("vcodec") or "").startswith("avc1")
        ]
        # Fallback to any MP4/HLS video <= max_height (including HLS if HTTPS unavailable)
        if not h264_vids:
            h264_vids = [
                f for f in formats
                if _is_video_fmt(f)
                and f.get("protocol") in ("https", "http", "m3u8_native", "m3u8")
                and (f.get("ext") == "mp4" or (f.get("vcodec") or "").startswith("avc1"))
            ]

        # Check for progressive stream (has both audio & video)
        prog_mp4 = [
            f for f in h264_vids
            if f.get("acodec") not in (None, "none")
        ]
        if prog_mp4 and not is_live:
            best_prog = sorted(prog_mp4, key=lambda x: x.get("height") or 0, reverse=True)[0]
            proto = str(best_prog.get("protocol") or "")
            return best_prog["url"], None, True, ("m3u8" in proto)

        # Separate DASH/HLS video + audio
        best_vid_fmt: Optional[Dict[str, Any]] = None
        if h264_vids:
            best_vid_fmt = sorted(
                h264_vids,
                key=lambda x: (1 if x.get("protocol") in allowed_protos else 0, x.get("height") or 0, x.get("tbr") or 0),
                reverse=True,
            )[0]
        else:
            any_vids = [
                f for f in formats
                if f.get("url") and f.get("vcodec") not in (None, "none") and (f.get("height") or 0) > 0
            ]
            if any_vids:
                best_vid_fmt = sorted(any_vids, key=lambda x: x.get("height") or 0, reverse=True)[0]

        vid_url = best_vid_fmt["url"] if best_vid_fmt else None
        vid_is_hls = bool(best_vid_fmt and "m3u8" in str(best_vid_fmt.get("protocol") or ""))

        # Select matching-protocol best audio-only stream
        aud_protos = ("m3u8_native", "m3u8") if vid_is_hls else ("https", "http")
        auds = [f for f in formats if _is_audio_only_fmt(f) and f.get("protocol") in aud_protos]
        if not auds:
            auds = [f for f in formats if _is_audio_only_fmt(f)]

        aud_url = None
        if auds:
            def audio_rank(a: Dict[str, Any]) -> Tuple[int, int, int, int, float]:
                note = (a.get("format_note") or "").lower()
                is_high = 2 if "high" in note else (1 if "medium" in note else 0)
                is_m4a = 1 if a.get("ext") in ("m4a", "mp4") else 0
                is_orig = 1 if ("original" in note or "default" in note) else 0
                is_en = 1 if (a.get("language") or "").lower().startswith("en") else 0
                abr = float(a.get("abr") or a.get("tbr") or 0)
                return (is_orig, is_high, is_m4a, is_en, abr)

            best_aud = sorted(auds, key=audio_rank, reverse=True)[0]
            aud_url = best_aud["url"]

        return vid_url, aud_url, False, vid_is_hls

    @staticmethod
    def inspect_metadata(url: str) -> Dict[str, Any]:
        """Inspects remote video metadata using direct yt-dlp in-process or fast oEmbed fallback."""
        if not URLValidator.is_valid_youtube_url(url):
            raise ValueError(f"Invalid or unsupported YouTube URL: {url}")

        video_id = URLValidator.extract_youtube_video_id(url)

        # 1. Direct in-process yt_dlp for rich, accurate extraction
        try:
            import yt_dlp
            ydl_opts: Any = {
                "quiet": True,
                "no_warnings": True,
                "skip_download": True,
                "noplaylist": True,
                "extract_flat": False,
                "nocheckcertificate": True,
                "socket_timeout": 15,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                data = ydl.extract_info(url, download=False)
                if data:
                    thumbnail = data.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
                    is_live = bool(data.get("is_live") or data.get("live_status") == "is_live")
                    dur = int(data.get("duration") or 0)
                    if is_live and dur <= 0:
                        rel_ts = data.get("release_timestamp")
                        if rel_ts:
                            dur = max(60, min(14400, int(time.time() - float(rel_ts))))
                        else:
                            dur = 3600
                    return {
                        "title": data.get("title", f"YouTube Video ({video_id})"),
                        "uploader": data.get("uploader") or data.get("channel") or "YouTube Creator",
                        "duration": dur,
                        "width": data.get("width") or 1920,
                        "height": data.get("height") or 1080,
                        "fps": data.get("fps") or 30,
                        "thumbnail": thumbnail,
                        "description": (data.get("description") or "")[:500],
                        "view_count": data.get("view_count") or data.get("concurrent_view_count") or 0,
                        "video_id": video_id,
                        "is_live": is_live,
                        "live_status": str(data.get("live_status") or ("is_live" if is_live else "not_live")),
                        "status": "loaded",
                    }
        except Exception:
            pass

        # 2. Fast YouTube oEmbed API fallback
        try:
            oembed_url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
            req = urllib.request.Request(oembed_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=5) as response:
                if response.status == 200:
                    oembed_data = json.loads(response.read().decode())
                    return {
                        "title": oembed_data.get("title", f"YouTube Video ({video_id})"),
                        "uploader": oembed_data.get("author_name", "YouTube Creator"),
                        "duration": 180,
                        "width": 1280,
                        "height": 720,
                        "fps": 30,
                        "thumbnail": oembed_data.get("thumbnail_url") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                        "description": "Imported via OpenClip AI Viral Engine",
                        "view_count": 0,
                        "video_id": video_id,
                        "status": "loaded",
                    }
        except Exception:
            pass

        raise RuntimeError(f"Failed to probe YouTube video metadata for {url}")

    @staticmethod
    def extract_clips_parallel(
        url: str,
        job_id: str,
        clip_count: int = 5,
        max_height: int = 1080,
        aspect_ratio: str = "9:16",
        caption_style: str = "Hormozi",
        hook_mode: str = "balanced",
        hook_hint: Optional[str] = None,
        live_mode: str = "live_and_behind",
        dvr_behind_sec: int = 900,
        ai_hook_intro: bool = True,
        narrator_voice: str = "en-US-ChristopherNeural",
    ) -> Dict[str, Any]:
        """
        Extracts real 1080p Full HD H.264/AAC MP4 viral clip segments directly from YouTube CDN in parallel
        (supports VODs, Shorts, AND active YouTube Live streams — cutting both the live edge AND from
        behind in the DVR rewind buffer!).
        """
        if not URLValidator.is_valid_youtube_url(url):
            raise ValueError(f"Invalid or unsupported YouTube URL: {url}")

        import yt_dlp

        video_id = URLValidator.extract_youtube_video_id(url)
        ydl_opts: Any = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "noplaylist": True,
            "nocheckcertificate": True,
            "socket_timeout": 15,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_raw = ydl.extract_info(url, download=False)

        if not info_raw:
            raise RuntimeError("yt-dlp returned empty video info")
        info: Dict[str, Any] = dict(info_raw)
        is_live = bool(info.get("is_live") or info.get("live_status") == "is_live")

        # Pull crisp 1080p Full HD source stream + original audio (supports both HTTPS VOD and HLS Live/DVR)
        vid_url, aud_url, is_progressive, is_hls = YtDlpClient._select_best_streams(info, max_height=max_height)
        if not vid_url:
            raise RuntimeError("No playable video stream found for this YouTube URL")

        # For Live / HLS streams, parse DVR segment lists once so we can cut BOTH live edge AND from behind!
        vid_hls_segs: List[Tuple[float, float, str]] = []
        aud_hls_segs: List[Tuple[float, float, str]] = []
        aud_low_hls_segs: List[Tuple[float, float, str]] = []
        dvr_duration_s = 0.0
        if is_hls:
            vid_hls_segs, dvr_duration_s = _parse_hls_dvr_segments(vid_url)
            if aud_url:
                aud_hls_segs, _ = _parse_hls_dvr_segments(aud_url)
            # Also grab ultra-light low-bitrate audio playlist (e.g. itag 233) for ~2s hype scanning
            low_aud_url = next(
                (
                    f["url"]
                    for f in (info.get("formats") or [])
                    if f.get("url")
                    and f.get("vcodec") in (None, "none")
                    and "m3u8" in str(f.get("protocol") or "")
                    and "low" in str(f.get("format_note") or "").lower()
                ),
                None,
            )
            if low_aud_url:
                try:
                    aud_low_hls_segs, _ = _parse_hls_dvr_segments(low_aud_url)
                except Exception:
                    aud_low_hls_segs = aud_hls_segs
            else:
                aud_low_hls_segs = aud_hls_segs

        # Fetch real timed speech captions from YouTube once (~0.2s) for VODs
        all_cues = [] if is_live else fetch_youtube_captions(info)

        if is_live and dvr_duration_s > 0:
            total_duration = int(dvr_duration_s)
        else:
            total_duration = int(info.get("duration") or (dvr_duration_s if dvr_duration_s > 0 else 180))
        clip_count = max(1, min(20, int(clip_count)))

        metadata: Dict[str, Any] = {
            "title": info.get("title", f"YouTube Video ({video_id})"),
            "uploader": info.get("uploader") or info.get("channel") or "YouTube Creator",
            "duration": total_duration,
            "width": info.get("width") or 1920,
            "height": info.get("height") or 1080,
            "fps": info.get("fps") or 30,
            "thumbnail": info.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            "view_count": info.get("view_count") or info.get("concurrent_view_count") or 0,
            "video_id": video_id,
            "is_live": is_live,
            "live_status": str(info.get("live_status") or ("is_live" if is_live else "not_live")),
            "live_mode": live_mode if is_live else None,
            "dvr_window_sec": int(dvr_duration_s) if is_live else 0,
            "captions_available": len(all_cues) > 0,
            "aspect_ratio": aspect_ratio,
            "caption_style": caption_style,
            "status": "loaded",
        }

        OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
        ffmpeg_bin = FFMPEG_PATH or "ffmpeg"

        # M6a unified hook-aware clip selection (replaces naive even-step slicing when captions exist)
        clip_specs: List[Dict[str, Any]] = []
        hook_report_meta: Dict[str, Any] = {}
        if all_cues:
            from openclip_engine.clipping.karaoke_pop import cues_to_words
            from openclip_engine.clipping.title_renderer import resolve_title_and_keyword
            from openclip_engine.scoring.hook_selector import select_hook_clips

            all_words = cues_to_words(all_cues)
            try:
                selected_hooks, hook_report_meta = select_hook_clips(
                    words=all_words,
                    clip_count=max(0, int(clip_count)),
                    min_dur=15.0,
                    max_dur=45.0,
                    hook_mode=hook_mode,
                    hook_hint=hook_hint,
                    report_dir=OUTPUTS_DIR / f"{job_id}_analysis",
                    video_label=str(metadata.get("title") or f"YouTube Video ({video_id})"),
                    use_llm=True,
                    ffmpeg_bin=ffmpeg_bin,
                )
            except ValueError as exc:
                print(f"[OpenClip] Invalid hook_selector arguments ({exc}); falling back to default slicing", file=sys.stderr)
                selected_hooks, hook_report_meta = [], {"error": str(exc)}
            for hc in selected_hooks:
                st = hc.refined_start if hc.refined_start is not None else hc.start
                en = hc.refined_end if hc.refined_end is not None else hc.end
                title_txt, _ = resolve_title_and_keyword(
                    hc.text, hook_sentence=hc.hook_sentence, use_llm=False
                )
                clip_specs.append({
                    "start_sec": max(0.0, float(st)),
                    "end_sec": min(float(total_duration), max(float(st) + 5.0, float(en))),
                    "hook_sentence": hc.hook_sentence,
                    "title": title_txt,
                    "score": int(round(min(99.0, max(50.0, hc.final_score * 10.0)))),
                    "reason": hc.reason,
                })

        if not clip_specs and is_live and dvr_duration_s > 0:
            # GOATED Live + Behind (DVR) finder: scans audio energy spikes across DVR lookback +
            # transcribes top candidates with Groq Whisper + ranks by hype + spoken hook strength!
            clip_specs = _select_goated_live_specs(
                aud_low_segs=aud_low_hls_segs,
                aud_hi_segs=aud_hls_segs,
                dvr_duration_s=dvr_duration_s,
                clip_count=clip_count,
                live_mode=live_mode,
                dvr_behind_sec=dvr_behind_sec,
                stream_title=str(metadata["title"]),
                work_dir=OUTPUTS_DIR,
                ffmpeg_bin=ffmpeg_bin,
            )

        if not clip_specs:
            # Fallback when VOD video has no captions at all
            clip_len = min(20, max(10, total_duration // max(clip_count, 1)))
            if total_duration <= clip_len:
                starts = [0]
            else:
                usable_span = max(1, total_duration - clip_len)
                step = usable_span / max(clip_count, 1)
                starts = [int(i * step) for i in range(clip_count)]
            for st in starts:
                clip_specs.append({
                    "start_sec": float(st),
                    "end_sec": float(min(total_duration, st + clip_len)),
                    "hook_sentence": "",
                    "title": metadata["title"],
                    "score": 82,
                    "reason": "Even-interval fallback (no captions track)",
                })

        metadata["hook_analysis"] = hook_report_meta

        def cut_and_caption_clip(idx: int, spec: Dict[str, Any]) -> Dict[str, Any]:
            start_sec = float(spec["start_sec"])
            end_sec = float(spec["end_sec"])
            seg_dur = max(5.0, end_sec - start_sec)
            clip_id = f"{job_id}_clip_{idx + 1}"
            raw_path = OUTPUTS_DIR / f".raw_{clip_id}.mp4"
            out_path = OUTPUTS_DIR / f"{clip_id}.mp4"
            vtt_path = OUTPUTS_DIR / f"{clip_id}.vtt"
            vid_m3u8 = OUTPUTS_DIR / f".v_{clip_id}.m3u8"
            aud_m3u8 = OUTPUTS_DIR / f".a_{clip_id}.m3u8"

            try:
                # 1. Fast stream-copy 1080p segment from YouTube CDN (VOD HTTPS or Live/DVR HLS sub-playlist!)
                if is_hls and vid_hls_segs:
                    v_pl, v_off = _write_vod_subplaylist(vid_hls_segs, start_sec, end_sec, vid_m3u8)
                    hls_flags = ["-protocol_whitelist", "file,http,https,tcp,tls,crypto", "-allowed_extensions", "ALL"]
                    if aud_hls_segs:
                        a_pl, a_off = _write_vod_subplaylist(aud_hls_segs, start_sec, end_sec, aud_m3u8)
                        cmd = [
                            ffmpeg_bin, "-y", "-loglevel", "error",
                            *hls_flags, "-i", str(v_pl),
                            *hls_flags, "-i", str(a_pl),
                            "-ss", f"{min(v_off, a_off):.3f}", "-t", f"{seg_dur:.3f}",
                            "-map", "0:v:0", "-map", "1:a:0",
                            "-c", "copy", "-shortest", "-movflags", "+faststart",
                            str(raw_path),
                        ]
                    else:
                        cmd = [
                            ffmpeg_bin, "-y", "-loglevel", "error",
                            *hls_flags, "-i", str(v_pl),
                            "-ss", f"{v_off:.3f}", "-t", f"{seg_dur:.3f}",
                            "-c", "copy", "-movflags", "+faststart",
                            str(raw_path),
                        ]
                elif is_progressive or not aud_url:
                    cmd = [
                        ffmpeg_bin, "-y", "-loglevel", "error",
                        "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2",
                        "-ss", f"{start_sec:.3f}", "-t", f"{seg_dur:.3f}", "-i", vid_url,
                        "-c", "copy", "-movflags", "+faststart",
                        str(raw_path),
                    ]
                else:
                    cmd = [
                        ffmpeg_bin, "-y", "-loglevel", "error",
                        "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2",
                        "-ss", f"{start_sec:.3f}", "-t", f"{seg_dur:.3f}", "-i", vid_url,
                        "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2",
                        "-ss", f"{start_sec:.3f}", "-t", f"{seg_dur:.3f}", "-i", aud_url,
                        "-map", "0:v:0", "-map", "1:a:0",
                        "-c", "copy", "-shortest", "-movflags", "+faststart",
                        str(raw_path),
                    ]

                res = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
                if res.returncode != 0 or not raw_path.exists() or raw_path.stat().st_size < 1000:
                    raise RuntimeError(f"FFmpeg clip {idx + 1} fetch failed: {res.stderr[-300:]}")

                # 2. Slice real spoken captions (or reuse precomputed Live Whisper cues / fallback transcribe!)
                pre_cues = spec.get("precomputed_cues") or []
                if pre_cues:
                    clip_cues = list(pre_cues)
                    used_clip_whisper = True
                else:
                    clip_cues = slice_and_chunk_cues(all_cues, float(start_sec), float(end_sec)) if all_cues else []
                    used_clip_whisper = False
                    if not clip_cues and is_live:
                        clip_cues = _transcribe_clip_groq_whisper(raw_path, ffmpeg_bin=ffmpeg_bin)
                        used_clip_whisper = bool(clip_cues)

                sub_path_str: Optional[str] = None
                if clip_cues:
                    write_vtt(clip_cues, vtt_path)
                    sub_path_str = str(vtt_path)

                # 3. Smart-reframe / M6 framing + burnt-in captions + M6d complete title
                clip_title = spec.get("title") or metadata["title"]
                if used_clip_whisper and clip_cues:
                    from openclip_engine.clipping.title_renderer import resolve_title_and_keyword
                    spoken = " ".join(c["text"] for c in clip_cues)
                    t_gen, _ = resolve_title_and_keyword(spoken, use_llm=False)
                    if t_gen:
                        clip_title = t_gen

                build_reframe_and_caption_clip(
                    raw_clip_path=raw_path,
                    final_clip_path=out_path,
                    cues=clip_cues,
                    aspect_ratio=aspect_ratio,
                    caption_style=caption_style,
                    ffmpeg_bin=ffmpeg_bin,
                    raw_all_cues=None if used_clip_whisper else all_cues,
                    clip_start=0.0 if used_clip_whisper else float(start_sec),
                    clip_end=seg_dur if used_clip_whisper else float(end_sec),
                    hook_sentence=spec.get("hook_sentence") or None,
                    title=clip_title,
                    is_live=is_live,
                )

                full_transcript = " ".join(c["text"] for c in clip_cues).strip()
                transcript_text = full_transcript[:160]

                # 3b. Optional Cold-Open Preview + Male AI Narrator Hook Intro
                # ("This is what happened when <streamer>..." over peak preview slice, THEN main clip!)
                intro_meta: Dict[str, Any] = {
                    "applied": False,
                    "hook_narration": "",
                    "intro_duration": 0.0,
                    "preview_start": 0.0,
                    "voice_backend": "",
                }
                if ai_hook_intro:
                    try:
                        from openclip_engine.clipping.hook_intro import prepend_ai_hook_intro

                        intro_meta = prepend_ai_hook_intro(
                            main_clip_path=out_path,
                            raw_source_path=raw_path,
                            transcript=full_transcript,
                            video_title=str(metadata.get("title") or ""),
                            uploader=str(metadata.get("uploader") or ""),
                            hook_sentence=str(spec.get("hook_sentence") or ""),
                            is_live=is_live,
                            aspect_ratio=aspect_ratio,
                            narrator_voice=narrator_voice,
                            ffmpeg_bin=ffmpeg_bin,
                            use_llm=True,
                        )
                        if intro_meta.get("applied") and float(intro_meta.get("intro_duration") or 0.0) > 0:
                            intro_off = float(intro_meta["intro_duration"])
                            shifted_cues: List[Dict[str, Any]] = []
                            if intro_meta.get("hook_narration"):
                                shifted_cues.append({
                                    "start": 0.05,
                                    "end": max(0.5, intro_off - 0.1),
                                    "text": str(intro_meta["hook_narration"]),
                                })
                            for c in clip_cues:
                                shifted_cues.append({
                                    "start": round(float(c["start"]) + intro_off, 3),
                                    "end": round(float(c["end"]) + intro_off, 3),
                                    "text": c["text"],
                                })
                            write_vtt(shifted_cues, vtt_path)
                            sub_path_str = str(vtt_path)
                    except Exception as intro_exc:
                        print(f"[OpenClip] AI hook intro skipped for clip {idx + 1}: {intro_exc}", file=sys.stderr)

                # 4. Generate YouTube SEO Package (YT title, description, tags, hashtags) + persist .seo.json
                from openclip_engine.clipping.seo_generator import generate_clip_seo, write_clip_seo_json

                seo_pkg = generate_clip_seo(
                    transcript=full_transcript,
                    video_title=str(metadata.get("title") or ""),
                    uploader=str(metadata.get("uploader") or ""),
                    hook_sentence=str(spec.get("hook_sentence") or ""),
                    is_live=is_live,
                    aspect_ratio=aspect_ratio,
                    use_llm=True,
                )
                if intro_meta.get("applied"):
                    seo_pkg["hook_narration"] = str(intro_meta.get("hook_narration") or "")
                    seo_pkg["intro_duration"] = float(intro_meta.get("intro_duration") or 0.0)
                    seo_pkg["preview_start"] = float(intro_meta.get("preview_start") or 0.0)
                seo_path = write_clip_seo_json(out_path, seo_pkg)

                return {
                    "index": idx,
                    "id": clip_id,
                    "start_time": round(start_sec, 2),
                    "end_time": round(end_sec, 2),
                    "title": seo_pkg.get("yt_title") or clip_title,
                    "yt_title": seo_pkg.get("yt_title") or clip_title,
                    "description": seo_pkg.get("description") or "",
                    "tags": seo_pkg.get("tags") or [],
                    "hashtags": seo_pkg.get("hashtags") or [],
                    "seo": seo_pkg,
                    "seo_path": str(seo_path),
                    "hook_narration": str(intro_meta.get("hook_narration") or ""),
                    "intro_duration": float(intro_meta.get("intro_duration") or 0.0),
                    "preview_start": float(intro_meta.get("preview_start") or 0.0),
                    "voice_backend": str(intro_meta.get("voice_backend") or ""),
                    "score": int(spec.get("score", 85)),
                    "hook_sentence": spec.get("hook_sentence") or "",
                    "hook_rationale": spec.get("reason") or "",
                    "output_path": str(out_path),
                    "subtitles_path": sub_path_str,
                    "captions_count": len(clip_cues),
                    "transcript_preview": transcript_text,
                    "size_bytes": out_path.stat().st_size,
                }
            finally:
                raw_path.unlink(missing_ok=True)
                vid_m3u8.unlink(missing_ok=True)
                aud_m3u8.unlink(missing_ok=True)

        extracted: List[Dict[str, Any]] = []
        max_workers = min(4, len(clip_specs))
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(cut_and_caption_clip, idx, sp): idx for idx, sp in enumerate(clip_specs)}
            for fut in as_completed(futures):
                extracted.append(fut.result())

        extracted.sort(key=lambda x: x["index"])

        return {
            "metadata": metadata,
            "clips": extracted,
        }

    @staticmethod
    def download_video(url: str, job_id: str, max_height: int = 720) -> str:
        """Downloads authorized real video content up to max_height resolution using high-performance yt-dlp."""
        if not URLValidator.is_valid_youtube_url(url):
            raise ValueError(f"Invalid or unsupported YouTube URL: {url}")

        UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        output_template = str(UPLOADS_DIR / f"{job_id}_video.%(ext)s")

        import yt_dlp
        ydl_opts = {
            "format": (
                f"bestvideo[height<={max_height}][vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/"
                f"best[height<={max_height}][ext=mp4]/"
                f"bestvideo[height<={max_height}]+bestaudio/best"
            ),
            "outtmpl": output_template,
            "noplaylist": True,
            "merge_output_format": "mp4",
            "quiet": True,
            "no_warnings": True,
            "nocheckcertificate": True,
            "concurrent_fragment_downloads": 8,
            "buffersize": 1024 * 1024,
            "socket_timeout": 30,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

        matched = list(UPLOADS_DIR.glob(f"{job_id}_video*.mp4"))
        if matched:
            return str(matched[0])
        raise RuntimeError(f"yt-dlp completed but output file not found in {UPLOADS_DIR}")

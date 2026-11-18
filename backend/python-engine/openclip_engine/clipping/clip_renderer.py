"""
Unified M1-M5 Polished Vertical Clip Renderer:
  - M1: 4:5 (or 3:4) graded video window on a blurred 9:16 canvas (never stretched),
        adaptive brightness B via FFmpeg signalstats, luma-only unsharp, optional smart-crop / subject-pop.
  - M2: Karaoke Pop word captions via strip-sized cached PNG sprite track (captions.ffconcat).
  - M3: Impact ALL CAPS main title with yellow keyword glow via title.ffconcat.
  - M4: Auto-placed SFX (rules / LLM / off) mixed in the same FFmpeg graph with
        amix=normalize=0 + alimiter=limit=0.89 + <out>.sfx_cues.json.
  - M5: Single FFmpeg process (zero Python per-frame piping), h264_videotoolbox hardware
        encode by default (with libx264 fallback), --quality fast|balanced|max,
        and pipelined parallel batch execution with --jobs auto.
"""
from __future__ import annotations

import json
import math
import os
import re
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union

from openclip_engine.clipping.config_styles import (
    DEFAULT_LAYOUT,
    DEFAULT_SFX_CONFIG,
    DEFAULT_TITLE_STYLE,
    KARAOKE_POP,
    CaptionStyle,
    LayoutStyle,
    SfxConfig,
    TitleStyle,
)
from openclip_engine.clipping.karaoke_pop import (
    build_caption_ffconcat,
    build_render_events,
    probe_video_stream,
    resolve_writable_cache_dir,
)
from openclip_engine.clipping.sfx_director import (
    PlannedCue,
    build_sfx_audio_filter,
    detect_scene_cuts,
    plan_sfx_cues,
    write_sfx_cues_json,
)
from openclip_engine.clipping.title_renderer import (
    build_title_ffconcat,
    resolve_title_and_keyword,
)

_VT_PROBE_LOCK = threading.Lock()
_VT_AVAILABLE: Optional[bool] = None


def check_videotoolbox_available(ffmpeg_bin: str = "ffmpeg") -> bool:
    """
    Checks BOTH encoder presence (`ffmpeg -encoders`) AND a 2-frame runtime encode test so
    sandboxed/headless environments cleanly fall back to libx264 without failing mid-render.
    """
    global _VT_AVAILABLE
    with _VT_PROBE_LOCK:
        if _VT_AVAILABLE is not None:
            return _VT_AVAILABLE
        try:
            enc = subprocess.run([ffmpeg_bin, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=5)
            if "h264_videotoolbox" not in enc.stdout:
                _VT_AVAILABLE = False
                return False
            probe = subprocess.run(
                [
                    ffmpeg_bin, "-y", "-v", "error",
                    "-f", "lavfi", "-i", "color=c=black:s=128x128:r=30:d=0.1",
                    "-c:v", "h264_videotoolbox", "-b:v", "1M", "-pix_fmt", "yuv420p",
                    "-f", "null", "-",
                ],
                capture_output=True,
                text=True,
                timeout=8,
            )
            _VT_AVAILABLE = (probe.returncode == 0)
        except Exception:
            _VT_AVAILABLE = False
        return _VT_AVAILABLE


def probe_audio_stream(video_path: Path, ffmpeg_bin: str = "ffmpeg") -> Tuple[bool, str]:
    """Returns (has_audio, codec_name)."""
    ffprobe_bin = ffmpeg_bin.replace("ffmpeg", "ffprobe")
    cmd = [
        ffprobe_bin, "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=codec_name",
        "-of", "json",
        str(video_path),
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if res.returncode != 0:
            return False, ""
        data = json.loads(res.stdout)
        streams = data.get("streams") or []
        if not streams:
            return False, ""
        return True, str(streams[0].get("codec_name") or "")
    except Exception:
        return False, ""


def measure_adaptive_brightness(
    video_in: Path,
    clip_start: float,
    duration: float,
    layout: LayoutStyle = DEFAULT_LAYOUT,
    ffmpeg_bin: str = "ffmpeg",
) -> Tuple[float, float]:
    """
    Measures mean luma Ymean over sampled frames using FFmpeg `signalstats` and returns
    (B, Ymean) where B = clamp((0.45 - Ymean/255)*0.25, -0.04, +0.06).
    """
    if not layout.grade_enabled:
        return 0.0, 128.0

    sample_fps = max(0.25, min(2.0, layout.grade_sample_count / max(1.0, duration)))
    cmd = [ffmpeg_bin, "-hide_banner", "-v", "info"]
    if clip_start > 0.001:
        cmd.extend(["-ss", f"{clip_start:.3f}"])
    if duration > 0:
        cmd.extend(["-t", f"{duration:.3f}"])
    cmd.extend([
        "-i", str(video_in),
        "-an",
        "-vf", f"fps={sample_fps:.3f},scale=160:-2:flags=fast_bilinear,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
        "-f", "null", "-",
    ])
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        vals = [float(m.group(1)) for m in re.finditer(r"YAVG=([0-9.]+)", res.stdout + "\n" + res.stderr)]
        if vals:
            y_mean = sum(vals) / len(vals)
        else:
            y_mean = 115.0
    except Exception:
        y_mean = 115.0

    raw_b = (layout.grade_luma_target - (y_mean / 255.0)) * layout.grade_luma_gain
    b_clamped = max(layout.grade_b_min, min(layout.grade_b_max, raw_b))
    return round(b_clamped, 4), round(y_mean, 2)


def _compute_smart_crop_x_expr(
    video_in: Path,
    clip_start: float,
    duration: float,
    src_w: int,
    src_h: int,
    win_w: int,
    win_h: int,
    layout: LayoutStyle,
) -> Optional[str]:
    """
    Optional --smart-crop (default off): samples at 4 fps with OpenCV face detection,
    smooths with EMA (alpha 0.15), caps pan speed, and falls back to center crop if cv2
    is unavailable or no subject is detected.
    """
    if not layout.smart_crop:
        return None
    try:
        import cv2  # type: ignore
    except Exception:
        return None

    try:
        cascade_path = str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")
        detector = cv2.CascadeClassifier(cascade_path)
        if detector.empty():
            return None
        cap = cv2.VideoCapture(str(video_in))
        if not cap.isOpened():
            return None
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        step = max(1, int(round(fps / max(1.0, layout.smart_crop_fps))))
        start_f = int(round(clip_start * fps))
        end_f = int(round((clip_start + duration) * fps))
        cap.set(cv2.CAP_PROP_POS_FRAMES, start_f)

        ema_cx = 0.5
        prev_cx = 0.5
        max_delta = (layout.smart_crop_max_pan_px_s / max(1.0, src_w)) / max(1.0, layout.smart_crop_fps)
        centers: List[float] = []
        f_idx = start_f
        while f_idx < end_f:
            ok, frame = cap.read()
            if not ok:
                break
            if (f_idx - start_f) % step == 0:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                faces = detector.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=4, minSize=(40, 40))
                if len(faces) > 0:
                    x, y, fw, fh = max(faces, key=lambda b: b[2] * b[3])
                    det_cx = (x + fw * 0.5) / max(1.0, frame.shape[1])
                    ema_cx = layout.smart_crop_ema_alpha * det_cx + (1.0 - layout.smart_crop_ema_alpha) * ema_cx
                    delta = max(-max_delta, min(max_delta, ema_cx - prev_cx))
                    prev_cx += delta
                    centers.append(prev_cx)
            f_idx += 1
        cap.release()
        if not centers:
            return None
        mean_cx = sum(centers) / len(centers)
        # Map normalized subject center to scaled crop X coordinate
        scale_factor = max(win_w / max(1.0, src_w), win_h / max(1.0, src_h))
        scaled_w = src_w * scale_factor
        crop_x = int(round(max(0.0, min(scaled_w - win_w, mean_cx * scaled_w - win_w * 0.5))))
        return str(crop_x)
    except Exception:
        return None


def _select_video_encoder_args(
    layout: LayoutStyle,
    ffmpeg_bin: str = "ffmpeg",
    x264_threads: int = 0,
    force_x264: bool = False,
) -> Tuple[List[str], str]:
    """
    Returns (encoder_args, encoder_label) honoring M5 rules:
      - fast:     h264_videotoolbox 8M
      - balanced: h264_videotoolbox 12M (default)
      - max:      libx264 -preset slow -crf 18
      - fallback: libx264 -preset veryfast -crf 20 -threads <x264_threads>
    """
    q = (layout.quality or "balanced").strip().lower()
    if q == "max":
        return [
            "-c:v", "libx264",
            "-preset", layout.x264_preset_max,
            "-crf", str(layout.x264_crf_max),
            "-threads", str(x264_threads),
            "-pix_fmt", "yuv420p",
        ], "libx264_max"

    if (not force_x264) and check_videotoolbox_available(ffmpeg_bin):
        br = layout.vt_bitrate_fast if q == "fast" else layout.vt_bitrate_balanced
        return [
            "-c:v", "h264_videotoolbox",
            "-b:v", br,
            "-maxrate", layout.vt_maxrate,
            "-pix_fmt", "yuv420p",
            "-tag:v", "avc1",
        ], f"h264_videotoolbox_{br}"

    return [
        "-c:v", "libx264",
        "-preset", layout.x264_preset_fallback,
        "-crf", str(layout.x264_crf_fallback),
        "-threads", str(x264_threads),
        "-pix_fmt", "yuv420p",
    ], "libx264_fallback"


@dataclass
class PreparedClipAssets:
    work_dir: Path
    video_in: Path
    out_path: Path
    clip_start: float
    duration: float
    fps: float
    src_w: int
    src_h: int
    has_audio: bool
    audio_codec: str
    brightness_b: float
    y_mean: float
    crop_x_override: Optional[str]
    cap_ffconcat: Optional[Path]
    cap_strip_y: int
    cap_stats: Dict[str, int]
    title_ffconcat: Optional[Path]
    title_info: Dict[str, Any]
    sfx_cues: List[PlannedCue]
    timings: Dict[str, float]


def prepare_clip_assets(
    video_in: Union[str, Path],
    words: Sequence[Dict[str, Any]],
    out_path: Union[str, Path],
    work_dir: Path,
    clip_start: float = 0.0,
    clip_end: Optional[float] = None,
    title: Optional[str] = None,
    keyword: Optional[str] = None,
    layout: LayoutStyle = DEFAULT_LAYOUT,
    caption_style: CaptionStyle = KARAOKE_POP,
    title_style: TitleStyle = DEFAULT_TITLE_STYLE,
    sfx_config: SfxConfig = DEFAULT_SFX_CONFIG,
    ffmpeg_bin: str = "ffmpeg",
    seek_source: bool = True,
    use_llm: bool = True,
    use_disk_cache: bool = True,
    detect_scenes: bool = True,
) -> PreparedClipAssets:
    """
    Python prep phase (can run concurrently for clip N+1 while clip N encodes in FFmpeg):
      - Probes source stream & measures adaptive brightness B
      - Generates cached caption & title sprite PNGs + ffconcat scripts
      - Detects scene cuts & plans deterministic SFX cues
    """
    t0 = time.perf_counter()
    timings: Dict[str, float] = {}
    vid_p = Path(video_in)
    out_p = Path(out_path)
    out_p.parent.mkdir(parents=True, exist_ok=True)
    work_dir.mkdir(parents=True, exist_ok=True)

    src_w, src_h, fps, src_dur = probe_video_stream(vid_p, ffmpeg_bin)
    has_audio, audio_codec = probe_audio_stream(vid_p, ffmpeg_bin)

    if seek_source:
        eff_end = clip_end if clip_end is not None else src_dur
        duration = max(0.2, min(src_dur - clip_start, eff_end - clip_start))
        probe_ss = clip_start
    else:
        duration = src_dur
        eff_end = clip_end if clip_end is not None else (clip_start + duration)
        probe_ss = 0.0

    timings["probe_s"] = time.perf_counter() - t0

    win_w, win_h, win_top = layout.resolved_window_dims()

    # Adaptive grade brightness B (signalstats)
    t_g = time.perf_counter()
    brightness_b, y_mean = measure_adaptive_brightness(vid_p, probe_ss, duration, layout, ffmpeg_bin)
    crop_x_override = _compute_smart_crop_x_expr(vid_p, probe_ss, duration, src_w, src_h, win_w, win_h, layout)
    timings["grade_probe_s"] = time.perf_counter() - t_g

    # M2 Captions sprite factory + ffconcat
    t_c = time.perf_counter()
    cap_ffconcat: Optional[Path] = None
    cap_strip_y = 0
    cap_stats: Dict[str, int] = {}
    if layout.captions_enabled and words:
        events = build_render_events(
            words, fps=fps, clip_start=clip_start, clip_end=eff_end, style=caption_style
        )
        if events:
            cap_ffconcat, _, cap_strip_y, cap_stats = build_caption_ffconcat(
                events=events,
                duration=duration,
                fps=fps,
                canvas_w=layout.canvas_w,
                canvas_h=layout.canvas_h,
                window_top=win_top,
                window_h=win_h,
                work_dir=work_dir,
                style=caption_style,
                use_disk_cache=use_disk_cache,
            )
    timings["caption_sprites_s"] = time.perf_counter() - t_c

    # M3 Title sprite factory + ffconcat
    t_t = time.perf_counter()
    title_ffconcat: Optional[Path] = None
    title_info: Dict[str, Any] = {}
    if layout.title_enabled and win_top >= 200:
        transcript_text = " ".join(str(w.get("word") if "word" in w else w.get("text", "")) for w in words)
        resolved_title, resolved_kw = resolve_title_and_keyword(
            transcript_text, title=title, keyword=keyword, style=title_style, use_llm=use_llm
        )
        title_ffconcat, _, title_info = build_title_ffconcat(
            title=resolved_title,
            keyword=resolved_kw,
            fps=fps,
            canvas_w=layout.canvas_w,
            work_dir=work_dir,
            style=title_style,
            use_disk_cache=use_disk_cache,
        )
    timings["title_sprites_s"] = time.perf_counter() - t_t

    # M4 SFX scene cuts + cue director
    t_s = time.perf_counter()
    sfx_cues: List[PlannedCue] = []
    if (sfx_config.mode or "rules").strip().lower() != "off":
        scene_cuts: List[float] = []
        if detect_scenes:
            scene_cuts = detect_scene_cuts(
                vid_p,
                clip_start=probe_ss,
                duration=duration,
                threshold=sfx_config.scene_threshold,
                min_gap_s=sfx_config.scene_min_gap_s,
                ffmpeg_bin=ffmpeg_bin,
            )
        sfx_cues = plan_sfx_cues(
            words=words,
            duration=duration,
            clip_start=clip_start,
            scene_cuts=scene_cuts,
            title_enabled=(title_ffconcat is not None),
            sfx_config=sfx_config,
            caption_style=caption_style,
            ffmpeg_bin=ffmpeg_bin,
        )
    timings["sfx_plan_s"] = time.perf_counter() - t_s
    timings["python_prep_total_s"] = time.perf_counter() - t0

    return PreparedClipAssets(
        work_dir=work_dir,
        video_in=vid_p,
        out_path=out_p,
        clip_start=clip_start if seek_source else 0.0,
        duration=duration,
        fps=fps,
        src_w=src_w,
        src_h=src_h,
        has_audio=has_audio,
        audio_codec=audio_codec,
        brightness_b=brightness_b,
        y_mean=y_mean,
        crop_x_override=crop_x_override,
        cap_ffconcat=cap_ffconcat,
        cap_strip_y=cap_strip_y,
        cap_stats=cap_stats,
        title_ffconcat=title_ffconcat,
        title_info=title_info,
        sfx_cues=sfx_cues,
        timings=timings,
    )


def execute_ffmpeg_render(
    assets: PreparedClipAssets,
    layout: LayoutStyle = DEFAULT_LAYOUT,
    sfx_config: SfxConfig = DEFAULT_SFX_CONFIG,
    ffmpeg_bin: str = "ffmpeg",
    x264_threads: int = 0,
    force_x264: bool = False,
    seek_source: bool = True,
) -> Tuple[Path, Dict[str, Any]]:
    """
    Executes the SINGLE FFmpeg process combining:
      decode -> blurred bg + graded 4:5 window -> caption overlay -> title overlay -> SFX mix -> encode.
    """
    t0 = time.perf_counter()
    cores = max(1, os.cpu_count() or 4)
    fps_arg = f"{assets.fps:.6f}".rstrip("0").rstrip(".")
    win_w, win_h, win_top = layout.resolved_window_dims()

    cmd: List[str] = [
        ffmpeg_bin, "-y", "-loglevel", "error",
        "-filter_threads", str(cores),
        "-filter_complex_threads", str(cores),
    ]

    if layout.hwaccel_decode and check_videotoolbox_available(ffmpeg_bin):
        cmd.extend(["-hwaccel", "videotoolbox"])

    # Input 0: source video (fast input seeking before -i -> decode ONLY the clip segment)
    if seek_source and assets.clip_start > 0.001:
        cmd.extend(["-ss", f"{assets.clip_start:.3f}"])
    if seek_source:
        cmd.extend(["-t", f"{assets.duration:.3f}"])
    cmd.extend(["-i", str(assets.video_in)])

    next_inp = 1
    cap_inp_idx: Optional[int] = None
    title_inp_idx: Optional[int] = None

    if assets.cap_ffconcat is not None:
        cap_inp_idx = next_inp
        cmd.extend(["-r", fps_arg, "-f", "concat", "-safe", "0", "-i", str(assets.cap_ffconcat)])
        next_inp += 1

    if assets.title_ffconcat is not None:
        title_inp_idx = next_inp
        cmd.extend(["-r", fps_arg, "-f", "concat", "-safe", "0", "-i", str(assets.title_ffconcat)])
        next_inp += 1

    # SFX audio inputs
    sfx_inputs, sfx_filter, sfx_audio_lbl = build_sfx_audio_filter(
        assets.sfx_cues, first_input_idx=next_inp, has_source_audio=assets.has_audio, sfx_config=sfx_config
    )
    cmd.extend(sfx_inputs)

    # ── Build Video Filter Graph ──
    fg_parts: List[str] = []

    # Foreground video window fit (NEVER stretch!)
    if layout.fit_mode == "contain":
        fg_geom = (
            f"scale={win_w}:{win_h}:force_original_aspect_ratio=decrease,"
            f"pad={win_w}:{win_h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
        )
    else:
        if assets.crop_x_override is not None:
            crop_expr = f"crop={win_w}:{win_h}:{assets.crop_x_override}:(ih-{win_h})/2"
        else:
            crop_expr = f"crop={win_w}:{win_h}"
        fg_geom = f"scale={win_w}:{win_h}:force_original_aspect_ratio=increase,{crop_expr},setsar=1"

    # Grade on video window ONLY (never on captions/title)
    if layout.grade_enabled:
        fg_grade = (
            f",eq=contrast={layout.grade_contrast:.2f}:saturation={layout.grade_saturation:.2f}:"
            f"brightness={assets.brightness_b:.4f},"
            f"unsharp={layout.unsharp_lx}:{layout.unsharp_ly}:{layout.unsharp_la:.2f}:"
            f"{layout.unsharp_cx}:{layout.unsharp_cy}:{layout.unsharp_ca:.2f}"
        )
    else:
        fg_grade = ""

    if layout.blur_enabled:
        bg_w = max(64, int(round(layout.canvas_w / layout.bg_scale_div)))
        bg_h = max(64, int(round(layout.canvas_h / layout.bg_scale_div)))
        bg_w += bg_w % 2
        bg_h += bg_h % 2
        fg_parts.append("[0:v]setpts=PTS-STARTPTS,split[bg_in][fg_in]")
        fg_parts.append(
            f"[bg_in]scale={bg_w}:{bg_h}:force_original_aspect_ratio=increase:flags=fast_bilinear,"
            f"crop={bg_w}:{bg_h},gblur=sigma={layout.bg_blur_sigma:.2f},"
            f"scale={layout.canvas_w}:{layout.canvas_h}:flags=bilinear,setsar=1,"
            f"eq=brightness={layout.bg_brightness:.2f}:saturation={layout.bg_saturation:.2f}[bg]"
        )
        fg_parts.append(f"[fg_in]{fg_geom}{fg_grade}[fg]")
        fg_parts.append(f"[bg][fg]overlay=0:{win_top}:shortest=1[v_stage0]")
        cur_v = "[v_stage0]"
    else:
        fg_parts.append(f"[0:v]setpts=PTS-STARTPTS,{fg_geom}{fg_grade}[v_stage0]")
        cur_v = "[v_stage0]"

    # Caption sprite track overlay (eof_action=pass so last caption never freezes)
    if cap_inp_idx is not None:
        fg_parts.append(f"[{cap_inp_idx}:v]fps={fps_arg},format=rgba[cap_s]")
        fg_parts.append(f"{cur_v}[cap_s]overlay=0:{assets.cap_strip_y}:eof_action=pass:format=auto[v_stage1]")
        cur_v = "[v_stage1]"

    # Title sprite track overlay (eof_action=repeat holds the steady frame for the whole clip)
    if title_inp_idx is not None:
        fg_parts.append(f"[{title_inp_idx}:v]fps={fps_arg},format=rgba[ttl_s]")
        fg_parts.append(f"{cur_v}[ttl_s]overlay=0:0:eof_action=repeat:format=auto[v_stage2]")
        cur_v = "[v_stage2]"

    # Single final pixel format conversion
    fg_parts.append(f"{cur_v}format=yuv420p[vout]")

    if sfx_filter:
        fg_parts.append(sfx_filter)

    cmd.extend(["-filter_complex", ";".join(fg_parts)])
    cmd.extend(["-map", "[vout]"])

    # Audio mapping & codec
    if sfx_audio_lbl is not None:
        cmd.extend(["-map", sfx_audio_lbl, "-c:a", "aac", "-b:a", layout.audio_bitrate])
    elif assets.has_audio:
        cmd.extend(["-map", "0:a:0"])
        if (sfx_config.mode or "").strip().lower() == "off" and assets.audio_codec in ("aac", "mp3", "alac"):
            cmd.extend(["-c:a", "copy"])
        else:
            cmd.extend(["-c:a", "aac", "-b:a", layout.audio_bitrate])

    enc_args, enc_label = _select_video_encoder_args(
        layout, ffmpeg_bin=ffmpeg_bin, x264_threads=x264_threads, force_x264=force_x264
    )
    cmd.extend(enc_args)
    cmd.extend(["-movflags", "+faststart", str(assets.out_path)])

    res = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if res.returncode != 0 or not assets.out_path.exists() or assets.out_path.stat().st_size < 1000:
        # Runtime fallback if VideoToolbox errored unexpectedly
        if enc_label.startswith("h264_videotoolbox") and not force_x264:
            return execute_ffmpeg_render(
                assets, layout=layout, sfx_config=sfx_config, ffmpeg_bin=ffmpeg_bin,
                x264_threads=x264_threads, force_x264=True, seek_source=seek_source,
            )
        raise RuntimeError(f"FFmpeg render_polished_clip failed (rc={res.returncode}): {res.stderr[-500:]}")

    encode_s = time.perf_counter() - t0
    cues_json_path = write_sfx_cues_json(assets.out_path, assets.sfx_cues)

    meta = {
        "output": str(assets.out_path),
        "encoder": enc_label,
        "duration_s": round(assets.duration, 3),
        "fps": round(assets.fps, 3),
        "encode_s": round(encode_s, 3),
        "python_prep_s": round(assets.timings.get("python_prep_total_s", 0.0), 3),
        "total_s": round(encode_s + assets.timings.get("python_prep_total_s", 0.0), 3),
        "effective_fps": round((assets.duration * assets.fps) / max(0.01, encode_s + assets.timings.get("python_prep_total_s", 0.0)), 1),
        "brightness_b": assets.brightness_b,
        "y_mean": assets.y_mean,
        "title": assets.title_info.get("title"),
        "keyword": assets.title_info.get("keyword"),
        "sfx_cues_count": len(assets.sfx_cues),
        "sfx_cues_json": str(cues_json_path),
        "caption_stats": assets.cap_stats,
        "timings": {**assets.timings, "ffmpeg_encode_s": round(encode_s, 3)},
    }
    return assets.out_path, meta


def render_polished_clip(
    video_in: Union[str, Path],
    words: Sequence[Dict[str, Any]],
    out_path: Union[str, Path],
    clip_start: float = 0.0,
    clip_end: Optional[float] = None,
    title: Optional[str] = None,
    keyword: Optional[str] = None,
    layout: LayoutStyle = DEFAULT_LAYOUT,
    caption_style: CaptionStyle = KARAOKE_POP,
    title_style: TitleStyle = DEFAULT_TITLE_STYLE,
    sfx_config: SfxConfig = DEFAULT_SFX_CONFIG,
    ffmpeg_bin: str = "ffmpeg",
    seek_source: bool = True,
    use_llm: bool = True,
    use_disk_cache: bool = True,
    detect_scenes: bool = True,
    force_x264: bool = False,
    x264_threads: int = 0,
    return_meta: bool = False,
) -> Union[Path, Tuple[Path, Dict[str, Any]]]:
    """
    High-level single-clip API combining M1+M2+M3+M4+M5 in one FFmpeg invocation.
    """
    with tempfile.TemporaryDirectory(prefix="oc_render_") as td:
        assets = prepare_clip_assets(
            video_in=video_in,
            words=words,
            out_path=out_path,
            work_dir=Path(td),
            clip_start=clip_start,
            clip_end=clip_end,
            title=title,
            keyword=keyword,
            layout=layout,
            caption_style=caption_style,
            title_style=title_style,
            sfx_config=sfx_config,
            ffmpeg_bin=ffmpeg_bin,
            seek_source=seek_source,
            use_llm=use_llm,
            use_disk_cache=use_disk_cache,
            detect_scenes=detect_scenes,
        )
        out_p, meta = execute_ffmpeg_render(
            assets,
            layout=layout,
            sfx_config=sfx_config,
            ffmpeg_bin=ffmpeg_bin,
            x264_threads=x264_threads,
            force_x264=force_x264,
            seek_source=seek_source,
        )
        return (out_p, meta) if return_meta else out_p


def resolve_auto_jobs(
    clip_count: int,
    layout: LayoutStyle = DEFAULT_LAYOUT,
    ffmpeg_bin: str = "ffmpeg",
) -> int:
    """
    M5 Rule 7: resolves optimal concurrency for `--jobs auto`, caching the result in
    ~/.cache/openclip/bench_jobs.json (or storage cache fallback).
    """
    from openclip_engine.core.config import CACHE_DIR

    cache_dir = resolve_writable_cache_dir(str(Path.home() / ".cache" / "openclip"), CACHE_DIR)
    vt = check_videotoolbox_available(ffmpeg_bin)
    cache_key = f"{'vt' if vt else 'x264'}_{os.cpu_count() or 4}"
    cache_file = cache_dir / "bench_jobs.json"

    try:
        if cache_file.exists():
            data = json.loads(cache_file.read_text(encoding="utf-8"))
            if isinstance(data, dict) and cache_key in data:
                return max(1, min(clip_count, int(data[cache_key])))
    except Exception:
        pass

    # Apple Silicon sweet spot: 3 concurrent sessions (or 2 on <=4 cores) saturates encoders without thrash
    cores = os.cpu_count() or 4
    best_jobs = 3 if cores >= 8 else (2 if cores >= 4 else 1)
    try:
        data = json.loads(cache_file.read_text(encoding="utf-8")) if cache_file.exists() else {}
        data[cache_key] = best_jobs
        cache_file.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception:
        pass
    return max(1, min(clip_count, best_jobs))


def render_clips_batch(
    specs: Sequence[Dict[str, Any]],
    layout: LayoutStyle = DEFAULT_LAYOUT,
    caption_style: CaptionStyle = KARAOKE_POP,
    title_style: TitleStyle = DEFAULT_TITLE_STYLE,
    sfx_config: SfxConfig = DEFAULT_SFX_CONFIG,
    jobs: Union[int, str] = "auto",
    ffmpeg_bin: str = "ffmpeg",
    use_llm: bool = True,
    use_disk_cache: bool = True,
    detect_scenes: bool = True,
    force_x264: bool = False,
) -> List[Dict[str, Any]]:
    """
    Pipelined parallel batch renderer (M5 Rules 4 & 7):
      - Pre-prepares sprites/assets concurrently while FFmpeg workers encode up to `n_jobs` clips.
      - Allocates `-threads = cores // n_jobs` for libx264 fallback.
    Each spec dict contains: {video_in, words, out_path, clip_start?, clip_end?, title?, keyword?, seek_source?}.
    """
    if not specs:
        return []
    n_jobs = resolve_auto_jobs(len(specs), layout, ffmpeg_bin) if str(jobs) == "auto" else max(1, int(jobs))
    n_jobs = min(len(specs), n_jobs)
    cores = max(1, os.cpu_count() or 4)
    x264_threads = max(2, cores // n_jobs)

    # Pipeline: prepare assets for clips in a background pool, immediately dispatch FFmpeg encodes
    def _run_one(idx: int, sp: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
        _, meta = render_polished_clip(
            video_in=sp["video_in"],
            words=sp.get("words") or [],
            out_path=sp["out_path"],
            clip_start=float(sp.get("clip_start", 0.0)),
            clip_end=sp.get("clip_end"),
            title=sp.get("title"),
            keyword=sp.get("keyword"),
            layout=layout,
            caption_style=caption_style,
            title_style=title_style,
            sfx_config=sfx_config,
            ffmpeg_bin=ffmpeg_bin,
            seek_source=bool(sp.get("seek_source", True)),
            use_llm=use_llm,
            use_disk_cache=use_disk_cache,
            detect_scenes=detect_scenes,
            force_x264=force_x264,
            x264_threads=x264_threads,
            return_meta=True,
        )
        return idx, meta

    results: List[Optional[Dict[str, Any]]] = [None] * len(specs)
    with ThreadPoolExecutor(max_workers=n_jobs) as pool:
        futs = [pool.submit(_run_one, i, sp) for i, sp in enumerate(specs)]
        for fut in as_completed(futs):
            idx, meta = fut.result()
            results[idx] = meta
    return [r for r in results if r is not None]

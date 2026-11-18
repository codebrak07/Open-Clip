"""
M6b Multi-Subject & Reference-Matched Framing Engine (`framing_engine.py`):
  - Detects subjects via Apple Vision (PyObjC VNDetectHumanRectanglesRequest +
    VNDetectFaceRectanglesRequest), fallback OpenCV YuNet, fallback center crop,
    or `--subjects-json` override for deterministic tests.
  - Samples at 4 fps on frames <= 640 px, runs simple IoU tracking, caches by
    (video hash, time range). Never runs inside the per-frame render loop.
  - Plans constant uniform-scale framing per shot (never stretches!):
      * 1 subject: cover crop with eyes at ~38% of window height (headroom rule)
      * 2+ subjects (`two_shot`): union box + 8% margin, uniform scale = win_w/span_w;
        wide sources render as a vertically centered strip with 24px top/bottom feathering
        over the blurred 9:16 background, preserving the gap between subjects!
      * Optional `multi_subject_layout="split"`: stacked panels per subject.
      * Reference-matched framing (`--framing-ref`): solves (cx, cy, uniform scale)
        minimizing center + size error against reference normalized boxes and logs residuals.
  - Emits `framing_report.json` + optional debug contact sheet with detected boxes drawn.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import subprocess
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple, cast

import numpy as np
from PIL import Image, ImageDraw

from openclip_engine.clipping.config_styles import DEFAULT_LAYOUT, REPO_ROOT, LayoutStyle
from openclip_engine.clipping.karaoke_pop import resolve_writable_cache_dir

Vision: Any = None
Quartz: Any = None
try:
    import Vision as _Vision  # type: ignore
    import Quartz as _Quartz  # type: ignore
    Vision = _Vision
    Quartz = _Quartz
    _HAS_VISION = True
except Exception:
    _HAS_VISION = False

cv2: Any = None
try:
    import cv2 as _cv2  # type: ignore
    cv2 = _cv2
    _HAS_CV2 = True
except Exception:
    _HAS_CV2 = False


@dataclass
class Box:
    """Normalized [0, 1] top-left box in image coordinates."""
    x: float
    y: float
    w: float
    h: float
    kind: str = "person"     # "person" | "face"
    score: float = 1.0
    track_id: int = 0

    @property
    def cx(self) -> float:
        return self.x + self.w * 0.5

    @property
    def cy(self) -> float:
        return self.y + self.h * 0.5

    @property
    def x2(self) -> float:
        return self.x + self.w

    @property
    def y2(self) -> float:
        return self.y + self.h


@dataclass
class ShotFramingPlan:
    shot_index: int
    start_s: float
    end_s: float
    mode: str                         # "center" | "single_subject" | "two_shot_cover" | "two_shot_strip" | "split" | "ref_matched"
    subject_count: int
    crop_x: int                       # pixels in source frame
    crop_y: int
    crop_w: int
    crop_h: int
    out_w: int                        # scaled strip/window width (always win_w)
    out_h: int                        # scaled strip/window height (<= win_h for wide strip, == win_h for cover)
    offset_y_in_window: int           # vertical placement inside window (0 for cover)
    feather_px: int = 0               # 24px top/bottom feather when out_h < win_h
    split_crops: List[Tuple[int, int, int, int]] = field(default_factory=list)
    residuals: Dict[str, Any] = field(default_factory=dict)
    subjects: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class ReferenceLayout:
    source: str
    subject_count: int
    boxes: List[Dict[str, float]]     # sorted left->right in window-normalized coords [0, 1]
    gap_ratio: float                  # normalized horizontal gap between outermost adjacent subjects
    vertical_center: float            # mean normalized y center


# ─────────────────────── Detection Backends (Vision -> YuNet -> Fallback) ───────────────────────
def _iou(a: Box, b: Box) -> float:
    ix0 = max(a.x, b.x)
    iy0 = max(a.y, b.y)
    ix1 = min(a.x2, b.x2)
    iy1 = min(a.y2, b.y2)
    inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
    if inter <= 0.0:
        return 0.0
    union = a.w * a.h + b.w * b.h - inter
    return inter / max(1e-9, union)


def _detect_boxes_vision_rgb(rgb: np.ndarray) -> Optional[List[Box]]:
    """Runs Apple Vision human + face rectangle detection on an RGB uint8 numpy image."""
    if not _HAS_VISION or Vision is None or Quartz is None:
        return None
    vision_mod: Any = cast(Any, Vision)
    quartz_mod: Any = cast(Any, Quartz)
    h, w, _ = rgb.shape
    try:
        rgba = np.empty((h, w, 4), dtype=np.uint8)
        rgba[:, :, :3] = rgb
        rgba[:, :, 3] = 255
        raw = rgba.tobytes()
        cs = quartz_mod.CGColorSpaceCreateDeviceRGB()
        prov = quartz_mod.CGDataProviderCreateWithData(None, raw, len(raw), None)
        cg = quartz_mod.CGImageCreate(
            w, h, 8, 32, w * 4, cs, quartz_mod.kCGImageAlphaNoneSkipLast,
            prov, None, False, quartz_mod.kCGRenderingIntentDefault,
        )
        req_h = vision_mod.VNDetectHumanRectanglesRequest.alloc().init()
        req_f = vision_mod.VNDetectFaceRectanglesRequest.alloc().init()
        handler = vision_mod.VNImageRequestHandler.alloc().initWithCGImage_options_(cg, None)
        ok, _ = handler.performRequests_error_([req_h, req_f], None)
        if not ok:
            return None

        humans: List[Box] = []
        for obs in (req_h.results() or []):
            bb = obs.boundingBox()
            # Vision origin is bottom-left -> convert to top-left normalized [0, 1]
            bx = float(bb.origin.x)
            bw = float(bb.size.width)
            bh = float(bb.size.height)
            by = max(0.0, 1.0 - float(bb.origin.y) - bh)
            if bw > 0.03 and bh > 0.06:
                humans.append(Box(x=bx, y=by, w=bw, h=bh, kind="person", score=float(obs.confidence())))

        faces: List[Box] = []
        for obs in (req_f.results() or []):
            bb = obs.boundingBox()
            bx = float(bb.origin.x)
            bw = float(bb.size.width)
            bh = float(bb.size.height)
            by = max(0.0, 1.0 - float(bb.origin.y) - bh)
            if bw > 0.02 and bh > 0.02:
                faces.append(Box(x=bx, y=by, w=bw, h=bh, kind="face", score=float(obs.confidence())))

        # Prefer human rectangles when present, falling back to face rectangles expanded to torso
        if humans:
            return sorted(humans, key=lambda b: b.cx)
        return sorted(faces, key=lambda b: b.cx)
    except Exception:
        return None


def _detect_boxes_yunet_rgb(rgb: np.ndarray) -> Optional[List[Box]]:
    """Fallback OpenCV YuNet face detector (if cv2 + assets/models/face_detection_yunet_2023mar.onnx exist)."""
    if not _HAS_CV2:
        return None
    model_path = REPO_ROOT / "assets" / "models" / "face_detection_yunet_2023mar.onnx"
    if not model_path.exists():
        return None
    try:
        h, w, _ = rgb.shape
        det = cv2.FaceDetectorYN.create(str(model_path), "", (w, h), 0.6, 0.3, 10)
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        _, faces = det.detect(bgr)
        if faces is None:
            return []
        out: List[Box] = []
        for row in faces:
            fx, fy, fw, fh, conf = float(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[14])
            out.append(Box(x=max(0.0, fx / w), y=max(0.0, fy / h), w=min(1.0, fw / w), h=min(1.0, fh / h), kind="face", score=conf))
        return sorted(out, key=lambda b: b.cx)
    except Exception:
        return None


def detect_boxes_in_image(rgb: np.ndarray) -> Tuple[List[Box], str]:
    """Detects subject boxes on a single RGB frame: Apple Vision -> OpenCV YuNet -> none."""
    res = _detect_boxes_vision_rgb(rgb)
    if res is not None:
        return res, "apple_vision"
    res = _detect_boxes_yunet_rgb(rgb)
    if res is not None:
        return res, "opencv_yunet"
    return [], "fallback_center"


def _file_quick_hash(path: Path) -> str:
    st = path.stat()
    h = hashlib.sha1(f"{path.name}:{st.st_size}:{int(st.st_mtime)}".encode("utf-8"))
    with path.open("rb") as f:
        h.update(f.read(65536))
    return h.hexdigest()[:16]


def _extract_sampled_frames_rgb(
    video_in: Path,
    clip_start: float,
    duration: float,
    sample_fps: float = 4.0,
    max_width: int = 640,
    ffmpeg_bin: str = "ffmpeg",
) -> Tuple[List[Tuple[float, np.ndarray]], int, int]:
    """Extracts RGB frames <= 640px at sample_fps via ONE fast FFmpeg rawvideo pipe."""
    ffprobe_bin = ffmpeg_bin.replace("ffmpeg", "ffprobe")
    pr = subprocess.run(
        [ffprobe_bin, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", str(video_in)],
        capture_output=True, text=True, timeout=10,
    )
    src_w, src_h = 1920, 1080
    if pr.returncode == 0:
        s = (json.loads(pr.stdout).get("streams") or [{}])[0]
        src_w = int(s.get("width") or 1920)
        src_h = int(s.get("height") or 1080)

    if src_w > max_width:
        sw = max_width
        sh = int(round(src_h * (max_width / float(src_w))))
    else:
        sw, sh = src_w, src_h
    sw += sw % 2
    sh += sh % 2

    cmd = [ffmpeg_bin, "-v", "error"]
    if clip_start > 0.001:
        cmd.extend(["-ss", f"{clip_start:.3f}"])
    cmd.extend([
        "-t", f"{duration:.3f}",
        "-i", str(video_in),
        "-an",
        "-vf", f"fps={sample_fps:.2f},scale={sw}:{sh}:flags=fast_bilinear",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
    ])
    res = subprocess.run(cmd, capture_output=True, timeout=20)
    if res.returncode != 0 or not res.stdout:
        return [], sw, sh

    frame_bytes = sw * sh * 3
    n_frames = len(res.stdout) // frame_bytes
    frames: List[Tuple[float, np.ndarray]] = []
    for i in range(n_frames):
        buf = res.stdout[i * frame_bytes : (i + 1) * frame_bytes]
        arr = np.frombuffer(buf, dtype=np.uint8).reshape((sh, sw, 3))
        frames.append((round(i / sample_fps, 4), arr))
    return frames, sw, sh


def _load_injected_subjects(subjects_json_path: Path, duration: float) -> List[Dict[str, Any]]:
    """
    Loads `--subjects-json` for deterministic tests. Supports:
      - List of boxes (applied across whole clip): [{"x":0.1,"y":0.2,"w":0.15,"h":0.5}, ...]
      - Dict with {"boxes": [...]} or {"frames": [{"t": 0.0, "boxes": [...]}, ...]}
    """
    raw = json.loads(subjects_json_path.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and isinstance(raw.get("frames"), list):
        return raw["frames"]
    boxes = raw.get("boxes") if isinstance(raw, dict) else raw
    if not isinstance(boxes, list):
        return []
    # Emit sampled timestamps every 0.25s
    n = max(2, int(math.ceil(duration * 4.0)))
    return [{"t": round(i * 0.25, 3), "boxes": boxes} for i in range(n)]


def detect_subjects(
    video_in: Path,
    clip_start: float,
    duration: float,
    sample_fps: float = 4.0,
    subjects_json_path: Optional[str] = None,
    ffmpeg_bin: str = "ffmpeg",
    use_cache: bool = True,
) -> Tuple[List[Dict[str, Any]], str, float]:
    """
    Returns (frame_tracks, backend_used, elapsed_s).
    Each entry in frame_tracks: {"t": float, "boxes": [{x,y,w,h,kind,score,track_id}, ...]}.
    Caches detections by (video hash, clip_start, duration).
    """
    t0 = time.perf_counter()
    if subjects_json_path and Path(subjects_json_path).exists():
        tracks = _load_injected_subjects(Path(subjects_json_path), duration)
        return tracks, "subjects_json", round(time.perf_counter() - t0, 4)

    from openclip_engine.core.config import CACHE_DIR
    cache_dir = resolve_writable_cache_dir(str(Path.home() / ".cache" / "openclip" / "framing"), CACHE_DIR / "framing")
    cache_key = hashlib.sha1(f"{_file_quick_hash(video_in)}|{clip_start:.2f}|{duration:.2f}|{sample_fps:.1f}".encode("utf-8")).hexdigest()
    cache_file = cache_dir / f"det_{cache_key}.json"

    if use_cache and cache_file.exists():
        try:
            cached = json.loads(cache_file.read_text(encoding="utf-8"))
            if isinstance(cached, dict) and isinstance(cached.get("frames"), list):
                return cached["frames"], f"{cached.get('backend', 'cache')}(cached)", round(time.perf_counter() - t0, 4)
        except Exception:
            pass

    sampled, _, _ = _extract_sampled_frames_rgb(video_in, clip_start, duration, sample_fps=sample_fps, ffmpeg_bin=ffmpeg_bin)
    tracks_out: List[Dict[str, Any]] = []
    backend = "fallback_center"
    prev_boxes: List[Box] = []
    next_tid = 1

    for t_s, rgb in sampled:
        boxes, be = detect_boxes_in_image(rgb)
        backend = be
        if be == "fallback_center":
            # No detector available -> bail early (0.05s) instead of looping empty frames
            tracks_out.append({"t": t_s, "boxes": []})
            break

        # Simple IoU tracker
        for b in boxes:
            best_tid = 0
            best_iou = 0.25
            for pb in prev_boxes:
                ov = _iou(b, pb)
                if ov > best_iou:
                    best_iou = ov
                    best_tid = pb.track_id
            if best_tid == 0:
                best_tid = next_tid
                next_tid += 1
            b.track_id = best_tid
        prev_boxes = boxes
        tracks_out.append({"t": t_s, "boxes": [asdict(b) for b in boxes]})

    if use_cache and backend != "fallback_center":
        try:
            cache_file.write_text(json.dumps({"backend": backend, "frames": tracks_out}), encoding="utf-8")
        except Exception:
            pass

    return tracks_out, backend, round(time.perf_counter() - t0, 4)


# ─────────────────────── Reference Layout Analysis ───────────────────────
def analyze_framing_reference(
    ref_path: Path,
    ref_boxes_override: Optional[Sequence[Dict[str, Any]]] = None,
    ffmpeg_bin: str = "ffmpeg",
) -> Optional[ReferenceLayout]:
    """
    Analyzes a reference image or short video and returns its window-normalized layout:
    subject count N, sorted boxes [{x,y,w,h}], gap_ratio, vertical_center.
    """
    boxes: List[Box] = []
    if ref_boxes_override:
        for b in ref_boxes_override:
            boxes.append(Box(x=float(b["x"]), y=float(b["y"]), w=float(b["w"]), h=float(b["h"])))
    elif ref_path.exists():
        if ref_path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
            rgb = np.array(Image.open(ref_path).convert("RGB"), dtype=np.uint8)
            boxes, _ = detect_boxes_in_image(rgb)
        else:
            frames, _, _ = _extract_sampled_frames_rgb(ref_path, 0.0, 2.0, sample_fps=2.0, ffmpeg_bin=ffmpeg_bin)
            for _, rgb in frames:
                det, _ = detect_boxes_in_image(rgb)
                if det:
                    boxes = det
                    break
    else:
        return None

    if not boxes:
        return None

    boxes = sorted(boxes, key=lambda b: b.cx)
    gap_ratio = 0.0
    if len(boxes) >= 2:
        gap_ratio = max(0.0, boxes[-1].x - boxes[0].x2)
    v_center = sum(b.cy for b in boxes) / len(boxes)
    return ReferenceLayout(
        source=str(ref_path),
        subject_count=len(boxes),
        boxes=[{"x": round(b.x, 4), "y": round(b.y, 4), "w": round(b.w, 4), "h": round(b.h, 4)} for b in boxes],
        gap_ratio=round(gap_ratio, 4),
        vertical_center=round(v_center, 4),
    )


def find_default_framing_ref() -> Optional[Path]:
    ref_dir = REPO_ROOT / "reference"
    if not ref_dir.exists():
        return None
    for p in sorted(ref_dir.glob("framing_ref.*")):
        if p.is_file():
            return p
    return None


# ─────────────────────── Per-Shot Framing Solver ───────────────────────
def _aggregate_shot_subjects(
    tracks: Sequence[Dict[str, Any]],
    t0: float,
    t1: float,
    ema_alpha: float = 0.15,
) -> List[Box]:
    """Aggregates EMA-smoothed subject boxes within shot [t0, t1], grouped left-to-right."""
    shot_frames = [fr for fr in tracks if t0 - 0.05 <= float(fr["t"]) <= t1 + 0.05 and fr.get("boxes")]
    if not shot_frames:
        return []

    # Determine dominant subject count in this shot (median count)
    counts = sorted(len(fr["boxes"]) for fr in shot_frames)
    dom_n = counts[len(counts) // 2]
    if dom_n <= 0:
        return []

    matching = [fr["boxes"] for fr in shot_frames if len(fr["boxes"]) == dom_n] or [fr["boxes"] for fr in shot_frames]
    # Sort each frame's boxes left-to-right and EMA-smooth across the shot
    ema_boxes: Optional[List[List[float]]] = None
    for b_list in matching:
        ordered = sorted(b_list, key=lambda b: float(b["x"]) + float(b["w"]) * 0.5)[:dom_n]
        if len(ordered) < dom_n:
            continue
        cur = [[float(b["x"]), float(b["y"]), float(b["w"]), float(b["h"])] for b in ordered]
        if ema_boxes is None:
            ema_boxes = cur
        else:
            for j in range(dom_n):
                for k in range(4):
                    ema_boxes[j][k] = ema_alpha * cur[j][k] + (1.0 - ema_alpha) * ema_boxes[j][k]

    if not ema_boxes:
        return []
    return [Box(x=v[0], y=v[1], w=v[2], h=v[3]) for v in ema_boxes]


def _make_even(v: int, lo: int = 2, hi: int = 10000) -> int:
    v = max(lo, min(hi, int(round(v))))
    if v % 2 != 0:
        v = v - 1 if v > lo else v + 1
    return max(lo, min(hi, v))


def _solve_reference_crop(
    subjects: Sequence[Box],
    ref: ReferenceLayout,
    src_w: int,
    src_h: int,
    win_w: int,
    win_h: int,
    feather_px: int,
) -> Optional[ShotFramingPlan]:
    """
    Solves for uniform scale + (cx, cy) minimizing squared center + size error against reference
    boxes in window-normalized coords. Clamps to source and uses wide-strip fit when needed.
    Accepts when mean center error <= 5% of window width and size error <= 15%.
    """
    if len(subjects) != ref.subject_count or not subjects:
        return None

    subs = sorted(subjects, key=lambda b: b.cx)
    ref_bs = [Box(x=b["x"], y=b["y"], w=b["w"], h=b["h"]) for b in ref.boxes]

    # Solve uniform scale `s` (window px per source px) from width & center spacing
    scale_ests: List[float] = []
    for sb, rb in zip(subs, ref_bs):
        if sb.w * src_w > 1.0 and rb.w > 0.01:
            scale_ests.append((rb.w * win_w) / (sb.w * src_w))
    if len(subs) >= 2:
        src_span = (subs[-1].cx - subs[0].cx) * src_w
        ref_span = (ref_bs[-1].cx - ref_bs[0].cx) * win_w
        if src_span > 5.0 and ref_span > 5.0:
            # Weight inter-subject spacing strongly so gap matches reference!
            scale_ests.extend([ref_span / src_span] * 3)

    if not scale_ests:
        return None
    s = sum(scale_ests) / len(scale_ests)
    # Clamp scale so crop_w <= src_w
    s = max(win_w / float(src_w), min(s, 4.0))

    crop_w = min(src_w, _make_even(int(round(win_w / s)), lo=64, hi=src_w))
    eff_s = win_w / float(crop_w)

    # Optimal crop_x minimizing center X error
    ideal_xs = [sb.cx * src_w - rb.cx * crop_w for sb, rb in zip(subs, ref_bs)]
    crop_x = int(round(max(0.0, min(src_w - crop_w, sum(ideal_xs) / len(ideal_xs)))))

    # Vertical fit: cover if eff_s * src_h >= win_h, else wide-strip placed inside window
    scaled_full_h = int(round(src_h * eff_s))
    scaled_full_h = _make_even(scaled_full_h, lo=64, hi=win_h * 4)

    if scaled_full_h >= win_h:
        crop_h = min(src_h, _make_even(int(round(win_h / eff_s)), lo=64, hi=src_h))
        ideal_ys = [sb.cy * src_h - rb.cy * crop_h for sb, rb in zip(subs, ref_bs)]
        crop_y = int(round(max(0.0, min(src_h - crop_h, sum(ideal_ys) / len(ideal_ys)))))
        out_h = win_h
        offset_y = 0
        fpx = 0
    else:
        crop_h = src_h
        crop_y = 0
        out_h = min(win_h, scaled_full_h)
        # Position strip vertically so subjects' center matches reference vertical center!
        ideal_offs = [rb.cy * win_h - (sb.cy * src_h) * eff_s for sb, rb in zip(subs, ref_bs)]
        offset_y = int(round(max(0.0, min(win_h - out_h, sum(ideal_offs) / len(ideal_offs)))))
        fpx = feather_px

    # Compute exact residuals in window-normalized coords
    center_errs: List[float] = []
    size_errs: List[float] = []
    for sb, rb in zip(subs, ref_bs):
        mapped_cx = ((sb.cx * src_w - crop_x) * eff_s) / float(win_w)
        mapped_cy = (offset_y + (sb.cy * src_h - crop_y) * eff_s) / float(win_h)
        mapped_w = (sb.w * src_w * eff_s) / float(win_w)
        center_errs.append(math.hypot(mapped_cx - rb.cx, (mapped_cy - rb.cy) * (win_h / float(win_w))))
        size_errs.append(abs(mapped_w - rb.w) / max(0.01, rb.w))

    mean_center_err = sum(center_errs) / len(center_errs)
    mean_size_err = sum(size_errs) / len(size_errs)
    accepted = (mean_center_err <= 0.05) and (mean_size_err <= 0.15)
    residuals = {
        "mean_center_err_pct": round(mean_center_err * 100.0, 2),
        "mean_size_err_pct": round(mean_size_err * 100.0, 2),
        "accepted": accepted,
        "ref_source": ref.source,
    }
    if not accepted:
        return None

    return ShotFramingPlan(
        shot_index=0,
        start_s=0.0,
        end_s=0.0,
        mode="ref_matched",
        subject_count=len(subs),
        crop_x=crop_x,
        crop_y=crop_y,
        crop_w=crop_w,
        crop_h=crop_h,
        out_w=win_w,
        out_h=out_h,
        offset_y_in_window=offset_y,
        feather_px=fpx,
        residuals=residuals,
        subjects=[asdict(b) for b in subs],
    )


def _solve_shot_auto(
    subjects: Sequence[Box],
    src_w: int,
    src_h: int,
    win_w: int,
    win_h: int,
    layout: LayoutStyle,
) -> ShotFramingPlan:
    """Automatic per-shot uniform-scale framing solver (0, 1, or 2+ subjects)."""
    win_aspect = win_w / float(win_h)

    # Default center cover crop
    def _center_cover() -> ShotFramingPlan:
        if (src_w / float(src_h)) >= win_aspect:
            ch = src_h
            cw = _make_even(int(round(src_h * win_aspect)), lo=64, hi=src_w)
        else:
            cw = src_w
            ch = _make_even(int(round(src_w / win_aspect)), lo=64, hi=src_h)
        cx = (src_w - cw) // 2
        cy = (src_h - ch) // 2
        return ShotFramingPlan(
            shot_index=0, start_s=0.0, end_s=0.0, mode="center", subject_count=0,
            crop_x=cx, crop_y=cy, crop_w=cw, crop_h=ch, out_w=win_w, out_h=win_h, offset_y_in_window=0,
        )

    if not subjects:
        return _center_cover()

    subs = sorted(subjects, key=lambda b: b.cx)

    # 1 subject: cover crop centered on subject, eyes at ~38% of window height (headroom rule)
    if len(subs) == 1:
        sb = subs[0]
        if (src_w / float(src_h)) >= win_aspect:
            ch = src_h
            cw = _make_even(int(round(src_h * win_aspect)), lo=64, hi=src_w)
        else:
            cw = src_w
            ch = _make_even(int(round(src_w / win_aspect)), lo=64, hi=src_h)
        cx = int(round(max(0.0, min(src_w - cw, sb.cx * src_w - cw * 0.5))))
        eye_y = (sb.y + (0.45 if sb.kind == "face" else 0.22) * sb.h) * src_h
        cy = int(round(max(0.0, min(src_h - ch, eye_y - 0.38 * ch))))
        return ShotFramingPlan(
            shot_index=0, start_s=0.0, end_s=0.0, mode="single_subject", subject_count=1,
            crop_x=cx, crop_y=cy, crop_w=cw, crop_h=ch, out_w=win_w, out_h=win_h, offset_y_in_window=0,
            subjects=[asdict(sb)],
        )

    # Optional split layout: stacked panels (one per subject, removing the gap)
    if layout.multi_subject_layout == "split":
        n_panels = min(len(subs), 3)
        panel_h = _make_even(win_h // n_panels, lo=128, hi=win_h)
        panel_aspect = win_w / float(panel_h)
        split_crops: List[Tuple[int, int, int, int]] = []
        for sb in subs[:n_panels]:
            if (src_w / float(src_h)) >= panel_aspect:
                ch = src_h
                cw = _make_even(int(round(src_h * panel_aspect)), lo=64, hi=src_w)
            else:
                cw = src_w
                ch = _make_even(int(round(src_w / panel_aspect)), lo=64, hi=src_h)
            px = int(round(max(0.0, min(src_w - cw, sb.cx * src_w - cw * 0.5))))
            py = int(round(max(0.0, min(src_h - ch, sb.cy * src_h - ch * 0.42))))
            split_crops.append((px, py, cw, ch))
        return ShotFramingPlan(
            shot_index=0, start_s=0.0, end_s=0.0, mode="split", subject_count=n_panels,
            crop_x=0, crop_y=0, crop_w=src_w, crop_h=src_h, out_w=win_w, out_h=panel_h * n_panels,
            offset_y_in_window=(win_h - panel_h * n_panels) // 2,
            split_crops=split_crops,
            subjects=[asdict(b) for b in subs[:n_panels]],
        )

    # 2+ subjects (`two_shot`, gap-preserving!): union box + margin on each side
    margin = 0.06 if layout.framing_preset == "two_shot_gap" else layout.framing_two_shot_margin
    ux0 = min(b.x for b in subs)
    ux1 = max(b.x2 for b in subs)
    uy0 = min(b.y for b in subs)
    uy1 = max(b.y2 for b in subs)

    # Apply margin relative to union span (or frame width) so both subjects have >= 6-8% edge breathing room
    span_norm = max(0.20, ux1 - ux0)
    pad_norm = max(margin, span_norm * margin)
    cx0_norm = max(0.0, ux0 - pad_norm)
    cx1_norm = min(1.0, ux1 + pad_norm)

    crop_x = int(round(cx0_norm * src_w))
    crop_w = _make_even(int(round((cx1_norm - cx0_norm) * src_w)), lo=64, hi=src_w)
    crop_x = max(0, min(src_w - crop_w, crop_x))

    # Uniform scale s = win_w / crop_w (NEVER stretch!)
    s = win_w / float(crop_w)
    scaled_full_h = _make_even(int(round(src_h * s)), lo=64, hi=win_h * 4)

    if scaled_full_h >= win_h:
        # Normal cover crop vertically around subjects
        crop_h = _make_even(int(round(win_h / s)), lo=64, hi=src_h)
        subj_cy_px = ((uy0 + uy1) * 0.5) * src_h
        target_v_frac = 0.45 if layout.framing_preset == "two_shot_gap" else 0.50
        crop_y = int(round(max(0.0, min(src_h - crop_h, subj_cy_px - target_v_frac * crop_h))))
        return ShotFramingPlan(
            shot_index=0, start_s=0.0, end_s=0.0, mode="two_shot_cover", subject_count=len(subs),
            crop_x=crop_x, crop_y=crop_y, crop_w=crop_w, crop_h=crop_h,
            out_w=win_w, out_h=win_h, offset_y_in_window=0, feather_px=0,
            subjects=[asdict(b) for b in subs],
        )

    # Wide source -> uniform-scaled horizontal strip vertically centered in window with 24px feather!
    out_h = min(win_h, scaled_full_h)
    target_cy_frac = 0.45 if layout.framing_preset == "two_shot_gap" else 0.50
    subj_cy_in_strip = ((uy0 + uy1) * 0.5) * out_h
    offset_y = int(round(max(0.0, min(win_h - out_h, target_cy_frac * win_h - subj_cy_in_strip))))
    return ShotFramingPlan(
        shot_index=0, start_s=0.0, end_s=0.0, mode="two_shot_strip", subject_count=len(subs),
        crop_x=crop_x, crop_y=0, crop_w=crop_w, crop_h=src_h,
        out_w=win_w, out_h=out_h, offset_y_in_window=offset_y,
        feather_px=layout.framing_feather_px,
        subjects=[asdict(b) for b in subs],
    )


def plan_framing_for_clip(
    video_in: Path,
    clip_start: float,
    duration: float,
    src_w: int,
    src_h: int,
    scene_cuts: Sequence[float] = (),
    layout: LayoutStyle = DEFAULT_LAYOUT,
    ffmpeg_bin: str = "ffmpeg",
    ref_boxes_override: Optional[Sequence[Dict[str, Any]]] = None,
) -> Tuple[List[ShotFramingPlan], Dict[str, Any]]:
    """
    Builds a per-shot framing plan for the clip.
    Returns (shot_plans, framing_report_dict).
    """
    win_w, win_h, _ = layout.resolved_window_dims()
    mode = (layout.framing_mode or "auto").strip().lower()
    if mode == "off":
        plan = _solve_shot_auto([], src_w, src_h, win_w, win_h, layout)
        plan.start_s = 0.0
        plan.end_s = round(duration, 4)
        return [plan], {"framing_mode": "off", "detector": "disabled", "detect_s": 0.0, "shots": [asdict(plan)]}

    tracks, backend, detect_s = detect_subjects(
        video_in,
        clip_start=clip_start,
        duration=duration,
        sample_fps=layout.smart_crop_fps,
        subjects_json_path=layout.subjects_json_path,
        ffmpeg_bin=ffmpeg_bin,
    )

    # Reference layout (when --framing ref or --framing-ref or default reference/framing_ref.* exists)
    ref_layout: Optional[ReferenceLayout] = None
    ref_p = Path(layout.framing_ref_path) if layout.framing_ref_path else find_default_framing_ref()
    if ref_boxes_override is not None or (ref_p is not None and ref_p.exists()):
        ref_layout = analyze_framing_reference(
            ref_p or Path("reference/framing_ref.png"),
            ref_boxes_override=ref_boxes_override,
            ffmpeg_bin=ffmpeg_bin,
        )

    # Build shots from scene cuts, enforcing min shot length 0.8 s
    boundaries = [0.0]
    for ct in sorted(scene_cuts):
        if ct - boundaries[-1] >= layout.framing_min_shot_s and (duration - ct) >= layout.framing_min_shot_s:
            boundaries.append(round(float(ct), 4))
    boundaries.append(round(duration, 4))

    plans: List[ShotFramingPlan] = []
    for idx in range(len(boundaries) - 1):
        s0, s1 = boundaries[idx], boundaries[idx + 1]
        subs = _aggregate_shot_subjects(tracks, s0, s1, ema_alpha=layout.framing_ema_alpha)

        shot_plan: Optional[ShotFramingPlan] = None
        if ref_layout is not None and subs:
            shot_plan = _solve_reference_crop(subs, ref_layout, src_w, src_h, win_w, win_h, layout.framing_feather_px)
        if shot_plan is None:
            shot_plan = _solve_shot_auto(subs, src_w, src_h, win_w, win_h, layout)

        shot_plan.shot_index = idx
        shot_plan.start_s = s0
        shot_plan.end_s = s1
        plans.append(shot_plan)

    report = {
        "framing_mode": mode,
        "preset": layout.framing_preset,
        "multi_subject_layout": layout.multi_subject_layout,
        "detector": backend,
        "detect_s": detect_s,
        "source_dims": [src_w, src_h],
        "window_dims": [win_w, win_h],
        "reference": asdict(ref_layout) if ref_layout else None,
        "shots": [asdict(p) for p in plans],
    }
    return plans, report


# ─────────────────────── FFmpeg Filtergraph Builder (Zero Per-Frame Python) ───────────────────────
def _ensure_feather_mask_png(width: int, height: int, feather_px: int, work_dir: Path) -> Path:
    """Generates a tiny static grayscale PNG alpha ramp (24px top/bottom feather) for fast alphamerge."""
    p = work_dir / f"feather_{width}x{height}_f{feather_px}.png"
    if not p.exists():
        m = np.full((height, width), 255, dtype=np.uint8)
        fpx = max(1, min(feather_px, height // 4))
        ramp = np.linspace(0, 255, fpx, endpoint=False, dtype=np.float32).round().astype(np.uint8)
        m[:fpx, :] = ramp[:, None]
        m[height - fpx :, :] = ramp[::-1, None]
        Image.fromarray(m, mode="L").save(p, compress_level=1)
    return p


def build_framing_filter_graph(
    plans: Sequence[ShotFramingPlan],
    win_w: int,
    win_h: int,
    win_top: int,
    grade_expr: str,
    bg_label: Optional[str],
    work_dir: Path,
    next_input_idx: int,
    fg_in_label: str = "[fg_in]",
    out_label: str = "[v_stage0]",
) -> Tuple[List[str], List[str], int]:
    """
    Translates per-shot framing plans into pure FFmpeg filtergraph stages (zero per-frame Python!):
      - Single shot cover -> direct crop + scale + grade + overlay on bg (maximum M5 speed!)
      - Wide strip (`two_shot_strip` / ref strip) -> crop + uniform scale + grade + fast static
        `alphamerge` 24px top/bottom feather overlaid at `y = win_top + offset_y_in_window` onto blurred bg!
      - Multi-shot -> trim + crop + scale per shot + concat + grade!
      - Split layout -> split into N subject panels + vstack!
    Returns (extra_input_args, filter_parts, updated_next_input_idx).
    """
    extra_inputs: List[str] = []
    parts: List[str] = []
    inp_cursor = next_input_idx

    def _add_feather_input(w: int, h: int, fpx: int) -> str:
        nonlocal inp_cursor
        mp = _ensure_feather_mask_png(w, h, fpx, work_dir)
        extra_inputs.extend(["-loop", "1", "-i", str(mp)])
        idx = inp_cursor
        inp_cursor += 1
        lbl = f"[fmask_{idx}]"
        parts.append(f"[{idx}:v]format=gray{lbl}")
        return lbl

    def _single_shot_chain(p: ShotFramingPlan, inp: str, out_lbl: str) -> None:
        base_lbl = out_lbl.strip("[]")
        if p.mode == "split" and p.split_crops:
            n = len(p.split_crops)
            panel_h = p.out_h // n
            split_lbls = [f"[{base_lbl}_sp{i}]" for i in range(n)]
            parts.append(f"{inp}split={n}" + "".join(split_lbls))
            panel_lbls = []
            for i, (px, py, cw, ch) in enumerate(p.split_crops):
                pl = f"[{base_lbl}_p{i}]"
                parts.append(f"{split_lbls[i]}crop={cw}:{ch}:{px}:{py},scale={win_w}:{panel_h},setsar=1{pl}")
                panel_lbls.append(pl)
            parts.append("".join(panel_lbls) + f"vstack=inputs={n}{grade_expr}{out_lbl}")
            return

        if p.out_h < win_h and p.feather_px > 0 and bg_label is not None:
            raw_lbl = f"[{base_lbl}_raw]"
            parts.append(f"{inp}crop={p.crop_w}:{p.crop_h}:{p.crop_x}:{p.crop_y},scale={p.out_w}:{p.out_h},setsar=1{grade_expr},format=yuva420p{raw_lbl}")
            mask_lbl = _add_feather_input(p.out_w, p.out_h, p.feather_px)
            parts.append(f"{raw_lbl}{mask_lbl}alphamerge{out_lbl}")
        else:
            parts.append(f"{inp}crop={p.crop_w}:{p.crop_h}:{p.crop_x}:{p.crop_y},scale={p.out_w}:{p.out_h},setsar=1{grade_expr}{out_lbl}")

    same_plan = len(plans) == 1 or all(
        (p.mode, p.crop_x, p.crop_y, p.crop_w, p.crop_h, p.out_h, p.offset_y_in_window)
        == (plans[0].mode, plans[0].crop_x, plans[0].crop_y, plans[0].crop_w, plans[0].crop_h, plans[0].out_h, plans[0].offset_y_in_window)
        for p in plans
    )

    if same_plan:
        p0 = plans[0]
        if bg_label is not None:
            _single_shot_chain(p0, fg_in_label, "[fg_framed]")
            oy = win_top + p0.offset_y_in_window
            parts.append(f"{bg_label}[fg_framed]overlay=0:{oy}:shortest=1{out_label}")
        else:
            if p0.out_h < win_h:
                _single_shot_chain(p0, fg_in_label, "[fg_framed]")
                parts.append(f"[fg_framed]pad={win_w}:{win_h}:0:{p0.offset_y_in_window}:black{out_label}")
            else:
                _single_shot_chain(p0, fg_in_label, out_label)
        return extra_inputs, parts, inp_cursor

    n_shots = len(plans)
    in_lbls = [f"[sh_in_{i}]" for i in range(n_shots)]
    parts.append(f"{fg_in_label}split={n_shots}" + "".join(in_lbls))
    seg_lbls: List[str] = []
    for i, p in enumerate(plans):
        trimmed = f"[sh_tr_{i}]"
        framed = f"[sh_fr_{i}]"
        parts.append(f"{in_lbls[i]}trim=start={p.start_s:.4f}:end={p.end_s:.4f},setpts=PTS-STARTPTS{trimmed}")
        if p.out_h < win_h:
            raw_lbl = f"[sh_raw_{i}]"
            feath_lbl = f"[sh_fe_{i}]"
            parts.append(f"{trimmed}crop={p.crop_w}:{p.crop_h}:{p.crop_x}:{p.crop_y},scale={p.out_w}:{p.out_h},setsar=1{grade_expr},format=yuva420p{raw_lbl}")
            mask_lbl = _add_feather_input(p.out_w, p.out_h, max(1, p.feather_px))
            parts.append(f"{raw_lbl}{mask_lbl}alphamerge{feath_lbl}")
            parts.append(f"{feath_lbl}pad={win_w}:{win_h}:0:{p.offset_y_in_window}:color=black@0{framed}")
        else:
            parts.append(
                f"{trimmed}crop={p.crop_w}:{p.crop_h}:{p.crop_x}:{p.crop_y},scale={win_w}:{win_h},setsar=1{grade_expr},format=yuva420p{framed}"
            )
        seg_lbls.append(framed)

    parts.append("".join(seg_lbls) + f"concat=n={n_shots}:v=1:a=0[fg_framed]")
    if bg_label is not None:
        parts.append(f"{bg_label}[fg_framed]overlay=0:{win_top}:shortest=1{out_label}")
    else:
        parts.append(f"[fg_framed]format=yuv420p{out_label}")
    return extra_inputs, parts, inp_cursor


def write_framing_debug_sheet(
    video_in: Path,
    plans: Sequence[ShotFramingPlan],
    out_png: Path,
    clip_start: float = 0.0,
    ffmpeg_bin: str = "ffmpeg",
) -> Optional[Path]:
    """Saves a debug contact sheet showing sampled shot frames with detected subject boxes & crop overlay."""
    if not plans:
        return None
    tiles: List[Image.Image] = []
    tw, th = 480, 270
    for p in plans[:6]:
        mid_t = clip_start + 0.5 * (p.start_s + p.end_s)
        tmp_p = out_png.with_suffix(f".tmp_{p.shot_index}.png")
        try:
            subprocess.run(
                [ffmpeg_bin, "-y", "-v", "error", "-ss", f"{mid_t:.3f}", "-i", str(video_in), "-frames:v", "1", str(tmp_p)],
                check=True, timeout=15,
            )
            im = Image.open(tmp_p).convert("RGB")
            sw, sh = im.size
            draw = ImageDraw.Draw(im)
            # Draw crop box in cyan
            draw.rectangle((p.crop_x, p.crop_y, p.crop_x + p.crop_w, p.crop_y + p.crop_h), outline=(46, 230, 240), width=6)
            # Draw detected subject boxes in yellow
            for sb in p.subjects:
                x0, y0 = int(sb["x"] * sw), int(sb["y"] * sh)
                x1, y1 = int((sb["x"] + sb["w"]) * sw), int((sb["y"] + sb["h"]) * sh)
                draw.rectangle((x0, y0, x1, y1), outline=(245, 240, 0), width=6)
            im = im.resize((tw, th), Image.Resampling.BILINEAR)
            d2 = ImageDraw.Draw(im)
            d2.rectangle((0, 0, tw, 24), fill=(0, 0, 0))
            d2.text((6, 5), f"shot {p.shot_index} [{p.start_s:.1f}-{p.end_s:.1f}s] {p.mode} n={p.subject_count}", fill=(255, 255, 255))
            tiles.append(im)
        except Exception:
            continue
        finally:
            tmp_p.unlink(missing_ok=True)

    if not tiles:
        return None
    cols = min(3, len(tiles))
    rows = math.ceil(len(tiles) / cols)
    sheet = Image.new("RGB", (cols * tw, rows * th), (18, 18, 22))
    for i, tile in enumerate(tiles):
        r, c = divmod(i, cols)
        sheet.paste(tile, (c * tw, r * th))
    out_png.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_png)
    return out_png

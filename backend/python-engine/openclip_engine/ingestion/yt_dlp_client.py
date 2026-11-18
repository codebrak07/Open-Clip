import json
import subprocess
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from openclip_engine.core.config import UPLOADS_DIR, OUTPUTS_DIR, FFMPEG_PATH
from openclip_engine.ingestion.url_validator import URLValidator
from openclip_engine.clipping.caption_burner import (
    fetch_youtube_captions,
    slice_and_chunk_cues,
    write_vtt,
    build_reframe_and_caption_clip,
)


class YtDlpClient:
    @staticmethod
    def _select_best_streams(info: Dict[str, Any], max_height: int = 720) -> Tuple[Optional[str], Optional[str], bool]:
        """
        Selects direct HTTPS H.264 video + M4A audio stream URLs (or progressive MP4).
        Returns (video_url, audio_url, is_progressive).
        """
        formats = info.get("formats", []) or []

        # 1. Prefer direct HTTPS H.264 (avc1) video <= max_height for universal browser compatibility
        h264_vids = [
            f for f in formats
            if f.get("url")
            and f.get("protocol") in ("https", "http")
            and (f.get("vcodec") or "").startswith("avc1")
            and 0 < (f.get("height") or 0) <= max_height
        ]
        # Fallback to any HTTPS MP4 video <= max_height
        if not h264_vids:
            h264_vids = [
                f for f in formats
                if f.get("url")
                and f.get("protocol") in ("https", "http")
                and f.get("ext") == "mp4"
                and f.get("vcodec") not in (None, "none")
                and 0 < (f.get("height") or 0) <= max_height
            ]

        # Check for progressive MP4 (has both audio & video)
        prog_mp4 = [
            f for f in h264_vids
            if f.get("acodec") not in (None, "none")
        ]
        if prog_mp4:
            best_prog = sorted(prog_mp4, key=lambda x: x.get("height") or 0, reverse=True)[0]
            return best_prog["url"], None, True

        # Separate DASH video + audio
        vid_url = None
        if h264_vids:
            best_vid = sorted(h264_vids, key=lambda x: (x.get("height") or 0, x.get("tbr") or 0), reverse=True)[0]
            vid_url = best_vid["url"]
        else:
            # Last resort: any video with URL
            any_vids = [
                f for f in formats
                if f.get("url") and f.get("vcodec") not in (None, "none") and (f.get("height") or 0) > 0
            ]
            if any_vids:
                best_vid = sorted(any_vids, key=lambda x: x.get("height") or 0, reverse=True)[0]
                vid_url = best_vid["url"]

        # Select best M4A/AAC original-language HTTPS audio
        auds = [
            f for f in formats
            if f.get("url")
            and f.get("protocol") in ("https", "http")
            and f.get("acodec") not in (None, "none")
            and f.get("vcodec") in (None, "none")
        ]
        aud_url = None
        if auds:
            def audio_rank(a: Dict[str, Any]) -> Tuple[int, int, int, float]:
                note = (a.get("format_note") or "").lower()
                is_m4a = 1 if a.get("ext") == "m4a" else 0
                is_orig = 1 if ("original" in note or "default" in note) else 0
                is_en = 1 if (a.get("language") or "").lower().startswith("en") else 0
                abr = float(a.get("abr") or a.get("tbr") or 0)
                return (is_orig, is_m4a, is_en, abr)

            best_aud = sorted(auds, key=audio_rank, reverse=True)[0]
            aud_url = best_aud["url"]

        return vid_url, aud_url, False

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
                    return {
                        "title": data.get("title", f"YouTube Video ({video_id})"),
                        "uploader": data.get("uploader") or data.get("channel") or "YouTube Creator",
                        "duration": int(data.get("duration") or 0),
                        "width": data.get("width", 1280),
                        "height": data.get("height", 720),
                        "fps": data.get("fps", 30),
                        "thumbnail": thumbnail,
                        "description": (data.get("description") or "")[:500],
                        "view_count": data.get("view_count", 0),
                        "video_id": video_id,
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
    ) -> Dict[str, Any]:
        """
        Extracts real 1080p Full HD H.264/AAC MP4 viral clip segments directly from YouTube CDN in parallel,
        fetches real timed captions from YouTube, smart-reframes to target aspect ratio (e.g. 1080x1920 9:16),
        and burns crisp Hormozi / Minimalist / Banner captions directly into each MP4.
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

        # Pull crisp 1080p Full HD source stream + original audio
        vid_url, aud_url, is_progressive = YtDlpClient._select_best_streams(info, max_height=max_height)
        if not vid_url:
            raise RuntimeError("No playable MP4 video stream found for this YouTube URL")

        # Fetch real timed speech captions from YouTube once (~0.2s)
        all_cues = fetch_youtube_captions(info)

        total_duration = int(info.get("duration") or 180)
        clip_count = max(1, min(20, int(clip_count)))

        metadata = {
            "title": info.get("title", f"YouTube Video ({video_id})"),
            "uploader": info.get("uploader") or info.get("channel") or "YouTube Creator",
            "duration": total_duration,
            "width": info.get("width", 1920),
            "height": info.get("height", 1080),
            "fps": info.get("fps", 30),
            "thumbnail": info.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            "view_count": info.get("view_count", 0),
            "video_id": video_id,
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
            selected_hooks, hook_report_meta = select_hook_clips(
                words=all_words,
                clip_count=clip_count,
                min_dur=15.0,
                max_dur=45.0,
                hook_mode=hook_mode,
                hook_hint=hook_hint,
                report_dir=OUTPUTS_DIR / f"{job_id}_analysis",
                video_label=str(metadata.get("title") or f"YouTube Video ({video_id})"),
                use_llm=True,
                ffmpeg_bin=ffmpeg_bin,
            )
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

        if not clip_specs:
            # Fallback when video has no captions at all
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

            try:
                # 1. Fast stream-copy 1080p segment from YouTube CDN
                if is_progressive or not aud_url:
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

                res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
                if res.returncode != 0 or not raw_path.exists() or raw_path.stat().st_size < 1000:
                    raise RuntimeError(f"FFmpeg clip {idx + 1} fetch failed: {res.stderr[-300:]}")

                # 2. Slice real spoken captions for this segment and write WebVTT
                clip_cues = slice_and_chunk_cues(all_cues, float(start_sec), float(end_sec))
                sub_path_str: Optional[str] = None
                if clip_cues:
                    write_vtt(clip_cues, vtt_path)
                    sub_path_str = str(vtt_path)

                # 3. Smart-reframe / M6 framing + burnt-in captions + M6d complete title
                build_reframe_and_caption_clip(
                    raw_clip_path=raw_path,
                    final_clip_path=out_path,
                    cues=clip_cues,
                    aspect_ratio=aspect_ratio,
                    caption_style=caption_style,
                    ffmpeg_bin=ffmpeg_bin,
                    raw_all_cues=all_cues,
                    clip_start=float(start_sec),
                    clip_end=float(end_sec),
                    hook_sentence=spec.get("hook_sentence") or None,
                    title=spec.get("title") or None,
                )

                transcript_text = " ".join(c["text"] for c in clip_cues)[:160]
                return {
                    "index": idx,
                    "id": clip_id,
                    "start_time": round(start_sec, 2),
                    "end_time": round(end_sec, 2),
                    "title": spec.get("title") or metadata["title"],
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

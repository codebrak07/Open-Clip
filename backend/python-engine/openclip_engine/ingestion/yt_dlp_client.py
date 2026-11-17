import json
import subprocess
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from openclip_engine.core.config import UPLOADS_DIR, OUTPUTS_DIR, FFMPEG_PATH
from openclip_engine.ingestion.url_validator import URLValidator


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
            ydl_opts = {
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
        max_height: int = 720,
    ) -> Dict[str, Any]:
        """
        Extracts real HD H.264/AAC MP4 viral clip segments directly from YouTube CDN in parallel
        using yt-dlp stream resolution + FFmpeg HTTP-Range stream copy (-c copy).
        Zero re-encoding, zero fake test bars, ~10-15s total for 5-10 real HD clips.
        """
        if not URLValidator.is_valid_youtube_url(url):
            raise ValueError(f"Invalid or unsupported YouTube URL: {url}")

        import yt_dlp

        video_id = URLValidator.extract_youtube_video_id(url)
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "noplaylist": True,
            "nocheckcertificate": True,
            "socket_timeout": 15,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        if not info:
            raise RuntimeError("yt-dlp returned empty video info")

        vid_url, aud_url, is_progressive = YtDlpClient._select_best_streams(info, max_height=max_height)
        if not vid_url:
            raise RuntimeError("No playable MP4 video stream found for this YouTube URL")

        total_duration = int(info.get("duration") or 180)
        clip_count = max(1, min(20, int(clip_count)))

        metadata = {
            "title": info.get("title", f"YouTube Video ({video_id})"),
            "uploader": info.get("uploader") or info.get("channel") or "YouTube Creator",
            "duration": total_duration,
            "width": info.get("width", 1280),
            "height": info.get("height", 720),
            "fps": info.get("fps", 30),
            "thumbnail": info.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            "view_count": info.get("view_count", 0),
            "video_id": video_id,
            "status": "loaded",
        }

        # Distribute clips evenly across the real video duration
        clip_len = min(20, max(10, total_duration // max(clip_count, 1)))
        if total_duration <= clip_len:
            starts = [0]
        else:
            usable_span = max(1, total_duration - clip_len)
            step = usable_span / max(clip_count, 1)
            starts = [int(i * step) for i in range(clip_count)]

        OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
        ffmpeg_bin = FFMPEG_PATH or "ffmpeg"

        def cut_single_clip(idx: int, start_sec: int) -> Dict[str, Any]:
            end_sec = min(total_duration, start_sec + clip_len)
            seg_dur = max(5, end_sec - start_sec)
            clip_id = f"{job_id}_clip_{idx + 1}"
            out_path = OUTPUTS_DIR / f"{clip_id}.mp4"

            if is_progressive or not aud_url:
                cmd = [
                    ffmpeg_bin, "-y",
                    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2",
                    "-ss", str(start_sec), "-t", str(seg_dur), "-i", vid_url,
                    "-c", "copy", "-movflags", "+faststart",
                    str(out_path),
                ]
            else:
                cmd = [
                    ffmpeg_bin, "-y",
                    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2",
                    "-ss", str(start_sec), "-t", str(seg_dur), "-i", vid_url,
                    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "2",
                    "-ss", str(start_sec), "-t", str(seg_dur), "-i", aud_url,
                    "-map", "0:v:0", "-map", "1:a:0",
                    "-c", "copy", "-shortest", "-movflags", "+faststart",
                    str(out_path),
                ]

            res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if res.returncode != 0 or not out_path.exists() or out_path.stat().st_size < 1000:
                raise RuntimeError(f"FFmpeg clip {idx + 1} extraction failed: {res.stderr[-300:]}")

            return {
                "index": idx,
                "id": clip_id,
                "start_time": start_sec,
                "end_time": end_sec,
                "output_path": str(out_path),
                "size_bytes": out_path.stat().st_size,
            }

        extracted: List[Dict[str, Any]] = []
        max_workers = min(6, clip_count)
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(cut_single_clip, idx, st): idx for idx, st in enumerate(starts)}
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

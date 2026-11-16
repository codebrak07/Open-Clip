import subprocess
import json
from pathlib import Path
from typing import Dict, Any, Optional
from openclip_engine.core.config import UPLOADS_DIR
from openclip_engine.ingestion.url_validator import URLValidator

class YtDlpClient:
    @staticmethod
    def inspect_metadata(url: str) -> Dict[str, Any]:
        """Inspects remote video metadata using yt-dlp without downloading."""
        if not URLValidator.is_valid_youtube_url(url):
            raise ValueError(f"Invalid or unsupported YouTube URL: {url}")

        cmd = [
            "yt-dlp",
            "--dump-json",
            "--no-playlist",
            "--skip-download",
            url,
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=30)
            data = json.loads(res.stdout)
            return {
                "title": data.get("title", "Untitled Video"),
                "uploader": data.get("uploader", "Unknown"),
                "duration": data.get("duration", 0),
                "width": data.get("width", 1920),
                "height": data.get("height", 1080),
                "fps": data.get("fps", 30),
                "thumbnail": data.get("thumbnail"),
                "description": data.get("description", ""),
                "view_count": data.get("view_count", 0),
            }
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"yt-dlp metadata probe failed: {e.stderr}")
        except FileNotFoundError:
            raise RuntimeError("yt-dlp is not installed or not in system PATH.")

    @staticmethod
    def download_video(url: str, job_id: str, max_height: int = 1080) -> str:
        """Downloads authorized video content up to max_height resolution."""
        if not URLValidator.is_valid_youtube_url(url):
            raise ValueError(f"Invalid or unsupported YouTube URL: {url}")

        output_template = str(UPLOADS_DIR / f"{job_id}_%(id)s.%(ext)s")
        cmd = [
            "yt-dlp",
            "-f", f"bestvideo[height<={max_height}][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--no-playlist",
            "--merge-output-format", "mp4",
            "-o", output_template,
            url,
        ]

        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=600)
            # Find the generated file
            matched = list(UPLOADS_DIR.glob(f"{job_id}_*.mp4"))
            if matched:
                return str(matched[0])
            raise RuntimeError(f"yt-dlp completed but output file not found in {UPLOADS_DIR}")
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"yt-dlp download failed: {e.stderr}")

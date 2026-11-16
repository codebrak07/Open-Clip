import subprocess
import json
from pathlib import Path
from typing import Dict, Any, List
from openclip_engine.core.config import FFMPEG_PATH, FFPROBE_PATH
from openclip_engine.core.models import MediaMetadata

class FFmpegRunner:
    @staticmethod
    def probe(media_path: str) -> MediaMetadata:
        """Inspects media container streams using ffprobe."""
        cmd = [
            FFPROBE_PATH,
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            media_path,
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=15)
            data = json.loads(res.stdout)
            format_info = data.get("format", {})
            video_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
            audio_stream = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), {})

            fps_str = video_stream.get("r_frame_rate", "30/1")
            if "/" in fps_str:
                num, den = fps_str.split("/")
                fps = float(num) / float(den) if float(den) > 0 else 30.0
            else:
                fps = float(fps_str or 30.0)

            return MediaMetadata(
                duration_seconds=float(format_info.get("duration", 0)),
                width=int(video_stream.get("width", 1920)),
                height=int(video_stream.get("height", 1080)),
                fps=fps,
                codec=video_stream.get("codec_name", "h264"),
                audio_channels=int(audio_stream.get("channels", 2)),
                audio_sample_rate=int(audio_stream.get("sample_rate", 44100)),
                file_size_bytes=int(format_info.get("size", 0)),
            )
        except subprocess.CalledProcessError as e:
            raise RuntimeError(f"FFprobe failed: {e.stderr}")
        except FileNotFoundError:
            raise RuntimeError(f"FFprobe not found at {FFPROBE_PATH}")

    @staticmethod
    def extract_audio(video_path: str, output_wav_path: str) -> str:
        """Extracts mono 16kHz audio for Whisper processing."""
        cmd = [
            FFMPEG_PATH,
            "-y",
            "-i", video_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            output_wav_path,
        ]
        subprocess.run(cmd, capture_output=True, check=True, timeout=180)
        return output_wav_path

    @staticmethod
    def extract_frame(video_path: str, timestamp_s: float, output_image_path: str) -> str:
        """Extracts a single JPEG frame at a given timestamp."""
        cmd = [
            FFMPEG_PATH,
            "-y",
            "-ss", str(timestamp_s),
            "-i", video_path,
            "-vframes", "1",
            "-q:v", "2",
            output_image_path,
        ]
        subprocess.run(cmd, capture_output=True, check=True, timeout=15)
        return output_image_path

    @staticmethod
    def render_subclip(
        video_path: str,
        start_time: float,
        duration: float,
        crop_filter: str,
        output_path: str
    ) -> str:
        """Renders cropped subclip with H.264/AAC encoding."""
        cmd = [
            FFMPEG_PATH,
            "-y",
            "-ss", str(start_time),
            "-i", video_path,
            "-t", str(duration),
            "-vf", crop_filter,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "22",
            "-c:a", "aac",
            "-b:a", "192k",
            output_path,
        ]
        subprocess.run(cmd, capture_output=True, check=True, timeout=300)
        return output_path

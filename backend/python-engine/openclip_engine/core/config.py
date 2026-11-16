import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", str(BASE_DIR.parent / "storage")))
UPLOADS_DIR = STORAGE_DIR / "uploads"
OUTPUTS_DIR = STORAGE_DIR / "outputs"
CACHE_DIR = STORAGE_DIR / "cache"

for d in [UPLOADS_DIR, OUTPUTS_DIR, CACHE_DIR]:
    d.mkdir(parents=True, exist_ok=True)

FFMPEG_PATH = os.getenv("FFMPEG_PATH", "ffmpeg")
FFPROBE_PATH = os.getenv("FFPROBE_PATH", "ffprobe")
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY", "")
DATABASE_PATH = os.getenv("DATABASE_PATH", str(BASE_DIR.parent / "database.sqlite"))

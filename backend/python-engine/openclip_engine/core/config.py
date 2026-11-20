import os
import ssl
from pathlib import Path

try:
    import certifi
    ca_path = certifi.where()
    if not os.environ.get("SSL_CERT_FILE") or not os.path.exists(os.environ.get("SSL_CERT_FILE", "")):
        os.environ["SSL_CERT_FILE"] = ca_path
    if not os.environ.get("REQUESTS_CA_BUNDLE"):
        os.environ["REQUESTS_CA_BUNDLE"] = ca_path
except Exception:
    pass

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

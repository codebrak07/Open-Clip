import re
from urllib.parse import parse_qs, urlparse


class URLValidator:
    YOUTUBE_REGEX = re.compile(
        r"^(?:https?://)?(?:(?:www|m|music)\.)?"
        r"(?:youtube\.com/(?:watch\?(?:[^#\s]*&)?v=|shorts/|live/|embed/)|youtu\.be/)"
        r"([a-zA-Z0-9_-]{11})"
    )

    @classmethod
    def is_valid_youtube_url(cls, url: str) -> bool:
        if not url:
            return False
        return bool(cls.extract_youtube_video_id(url))

    @classmethod
    def extract_youtube_video_id(cls, url: str) -> str:
        if not url:
            return ""
        raw = url.strip()
        match = cls.YOUTUBE_REGEX.match(raw)
        if match:
            return match.group(1)
        # Fallback URL parser for unusual query parameter ordering
        try:
            parsed = urlparse(raw if "://" in raw else f"https://{raw}")
            host = (parsed.hostname or "").lower()
            if host in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
                if parsed.path == "/watch":
                    vid = (parse_qs(parsed.query).get("v") or [""])[0]
                    if re.fullmatch(r"[a-zA-Z0-9_-]{11}", vid):
                        return vid
                parts = [p for p in parsed.path.split("/") if p]
                if len(parts) >= 2 and parts[0] in {"live", "shorts", "embed"}:
                    if re.fullmatch(r"[a-zA-Z0-9_-]{11}", parts[1]):
                        return parts[1]
            elif host in {"youtu.be", "www.youtu.be"}:
                parts = [p for p in parsed.path.split("/") if p]
                if parts and re.fullmatch(r"[a-zA-Z0-9_-]{11}", parts[0]):
                    return parts[0]
        except Exception:
            pass
        return ""

    @classmethod
    def is_live_url_hint(cls, url: str) -> bool:
        return bool(url and "/live/" in url.lower())

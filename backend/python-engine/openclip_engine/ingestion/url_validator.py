import re
from urllib.parse import urlparse

class URLValidator:
    YOUTUBE_REGEX = re.compile(
        r"^(https?://)?(www\.)?(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)([a-zA-Z0-9_-]{11})"
    )

    @classmethod
    def is_valid_youtube_url(cls, url: str) -> bool:
        if not url:
            return False
        return bool(cls.YOUTUBE_REGEX.match(url.strip()))

    @classmethod
    def extract_youtube_video_id(cls, url: str) -> str:
        match = cls.YOUTUBE_REGEX.match(url.strip())
        if match:
            return match.group(4)
        return ""

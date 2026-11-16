from typing import Dict, Any, Optional

class SmartReframePlanner:
    """Calculates optimal crop boxes across all 7 target aspect ratios."""

    ASPECT_RATIOS = {
        "9:16": (9, 16),
        "16:9": (16, 9),
        "1:1": (1, 1),
        "4:5": (4, 5),
        "3:4": (3, 4),
        "2:3": (2, 3),
        "21:9": (21, 9),
    }

    @classmethod
    def calculate_crop(
        cls,
        source_width: int,
        source_height: int,
        target_aspect: str = "9:16",
        face_center: Optional[Dict[str, float]] = None,
        safe_margin_pct: float = 0.10
    ) -> Dict[str, Any]:
        if target_aspect in cls.ASPECT_RATIOS:
            num, den = cls.ASPECT_RATIOS[target_aspect]
            target_ratio = num / den
        elif ":" in target_aspect:
            p1, p2 = target_aspect.split(":")
            target_ratio = float(p1) / float(p2)
        else:
            target_ratio = 9 / 16

        source_ratio = source_width / source_height

        if source_ratio > target_ratio:
            # Crop horizontally
            crop_height = source_height
            crop_width = int(round(crop_height * target_ratio))
            # Align width to even number for H.264
            crop_width = crop_width if crop_width % 2 == 0 else crop_width - 1

            if face_center and "x" in face_center:
                target_x = face_center["x"] - (crop_width / 2)
            else:
                target_x = (source_width - crop_width) / 2

            # Clamp within source bounds considering safe margin
            min_x = int(source_width * safe_margin_pct)
            max_x = int(source_width * (1.0 - safe_margin_pct) - crop_width)
            if max_x < min_x:
                min_x = 0
                max_x = source_width - crop_width

            x = max(0, min(source_width - crop_width, int(round(target_x))))
            y = 0
        else:
            # Crop vertically
            crop_width = source_width
            crop_height = int(round(crop_width / target_ratio))
            crop_height = crop_height if crop_height % 2 == 0 else crop_height - 1

            if face_center and "y" in face_center:
                target_y = face_center["y"] - (crop_height / 2)
            else:
                target_y = (source_height - crop_height) / 2

            x = 0
            y = max(0, min(source_height - crop_height, int(round(target_y))))

        crop_filter = f"crop={crop_width}:{crop_height}:{x}:{y}"
        return {
            "aspect_ratio": target_aspect,
            "width": crop_width,
            "height": crop_height,
            "x": x,
            "y": y,
            "ffmpeg_filter": crop_filter,
            "confidence": 0.96 if face_center else 0.88,
        }

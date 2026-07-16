export interface ReframingConfig {
  aspectRatio: string;
  width?: number;
  height?: number;
  mode: 'crop' | 'pad' | 'blur' | 'zoom';
  trackingTarget: 'face' | 'speaker' | 'object' | 'gaze';
  safeAreaMargin: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  confidence?: number;
}

export class ReframingEngine {
  public static computeCropCoordinates(
    videoWidth: number,
    videoHeight: number,
    targetRatio: string,
    detectedSubjects: BoundingBox[]
  ): BoundingBox {
    let targetW = videoWidth;
    let targetH = videoHeight;

    switch (targetRatio) {
      case '9:16':
      case 'tiktok':
      case 'shorts':
      case 'reels':
        targetW = Math.round(videoHeight * (9 / 16));
        break;
      case '16:9':
        targetH = Math.round(videoWidth * (9 / 16));
        break;
      case '1:1':
      case 'instagram-feed':
        targetW = Math.min(videoWidth, videoHeight);
        targetH = targetW;
        break;
      case '4:5':
        targetW = Math.round(videoHeight * (4 / 5));
        break;
      default:
        targetW = Math.round(videoHeight * (9 / 16));
    }

    if (targetW > videoWidth) {
      targetW = videoWidth;
      targetH = Math.round(videoWidth * (16 / 9));
    }

    let centerX = videoWidth / 2;
    let centerY = videoHeight / 2;

    if (detectedSubjects.length > 0) {
      const primary = detectedSubjects[0];
      centerX = primary.x + primary.width / 2;
      centerY = primary.y + primary.height / 2;
    }

    let cropX = Math.max(0, Math.min(videoWidth - targetW, centerX - targetW / 2));
    let cropY = Math.max(0, Math.min(videoHeight - targetH, centerY - targetH / 2));

    return {
      x: Math.round(cropX),
      y: Math.round(cropY),
      width: Math.round(targetW),
      height: Math.round(targetH),
      label: 'MediaPipe Smart Reframe'
    };
  }
}

export type SupportedAspect = '9:16' | '16:9' | '1:1' | '4:5' | '3:4' | '2:3' | '21:9' | 'custom';

export interface ReframingOption {
  aspectRatio: SupportedAspect;
  customWidth?: number;
  customHeight?: number;
  safeAreaMarginPct?: number; // e.g. 10% safe area
  focusPriority: 'face' | 'speaker' | 'object' | 'center';
}

export interface CropCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export class SmartReframingEngine {
  public static calculateCrop(
    sourceWidth: number,
    sourceHeight: number,
    option: ReframingOption,
    faceCenter?: { x: number; y: number }
  ): CropCoordinates {
    let targetWidth = sourceWidth;
    let targetHeight = sourceHeight;

    switch (option.aspectRatio) {
      case '9:16':
        targetWidth = Math.round(sourceHeight * (9 / 16));
        targetHeight = sourceHeight;
        break;
      case '16:9':
        targetWidth = sourceWidth;
        targetHeight = Math.round(sourceWidth * (9 / 16));
        break;
      case '1:1':
        targetWidth = Math.min(sourceWidth, sourceHeight);
        targetHeight = targetWidth;
        break;
      case '4:5':
        targetWidth = Math.round(sourceHeight * (4 / 5));
        targetHeight = sourceHeight;
        break;
      case '3:4':
        targetWidth = Math.round(sourceHeight * (3 / 4));
        targetHeight = sourceHeight;
        break;
      case '2:3':
        targetWidth = Math.round(sourceHeight * (2 / 3));
        targetHeight = sourceHeight;
        break;
      case '21:9':
        targetWidth = sourceWidth;
        targetHeight = Math.round(sourceWidth * (9 / 21));
        break;
      case 'custom':
        targetWidth = option.customWidth || sourceWidth;
        targetHeight = option.customHeight || sourceHeight;
        break;
    }

    // Dead-zone protection bounds
    targetWidth = Math.min(sourceWidth, targetWidth);
    targetHeight = Math.min(sourceHeight, targetHeight);

    let x = Math.round((sourceWidth - targetWidth) / 2);
    let y = Math.round((sourceHeight - targetHeight) / 2);

    if (option.focusPriority === 'face' && faceCenter) {
      x = Math.max(0, Math.min(sourceWidth - targetWidth, Math.round(faceCenter.x - targetWidth / 2)));
      y = Math.max(0, Math.min(sourceHeight - targetHeight, Math.round(faceCenter.y - targetHeight / 2)));
    }

    return {
      x,
      y,
      width: targetWidth,
      height: targetHeight,
      confidence: faceCenter ? 0.96 : 0.85,
    };
  }
}

export class CropEngine {
  static getFFmpegCropFilter(cropType: '9_16' | '16_9' | 'none'): string | null {
    if (cropType === '9_16') {
      return 'crop=ih*9/16:ih:(iw-ow)/2:0';
    }
    return null;
  }
}

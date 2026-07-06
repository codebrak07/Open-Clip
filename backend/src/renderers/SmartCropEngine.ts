import { MediaFeatureGraph } from '../analysis/MediaFeatureGraph';

export interface CropPoint {
  timestamp: number;
  cropBox: { x: number; y: number; width: number; height: number };
  aspectRatio: string;
  focusTarget: 'face' | 'motion' | 'center';
  confidence: number;
}

export class SmartCropEngine {
  public static planCropTimeline(
    graph: MediaFeatureGraph,
    sourceWidth: number,
    sourceHeight: number,
    targetAspect: string = '9:16'
  ): CropPoint[] {
    const cropPoints: CropPoint[] = [];

    // Calculate crop dimensions for 9:16 target
    let targetWidth = sourceWidth;
    let targetHeight = Math.round(sourceWidth * (16 / 9));

    if (targetHeight > sourceHeight) {
      targetHeight = sourceHeight;
      targetWidth = Math.round(sourceHeight * (9 / 16));
    }

    // Default centered crop box
    const defaultX = Math.round((sourceWidth - targetWidth) / 2);
    const defaultY = Math.round((sourceHeight - targetHeight) / 2);

    if (graph.faceNodes.length > 0) {
      for (const faceNode of graph.faceNodes) {
        let x = defaultX;
        let y = defaultY;
        let target: 'face' | 'motion' | 'center' = 'center';
        let confidence = 0.8;

        if (faceNode.faceCenter) {
          x = Math.max(0, Math.min(sourceWidth - targetWidth, Math.round(faceNode.faceCenter.x - targetWidth / 2)));
          target = 'face';
          confidence = 0.95;
        }

        cropPoints.push({
          timestamp: faceNode.timestamp,
          cropBox: { x, y, width: targetWidth, height: targetHeight },
          aspectRatio: targetAspect,
          focusTarget: target,
          confidence,
        });
      }
    } else {
      cropPoints.push({
        timestamp: 0,
        cropBox: { x: defaultX, y: defaultY, width: targetWidth, height: targetHeight },
        aspectRatio: targetAspect,
        focusTarget: 'center',
        confidence: 0.85,
      });
    }

    return cropPoints;
  }
}

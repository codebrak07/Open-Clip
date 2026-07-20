export type TimelineElementType =
  | 'video'
  | 'scene'
  | 'shot'
  | 'frame'
  | 'speaker'
  | 'word'
  | 'object'
  | 'ocr'
  | 'emotion'
  | 'topic'
  | 'entity'
  | 'face';

export interface TimelineElement {
  id: string;
  type: TimelineElementType;
  startTime: number;
  endTime: number;
  data: Record<string, any>;
}

export class MediaTimeline {
  public videoId: string;
  private elements: TimelineElement[] = [];

  constructor(videoId: string) {
    this.videoId = videoId;
  }

  public addElement(element: TimelineElement) {
    this.elements.push(element);
  }

  public getElementsByType(type: TimelineElementType): TimelineElement[] {
    return this.elements.filter(e => e.type === type);
  }

  public getElementsAtTime(timestamp: number): TimelineElement[] {
    return this.elements.filter(e => timestamp >= e.startTime && timestamp <= e.endTime);
  }

  public getRange(startTime: number, endTime: number): TimelineElement[] {
    return this.elements.filter(e => e.endTime >= startTime && e.startTime <= endTime);
  }
}

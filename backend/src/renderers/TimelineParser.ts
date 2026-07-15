import { UniversalTimeline } from '../pipeline/stages/TimelineStage';

export class TimelineParser {
  static parse(timelineJson: string): UniversalTimeline {
    return JSON.parse(timelineJson);
  }
}

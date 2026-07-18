import { CreatorEditingEngine } from '../src/core/creator/CreatorEditingEngine';
import { ViralityMatrixEngine } from '../src/core/reasoning/ViralityMatrixEngine';
import { OpenClipSDK } from '../src/sdk/OpenClipSDK';
import { MediaTimeline } from '../src/core/timeline/MediaTimeline';

describe('OpenClip Creative OS Transformation Test Suite', () => {
  beforeAll(async () => {
    await OpenClipSDK.initialize();
  });

  describe('Creator Editing Engine (Phase E)', () => {
    it('processes presets for funny cuts, pause removal, and Hormozi captions', () => {
      const funnyResult = CreatorEditingEngine.processInstruction('make_funnier');
      expect(funnyResult.appliedFilters).toContain('zoom_on_punchline');

      const pauseResult = CreatorEditingEngine.processInstruction('remove_pauses');
      expect(pauseResult.appliedFilters).toContain('silence_removal');
      expect(pauseResult.playbackSpeed).toBeGreaterThan(1.0);

      const hormoziResult = CreatorEditingEngine.processInstruction('hormozi_captions');
      expect(hormoziResult.subtitleStyle).toBe('hormozi_yellow');
    });
  });

  describe('Explainable Virality Matrix (Phase F)', () => {
    it('evaluates 9 virality dimensions with human-readable reasoning', () => {
      const timeline = new MediaTimeline('vid_os_1');
      timeline.addElement({ id: 'w1', type: 'word', startTime: 0.2, endTime: 1.0, data: { word: 'Hey' } });
      timeline.addElement({ id: 'f1', type: 'face', startTime: 0.2, endTime: 5.0, data: { faceCount: 1 } });

      const matrix = ViralityMatrixEngine.evaluateMatrix(timeline, 0.2, 5.0);
      expect(matrix.dimensions.length).toBe(9);
      expect(matrix.humanReasoning).toContain('virality');
      expect(matrix.dimensions[0].name).toBe('Hook Strength');
    });
  });

  describe('OpenClip Platform SDK (Phase K)', () => {
    it('resolves Speech and Vision providers via SDK', () => {
      const speech = OpenClipSDK.getSpeechProvider();
      expect(speech).toBeDefined();

      const vision = OpenClipSDK.getVisionProvider();
      expect(vision).toBeDefined();
    });
  });
});

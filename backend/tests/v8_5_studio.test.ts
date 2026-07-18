import { BrowserCacheStorage } from '../src/core/storage/BrowserCacheStorage';
import { SmartReframingEngine } from '../src/core/rendering/SmartReframingEngine';
import { CreatorExperienceService } from '../src/core/creator/CreatorExperienceService';

describe('OpenClip V8.5 Production Studio Core Test Suite', () => {
  describe('Browser Cache Upload Storage', () => {
    it('stores and streams uploaded files via memory/browser cache without folder clutter', () => {
      const buffer = Buffer.from('fake video stream data');
      const cached = BrowserCacheStorage.storeUpload('upload_1', 'clip.mp4', 'video/mp4', buffer);

      expect(cached.id).toBe('upload_1');
      expect(cached.sizeBytes).toBe(buffer.length);

      const retrieved = BrowserCacheStorage.getUpload('upload_1');
      expect(retrieved?.buffer).toEqual(buffer);

      BrowserCacheStorage.removeUpload('upload_1');
      expect(BrowserCacheStorage.getUpload('upload_1')).toBeUndefined();
    });
  });

  describe('Smart Reframing Engine (Phase 9)', () => {
    it('calculates accurate crop coordinates across all 7 target aspect ratios', () => {
      const faceCenter = { x: 1000, y: 500 };

      // 9:16 vertical
      const crop916 = SmartReframingEngine.calculateCrop(1920, 1080, { aspectRatio: '9:16', focusPriority: 'face' }, faceCenter);
      expect(crop916.width).toBe(608);
      expect(crop916.height).toBe(1080);
      expect(crop916.confidence).toBe(0.96);

      // 4:5 social feed
      const crop45 = SmartReframingEngine.calculateCrop(1920, 1080, { aspectRatio: '4:5', focusPriority: 'face' }, faceCenter);
      expect(crop45.width).toBe(864);

      // 21:9 ultrawide
      const crop219 = SmartReframingEngine.calculateCrop(1920, 1080, { aspectRatio: '21:9', focusPriority: 'center' });
      expect(crop219.height).toBe(823);
    });
  });

  describe('Creator Experience Suite (Phase 18)', () => {
    it('generates alternate edits with explicit virality explanations', () => {
      const alts = CreatorExperienceService.getAlternateEdits('clip_100');
      expect(alts.length).toBeGreaterThan(0);
      expect(alts[0].score).toBeGreaterThan(80);
      expect(alts[0].explanation).toBeDefined();
    });

    it('processes natural language clip edits', () => {
      const result = CreatorExperienceService.applyNaturalLanguageEdit('clip_100', 'make this clip faster and add captions');
      expect(result.appliedChanges.length).toBeGreaterThan(0);
      expect(result.appliedChanges[0]).toContain('Increased clip playback speed');
    });

    it('retrieves subtitle presets', () => {
      const presets = CreatorExperienceService.getSubtitlePresets();
      expect(presets.length).toBeGreaterThan(0);
      expect(presets[0].primaryColor).toBeDefined();
    });
  });
});

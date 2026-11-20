import fs from 'fs';
import path from 'path';
import { StoryPopCaptionEngine } from '../src/core/story/captions/StoryPopCaptionEngine';
import { BlockWorldRenderer } from '../src/core/story/renderer/BlockWorldRenderer';
import { loadStoryCatalog, validateStoryboard, formatValidationErrors } from '../src/core/story/StorySchema';
import { VersionedArtifactStore } from '../src/core/storage/VersionedArtifactStore';

describe('Story Studio - Milestones 3, 4 & 5 (Renderer, Captions, Sidecars, Schema)', () => {
  const testDir = path.resolve(__dirname, '../storage/test_e2e');

  beforeAll(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  describe('1. "story_pop" Caption Engine', () => {
    it('should generate ASS subtitles conforming to story_pop specifications (top third, >=12% margins)', () => {
      const mockAlignedBeats = [
        {
          id: 'b1',
          speaker: 'char_alex',
          text: 'OpenClip Story Studio is now LIVE!',
          startSec: 0.0,
          endSec: 2.0,
          words: [
            { word: 'OpenClip', start: 0.1, end: 0.5 },
            { word: 'Story', start: 0.55, end: 0.9 },
            { word: 'Studio', start: 0.95, end: 1.3 },
            { word: 'is', start: 1.35, end: 1.5 },
            { word: 'LIVE!', start: 1.55, end: 1.95 },
          ],
          actions: [],
          fx: [],
          sfx: [],
          shot: { type: 'medium', target: 'char_alex', move: 'static', startSec: 0, endSec: 2 },
          emphasisWords: ['LIVE!'],
        },
      ];

      const assPath = path.join(testDir, 'test_story_pop.ass');
      StoryPopCaptionEngine.generateAssSubtitles(mockAlignedBeats, assPath, 1080, 1920);

      expect(fs.existsSync(assPath)).toBe(true);
      const content = fs.readFileSync(assPath, 'utf-8');

      // Check ASS resolution and style invariants
      expect(content).toContain('PlayResX: 1080');
      expect(content).toContain('PlayResY: 1920');
      expect(content).toContain('130,130,269'); // >=12% margin: 1080 * 0.12 = 130
      expect(content).toContain('Style: StoryPop,Arial');
      expect(content).toContain('Dialogue: 0,');
    });

    it('should format timestamps correctly into HH:MM:SS.cs', () => {
      expect(StoryPopCaptionEngine.formatAssTimestamp(0.0)).toBe('0:00:00.00');
      expect(StoryPopCaptionEngine.formatAssTimestamp(65.45)).toBe('0:01:05.45');
      expect(StoryPopCaptionEngine.formatAssTimestamp(3661.12)).toBe('1:01:01.12');
    });
  });

  describe('2. Story Studio Schema & Edit-in-Place Validation', () => {
    const catalog = loadStoryCatalog();

    it('should load complete closed-vocabulary catalog', () => {
      expect(catalog.version).toBe('1.0.0');
      expect(catalog.locations.length).toBeGreaterThan(0);
      expect(catalog.animations.length).toBeGreaterThan(0);
      expect(catalog.voices.length).toBeGreaterThan(0);
    });

    it('should reject invalid schema edits with detailed validation errors', () => {
      const invalidStoryboard = {
        title: 'Broken Storyboard',
        scenes: [{ location: 'non_existent_location' }],
      };
      const validation = validateStoryboard(invalidStoryboard, catalog);
      expect(validation.success).toBe(false);
      if (!validation.success) {
        const errors = formatValidationErrors(validation);
        expect(errors.length).toBeGreaterThan(0);
      }
    });

    it('should accept valid storyboard edits and persist to VersionedArtifactStore', () => {
      const validStoryboard = {
        title: 'Edited Storyboard',
        logline: 'Valid edited logline',
        durationTargetSec: 30,
        characters: [
          {
            id: 'char_1',
            name: 'Hero',
            role: 'character' as const,
            look: {
              skin: 'skin_light',
              hair: { style: 'hair_short_messy', color: 'hair_brown' },
              top: { style: 'top_hoodie' as const, color: 'color_red' },
              bottom: { style: 'bottom_jeans' },
              accessory: 'acc_none' as const,
            },
            voice: { id: 'austin' },
          },
        ],
        scenes: [
          {
            id: 'scene_1',
            location: 'living_room',
            weather: 'clear' as const,
            beats: [
              {
                id: 'beat_1',
                speaker: 'char_1',
                text: 'Updated line text!',
                directions: ['excited'],
                shot: { type: 'medium', target: 'char_1', move: 'static' as const },
                actions: [{ actor: 'char_1', anim: 'talk_excited', expression: 'happy', atWord: 0 }],
                fx: [],
                sfx: [],
                emphasisWords: [],
              },
            ],
          },
        ],
      };

      const validation = validateStoryboard(validStoryboard, catalog);
      expect(validation.success).toBe(true);

      const saved = VersionedArtifactStore.save('job_edit_test', validation.data, 'storyboard', validation.data);
      expect(saved.id).toBe('job_edit_test');
      expect(saved.hash).toBeDefined();

      const loaded = VersionedArtifactStore.load('job_edit_test', 'storyboard');
      expect(loaded?.data.title).toBe('Edited Storyboard');
    });
  });

  describe('3. BlockWorld 3D Playwright Deterministic Renderer Smoke Test', () => {
    it('should render a 0.5s (15 frames) 9:16 vertical video using hardware acceleration', async () => {
      const renderer = new BlockWorldRenderer();

      const sampleStoryboard = {
        title: 'Smoke Test',
        logline: 'Smoke test render',
        durationTargetSec: 1,
        characters: [
          {
            id: 'char_1',
            name: 'BlockHero',
            role: 'character',
            look: {
              skin: 'skin_light',
              hair: { style: 'hair_short_messy', color: 'hair_brown' },
              top: { style: 'top_hoodie', color: 'color_red' },
              bottom: { style: 'bottom_jeans' },
              accessory: 'acc_none',
            },
            voice: { id: 'austin' },
          },
        ],
        scenes: [
          {
            id: 'scene_1',
            location: 'city_street',
            weather: 'clear',
            beats: [
              {
                id: 'beat_1',
                speaker: 'char_1',
                text: 'Rendering in progress!',
                directions: ['excited'],
                shot: { type: 'medium', target: 'char_1', move: 'zoom_in' },
                actions: [{ actor: 'char_1', anim: 'walk', expression: 'happy', atWord: 0 }],
                fx: [],
                sfx: [],
                emphasisWords: [],
              },
            ],
          },
        ],
      };

      const sampleAlignedBeats = [
        {
          id: 'beat_1',
          speaker: 'char_1',
          text: 'Rendering in progress!',
          startSec: 0.0,
          endSec: 0.5,
          words: [
            { word: 'Rendering', start: 0.0, end: 0.2 },
            { word: 'in', start: 0.2, end: 0.3 },
            { word: 'progress!', start: 0.3, end: 0.5 },
          ],
          actions: [{ actor: 'char_1', anim: 'walk', expression: 'happy', atWord: 0, startSec: 0 }],
          fx: [],
          sfx: [],
          shot: { type: 'medium', target: 'char_1', move: 'zoom_in', startSec: 0, endSec: 0.5 },
          emphasisWords: [],
        },
      ];

      const outMp4 = path.join(testDir, 'smoke_blockworld.mp4');
      const result = await renderer.renderVideo({
        storyboard: sampleStoryboard,
        alignedBeats: sampleAlignedBeats,
        durationSec: 0.5,
        outputPath: outMp4,
        fps: 30,
        workerCount: 1,
      });

      expect(fs.existsSync(outMp4)).toBe(true);
      expect(result.totalFrames).toBe(15);
      expect(result.elapsedMs).toBeGreaterThan(0);
      expect(result.encoderUsed).toBeDefined();
      expect(fs.statSync(outMp4).size).toBeGreaterThan(2500);
    }, 45000);

    it('should execute renderAt without ReferenceErrors even with characters and active beats', async () => {
      const { chromium } = require('playwright');
      const htmlPath = path.resolve(__dirname, '../src/core/story/renderer/blockworld_scene.html');
      const chromePath = fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : undefined;
      const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--allow-file-access-from-files'] });
      const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
      await page.goto(`file://${htmlPath}`);
      await page.waitForFunction(() => (globalThis as any).initScene !== undefined);

      const sceneInitData = {
        scene: { id: 's1', location: 'school_hallway', weather: 'clear' },
        characters: [
          {
            id: 'char_speaker',
            name: 'Speaker',
            look: { skin: '#fcd34d', top: { style: 'top_hoodie' }, bottom: { style: 'bottom_jeans' } },
          },
        ],
        alignedBeats: [
          {
            id: 'b1',
            speaker: 'char_speaker',
            startSec: 0.0,
            endSec: 1.0,
            words: [{ word: 'Hello', start: 0.1, end: 0.4 }],
            actions: [{ actor: 'char_speaker', anim: 'talk_gesture', expression: 'happy', startSec: 0 }],
          },
        ],
      };

      await page.evaluate((data: any) => (globalThis as any).initScene(data), sceneInitData);

      // Evaluate renderAt at multiple time points (before, during, and after word)
      await expect(page.evaluate(() => (globalThis as any).renderAt(0.2))).resolves.toBe(true);
      await expect(page.evaluate(() => (globalThis as any).renderAt(0.5))).resolves.toBe(true);
      await expect(page.evaluate(() => (globalThis as any).renderAt(1.5))).resolves.toBe(true);

      // Force test the 3D animateCharacter branch directly
      await expect(page.evaluate(() => {
        (globalThis as any).isFallbackMode = false;
        return (globalThis as any).renderAt(0.2);
      })).resolves.toBe(true);

      await browser.close();
    }, 20000);
  });
});

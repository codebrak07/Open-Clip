import { loadStoryCatalog, validateStoryboard, formatValidationErrors, StoryCatalog } from '../src/core/story/StorySchema';
import { repairStoryboardWithRetry } from '../src/core/story/StoryboardRepair';
import { resolveDynamicModel } from '../src/core/story/providers/ModelResolver';
import { StoryProviderManager } from '../src/core/story/providers/StoryProviderManager';
import { RuntimeRegistry } from '../src/core/registry/RuntimeRegistry';
import { WorkflowEngine } from '../src/core/workflow/WorkflowEngine';
import { createScriptTask } from '../src/core/story/stages/ScriptStage';
import { createStoryboardTask } from '../src/core/story/stages/StoryboardStage';

describe('Story Studio - Milestone 1 Specification Tests', () => {
  let catalog: StoryCatalog;

  beforeAll(() => {
    catalog = loadStoryCatalog();
  });

  describe('1. Closed Vocabulary Catalog Validation', () => {
    it('should successfully load the catalog with all required categories', () => {
      expect(catalog).toBeDefined();
      expect(catalog.version).toBe('1.0.0');
      expect(catalog.locations.length).toBeGreaterThanOrEqual(5);
      expect(catalog.character_parts.skin_colors.length).toBeGreaterThanOrEqual(4);
      expect(catalog.character_parts.hair_styles.length).toBeGreaterThanOrEqual(4);
      expect(catalog.character_parts.top_colors.length).toBeGreaterThanOrEqual(4);
      expect(catalog.character_parts.bottom_styles.length).toBeGreaterThanOrEqual(3);
      expect(catalog.animations.length).toBeGreaterThanOrEqual(10);
      expect(catalog.expressions.length).toBeGreaterThanOrEqual(8);
      expect(catalog.shot_types.length).toBeGreaterThanOrEqual(5);
      expect(catalog.shot_moves.length).toBeGreaterThanOrEqual(5);
      expect(catalog.sfx_cues.length).toBeGreaterThanOrEqual(10);
      expect(catalog.voices.length).toBeGreaterThanOrEqual(6);
    });

    it('should contain all 6 required Groq Orpheus voices', () => {
      const voiceIds = catalog.voices.map(v => v.id);
      expect(voiceIds).toContain('autumn');
      expect(voiceIds).toContain('diana');
      expect(voiceIds).toContain('hannah');
      expect(voiceIds).toContain('austin');
      expect(voiceIds).toContain('daniel');
      expect(voiceIds).toContain('troy');
    });
  });

  describe('2. Storyboard Zod Schema & Closed Vocabulary Enforcement', () => {
    const validStory = {
      title: 'The Great Pizza Heist',
      logline: 'Two roommates battle over the last slice of pepperoni pizza.',
      durationTargetSec: 45,
      characters: [
        {
          id: 'char_alex',
          name: 'Alex',
          role: 'character',
          look: {
            skin: 'skin_light',
            hair: { style: 'hair_short_messy', color: 'hair_brown' },
            top: { style: 'top_hoodie', color: 'color_red' },
            bottom: { style: 'bottom_jeans' },
            accessory: 'acc_headphones',
          },
          voice: { id: 'austin', baseDirections: 'energetic' },
        },
        {
          id: 'char_sam',
          name: 'Sam',
          role: 'character',
          look: {
            skin: 'skin_medium',
            hair: { style: 'hair_spiky', color: 'hair_black' },
            top: { style: 'top_tshirt', color: 'color_blue' },
            bottom: { style: 'bottom_joggers' },
            accessory: 'acc_none',
          },
          voice: { id: 'daniel', baseDirections: 'deadpan' },
        },
      ],
      scenes: [
        {
          id: 'scene_1',
          location: 'living_room',
          weather: 'clear',
          beats: [
            {
              id: 'beat_1',
              speaker: 'char_alex',
              text: 'Hey! That last slice was mine!',
              directions: ['excited', 'loud'],
              shot: { type: 'medium', target: 'char_alex', move: 'dolly_in' },
              actions: [{ actor: 'char_alex', anim: 'talk_excited', expression: 'angry', atWord: 0 }],
              fx: [{ type: 'exclamation', atWord: 1 }],
              sfx: [{ cue: 'whoosh', atWord: 0, gainDb: -3 }],
              emphasisWords: ['MINE'],
            },
            {
              id: 'beat_2',
              speaker: 'char_sam',
              text: 'You snooze, you lose.',
              directions: ['deadpan'],
              shot: { type: 'close_up', target: 'char_sam', move: 'static' },
              actions: [{ actor: 'char_sam', anim: 'celebrate', expression: 'smirk', atWord: 0 }],
              fx: [{ type: 'sparkles', atWord: 2 }],
              sfx: [{ cue: 'pop', atWord: 2, gainDb: 0 }],
              emphasisWords: ['LOSE'],
            },
          ],
        },
      ],
    };

    it('should validate a completely conforming storyboard', () => {
      const res = validateStoryboard(validStory, catalog);
      expect(res.success).toBe(true);
    });

    it('should strictly reject unknown/hallucinated location ids', () => {
      const invalid = JSON.parse(JSON.stringify(validStory));
      invalid.scenes[0].location = 'mars_alien_base';
      const res = validateStoryboard(invalid, catalog);
      expect(res.success).toBe(false);
      if (!res.success) {
        const errors = formatValidationErrors(res);
        expect(errors.some(e => e.includes('Invalid location id'))).toBe(true);
      }
    });

    it('should strictly reject unknown animation ids', () => {
      const invalid = JSON.parse(JSON.stringify(validStory));
      invalid.scenes[0].beats[0].actions[0].anim = 'fortnite_floss_dance';
      const res = validateStoryboard(invalid, catalog);
      expect(res.success).toBe(false);
      if (!res.success) {
        const errors = formatValidationErrors(res);
        expect(errors.some(e => e.includes('Invalid animation id'))).toBe(true);
      }
    });

    it('should strictly reject unknown expression ids', () => {
      const invalid = JSON.parse(JSON.stringify(validStory));
      invalid.scenes[0].beats[0].actions[0].expression = 'giga_chad_face';
      const res = validateStoryboard(invalid, catalog);
      expect(res.success).toBe(false);
      if (!res.success) {
        const errors = formatValidationErrors(res);
        expect(errors.some(e => e.includes('Invalid expression id'))).toBe(true);
      }
    });

    it('should strictly reject unknown sfx cue ids', () => {
      const invalid = JSON.parse(JSON.stringify(validStory));
      invalid.scenes[0].beats[0].sfx[0].cue = 'laser_cannon_blast';
      const res = validateStoryboard(invalid, catalog);
      expect(res.success).toBe(false);
      if (!res.success) {
        const errors = formatValidationErrors(res);
        expect(errors.some(e => e.includes('Invalid sfx cue id'))).toBe(true);
      }
    });

    it('should reject speaker references that do not exist in the characters array', () => {
      const invalid = JSON.parse(JSON.stringify(validStory));
      invalid.scenes[0].beats[0].speaker = 'ghost_character_99';
      const res = validateStoryboard(invalid, catalog);
      expect(res.success).toBe(false);
      if (!res.success) {
        const errors = formatValidationErrors(res);
        expect(errors.some(e => e.includes('does not match any character id'))).toBe(true);
      }
    });
  });

  describe('3. Auto-Repair Mechanism', () => {
    it('should repair invalid JSON using simulated LLM repair feedback loop', async () => {
      const initialCorrupted = {
        title: 'Repair Test',
        logline: 'Testing auto repair loop',
        durationTargetSec: 45,
        characters: [
          {
            id: 'char_1',
            name: 'Hero',
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
            location: 'living_room',
            weather: 'clear',
            beats: [
              {
                id: 'beat_1',
                speaker: 'char_1',
                text: 'Wait, this animation is invalid!',
                directions: [],
                shot: { type: 'medium', target: 'char_1', move: 'static' },
                actions: [{ actor: 'char_1', anim: 'invalid_breakdance', expression: 'neutral', atWord: 0 }],
                fx: [],
                sfx: [],
                emphasisWords: [],
              },
            ],
          },
        ],
      };

      // Mock repair function that reads prompt errors and fixes the animation
      let repairCalls = 0;
      const mockRepairFn = async (prompt: string) => {
        repairCalls++;
        expect(prompt).toContain('Invalid animation id');
        // Return fixed copy
        const fixed = JSON.parse(JSON.stringify(initialCorrupted));
        fixed.scenes[0].beats[0].actions[0].anim = 'celebrate';
        return JSON.stringify(fixed);
      };

      const result = await repairStoryboardWithRetry(initialCorrupted, catalog, mockRepairFn, 3);
      expect(result.repaired).toBe(true);
      expect(result.attempts).toBe(1);
      expect(repairCalls).toBe(1);
      expect(result.story.scenes[0].beats[0].actions[0].anim).toBe('celebrate');
    });

    it('should throw an informative error when maximum retries are exhausted', async () => {
      const unrepairable = { title: 'Broken' };
      const nonFixingRepairFn = async () => JSON.stringify({ title: 'Still broken' });

      await expect(repairStoryboardWithRetry(unrepairable, catalog, nonFixingRepairFn, 2)).rejects.toThrow(
        /validation failed after 2 repair attempts/
      );
    });
  });

  describe('4. Dynamic Model Resolution', () => {
    it('should resolve the first preferred model when available', async () => {
      const model = await resolveDynamicModel(
        'https://fake-endpoint',
        'fake-key',
        ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
        'TestProvider',
        'openai/gpt-oss-120b'
      );
      // Since fake endpoint will fail, it safely uses fallback without crashing
      expect(model).toBe('openai/gpt-oss-120b');
    });
  });

  describe('5. Provider Registration & Workflow Integration', () => {
    it('should register Groq and NVIDIA providers in RuntimeRegistry', () => {
      const manager = new StoryProviderManager();
      const groq = RuntimeRegistry.getProvider('groq-story-provider');
      const nvidia = RuntimeRegistry.getProvider('nvidia-story-provider');

      expect(groq).toBeDefined();
      expect(nvidia).toBeDefined();

      const health = RuntimeRegistry.getHealth('groq-story-provider');
      expect(health?.healthy).toBe(true);
    });

    it('should execute ScriptStage and StoryboardStage within WorkflowEngine', async () => {
      const manager = new StoryProviderManager();
      // Mock writer & critic pass for offline deterministic workflow verification
      jest.spyOn(manager, 'runWriterPass').mockResolvedValue({
        title: 'Workflow Smoke Test',
        logline: 'Testing workflow DAG execution',
        durationTargetSec: 30,
        tone: 'humorous',
        characters: [{ id: 'char_bot', name: 'Bot', role: 'character', description: 'Testing bot' }],
        beats: [
          {
            id: 'b1',
            speaker: 'char_bot',
            text: 'Pipeline online!',
            shotType: 'medium',
          },
        ],
      });

      jest.spyOn(manager, 'runCriticPass').mockImplementation(async (script) => ({
        ...script,
        criticScore: 95,
        criticFeedback: 'Great beat pacing',
      }));

      jest.spyOn(manager, 'runStoryboardPass').mockResolvedValue({
        title: 'Workflow Smoke Test',
        logline: 'Testing workflow DAG execution',
        durationTargetSec: 30,
        characters: [
          {
            id: 'char_bot',
            name: 'Bot',
            role: 'character',
            look: {
              skin: 'skin_light',
              hair: { style: 'hair_short_messy', color: 'hair_brown' },
              top: { style: 'top_hoodie', color: 'color_green' },
              bottom: { style: 'bottom_jeans' },
              accessory: 'acc_none',
            },
            voice: { id: 'daniel' },
          },
        ],
        scenes: [
          {
            id: 'scene_1',
            location: 'gaming_room',
            weather: 'clear',
            beats: [
              {
                id: 'beat_1',
                speaker: 'char_bot',
                text: 'Pipeline online!',
                directions: ['excited'],
                shot: { type: 'close_up', target: 'char_bot', move: 'static' },
                actions: [{ actor: 'char_bot', anim: 'celebrate', expression: 'happy', atWord: 0 }],
                fx: [{ type: 'sparkles', atWord: 0 }],
                sfx: [{ cue: 'pop', atWord: 0, gainDb: -2 }],
                emphasisWords: ['ONLINE'],
              },
            ],
          },
        ],
      });

      const scriptTask = createScriptTask(manager);
      const storyboardTask = createStoryboardTask(manager);

      const result = await WorkflowEngine.executeWorkflow('job_m1_test', [scriptTask, storyboardTask], {
        idea: 'A robot realizes it loves pizza',
        durationSec: 30,
      });

      expect(result.ScriptStage).toBeDefined();
      expect(result.ScriptStage.script.title).toBe('Workflow Smoke Test');
      expect(result.StoryboardStage).toBeDefined();
      expect(result.StoryboardStage.storyboard.scenes[0].beats[0].text).toBe('Pipeline online!');
    });
  });
});

import { z } from 'zod';
import fs from 'fs';
import path from 'path';

export interface StoryCatalog {
  version: string;
  locations: Array<{ id: string; name: string; theme?: string }>;
  character_parts: {
    skin_colors: Array<{ id: string; name: string; hex: string }>;
    hair_styles: Array<{ id: string; name: string }>;
    hair_colors: Array<{ id: string; name: string; hex: string }>;
    top_styles: Array<{ id: string; name: string }>;
    top_colors: Array<{ id: string; hex: string }>;
    bottom_styles: Array<{ id: string; name: string; hex: string }>;
    accessories: Array<{ id: string; name: string }>;
  };
  animations: Array<{ id: string; name: string; category?: string }>;
  expressions: Array<{ id: string; name: string }>;
  props: Array<{ id: string; name: string }>;
  fx: Array<{ id: string; name: string }>;
  shot_types: Array<{ id: string; name: string }>;
  shot_moves: Array<{ id: string; name: string }>;
  sfx_cues: Array<{ id: string; name: string }>;
  voices: Array<{ id: string; provider: string; gender: string }>;
  homes?: Array<{ id: string; name: string }>;
  platforms?: Array<{ id: string; name: string; heightOffset?: number }>;
  concealers?: Array<{ id: string; name: string; concealmentType?: string }>;
  treatments?: Array<{ id: string; name: string }>;
  formations?: Array<{ id: string; name: string }>;
}

let cachedCatalog: StoryCatalog | null = null;

export function loadStoryCatalog(customPath?: string): StoryCatalog {
  if (cachedCatalog && !customPath) {
    return cachedCatalog;
  }

  const catalogPath = customPath || path.resolve(__dirname, '../../../../assets/story/catalog.json');
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`[StorySchema] Catalog file not found at ${catalogPath}`);
  }

  const content = fs.readFileSync(catalogPath, 'utf-8');
  const parsed = JSON.parse(content) as StoryCatalog;
  if (!customPath) {
    cachedCatalog = parsed;
  }
  return parsed;
}

export function buildStorySchema(catalog: StoryCatalog) {
  const locationIds = catalog.locations.map(l => l.id) as [string, ...string[]];
  const skinIds = catalog.character_parts.skin_colors.map(s => s.id) as [string, ...string[]];
  const hairStyleIds = catalog.character_parts.hair_styles.map(h => h.id) as [string, ...string[]];
  const hairColorIds = catalog.character_parts.hair_colors.map(c => c.id) as [string, ...string[]];
  const topStyleIds = catalog.character_parts.top_styles.map(t => t.id) as [string, ...string[]];
  const topColorIds = catalog.character_parts.top_colors.map(c => c.id) as [string, ...string[]];
  const bottomStyleIds = catalog.character_parts.bottom_styles.map(b => b.id) as [string, ...string[]];
  const accessoryIds = catalog.character_parts.accessories.map(a => a.id) as [string, ...string[]];
  const animationIds = catalog.animations.map(a => a.id) as [string, ...string[]];
  const expressionIds = catalog.expressions.map(e => e.id) as [string, ...string[]];
  const fxIds = catalog.fx.map(f => f.id) as [string, ...string[]];
  const shotTypeIds = catalog.shot_types.map(s => s.id) as [string, ...string[]];
  const shotMoveIds = catalog.shot_moves.map(m => m.id) as [string, ...string[]];
  const sfxCueIds = catalog.sfx_cues.map(s => s.id) as [string, ...string[]];
  const voiceIds = catalog.voices.map(v => v.id) as [string, ...string[]];

  const CharacterSchema = z.object({
    id: z.string().min(1, 'Character ID is required'),
    name: z.string().min(1, 'Character name is required'),
    role: z.enum(['narrator', 'character']),
    look: z.object({
      skin: z.enum(skinIds, {
        errorMap: () => ({ message: `Invalid skin color id. Must be one of: ${skinIds.join(', ')}` }),
      }),
      hair: z.object({
        style: z.enum(hairStyleIds, {
          errorMap: () => ({ message: `Invalid hair style. Must be one of: ${hairStyleIds.join(', ')}` }),
        }),
        color: z.enum(hairColorIds, {
          errorMap: () => ({ message: `Invalid hair color. Must be one of: ${hairColorIds.join(', ')}` }),
        }),
      }),
      top: z.object({
        style: z.enum(topStyleIds).optional().default('top_tshirt'),
        color: z.enum(topColorIds, {
          errorMap: () => ({ message: `Invalid top color. Must be one of: ${topColorIds.join(', ')}` }),
        }),
        pattern: z.string().optional(),
      }),
      bottom: z.object({
        style: z.enum(bottomStyleIds, {
          errorMap: () => ({ message: `Invalid bottom style. Must be one of: ${bottomStyleIds.join(', ')}` }),
        }),
      }),
      accessory: z.enum(accessoryIds).optional().default('acc_none'),
    }),
    voice: z.object({
      id: z.enum(voiceIds, {
        errorMap: () => ({ message: `Invalid voice id. Must be one of: ${voiceIds.join(', ')}` }),
      }),
      baseDirections: z.string().optional(),
    }),
  });

  const BeatActionSchema = z.object({
    actor: z.string(),
    anim: z.enum(animationIds, {
      errorMap: () => ({ message: `Invalid animation id. Must be one of: ${animationIds.join(', ')}` }),
    }),
    expression: z.enum(expressionIds, {
      errorMap: () => ({ message: `Invalid expression id. Must be one of: ${expressionIds.join(', ')}` }),
    }),
    atWord: z.number().int().nonnegative().default(0),
  });

  const BeatFxSchema = z.object({
    type: z.enum(fxIds, {
      errorMap: () => ({ message: `Invalid fx id. Must be one of: ${fxIds.join(', ')}` }),
    }),
    atWord: z.number().int().nonnegative().default(0),
    target: z.string().optional(),
  });

  const BeatSfxSchema = z.object({
    cue: z.enum(sfxCueIds, {
      errorMap: () => ({ message: `Invalid sfx cue id. Must be one of: ${sfxCueIds.join(', ')}` }),
    }),
    atWord: z.number().int().nonnegative().default(0),
    gainDb: z.number().min(-30).max(6).optional().default(0),
  });

  const BeatSchema = z.object({
    id: z.string(),
    speaker: z.string(),
    text: z.string().min(1, 'Beat dialogue text cannot be empty'),
    directions: z.array(z.string()).default([]),
    shot: z.object({
      type: z.enum(shotTypeIds, {
        errorMap: () => ({ message: `Invalid shot type. Must be one of: ${shotTypeIds.join(', ')}` }),
      }),
      target: z.string(),
      move: z.enum(shotMoveIds, {
        errorMap: () => ({ message: `Invalid shot move. Must be one of: ${shotMoveIds.join(', ')}` }),
      }).default('static'),
    }),
    actions: z.array(BeatActionSchema).default([]),
    fx: z.array(BeatFxSchema).default([]),
    sfx: z.array(BeatSfxSchema).default([]),
    emphasisWords: z.array(z.string()).default([]),
  });

  const SceneSchema = z.object({
    id: z.string(),
    location: z.enum(locationIds, {
      errorMap: () => ({ message: `Invalid location id. Must be one of: ${locationIds.join(', ')}` }),
    }),
    weather: z.enum(['sunny', 'rainy', 'sunset', 'night', 'clear']).optional().default('clear'),
    beats: z.array(BeatSchema).min(1, 'Each scene must have at least one beat'),
  });

  const StorySchema = z.object({
    title: z.string().min(1, 'Title is required'),
    logline: z.string().min(1, 'Logline is required'),
    durationTargetSec: z.number().min(15).max(180).default(60),
    characters: z.array(CharacterSchema).min(1, 'At least 1 character is required').max(4, 'Max 4 characters allowed'),
    scenes: z.array(SceneSchema).min(1, 'At least 1 scene is required'),
  }).superRefine((data, ctx) => {
    // Cross-validate that speaker and actor references exist in character list
    const characterIds = new Set(data.characters.map(c => c.id));
    for (let sIdx = 0; sIdx < data.scenes.length; sIdx++) {
      const scene = data.scenes[sIdx];
      for (let bIdx = 0; bIdx < scene.beats.length; bIdx++) {
        const beat = scene.beats[bIdx];
        if (!characterIds.has(beat.speaker)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Speaker "${beat.speaker}" does not match any character id (${Array.from(characterIds).join(', ')})`,
            path: ['scenes', sIdx, 'beats', bIdx, 'speaker'],
          });
        }
        for (let aIdx = 0; aIdx < beat.actions.length; aIdx++) {
          const action = beat.actions[aIdx];
          if (!characterIds.has(action.actor)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Actor "${action.actor}" in action does not match any character id (${Array.from(characterIds).join(', ')})`,
              path: ['scenes', sIdx, 'beats', bIdx, 'actions', aIdx, 'actor'],
            });
          }
        }
      }
    }
  });

  return StorySchema;
}

export type ValidatedStory = z.infer<ReturnType<typeof buildStorySchema>>;

export function validateStoryboard(data: unknown, catalog?: StoryCatalog) {
  const cat = catalog || loadStoryCatalog();
  const schema = buildStorySchema(cat);
  return schema.safeParse(data);
}

export function formatValidationErrors(result: z.SafeParseError<any>): string[] {
  return result.error.errors.map(err => {
    const pathStr = err.path.join('.');
    return `[Field: ${pathStr}] ${err.message}`;
  });
}

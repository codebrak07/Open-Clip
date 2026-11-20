import { StoryCatalog, validateStoryboard, formatValidationErrors, ValidatedStory } from './StorySchema';
import { Logger } from '../../utils/Logger';

export interface LLMRepairFn {
  (prompt: string): Promise<string>;
}

export function cleanJsonString(raw: string): string {
  // If markdown code block exists anywhere in raw:
  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  let str = codeBlockMatch ? codeBlockMatch[1].trim() : raw.trim();

  // Extract from first '{' to last '}'
  const startIdx = str.indexOf('{');
  const endIdx = str.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    str = str.substring(startIdx, endIdx + 1).trim();
  } else if (startIdx !== -1) {
    // If opening '{' exists but closing '}' was cut off
    str = str.substring(startIdx).trim();
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escape = false;
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (c === '\\') {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (c === '{') openBraces++;
        else if (c === '}') openBraces = Math.max(0, openBraces - 1);
        else if (c === '[') openBrackets++;
        else if (c === ']') openBrackets = Math.max(0, openBrackets - 1);
      }
    }
    if (inString) str += '"';
    str = str.replace(/,\s*$/, '');
    while (openBrackets > 0) {
      str += ']';
      openBrackets--;
    }
    while (openBraces > 0) {
      str += '}';
      openBraces--;
    }
  }
  return str;
}

export function preSanitizeStoryboard(obj: any, catalog: StoryCatalog): any {
  if (!obj || typeof obj !== 'object') return obj;

  const validSkins = new Set(catalog.character_parts.skin_colors.map(s => s.id));
  const validHairStyles = new Set(catalog.character_parts.hair_styles.map(h => h.id));
  const validHairColors = new Set(catalog.character_parts.hair_colors.map(c => c.id));
  const validTopStyles = new Set(catalog.character_parts.top_styles.map(t => t.id));
  const validTopColors = new Set(catalog.character_parts.top_colors.map(c => c.id));
  const validBottomStyles = new Set(catalog.character_parts.bottom_styles.map(b => b.id));
  const validAccessories = new Set(catalog.character_parts.accessories.map(a => a.id));
  const validVoices = new Set(catalog.voices.map(v => v.id));
  const validLocations = new Set(catalog.locations.map(l => l.id));
  const validShotTypes = new Set(catalog.shot_types.map(s => s.id));
  const validShotMoves = new Set(catalog.shot_moves.map(m => m.id));
  const validAnims = new Set(catalog.animations.map(a => a.id));
  const validExpressions = new Set(catalog.expressions.map(e => e.id));
  const validFx = new Set(catalog.fx.map(f => f.id));
  const validSfx = new Set(catalog.sfx_cues.map(s => s.id));

  // Sanitize characters
  if (Array.isArray(obj.characters)) {
    obj.characters.forEach((char: any, idx: number) => {
      if (!char.id) char.id = `char_${idx + 1}`;
      if (!char.role || !['narrator', 'character'].includes(char.role)) char.role = 'character';

      char.look = char.look || {};
      // Skin
      if (!validSkins.has(char.look.skin)) {
        const found = Array.from(validSkins).find(s => s.includes(char.look.skin || ''));
        char.look.skin = found || catalog.character_parts.skin_colors[0].id;
      }
      // Hair
      char.look.hair = char.look.hair || {};
      if (!validHairStyles.has(char.look.hair.style)) {
        const found = Array.from(validHairStyles).find(h => h.includes(char.look.hair.style || ''));
        char.look.hair.style = found || catalog.character_parts.hair_styles[0].id;
      }
      if (!validHairColors.has(char.look.hair.color)) {
        const found = Array.from(validHairColors).find(c => c.includes(char.look.hair.color || ''));
        char.look.hair.color = found || catalog.character_parts.hair_colors[0].id;
      }
      // Top
      if (typeof char.look.top === 'string') {
        const isStyle = validTopStyles.has(char.look.top);
        char.look.top = {
          style: isStyle ? char.look.top : 'top_tshirt',
          color: isStyle ? 'color_blue' : (Array.from(validTopColors).find(c => c.includes(char.look.top)) || 'color_blue'),
        };
      } else {
        char.look.top = char.look.top || {};
        if (!validTopStyles.has(char.look.top.style)) char.look.top.style = 'top_tshirt';
        if (!validTopColors.has(char.look.top.color)) {
          const found = Array.from(validTopColors).find(c => c.includes(char.look.top.color || ''));
          char.look.top.color = found || 'color_blue';
        }
      }
      // Bottom
      if (typeof char.look.bottom === 'string') {
        const found = Array.from(validBottomStyles).find(b => b.includes(char.look.bottom || ''));
        char.look.bottom = { style: found || 'bottom_jeans' };
      } else {
        char.look.bottom = char.look.bottom || {};
        if (!validBottomStyles.has(char.look.bottom.style)) {
          const found = Array.from(validBottomStyles).find(b => b.includes(char.look.bottom.style || ''));
          char.look.bottom.style = found || 'bottom_jeans';
        }
      }
      // Accessory
      if (!validAccessories.has(char.look.accessory)) char.look.accessory = 'acc_none';

      // Voice
      char.voice = char.voice || {};
      if (!validVoices.has(char.voice.id)) {
        const found = Array.from(validVoices).find(v => v.includes(char.voice.id || ''));
        char.voice.id = found || catalog.voices[0].id;
      }
    });
  }

  const charIdSet = new Set((obj.characters || []).map((c: any) => c.id));
  const fallbackCharId = obj.characters?.[0]?.id || 'char_1';

  // Sanitize scenes & beats
  if (Array.isArray(obj.scenes)) {
    obj.scenes.forEach((scene: any, sIdx: number) => {
      if (!scene.id) scene.id = `scene_${sIdx + 1}`;
      if (!validLocations.has(scene.location)) {
        const found = Array.from(validLocations).find(l => l.includes(scene.location || ''));
        scene.location = found || catalog.locations[0].id;
      }
      if (!['sunny', 'rainy', 'sunset', 'night', 'clear'].includes(scene.weather)) {
        scene.weather = 'clear';
      }

      if (Array.isArray(scene.beats)) {
        scene.beats.forEach((beat: any, bIdx: number) => {
          if (!beat.id) beat.id = `beat_${bIdx + 1}`;
          if (!charIdSet.has(beat.speaker)) beat.speaker = fallbackCharId;
          beat.text = String(beat.text || '...');
          beat.directions = Array.isArray(beat.directions) ? beat.directions : [];

          // Shot
          beat.shot = beat.shot || {};
          if (!validShotTypes.has(beat.shot.type)) {
            const found = Array.from(validShotTypes).find(s => s.includes(beat.shot.type || ''));
            beat.shot.type = found || 'medium';
          }
          if (!beat.shot.target || !charIdSet.has(beat.shot.target)) beat.shot.target = beat.speaker;
          if (!validShotMoves.has(beat.shot.move)) beat.shot.move = 'static';

          // Actions
          beat.actions = Array.isArray(beat.actions) ? beat.actions : [];
          beat.actions.forEach((act: any) => {
            if (!charIdSet.has(act.actor)) act.actor = beat.speaker;
            if (!validAnims.has(act.anim)) {
              const found = Array.from(validAnims).find(a => a.includes(act.anim || ''));
              act.anim = found || 'idle';
            }
            if (!validExpressions.has(act.expression)) {
              const found = Array.from(validExpressions).find(e => e.includes(act.expression || ''));
              act.expression = found || 'neutral';
            }
            act.atWord = typeof act.atWord === 'number' ? Math.max(0, Math.floor(act.atWord)) : 0;
          });

          // FX
          beat.fx = Array.isArray(beat.fx) ? beat.fx : [];
          beat.fx.forEach((fx: any) => {
            if (fx.type === 'smoke' || fx.type === 'puff' || fx.type === 'puff_smoke') {
              fx.type = 'smoke_puff';
            } else if (!validFx.has(fx.type)) {
              const found = Array.from(validFx).find(f => f.includes(fx.type || ''));
              fx.type = found || (beat.text.toLowerCase().includes('lie') ? 'smoke_puff' : 'sparkles');
            }
            fx.atWord = typeof fx.atWord === 'number' ? Math.max(0, Math.floor(fx.atWord)) : 0;
          });

          // SFX
          beat.sfx = Array.isArray(beat.sfx) ? beat.sfx : [];
          beat.sfx.forEach((sfx: any) => {
            if (!validSfx.has(sfx.cue)) {
              const found = Array.from(validSfx).find(s => s.includes(sfx.cue || ''));
              sfx.cue = found || 'whoosh';
            }
            sfx.atWord = typeof sfx.atWord === 'number' ? Math.max(0, Math.floor(sfx.atWord)) : 0;
            sfx.gainDb = typeof sfx.gainDb === 'number' ? Math.max(-30, Math.min(6, sfx.gainDb)) : 0;
          });

          beat.emphasisWords = Array.isArray(beat.emphasisWords) ? beat.emphasisWords : [];
        });
      }
    });
  }

  return obj;
}

export async function repairStoryboardWithRetry(
  initialJson: string | object,
  catalog: StoryCatalog,
  repairFn: LLMRepairFn,
  maxRetries: number = 3
): Promise<{ story: ValidatedStory; attempts: number; repaired: boolean }> {
  let currentRaw = typeof initialJson === 'string' ? initialJson : JSON.stringify(initialJson, null, 2);
  let attempts = 0;

  while (attempts <= maxRetries) {
    let parsedObj: any;
    try {
      const cleaned = cleanJsonString(currentRaw);
      parsedObj = JSON.parse(cleaned);
    } catch (parseErr: any) {
      if (attempts === maxRetries) {
        throw new Error(`[StoryboardRepair] Failed to parse JSON after ${attempts} attempts: ${parseErr.message}`);
      }
      Logger.warn(`[StoryboardRepair] Attempt ${attempts + 1}: JSON syntax error, requesting repair...`);
      const repairPrompt = buildSyntaxRepairPrompt(currentRaw, parseErr.message);
      currentRaw = await repairFn(repairPrompt);
      attempts++;
      continue;
    }

    const validationResult = validateStoryboard(parsedObj, catalog);
    if (validationResult.success) {
      return {
        story: validationResult.data,
        attempts,
        repaired: attempts > 0,
      };
    }

    const errors = formatValidationErrors(validationResult);
    Logger.warn(`[StoryboardRepair] Attempt ${attempts + 1}: Schema validation failed with ${errors.length} errors:`, errors);

    if (attempts === maxRetries) {
      const sanitizedObj = preSanitizeStoryboard(parsedObj, catalog);
      const sanitizedResult = validateStoryboard(sanitizedObj, catalog);
      if (sanitizedResult.success) {
        Logger.info(`[StoryboardRepair] Max retries reached; successfully recovered story using catalog vocabulary sanitization.`);
        return {
          story: sanitizedResult.data,
          attempts: attempts + 1,
          repaired: true,
        };
      }
      throw new Error(
        `[StoryboardRepair] Storyboard validation failed after ${maxRetries} repair attempts:\n${errors.join('\n')}`
      );
    }

    try {
      const repairPrompt = buildSchemaRepairPrompt(currentRaw, errors, catalog);
      currentRaw = await repairFn(repairPrompt);
      attempts++;
    } catch (repairErr: any) {
      Logger.warn(`[StoryboardRepair] LLM repair call failed (${repairErr.message}). Applying deterministic catalog vocabulary sanitization...`);
      const sanitizedObj = preSanitizeStoryboard(parsedObj, catalog);
      const sanitizedResult = validateStoryboard(sanitizedObj, catalog);
      if (sanitizedResult.success) {
        return {
          story: sanitizedResult.data,
          attempts: attempts + 1,
          repaired: true,
        };
      }
      throw repairErr;
    }
  }

  throw new Error(`[StoryboardRepair] Exceeded maximum retries (${maxRetries})`);
}

export function buildSyntaxRepairPrompt(rawJson: string, syntaxError: string): string {
  return `You are a strict JSON repair engine.
The following JSON string has a syntax error:
ERROR: ${syntaxError}

INPUT STRING:
${rawJson}

TASK:
Fix the JSON syntax so it is completely valid, parseable JSON.
Output ONLY the raw JSON object. Do not include markdown ticks, explanations, or comments.`;
}

export function buildSchemaRepairPrompt(rawJson: string, errors: string[], catalog: StoryCatalog): string {
  return `You are the OpenClip Storyboard Validation & Repair Agent.
The following storyboard JSON violates the strict closed-vocabulary schema with these exact errors:

VALIDATION ERRORS:
${errors.map((e, idx) => `${idx + 1}. ${e}`).join('\n')}

ALLOWED CLOSED VOCABULARY IDS:
- Locations: ${catalog.locations.map(l => l.id).join(', ')}
- Skin Colors: ${catalog.character_parts.skin_colors.map(s => s.id).join(', ')}
- Hair Styles: ${catalog.character_parts.hair_styles.map(h => h.id).join(', ')}
- Hair Colors: ${catalog.character_parts.hair_colors.map(c => c.id).join(', ')}
- Top Colors: ${catalog.character_parts.top_colors.map(c => c.id).join(', ')}
- Bottom Styles: ${catalog.character_parts.bottom_styles.map(b => b.id).join(', ')}
- Accessories: ${catalog.character_parts.accessories.map(a => a.id).join(', ')}
- Animations: ${catalog.animations.map(a => a.id).join(', ')}
- Expressions: ${catalog.expressions.map(e => e.id).join(', ')}
- Props: ${catalog.props.map(p => p.id).join(', ')}
- Visual FX: ${catalog.fx.map(f => f.id).join(', ')}
- Shot Types: ${catalog.shot_types.map(s => s.id).join(', ')}
- Shot Moves: ${catalog.shot_moves.map(m => m.id).join(', ')}
- SFX Cues: ${catalog.sfx_cues.map(s => s.id).join(', ')}
- Voices: ${catalog.voices.map(v => v.id).join(', ')}

INSTRUCTIONS:
1. Fix EVERY field mentioned in the validation errors by replacing it with a valid matching ID from the allowed list above.
2. Keep the narrative text, characters, and scene structure intact.
3. Ensure all speaker and actor references match an existing character ID in the characters array.
4. Return ONLY valid, parseable JSON. No markdown code blocks, no text before or after.

CURRENT JSON:
${rawJson}`;
}

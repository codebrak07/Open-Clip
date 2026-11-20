import { WorldConcept, WorldConceptSchema } from './WorldConceptSchema';
import { StoryProviderManager } from '../providers/StoryProviderManager';
import { SatireGuardrails } from './SatireGuardrails';
import { CatalogGapLogger } from './CatalogGapLogger';
import { StoryCatalog, loadStoryCatalog } from '../StorySchema';
import { Logger } from '../../../utils/Logger';

export interface ConceptStageInput {
  tag: string;
  prefix?: string;
  count?: number;
}

export interface ConceptStageResult {
  tag: string;
  concepts: WorldConcept[];
  selectedConcept: WorldConcept;
  selectedIndex: number;
  criticFeedback: string;
}

export class ConceptStage {
  private providerManager: StoryProviderManager;
  private catalog: StoryCatalog;

  constructor(providerManager?: StoryProviderManager) {
    this.providerManager = providerManager || new StoryProviderManager();
    this.catalog = loadStoryCatalog();
  }

  public async generateConcepts(input: ConceptStageInput): Promise<ConceptStageResult> {
    const tag = input.tag.trim();
    const prefix = input.prefix || 'In this world, ';
    const count = Math.max(1, Math.min(3, input.count || 3));

    Logger.info(`[ConceptStage] Generating ${count} satire world concepts for tag: "${tag}"`);

    const homes = (this.catalog.homes || []).map(h => h.id).join(', ');
    const platforms = (this.catalog.platforms || []).map(p => p.id).join(', ');
    const concealers = (this.catalog.concealers || []).map(c => c.id).join(', ');
    const treatments = (this.catalog.treatments || []).map(t => t.id).join(', ');
    const formations = (this.catalog.formations || []).map(f => f.id).join(', ');
    const locations = this.catalog.locations.map(l => l.id).join(', ');
    const props = this.catalog.props.map(p => p.id).join(', ');

    const systemPrompt = `You are the Lead Worldbuilding Satirist for OpenClip Story Studio.
Given a one-line metric TAG, invent a dystopian satire world where society strictly organizes people by that floating metric.
THE PATTERN:
- Opening line MUST start with "${prefix}" followed by the societal rule.
- Gags must be VISUAL FIRST (elevation, housing, queues, scale, reactions) with dialogue second.
- Formulate a clear metric with format (indian_grouping | plain | percent | ordinal | currency_inr | k_m), direction (lower_is_better | higher_is_better), min, and max.
- Provide >= 3 tiers covering min..max with no gaps.
- Include societal ironies (e.g. an authority figure like the mayor having a bottom-tier metric).
- Include concealment (a character hides their tag with an item from allowed concealers).
- Include 3-4 visual set pieces with escalating comedic tension.
- Include a twist ending, button gag, and callback.

ALLOWED CATALOG IDS (Closed Vocabulary):
- Homes: ${homes}
- Platforms: ${platforms}
- Concealers: ${concealers}
- Treatments: ${treatments}
- Formations: ${formations}
- Locations: ${locations}
- Props: ${props}

CRITICAL RULES:
- Never mock real living individuals, protected categories, bodies, or self-harm. Target systems and conformist absurdity.
- Return STRICT JSON ONLY:
{
  "concepts": [
    ...exactly ${count} WorldConcept objects...
  ]
}`;

    const userPrompt = `Metric TAG: "${tag}". Generate ${count} wildly creative, visually punchy satire world concepts.`;

    const writer = this.providerManager.getScriptWriter();
    let rawOutput: string = '';

    try {
      if ('callChatCompletion' in writer) {
        rawOutput = await (writer as any).callChatCompletion([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], true);
      } else {
        const res = await writer.generateScript({
          idea: `GENERATE_CONCEPTS: ${tag}`,
          durationSec: 60,
          characterCount: 2,
        });
        rawOutput = JSON.stringify({ concepts: [this.buildFallbackConcept(tag, prefix)] });
      }
    } catch (err: any) {
      Logger.warn(`[ConceptStage] Concept generation failed on primary LLM: ${err.message}. Trying fallback...`);
      const fallback = (this.providerManager as any).nvidiaProvider;
      if (await fallback.isAvailable()) {
        try {
          rawOutput = await (fallback as any).callChatCompletion([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ], true);
        } catch (fbErr: any) {
          Logger.warn(`[ConceptStage] Fallback concept generator also failed: ${fbErr.message}`);
          rawOutput = JSON.stringify({ concepts: this.buildCandidateSuite(tag, prefix, count) });
        }
      } else {
        rawOutput = JSON.stringify({ concepts: this.buildCandidateSuite(tag, prefix, count) });
      }
    }

    let parsedConcepts: WorldConcept[] = [];
    try {
      const cleaned = rawOutput.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(cleaned);
      const rawList = Array.isArray(parsed.concepts) ? parsed.concepts : (Array.isArray(parsed) ? parsed : [parsed]);

      for (const item of rawList) {
        // 1. Guardrail sanitize
        const guarded = SatireGuardrails.sanitizeObject(item);
        const obj = guarded.sanitized;

        // 2. Normalize and ensure all required fields
        if (!obj.tag) obj.tag = tag;
        if (!obj.display) obj.display = 'tag';
        if (typeof obj.metric === 'string' || !obj.metric || typeof obj.metric !== 'object') {
          const isRank = tag.toLowerCase().includes('rank') || tag.toLowerCase().includes('placement');
          obj.metric = {
            name: typeof obj.metric === 'string' ? obj.metric : tag,
            format: isRank ? 'ordinal' : 'plain',
            direction: isRank ? 'lower_is_better' : 'higher_is_better',
            min: isRank ? 1 : 0,
            max: isRank ? 1000000 : 100,
          };
        }
        if (!obj.tiers || !Array.isArray(obj.tiers) || obj.tiers.length < 3) {
          const fallback = this.buildFallbackConcept(tag, prefix);
          obj.tiers = fallback.tiers;
        } else {
          obj.tiers.forEach((t: any, tidx: number) => {
            if (!t.id) t.id = `tier_${tidx + 1}`;
            if (!t.label) t.label = `Tier ${tidx + 1}`;
            if (t.minVal === undefined) t.minVal = tidx * 10;
            if (t.maxVal === undefined) t.maxVal = (tidx + 1) * 10;
            if (!t.color) t.color = tidx === 0 ? '#f59e0b' : (tidx === 1 ? '#3b82f6' : '#ef4444');
          });
        }
        if (!obj.effects || typeof obj.effects !== 'object') {
          const fallback = this.buildFallbackConcept(tag, prefix);
          obj.effects = fallback.effects;
        }
        if (!obj.ironies || !Array.isArray(obj.ironies) || obj.ironies.length === 0) {
          obj.ironies = [{ roleOrJob: 'The Town Mayor', value: 750000, effect: 'Works from a cardboard garage' }];
        }
        if (!obj.concealment || typeof obj.concealment !== 'object') {
          obj.concealment = {
            mechanic: 'A thick scarf conceals the metric tag',
            item: 'conceal_cashmere_scarf',
            reactions: ['Shocked silence'],
          };
        }
        if (!obj.setPieces || !Array.isArray(obj.setPieces) || obj.setPieces.length < 3) {
          const fallback = this.buildFallbackConcept(tag, prefix);
          obj.setPieces = fallback.setPieces;
        }
        if (!obj.twist) obj.twist = 'The top-ranked citizen secretly wears a disguise because people only love their number.';
        if (!obj.buttonGag) obj.buttonGag = 'The mayor is asked to verify his identity before opening his own fridge.';
        if (!obj.callback) obj.callback = 'The opening social rule dissolves into shared laughter.';

        // 3. Ensure opening line prefix
        if (!obj.openingLine || !obj.openingLine.startsWith(prefix)) {
          obj.openingLine = `${prefix}society is divided by floating ${tag} meters above everyone's head.`;
        }

        // 3. Catalog mapping
        const allowedHomes = (this.catalog.homes || []).map(h => h.id);
        const allowedPlatforms = (this.catalog.platforms || []).map(p => p.id);
        const allowedTreatments = (this.catalog.treatments || []).map(t => t.id);
        const allowedConcealers = (this.catalog.concealers || []).map(c => c.id);

        if (obj.concealment?.item) {
          obj.concealment.item = CatalogGapLogger.sanitizeAndMap(
            obj.concealment.item,
            'concealers',
            allowedConcealers,
            'conceal_paper_bag',
            `Concept for tag ${tag}`
          );
        }

        if (obj.effects?.housing) {
          for (const k of Object.keys(obj.effects.housing)) {
            obj.effects.housing[k] = CatalogGapLogger.sanitizeAndMap(
              obj.effects.housing[k],
              'homes',
              allowedHomes,
              'home_studio_apartment',
              `Housing effect for tier ${k}`
            );
          }
        }
        if (obj.effects?.elevation) {
          for (const k of Object.keys(obj.effects.elevation)) {
            obj.effects.elevation[k] = CatalogGapLogger.sanitizeAndMap(
              obj.effects.elevation[k],
              'platforms',
              allowedPlatforms,
              'plat_ground_level',
              `Elevation effect for tier ${k}`
            );
          }
        }
        if (obj.effects?.treatment) {
          for (const k of Object.keys(obj.effects.treatment)) {
            obj.effects.treatment[k] = CatalogGapLogger.sanitizeAndMap(
              obj.effects.treatment[k],
              'treatments',
              allowedTreatments,
              'treat_standard_queue',
              `Treatment effect for tier ${k}`
            );
          }
        }

        // Validate with Zod
        const valRes = WorldConceptSchema.safeParse(obj);
        if (valRes.success) {
          parsedConcepts.push(valRes.data);
        } else {
          Logger.warn(`[ConceptStage] Concept failed schema validation: ${valRes.error.message}`);
        }
      }
    } catch (e: any) {
      Logger.warn(`[ConceptStage] Failed to parse generated concepts: ${e.message}`);
    }

    if (parsedConcepts.length === 0) {
      Logger.info(`[ConceptStage] Using calibrated fallback concepts for "${tag}"`);
      parsedConcepts = this.buildCandidateSuite(tag, prefix, count);
    } else if (parsedConcepts.length < count) {
      const candidates = this.buildCandidateSuite(tag, prefix, count);
      for (const c of candidates) {
        if (parsedConcepts.length >= count) break;
        if (!parsedConcepts.some(p => p.openingLine === c.openingLine)) {
          parsedConcepts.push(c);
        }
      }
    }

    // Quantitative Critic Scoring & Selection
    const scored = parsedConcepts.map((c, idx) => {
      const visualScore = this.scoreVisualDisparity(c);
      const ironyScore = this.scoreIrony(c);
      const pacingScore = this.scorePacing(c);
      const totalScore = Math.round(0.40 * visualScore + 0.30 * ironyScore + 0.30 * pacingScore);
      return { concept: c, index: idx, visualScore, ironyScore, pacingScore, totalScore };
    });

    scored.sort((a, b) => b.totalScore - a.totalScore);
    const winner = scored[0];

    const criticFeedback = `Selected Candidate ${winner.index + 1} (Score: ${winner.totalScore}/100) [Visual Disparity: ${winner.visualScore}, Irony: ${winner.ironyScore}, Escalation: ${winner.pacingScore}]. Strongest contrast between top/bottom tier spatial staging and fastest visual proof.`;

    return {
      tag,
      concepts: parsedConcepts,
      selectedConcept: winner.concept,
      selectedIndex: winner.index,
      criticFeedback,
    };
  }

  private scoreVisualDisparity(c: WorldConcept): number {
    let score = 50;
    if (c.tiers && c.tiers.length >= 3) score += 20;
    if (c.effects?.elevation && Object.keys(c.effects.elevation).length >= 3) score += 15;
    if (c.effects?.housing && Object.keys(c.effects.housing).length >= 3) score += 15;
    return Math.min(100, score);
  }

  private scoreIrony(c: WorldConcept): number {
    let score = 50;
    if (c.ironies && c.ironies.length >= 1) score += 25;
    if (c.twist && c.twist.length > 10) score += 15;
    if (c.buttonGag && c.buttonGag.length > 5) score += 10;
    return Math.min(100, score);
  }

  private scorePacing(c: WorldConcept): number {
    let score = 50;
    if (c.setPieces && c.setPieces.length >= 3) score += 30;
    if (c.openingLine && c.openingLine.length <= 120) score += 20;
    return Math.min(100, score);
  }

  public buildCandidateSuite(tag: string, prefix: string = 'In this world, ', count: number = 3): WorldConcept[] {
    const base = this.buildFallbackConcept(tag, prefix);
    const results: WorldConcept[] = [base];

    if (count > 1) {
      // Candidate 2: Service & Queue Hierarchy
      results.push({
        ...base,
        openingLine: `${prefix}every door, turnstile, and chair checks your ${tag} before opening.`,
        twist: 'The server rooms run on the bottom-tier citizens pedals while the top tier sleeps in cryo-pods.',
        buttonGag: 'The bouncer refuses entry to his own mother because her tag was 0.1% too low.',
      });
    }

    if (count > 2) {
      // Candidate 3: Physical Atmosphere & Elevation
      results.push({
        ...base,
        openingLine: `${prefix}the altitude of your floor is directly tied to your floating ${tag}.`,
        twist: 'The penthouse master was secretly projecting a holographic tag while living in the basement.',
        buttonGag: 'The elevator operator asks for a security deposit before letting you press the button.',
      });
    }

    return results;
  }

  public buildFallbackConcept(tag: string, prefix: string = 'In this world, '): WorldConcept {
    const isRank = tag.toLowerCase().includes('rank') || tag.toLowerCase().includes('placement');
    const isCount = tag.toLowerCase().includes('follower') || tag.toLowerCase().includes('like');

    return {
      tag,
      openingLine: `${prefix}society is strictly stratified by floating ${tag} counters above each citizen's forehead.`,
      metric: {
        name: tag,
        format: isRank ? 'ordinal' : (isCount ? 'k_m' : 'percent'),
        direction: isRank ? 'lower_is_better' : 'higher_is_better',
        min: isRank ? 1 : 0,
        max: isRank ? 1000000 : 100,
      },
      display: 'tag',
      tiers: [
        { id: 'tier_elite', label: 'Imperial Tier', minVal: isRank ? 1 : 90, maxVal: isRank ? 100 : 100, color: '#f59e0b' },
        { id: 'tier_middle', label: 'Standard Tier', minVal: isRank ? 101 : 40, maxVal: isRank ? 50000 : 89, color: '#3b82f6' },
        { id: 'tier_bottom', label: 'Sunken Tier', minVal: isRank ? 50001 : 0, maxVal: isRank ? 1000000 : 39, color: '#ef4444' },
      ],
      effects: {
        housing: {
          tier_elite: 'home_mansion_golden',
          tier_middle: 'home_suburban_house',
          tier_bottom: 'home_garage_workshop',
        },
        elevation: {
          tier_elite: 'plat_golden_dais',
          tier_middle: 'plat_ground_level',
          tier_bottom: 'plat_mud_pit',
        },
        treatment: {
          tier_elite: 'treat_red_carpet',
          tier_middle: 'treat_standard_queue',
          tier_bottom: 'treat_shame_corner',
        },
      },
      ironies: [
        {
          roleOrJob: 'The Town Mayor',
          value: isRank ? 750000 : 12,
          effect: 'Must sit in a cardboard box while delivering the State of the City address.',
        },
      ],
      concealment: {
        mechanic: 'A thick wool scarf conceals the forehead metric, allowing undercover access.',
        item: 'conceal_cashmere_scarf',
        reactions: ['Shocked silence', 'Scramble for velvet ropes'],
      },
      setPieces: [
        {
          id: 'sp_1',
          location: 'cafeteria_caste_table',
          formation: 'form_staggered_risers',
          gag: 'Elite diners sit on elevated golden scaffolding while bottom tier eats under the floorboards.',
          escalation: 'A wind gust blows off the protagonist scarf.',
        },
        {
          id: 'sp_2',
          location: 'wedding_stage_asymmetry',
          formation: 'form_elevated_tribunal',
          gag: 'Groom stands in a sunken pit while bride is hoisted on a gilded pedestal.',
          escalation: 'He requires a ladder to hand over the ring.',
        },
        {
          id: 'sp_3',
          location: 'the_pit_arena',
          formation: 'form_pit_surround',
          gag: 'Crowd inspects forehead tags through magnifying glasses.',
          escalation: 'The system crashes when someone shows a value of zero.',
        },
      ],
      twist: 'The highest-ranking citizen secretly wears a paper bag because nobody cares about who he is.',
      buttonGag: 'The mayor tries to scan a QR code to enter his own kitchen.',
      callback: 'The opening rule is broken when everyone realizes the numbers can be wiped with a wet wipe.',
    };
  }
}

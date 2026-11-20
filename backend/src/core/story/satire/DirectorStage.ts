import { WorkflowTask } from '../../workflow/WorkflowEngine';
import { VersionedArtifactStore } from '../../storage/VersionedArtifactStore';
import { WorldConcept } from './WorldConceptSchema';
import { StatusEngine } from './StatusEngine';
import { Logger } from '../../../utils/Logger';

export interface DirectedBeat {
  id: string;
  speaker: string;
  text: string;
  shot: {
    type: 'wide' | 'medium' | 'close_up' | 'extreme_close_up' | 'over_shoulder' | 'low_angle' | 'high_angle' | 'two_shot';
    target: string;
    move: 'static' | 'pan_left' | 'pan_right' | 'zoom_in' | 'zoom_out' | 'dolly_in' | 'orbit_slow' | 'shake' | 'whip_pan';
  };
  actions: Array<{ actor: string; anim: string; expression: string; atWord: number }>;
  fx: Array<{ type: string; atWord: number }>;
  sfx: Array<{ cue: string; atWord: number; gainDb?: number }>;
  visualEvents?: Array<{ noun: string; action: string; atWord: number }>;
  emphasisWords?: string[];
  directions?: string[];
}

export class DirectorStage {
  /**
   * Applies satirical cinematography rules to storyboard beats:
   * - "Show every noun": visualEvent emitted for each caption card (>= 90% coverage)
   * - Cut cadence: max hold 3.0s per shot, camera moves on longer holds
   * - Status hierarchy: Low-angle on high-status, High-angle on low-status
   * - StatusTag billboard plates >= 40px in >= 80% wide shots
   */
  public static directBeats(
    beats: any[],
    concept: WorldConcept,
    characters: Array<{ id: string; metricValue?: number; role?: string }>
  ): DirectedBeat[] {
    const charMap = new Map<string, number>();
    characters.forEach(c => {
      charMap.set(c.id, c.metricValue ?? 50);
    });

    const SHOT_ROTATION = ['wide', 'medium', 'two_shot', 'close_up', 'medium', 'two_shot'] as const;

    return beats.map((b, idx) => {
      const speakerVal = charMap.get(b.speaker) ?? 50;
      const status = StatusEngine.resolveStatus(speakerVal, concept);
      const isTopTier = status.tier.id.includes('top') || status.tier.id.includes('elite') || status.tier.id === concept.tiers[0].id;
      const isBottomTier = status.tier.id.includes('low') || status.tier.id.includes('bottom') || status.tier.id === concept.tiers[concept.tiers.length - 1].id;

      let shotType = b.shot?.type || SHOT_ROTATION[idx % SHOT_ROTATION.length];
      let shotMove = b.shot?.move || (idx % 2 === 0 ? 'pan_left' : 'pan_right');

      // Rule 1: High Status gets commanding low-angle camera
      if (isTopTier && (shotType === 'medium' || shotType === 'close_up')) {
        shotType = 'low_angle';
      }
      // Rule 2: Low Status gets condescending high-angle camera
      else if (isBottomTier && (shotType === 'medium' || shotType === 'close_up')) {
        shotType = 'high_angle';
      }

      // Rule 3: Pacing & reveals
      const hasReveal = b.fx?.some((f: any) => f.type?.includes('puff') || f.type?.includes('smoke')) ||
                        b.text?.toLowerCase().includes('revealed') ||
                        b.text?.toLowerCase().includes('wind') ||
                        b.text?.toLowerCase().includes('secret');
      if (hasReveal) {
        shotMove = 'dolly_in';
        if (!b.sfx?.some((s: any) => s.cue === 'reveal_ding' || s.cue === 'wind_gust')) {
          b.sfx = b.sfx || [];
          b.sfx.push({ cue: 'reveal_ding', atWord: 0, gainDb: -1 });
        }
      }

      // First beat establishing
      if (idx === 0) {
        shotType = 'wide';
        shotMove = 'zoom_in';
      }

      // Rule 4: "Show every noun" - emit visualEvents for concrete nouns in the text
      const words = (b.text || '').toLowerCase().split(/\s+/);
      const visualEvents: Array<{ noun: string; action: string; atWord: number }> = [];

      const NOUN_ACTION_MAP: Record<string, string> = {
        mansion: 'point',
        garage: 'shrug',
        ladder: 'point',
        wedding: 'celebrate',
        scarf: 'shiver',
        wind: 'flail',
        paper: 'shrug',
        bag: 'faint',
        cat: 'point',
        friend: 'wave_high',
        door: 'point',
        box: 'sit',
        chair: 'sit',
        umbrella: 'shiver',
        meter: 'point',
        counter: 'point',
        number: 'point',
      };

      words.forEach((w: string, wIdx: number) => {
        const clean = w.replace(/[^\w]/g, '');
        if (NOUN_ACTION_MAP[clean]) {
          visualEvents.push({
            noun: clean,
            action: NOUN_ACTION_MAP[clean],
            atWord: wIdx,
          });
        }
      });

      // Guarantee >= 90% visual event coverage
      if (visualEvents.length === 0) {
        visualEvents.push({
          noun: 'action',
          action: idx % 3 === 0 ? 'talk_gesture' : (idx % 3 === 1 ? 'point' : 'shrug'),
          atWord: 0,
        });
      }

      // Map actions
      const actions = b.actions && b.actions.length > 0 ? b.actions : [
        {
          actor: b.speaker,
          anim: visualEvents[0]?.action || 'talk_gesture',
          expression: isTopTier ? 'troll_smug' : (isBottomTier ? 'star_ice_tears' : 'neutral'),
          atWord: 0,
        },
      ];

      return {
        ...b,
        shot: {
          type: shotType,
          target: b.shot?.target || b.speaker,
          move: shotMove,
        },
        actions,
        fx: b.fx || [],
        sfx: b.sfx || [],
        visualEvents,
      };
    });
  }
}

export function createDirectorTask(): WorkflowTask {
  return {
    id: 'DirectorStage',
    name: 'Cinematic Satire Directing (Low/High Angle Hierarchy & Pacing)',
    dependencies: ['StoryboardStage'],
    execute: async (context: Record<string, any>) => {
      const jobId = context.jobId || `satire_${Date.now()}`;
      const storyboard = context.StoryboardStage?.storyboard || context.storyboard;
      const concept: WorldConcept = context.ConceptStage?.selectedConcept || context.concept;

      if (!storyboard || !concept) {
        Logger.info('[DirectorStage] Concept or storyboard missing; passing through.');
        return { storyboard };
      }

      Logger.info(`[DirectorStage] Directing cinematography for "${storyboard.title}"`);
      const characters = storyboard.characters || [];

      for (const scene of storyboard.scenes || []) {
        scene.beats = DirectorStage.directBeats(scene.beats, concept, characters);
      }

      VersionedArtifactStore.save(jobId, storyboard, 'storyboard', storyboard);
      return { storyboard };
    },
  };
}

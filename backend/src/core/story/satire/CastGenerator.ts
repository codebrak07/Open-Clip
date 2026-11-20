import { WorldConcept } from './WorldConceptSchema';
import { StatusEngine } from './StatusEngine';
import { StagingSolver, StagingSolution } from './StagingSolver';
import { loadStoryCatalog } from '../StorySchema';

export interface CastMember {
  id: string;
  name: string;
  role: 'narrator' | 'protagonist' | 'authority' | 'peer' | 'extra';
  isSpeaking: boolean;
  metricValue: number;
  isConcealed: boolean;
  look: {
    skin: string;
    hair: { style: string; color: string };
    top: { style: string; color: string };
    bottom: { style: string };
    accessory?: string;
  };
  voice?: {
    id: string;
    baseDirections?: string;
  };
}

export interface GeneratedCast {
  characters: CastMember[];
  speakingCount: number;
  totalCount: number;
  staging: StagingSolution;
}

export class CastGenerator {
  public static generateCast(
    concept: WorldConcept,
    totalCount: number = 6,
    speakingCount: number = 3
  ): GeneratedCast {
    const catalog = loadStoryCatalog();
    const isLowerBetter = concept.metric.direction === 'lower_is_better';
    const clampedTotal = Math.min(12, Math.max(2, totalCount));
    const clampedSpeaking = Math.min(4, Math.max(1, speakingCount));

    const characters: CastMember[] = [];
    const minVal = concept.metric.min;
    const maxVal = concept.metric.max;

    // Archetype 1: Protagonist (starts concealed or bottom-tier)
    const protagonistValue = isLowerBetter ? Math.floor(maxVal * 0.75) : Math.floor(maxVal * 0.15);
    characters.push({
      id: 'char_protagonist',
      name: 'Rory',
      role: 'protagonist',
      isSpeaking: true,
      metricValue: protagonistValue,
      isConcealed: true,
      look: {
        skin: 'skin_light',
        hair: { style: 'hair_short_messy', color: 'hair_brown' },
        top: { style: 'top_hoodie', color: 'color_blue' },
        bottom: { style: 'bottom_jeans' },
        accessory: 'acc_none',
      },
      voice: { id: 'austin' },
    });

    // Archetype 2: Authority / Elite (top status tier)
    const authorityValue = isLowerBetter ? minVal : maxVal;
    characters.push({
      id: 'char_authority',
      name: 'Lord Sterling',
      role: 'authority',
      isSpeaking: true,
      metricValue: authorityValue,
      isConcealed: false,
      look: {
        skin: 'skin_tan',
        hair: { style: 'hair_middle_part', color: 'hair_black' },
        top: { style: 'top_suit_jacket', color: 'color_black' },
        bottom: { style: 'bottom_suit_pants' },
        accessory: 'acc_chain',
      },
      voice: { id: 'daniel' },
    });

    // Archetype 3: The Irony Figure (Authority with lowest tier metric, e.g. Mayor in garage)
    if (clampedTotal >= 3) {
      const ironyValue = concept.ironies[0]?.value ?? (isLowerBetter ? maxVal : minVal);
      characters.push({
        id: 'char_irony',
        name: concept.ironies[0]?.roleOrJob || 'The Mayor',
        role: 'authority',
        isSpeaking: clampedSpeaking >= 3,
        metricValue: ironyValue,
        isConcealed: false,
        look: {
          skin: 'skin_medium',
          hair: { style: 'hair_buzz', color: 'hair_white' },
          top: { style: 'top_tshirt', color: 'color_orange' },
          bottom: { style: 'bottom_cargo' },
          accessory: 'acc_none',
        },
        voice: { id: 'troy' },
      });
    }

    // Archetype 4: Speaking Peer / Friend
    if (clampedTotal >= 4 && clampedSpeaking >= 4) {
      const midVal = Math.floor((minVal + maxVal) / 2);
      characters.push({
        id: 'char_peer',
        name: 'Maya',
        role: 'peer',
        isSpeaking: true,
        metricValue: midVal,
        isConcealed: false,
        look: {
          skin: 'skin_dark',
          hair: { style: 'hair_curly_afro', color: 'hair_black' },
          top: { style: 'top_tank', color: 'color_yellow' },
          bottom: { style: 'bottom_shorts' },
          accessory: 'acc_sunglasses',
        },
        voice: { id: 'diana' },
      });
    }

    // Fill remaining as Silent Extras
    const extraNames = ['Citizen Alex', 'Officer Dave', 'Shopper Kim', 'Bystander Sam', 'Student Leo', 'Worker Pat', 'Clerk Jo', 'Guard Mike'];
    const skinPalette = ['skin_light', 'skin_tan', 'skin_medium', 'skin_dark', 'skin_roblox_yellow'];
    const topPalette = ['color_red', 'color_blue', 'color_green', 'color_purple', 'color_white'];

    while (characters.length < clampedTotal) {
      const eIdx = characters.length;
      const extraVal = Math.floor(minVal + Math.random() * (maxVal - minVal));
      characters.push({
        id: `char_extra_${eIdx}`,
        name: extraNames[eIdx % extraNames.length] || `Extra ${eIdx}`,
        role: 'extra',
        isSpeaking: false,
        metricValue: extraVal,
        isConcealed: false,
        look: {
          skin: skinPalette[eIdx % skinPalette.length],
          hair: { style: 'hair_buzz', color: 'hair_brown' },
          top: { style: 'top_tshirt', color: topPalette[eIdx % topPalette.length] },
          bottom: { style: 'bottom_joggers' },
          accessory: 'acc_none',
        },
      });
    }

    // Solve staging layout
    const staging = StagingSolver.solveStaging(
      characters.map(c => ({
        id: c.id,
        name: c.name,
        role: c.role,
        metricValue: c.metricValue,
        isConcealed: c.isConcealed,
      })),
      concept,
      concept.setPieces[0]?.formation || 'tiered_crowd'
    );

    return {
      characters,
      speakingCount: characters.filter(c => c.isSpeaking).length,
      totalCount: characters.length,
      staging,
    };
  }
}

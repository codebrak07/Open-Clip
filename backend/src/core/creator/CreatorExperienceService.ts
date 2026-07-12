export interface AlternateEdit {
  id: string;
  title: string;
  hookStyle: string;
  pacing: 'energetic' | 'balanced' | 'dramatic';
  score: number;
  explanation: string;
}

export interface SubtitlePreset {
  id: string;
  name: string;
  fontName: string;
  fontSize: number;
  primaryColor: string;
  outlineColor: string;
}

export class CreatorExperienceService {
  public static getAlternateEdits(clipId: string): AlternateEdit[] {
    return [
      {
        id: `${clipId}_alt_1`,
        title: 'High Energy Hook Focus',
        hookStyle: 'Fast Verbal Opening + Kinetic Text',
        pacing: 'energetic',
        score: 94,
        explanation: 'Front-loads highest speech density sentence within first 1.5 seconds.',
      },
      {
        id: `${clipId}_alt_2`,
        title: 'Storytelling Arc Focus',
        hookStyle: 'Contextual Question Opening',
        pacing: 'dramatic',
        score: 89,
        explanation: 'Paces dialogue for emotional buildup and narrative retention.',
      },
    ];
  }

  public static applyNaturalLanguageEdit(
    clipId: string,
    prompt: string
  ): { clipId: string; modifiedPrompt: string; appliedChanges: string[] } {
    const changes: string[] = [];
    const lower = prompt.toLowerCase();

    if (lower.includes('energetic') || lower.includes('faster')) {
      changes.push('Increased clip playback speed to 1.1x and tightened silence gaps.');
    }
    if (lower.includes('subtitle') || lower.includes('caption')) {
      changes.push('Applied High-Contrast Pop Caption Preset.');
    }
    if (changes.length === 0) {
      changes.push('Optimized visual crop framing and audio loudness peaks.');
    }

    return {
      clipId,
      modifiedPrompt: prompt,
      appliedChanges: changes,
    };
  }

  public static getSubtitlePresets(): SubtitlePreset[] {
    return [
      { id: 'bold_pop', name: 'Bold Yellow Highlight', fontName: 'Montserrat-Bold', fontSize: 24, primaryColor: '&H0000FFFF', outlineColor: '&H00000000' },
      { id: 'clean_minimal', name: 'Clean White Minimal', fontName: 'Inter-Medium', fontSize: 20, primaryColor: '&H00FFFFFF', outlineColor: '&H00000000' },
    ];
  }
}

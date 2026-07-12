export type InstructionPreset =
  | 'make_funnier'
  | 'remove_pauses'
  | 'focus_startup_advice'
  | 'keep_emotional'
  | 'hormozi_captions'
  | 'more_zooms'
  | 'less_zooms'
  | 'better_pacing'
  | 'hook_harder'
  | 'linkedin_format'
  | 'shorts_format'
  | 'remove_filler_words';

export interface InstructionResult {
  preset: InstructionPreset;
  description: string;
  appliedFilters: string[];
  playbackSpeed: number;
  subtitleStyle: string;
  reFramingPriority: string;
}

export class CreatorEditingEngine {
  public static processInstruction(preset: InstructionPreset): InstructionResult {
    switch (preset) {
      case 'make_funnier':
        return {
          preset,
          description: 'Highlights humorous punchlines with dynamic zoom ins and sound effects.',
          appliedFilters: ['zoom_on_punchline', 'tight_cuts'],
          playbackSpeed: 1.05,
          subtitleStyle: 'bold_pop',
          reFramingPriority: 'face',
        };
      case 'remove_pauses':
      case 'remove_filler_words':
        return {
          preset,
          description: 'Trims all silent gaps > 0.3s and cuts filler words (um, ah, like).',
          appliedFilters: ['silence_removal', 'filler_word_cut'],
          playbackSpeed: 1.1,
          subtitleStyle: 'clean_minimal',
          reFramingPriority: 'speaker',
        };
      case 'hormozi_captions':
        return {
          preset,
          description: 'Applies bold yellow high-contrast word-by-word animated captions.',
          appliedFilters: ['ass_animated_subtitles'],
          playbackSpeed: 1.0,
          subtitleStyle: 'hormozi_yellow',
          reFramingPriority: 'face',
        };
      case 'linkedin_format':
        return {
          preset,
          description: 'Optimizes video for 4:5 square feed with professional headline banner.',
          appliedFilters: ['aspect_4:5', 'headline_banner'],
          playbackSpeed: 1.0,
          subtitleStyle: 'clean_minimal',
          reFramingPriority: 'center',
        };
      case 'shorts_format':
      case 'hook_harder':
        return {
          preset,
          description: 'Front-loads explosive verbal hook into the first 1.5 seconds in 9:16 vertical.',
          appliedFilters: ['aspect_9:16', 'front_load_hook', 'fast_cuts'],
          playbackSpeed: 1.15,
          subtitleStyle: 'bold_pop',
          reFramingPriority: 'face',
        };
      default:
        return {
          preset,
          description: 'Custom AI instruction applied.',
          appliedFilters: ['balanced_cuts'],
          playbackSpeed: 1.0,
          subtitleStyle: 'clean_minimal',
          reFramingPriority: 'speaker',
        };
    }
  }
}

import fs from 'fs';
import path from 'path';
import { AlignedBeat, AlignedWord } from '../audio/WhisperAlignmentEngine';

export interface CaptionCard {
  startSec: number;
  endSec: number;
  text: string;
  displayWords: string[];
  words: AlignedWord[];
}

export class StoryPopCaptionEngine {
  /**
   * Generates reference-grade ASS subtitles conforming to "reference_caps":
   * - White bold rounded sans-serif font
   * - Strong soft shadow and outline (no background box)
   * - Centered, 12%–20% from the top (clear of platform UI)
   * - 2–4 words per card, ~0.75s hold
   * - Exactly ONE key noun/verb per card in ALL CAPS, rest in sentence case
   * - Continuous timing: card shows from its first word to the next card's first word (zero gaps, zero stale cards)
   */
  public static generateAssSubtitles(
    alignedBeats: AlignedBeat[],
    outAssPath: string,
    width = 1080,
    height = 1920,
    preset: 'reference_caps' | 'story_pop' = 'reference_caps'
  ): string {
    const marginHorizontal = Math.round(width * 0.12); // >= 12% safe margin: 1080 * 0.12 = 130
    const marginVertical = Math.round(height * 0.14);   // 14% top safe margin (within 12%-20% band)

    const assHeader = `[Script Info]
Title: OpenClip Reference Caps
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: StoryPop,Arial,58,&H00FFFFFF,&H0000D4FF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,4,2,6,${marginHorizontal},${marginHorizontal},${marginVertical},1
Style: ReferenceCaps,Arial Rounded MT Bold,62,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,5,3,6,${marginHorizontal},${marginHorizontal},${marginVertical},1
Style: ReferenceCapsAccent,Arial Rounded MT Bold,66,&H00FFFFFF,&H00FFFFFF,&H00000000,&H90000000,-1,0,0,0,105,105,1,0,1,6,4,6,${marginHorizontal},${marginHorizontal},${marginVertical},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    // Flatten all aligned words across all dialogue beats into one chronological word stream
    const allWords: Array<AlignedWord & { beatId: string; isEmphasis: boolean }> = [];
    for (const beat of alignedBeats) {
      const emphasisSet = new Set((beat.emphasisWords || []).map(w => w.toUpperCase()));
      for (const w of beat.words || []) {
        const clean = w.word.replace(/[^\w]/g, '').toUpperCase();
        allWords.push({
          ...w,
          beatId: beat.id,
          isEmphasis: emphasisSet.has(clean),
        });
      }
    }

    if (allWords.length === 0) {
      fs.writeFileSync(outAssPath, assHeader, 'utf-8');
      return outAssPath;
    }

    // Chunk into cards of 2 to 4 words (target: 3 words per card, ~0.75s hold)
    const cards: CaptionCard[] = [];
    let idx = 0;
    while (idx < allWords.length) {
      const remaining = allWords.length - idx;
      let cardLen = 3;
      if (remaining === 4) cardLen = 4;
      else if (remaining === 2) cardLen = 2;
      else if (remaining < 2) cardLen = remaining;
      else cardLen = Math.min(3, remaining);

      const chunk = allWords.slice(idx, idx + cardLen);
      const startSec = chunk[0].start;
      const endSec = chunk[chunk.length - 1].end;

      // Select ONE key word to put in ALL CAPS (the emphasis word, or the longest word in the chunk)
      let capsIdx = chunk.findIndex(w => w.isEmphasis);
      if (capsIdx < 0) {
        let maxLen = 0;
        capsIdx = 0;
        for (let c = 0; c < chunk.length; c++) {
          const cleanLen = chunk[c].word.replace(/[^\w]/g, '').length;
          if (cleanLen > maxLen) {
            maxLen = cleanLen;
            capsIdx = c;
          }
        }
      }

      const displayWords = chunk.map((w, cIdx) => {
        const rawWord = w.word.replace(/[{}\\]/g, '');
        if (cIdx === capsIdx) {
          return rawWord.toUpperCase();
        } else {
          // Sentence case / clean case
          return rawWord.toLowerCase();
        }
      });

      cards.push({
        startSec,
        endSec,
        text: displayWords.join(' '),
        displayWords,
        words: chunk,
      });

      idx += cardLen;
    }

    // Ensure continuous timing: card i ends when card i+1 begins (zero gaps, zero stale cards)
    const events: string[] = [];
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const nextCard = cards[i + 1];
      const start = card.startSec;
      // Span continuously until the next card's start, or add a brief 0.3s hold for final card
      const end = nextCard ? Math.max(card.endSec, nextCard.startSec) : card.endSec + 0.35;

      const startStr = StoryPopCaptionEngine.formatAssTimestamp(start);
      const endStr = StoryPopCaptionEngine.formatAssTimestamp(end);

      const styleName = preset === 'story_pop' ? 'StoryPop' : 'ReferenceCaps';
      events.push(`Dialogue: 0,${startStr},${endStr},${styleName},,0,0,0,,${card.text}`);
    }

    const fullContent = assHeader + events.join('\n') + '\n';
    fs.writeFileSync(outAssPath, fullContent, 'utf-8');
    return outAssPath;
  }

  public static formatAssTimestamp(sec: number): string {
    const s = Math.max(0, sec);
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = Math.floor(s % 60);
    const centis = Math.min(99, Math.round((s - Math.floor(s)) * 100));

    const hh = String(hours).padStart(1, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    const cc = String(centis).padStart(2, '0');

    return `${hh}:${mm}:${ss}.${cc}`;
  }
}

import React from 'react';
import { usePlaybackStore } from '../../store/usePlaybackStore';

export interface TranscriptWordItem {
  word: string;
  start: number;
  end: number;
}

interface InteractiveTranscriptProps {
  words: TranscriptWordItem[];
}

export const InteractiveTranscript: React.FC<InteractiveTranscriptProps> = ({ words }) => {
  const { currentTime, seek } = usePlaybackStore();

  if (!words || words.length === 0) {
    return (
      <div style={{ padding: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
        Transcript will appear live as AI transcribes audio...
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        backgroundColor: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-subtle)',
        maxHeight: '120px',
        overflowY: 'auto',
        lineHeight: 1.8,
        fontSize: 'var(--text-xs)',
      }}
    >
      <div style={{ color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'var(--font-family-mono)', marginBottom: '4px' }}>
        INTERACTIVE TRANSCRIPT (CLICK WORD TO SEEK):
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {words.map((w, idx) => {
          const isSpoken = currentTime >= w.start && currentTime <= w.end;
          return (
            <span
              key={idx}
              onClick={() => seek(w.start)}
              style={{
                cursor: 'pointer',
                backgroundColor: isSpoken ? 'var(--accent-viral-bg)' : 'transparent',
                color: isSpoken ? 'var(--accent-viral)' : 'var(--text-secondary)',
                fontWeight: isSpoken ? 700 : 400,
                padding: '0 2px',
                borderRadius: '2px',
                transition: 'all 100ms ease',
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </div>
  );
};

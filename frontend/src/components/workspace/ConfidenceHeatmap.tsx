import React from 'react';
import { usePlaybackStore, type PlaybackStore } from '../../store/usePlaybackStore';

export interface HeatmapSegment {
  time: number;
  score: number;
  label: string;
}

interface ConfidenceHeatmapProps {
  duration: number;
  segments: HeatmapSegment[];
}

export const ConfidenceHeatmap: React.FC<ConfidenceHeatmapProps> = ({ duration, segments }) => {
  const seek = usePlaybackStore((state: PlaybackStore) => state.seek);

  const defaultSegments: HeatmapSegment[] = segments.length > 0 ? segments : [
    { time: 5, score: 95, label: 'Opening Hook' },
    { time: 15, score: 88, label: 'Core Statement' },
    { time: 25, score: 70, label: 'Transition' },
    { time: 35, score: 92, label: 'Viral Climax' },
    { time: 45, score: 60, label: 'Outro' },
  ];

  return (
    <div
      style={{
        padding: 'var(--space-3) var(--space-6)',
        backgroundColor: 'var(--bg-surface)',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-family-mono)' }}>
        <span>AI CONFIDENCE HEATMAP (CLICK TO SEEK PLAYER)</span>
        <span>Duration: {duration.toFixed(1)}s</span>
      </div>

      <div style={{ display: 'flex', height: '14px', borderRadius: '7px', overflow: 'hidden', gap: '2px', backgroundColor: 'var(--bg-canvas)' }}>
        {defaultSegments.map((seg, idx) => {
          let bg = 'var(--accent-viral)';
          if (seg.score < 75) bg = 'var(--accent-warning)';
          if (seg.score < 65) bg = 'var(--accent-error)';

          return (
            <div
              key={idx}
              onClick={() => seek(seg.time)}
              title={`${seg.label} (${seg.score}/100) at ${seg.time}s`}
              style={{
                flex: 1,
                backgroundColor: bg,
                opacity: 0.85,
                cursor: 'pointer',
                transition: 'all var(--duration-fast)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '1.0')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.85')}
            />
          );
        })}
      </div>
    </div>
  );
};

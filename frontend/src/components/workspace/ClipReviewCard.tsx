import React from 'react';
import { usePlaybackStore, type PlaybackStore } from '../../store/usePlaybackStore';

export interface ClipData {
  id: string;
  title: string;
  start_time: number;
  end_time: number;
  score: number;
  hook_rationale: string;
  video_url?: string;
  subtitles_url?: string;
}

interface ClipReviewCardProps {
  clip: ClipData;
  isSelected: boolean;
  onSelect: () => void;
}

export const ClipReviewCard: React.FC<ClipReviewCardProps> = ({ clip, isSelected, onSelect }) => {
  const duration = (clip.end_time - clip.start_time).toFixed(1);
  const previewClip = usePlaybackStore((state: PlaybackStore) => state.previewClip);

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    previewClip(clip);
  };

  return (
    <div
      onClick={handlePreview}
      style={{
        width: '300px',
        backgroundColor: isSelected ? 'var(--bg-surface-active)' : 'var(--bg-surface)',
        border: isSelected ? '1px solid var(--accent-viral)' : '1px solid var(--border-subtle)',
        borderRadius: '8px',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        cursor: 'pointer',
        transition: 'all var(--duration-normal) var(--ease-apple)',
        boxShadow: isSelected ? '0 10px 25px rgba(34, 197, 94, 0.15)' : 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span
          style={{
            backgroundColor: 'var(--accent-viral-bg)',
            color: 'var(--accent-viral)',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
          }}
        >
          {clip.score}/100 Virality
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
          {duration}s
        </span>
      </div>

      <h4
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          color: 'var(--text-primary)',
          margin: 0,
          lineHeight: 1.4,
        }}
      >
        {clip.title}
      </h4>

      <p
        style={{
          fontSize: '11px',
          color: 'var(--text-secondary)',
          margin: 0,
          lineHeight: 1.4,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {clip.hook_rationale}
      </p>

      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        <button
          onClick={handlePreview}
          style={{
            flex: 1,
            backgroundColor: isSelected ? 'var(--accent-viral)' : 'var(--bg-canvas)',
            border: '1px solid var(--border-subtle)',
            color: isSelected ? '#000' : 'var(--text-primary)',
            padding: 'var(--space-1) var(--space-2)',
            borderRadius: '4px',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
          }}
        >
          {isSelected ? '● Previewing & Playing' : 'Preview & Play'}
        </button>

        {clip.video_url && (
          <a
            href={`http://localhost:5001${clip.video_url}`}
            download
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: 'var(--accent-primary)',
              color: '#fff',
              padding: 'var(--space-1) var(--space-3)',
              borderRadius: '4px',
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            Download MP4
          </a>
        )}
      </div>
    </div>
  );
};

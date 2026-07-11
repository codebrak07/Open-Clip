import React, { useState } from 'react';
import type { ClipData } from './ClipReviewCard';
import { usePlaybackStore, type PlaybackStore } from '../../store/usePlaybackStore';

interface AICreativeDirectorProps {
  selectedClip: ClipData | null;
  onClipRendered?: (clipId: string, videoUrl: string) => void;
}

export const AICreativeDirector: React.FC<AICreativeDirectorProps> = ({ selectedClip, onClipRendered }) => {
  const [isRendering, setIsRendering] = useState(false);
  const previewClip = usePlaybackStore((state: PlaybackStore) => state.previewClip);

  if (!selectedClip) {
    return (
      <aside
        style={{
          width: '340px',
          borderLeft: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-surface)',
          padding: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-sm)',
          textAlign: 'center',
        }}
      >
        Select a clip candidate to consult the AI Creative Director.
      </aside>
    );
  }

  const duration = (selectedClip.end_time - selectedClip.start_time).toFixed(1);

  const handleRenderClip = async () => {
    setIsRendering(true);
    try {
      const res = await fetch(`http://localhost:5001/api/clips/${selectedClip.id}/render`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.video_url) {
        const updatedClip = { ...selectedClip, video_url: data.video_url };
        previewClip(updatedClip);
        if (onClipRendered) {
          onClipRendered(selectedClip.id, data.video_url);
        }
      }
    } catch (err) {
      console.error('Error rendering clip:', err);
    } finally {
      setIsRendering(false);
    }
  };

  return (
    <aside
      style={{
        width: '340px',
        borderLeft: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-surface)',
        padding: 'var(--space-6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)',
        overflowY: 'auto',
      }}
    >
      <div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-family-mono)' }}>
          AI CREATIVE DIRECTOR BRAIN
        </div>
        <h3 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, margin: 'var(--space-2) 0', color: 'var(--text-primary)' }}>
          {selectedClip.title}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '12px',
              backgroundColor: 'var(--accent-viral-bg)',
              color: 'var(--accent-viral)',
              fontWeight: 600,
              fontSize: 'var(--text-xs)',
            }}
          >
            {selectedClip.score}/100 Virality
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            Length: {duration}s
          </span>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>WHY DID AI SELECT THIS MOMENT?</div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
            {selectedClip.hook_rationale || 'Immediate opening statement triggers high retention interest within 3 seconds.'}
          </p>
        </div>

        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>TARGET AUDIENCE & SUITABILITY</div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-primary)', margin: 0, fontWeight: 500 }}>
            YouTube Shorts, TikTok, Instagram Reels (Tech & Founders)
          </p>
        </div>

        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>ESTIMATED WATCH TIME</div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--accent-viral)', margin: 0, fontWeight: 600 }}>
            84% Completion Rate (High Virality)
          </p>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-4)' }}>
        {selectedClip.video_url ? (
          <a
            href={`http://localhost:5001${selectedClip.video_url}`}
            download={`${selectedClip.title.replace(/\s+/g, '_')}.mp4`}
            style={{
              display: 'block',
              textAlign: 'center',
              backgroundColor: 'var(--accent-viral)',
              color: '#000',
              padding: 'var(--space-3)',
              borderRadius: '6px',
              fontWeight: 700,
              fontSize: 'var(--text-sm)',
              textDecoration: 'none',
              boxShadow: '0 4px 14px rgba(34, 197, 94, 0.4)',
            }}
          >
            Download Rendered MP4 Clip
          </a>
        ) : (
          <button
            onClick={handleRenderClip}
            disabled={isRendering}
            style={{
              width: '100%',
              backgroundColor: isRendering ? 'var(--accent-warning)' : 'var(--accent-primary)',
              color: '#fff',
              padding: 'var(--space-3)',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: 'var(--text-sm)',
              cursor: isRendering ? 'not-allowed' : 'pointer',
            }}
          >
            {isRendering ? 'Rendering 9:16 MP4 Clip...' : 'Approve & Render MP4 Clip'}
          </button>
        )}
      </div>
    </aside>
  );
};

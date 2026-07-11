import React from 'react';

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

interface AIInspectorPanelProps {
  selectedClip: ClipData | null;
  onExportClip: (clipId: string) => void;
}

export const AIInspectorPanel: React.FC<AIInspectorPanelProps> = ({ selectedClip, onExportClip }) => {
  if (!selectedClip) {
    return (
      <aside
        style={{
          width: '320px',
          borderLeft: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-surface)',
          padding: 'var(--space-6)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-sm)',
        }}
      >
        Select a clip candidate to view AI virality metrics & rationale.
      </aside>
    );
  }

  const duration = (selectedClip.end_time - selectedClip.start_time).toFixed(1);

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
          AI CANDIDATE INSPECTOR
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
            Score: {selectedClip.score}/100
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
            Duration: {duration}s
          </span>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-4)' }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-1)' }}>
          HOOK RATIONALE & VIRALITY ANALYSIS
        </div>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {selectedClip.hook_rationale || 'AI identified strong narrative coherence and immediate opening hook density.'}
        </p>
      </div>

      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-4)' }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
          EXPORT & DOWNLOADS
        </div>
        {selectedClip.video_url ? (
          <a
            href={selectedClip.video_url}
            download
            style={{
              display: 'block',
              textAlign: 'center',
              backgroundColor: 'var(--accent-viral)',
              color: '#000',
              padding: 'var(--space-3)',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: 'var(--text-sm)',
              textDecoration: 'none',
            }}
          >
            Download Rendered Clip (MP4)
          </a>
        ) : (
          <button
            onClick={() => onExportClip(selectedClip.id)}
            style={{
              width: '100%',
              backgroundColor: 'var(--accent-primary)',
              color: '#fff',
              padding: 'var(--space-3)',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: 'var(--text-sm)',
            }}
          >
            Trigger Clip Render
          </button>
        )}
      </div>
    </aside>
  );
};

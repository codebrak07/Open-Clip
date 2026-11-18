import React, { useState } from 'react';
import { usePlaybackStore, type PlaybackStore } from '../../store/usePlaybackStore';

export interface ClipSeoPackage {
  yt_title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  hook_narration?: string;
  intro_duration?: number;
  preview_start?: number;
}

export interface ClipData {
  id: string;
  title: string;
  start_time: number;
  end_time: number;
  score: number;
  hook_rationale: string;
  video_url?: string;
  subtitles_url?: string;
  yt_title?: string;
  description?: string;
  tags?: string[];
  hashtags?: string[];
  hook_narration?: string;
  intro_duration?: number;
  seo?: ClipSeoPackage | null;
}

interface ClipReviewCardProps {
  clip: ClipData;
  isSelected: boolean;
  onSelect: () => void;
}

export const ClipReviewCard: React.FC<ClipReviewCardProps> = ({ clip, isSelected, onSelect }) => {
  const duration = (clip.end_time - clip.start_time).toFixed(1);
  const previewClip = usePlaybackStore((state: PlaybackStore) => state.previewClip);
  const [showSeo, setShowSeo] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const ytTitle = clip.seo?.yt_title || clip.yt_title || clip.title;
  const description = clip.seo?.description || clip.description || '';
  const tags = clip.seo?.tags || clip.tags || [];
  const hashtags = clip.seo?.hashtags || clip.hashtags || [];
  const hasSeo = Boolean(description || tags.length > 0 || hashtags.length > 0);

  const copyText = (e: React.MouseEvent, key: string, text: string) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 1500);
  };

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

      {hasSeo && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              onClick={() => setShowSeo((v) => !v)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-primary)',
                fontSize: '11px',
                fontWeight: 600,
                padding: 0,
                cursor: 'pointer',
              }}
            >
              {showSeo ? '▾ Hide YT SEO' : '▸ YT Title, Tags & Description'}
            </button>
            <button
              type="button"
              onClick={(e) =>
                copyText(
                  e,
                  'all',
                  `TITLE:\n${ytTitle}\n\nDESCRIPTION:\n${description}\n\nHASHTAGS:\n${hashtags.join(' ')}\n\nTAGS:\n${tags.join(', ')}`
                )
              }
              style={{
                backgroundColor: 'var(--bg-canvas)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                borderRadius: '4px',
                padding: '2px 7px',
                fontSize: '10px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {copiedField === 'all' ? '✓ Copied SEO' : 'Copy All SEO'}
            </button>
          </div>

          {showSeo && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '10px' }}>
                  <span>YT TITLE</span>
                  <button type="button" onClick={(e) => copyText(e, 'title', ytTitle)} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '10px' }}>
                    {copiedField === 'title' ? '✓' : 'Copy'}
                  </button>
                </div>
                <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{ytTitle}</div>
              </div>
              {description && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '10px' }}>
                    <span>DESCRIPTION</span>
                    <button type="button" onClick={(e) => copyText(e, 'desc', description)} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '10px' }}>
                      {copiedField === 'desc' ? '✓' : 'Copy'}
                    </button>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.35 }}>{description}</div>
                </div>
              )}
              {hashtags.length > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '10px' }}>
                    <span>HASHTAGS</span>
                    <button type="button" onClick={(e) => copyText(e, 'hash', hashtags.join(' '))} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '10px' }}>
                      {copiedField === 'hash' ? '✓' : 'Copy'}
                    </button>
                  </div>
                  <div style={{ color: 'var(--accent-primary)', wordBreak: 'break-word' }}>{hashtags.join(' ')}</div>
                </div>
              )}
              {tags.length > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '10px' }}>
                    <span>SEO TAGS ({tags.length})</span>
                    <button type="button" onClick={(e) => copyText(e, 'tags', tags.join(', '))} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '10px' }}>
                      {copiedField === 'tags' ? '✓' : 'Copy'}
                    </button>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '10px' }}>{tags.join(', ')}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

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

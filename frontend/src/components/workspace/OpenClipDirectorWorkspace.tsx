import React, { useState } from 'react';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import type { ClipData } from './ClipReviewCard';
import { API_BASE_URL } from '../../config';


interface EditorialWorkspaceProps {
  clips: ClipData[];
  onUploadClick: () => void;
  isUploading: boolean;
  onGenerateMaster: () => void;
}

export const OpenClipDirectorWorkspace: React.FC<EditorialWorkspaceProps> = ({
  clips,
  isUploading,
  onGenerateMaster,
}) => {

  const { sourceVideoUrl, activeClip, previewClip, aspectRatio, setAspectRatio, isMuted, toggleMute } = usePlaybackStore();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);

  const [selectedFormat, setSelectedFormat] = useState('TIKTOK');
  const [waveformZoom, setWaveformZoom] = useState(50);

  // Local editable SEO overrides keyed by clip.id so edits & custom AI regenerations reflect instantly
  const [seoOverrides, setSeoOverrides] = useState<Record<string, {
    yt_title: string;
    description: string;
    tags: string[];
    hashtags: string[];
    hook_narration: string;
  }>>({});
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editHashtags, setEditHashtags] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editHookNarration, setEditHookNarration] = useState('');
  const [customMomentPrompt, setCustomMomentPrompt] = useState('');
  const [seoBusy, setSeoBusy] = useState<'idle' | 'saving' | 'regenerating'>('idle');
  const [seoFeedback, setSeoFeedback] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const resolveClipSeo = React.useCallback((clip: ClipData | null | undefined) => {
    if (!clip) {
      return { yt_title: '', description: '', tags: [] as string[], hashtags: [] as string[], hook_narration: '' };
    }
    const ov = seoOverrides[clip.id];
    if (ov) return ov;
    return {
      yt_title: clip.seo?.yt_title || clip.yt_title || clip.title || '',
      description: clip.seo?.description || clip.description || '',
      tags: clip.seo?.tags || clip.tags || [],
      hashtags: clip.seo?.hashtags || clip.hashtags || [],
      hook_narration: clip.seo?.hook_narration || clip.hook_narration || '',
    };
  }, [seoOverrides]);

  React.useEffect(() => {
    if (!activeClip && clips.length > 0) {
      previewClip(clips[0]);
    }
  }, [activeClip, clips, previewClip]);

  const currentClip = activeClip || (clips.length > 0 ? clips[0] : null);

  React.useEffect(() => {
    if (!currentClip) return;
    const seo = resolveClipSeo(currentClip);
    setEditTitle(seo.yt_title);
    setEditDescription(seo.description);
    setEditHashtags(seo.hashtags.join(' '));
    setEditTags(seo.tags.join(', '));
    setEditHookNarration(seo.hook_narration);
    setSeoFeedback(null);
  }, [currentClip?.id, resolveClipSeo]);

  const copySeoField = (key: string, value: string) => {
    navigator.clipboard?.writeText(value).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleSaveCustomSeo = async () => {
    if (!currentClip) return;
    setSeoBusy('saving');
    setSeoFeedback(null);
    const parsedTags = editTags.split(',').map((t) => t.trim().replace(/^#+/, '').toLowerCase()).filter(Boolean);
    const parsedHashtags = editHashtags
      .split(/[\s,]+/)
      .map((h) => h.trim().replace(/^#+/, ''))
      .filter(Boolean)
      .map((h) => `#${h.toLowerCase()}`);

    try {
      const resp = await fetch(`${API_BASE_URL}/api/clips/${encodeURIComponent(currentClip.id)}/seo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yt_title: editTitle.trim(),
          description: editDescription.trim(),
          tags: parsedTags,
          hashtags: parsedHashtags,
          hook_narration: editHookNarration.trim(),
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const saved = {
          yt_title: data.yt_title || editTitle.trim(),
          description: data.description ?? editDescription.trim(),
          tags: Array.isArray(data.tags) ? data.tags : parsedTags,
          hashtags: Array.isArray(data.hashtags) ? data.hashtags : parsedHashtags,
          hook_narration: data.hook_narration ?? editHookNarration.trim(),
        };
        setSeoOverrides((prev) => ({ ...prev, [currentClip.id]: saved }));
        setSeoFeedback('✓ Saved custom SEO to clip & .seo.json');
      } else {
        setSeoFeedback('✗ Could not save SEO');
      }
    } catch {
      setSeoFeedback('✗ Network error saving SEO');
    } finally {
      setSeoBusy('idle');
    }
  };

  const handleRegenerateCustomSeo = async () => {
    if (!currentClip) return;
    setSeoBusy('regenerating');
    setSeoFeedback(null);
    try {
      const resp = await fetch(`${API_BASE_URL}/api/clips/${encodeURIComponent(currentClip.id)}/seo/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customContext: customMomentPrompt.trim(),
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const nextSeo = {
          yt_title: data.yt_title || editTitle,
          description: data.description || editDescription,
          tags: Array.isArray(data.tags) ? data.tags : [],
          hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
          hook_narration: data.hook_narration || editHookNarration,
        };
        setSeoOverrides((prev) => ({ ...prev, [currentClip.id]: nextSeo }));
        setEditTitle(nextSeo.yt_title);
        setEditDescription(nextSeo.description);
        setEditTags(nextSeo.tags.join(', '));
        setEditHashtags(nextSeo.hashtags.join(' '));
        setEditHookNarration(nextSeo.hook_narration);
        setSeoFeedback('✨ Custom YouTube SEO regenerated!');
      } else {
        setSeoFeedback('✗ Regeneration failed');
      }
    } catch {
      setSeoFeedback('✗ Network error regenerating SEO');
    } finally {
      setSeoBusy('idle');
    }
  };

  const confidenceScore = activeClip ? activeClip.score : 88;
  const firstClip = clips.length > 0 ? clips[0] : null;
  const inferredJobId = firstClip?.id?.includes('_clip_') ? firstClip.id.split('_clip_')[0] : null;
  const fallbackJobStream = inferredJobId ? `${API_BASE_URL}/api/jobs/${inferredJobId}/video` : undefined;

  const rawVideoSrc = activeClip?.video_url || sourceVideoUrl || fallbackJobStream;
  const currentVideoSrc = rawVideoSrc
    ? rawVideoSrc.startsWith('blob:') || rawVideoSrc.startsWith('http')
      ? rawVideoSrc
      : `${API_BASE_URL}${rawVideoSrc}`
    : undefined;

  const activeStartTime = activeClip ? activeClip.start_time : 0;

  const activeEndTime = activeClip ? activeClip.end_time : 10;
  const clipDuration = Math.max(1, activeEndTime - activeStartTime);

  const formatTime = (seconds: number): string => {
    const totalSec = Math.round(seconds);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const isStandaloneClip = Boolean(activeClip?.video_url && activeClip.video_url.includes('/outputs/'));

  const handleSelectClip = (clip: ClipData) => {
    previewClip(clip);
    const clipIsStandalone = Boolean(clip.video_url && clip.video_url.includes('/outputs/'));
    if (videoRef.current && !clipIsStandalone) {
      videoRef.current.currentTime = clip.start_time;
      videoRef.current.play().catch(() => {});
    }
  };



  return (
    <div
      style={{
        flex: 1,
        backgroundColor: '#F7F5F0',
        color: '#1C1C18',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Playfair Display', Georgia, serif",
        overflowY: 'auto',
        minHeight: '100vh',
      }}
    >
      {/* Dynamic Processing Status Banner */}
      <div
        style={{
          backgroundColor: '#121212',
          color: '#FAF8F3',
          padding: '12px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '12px',
          fontFamily: "'Inter', sans-serif",
          fontWeight: 600,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#059669' }} />
          <span>
            {isUploading
              ? '⚡ Uploading footage...'
              : clips.length > 0
              ? `✅ Analysis Complete • Active Cut Segment: ${formatTime(activeStartTime)} to ${formatTime(activeEndTime)} (${formatTime(clipDuration)} duration)`
              : '🔄 Processing Pipeline: Whisper Transcription ➔ Speaker Reframing ➔ Virality Scoring...'}
          </span>
        </div>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#059669', fontSize: '11px' }}>
          DAG SCHEDULER ACTIVE
        </span>
      </div>

      {/* Main Glassmorphic Canvas Layout */}
      <div style={{ flex: 1, maxWidth: '1360px', width: '100%', margin: '0 auto', padding: '32px', display: 'grid', gridTemplateColumns: '1fr 380px', gap: '32px' }}>
        
        {/* Left Column (Hero Player + Real Extracted Clips) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          
          {/* Main Video Preview Frame */}
          <div
            style={{
              backgroundColor: '#EBE6DA',
              border: '1px solid #D8D2C2',
              borderRadius: '20px',
              padding: '20px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.03)',
            }}
          >
            {/* Top Toolbar Overlay */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', fontFamily: "'Inter', sans-serif" }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#059669' }} />
                <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: '#555', textTransform: 'uppercase' }}>
                  {activeClip ? `ACTIVE CUT PREVIEW (${formatTime(activeStartTime)} - ${formatTime(activeEndTime)})` : 'FULL VIDEO PREVIEW'}
                </span>
              </div>
              
              {/* Aspect Ratio Switcher Buttons */}
              <div style={{ display: 'flex', backgroundColor: '#DFD9CB', padding: '3px', borderRadius: '8px', gap: '2px' }}>
                {(['9:16', '16:9', '1:1'] as const).map((ratio) => (
                  <button
                    key={ratio}
                    onClick={() => setAspectRatio(ratio as any)}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      backgroundColor: aspectRatio === ratio ? '#FAF8F3' : 'transparent',
                      color: aspectRatio === ratio ? '#121212' : '#666',
                      border: 'none',
                      cursor: 'pointer',
                      boxShadow: aspectRatio === ratio ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                    }}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>

            {/* Video Screen Container */}
            <div
              style={{
                position: 'relative',
                aspectRatio: aspectRatio === '9:16' ? '9/16' : aspectRatio === '1:1' ? '1/1' : '16/9',
                maxHeight: '520px',
                margin: '0 auto',
                backgroundColor: '#0c0e12',
                borderRadius: '14px',
                overflow: 'hidden',
                boxShadow: 'inset 0 0 20px rgba(0,0,0,0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              {currentVideoSrc ? (
                <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <video
                    ref={videoRef}
                    key={currentVideoSrc}
                    src={currentVideoSrc}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'pointer' }}
                    controls
                    autoPlay
                    loop={isStandaloneClip}
                    playsInline
                    preload="auto"
                    muted={isMuted}
                    onClick={() => {
                      if (videoRef.current) {
                        if (videoRef.current.paused) {
                          videoRef.current.play().catch(() => {});
                        } else {
                          videoRef.current.pause();
                        }
                      }
                    }}
                    onLoadedMetadata={() => {
                      if (videoRef.current && activeClip) {
                        if (!isStandaloneClip) {
                          videoRef.current.currentTime = activeClip.start_time;
                        }
                        videoRef.current.play().catch(() => {});
                      }
                    }}
                    onTimeUpdate={() => {
                      if (videoRef.current && activeClip && !isStandaloneClip) {
                        if (videoRef.current.currentTime >= activeClip.end_time) {
                          videoRef.current.currentTime = activeClip.start_time;
                          videoRef.current.play().catch(() => {});
                        }
                      }
                    }}
                  />
                  {isMuted && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMute();
                        if (videoRef.current) {
                          videoRef.current.muted = false;
                          videoRef.current.play().catch(() => {});
                        }
                      }}
                      style={{
                        position: 'absolute',
                        top: '12px',
                        right: '12px',
                        backgroundColor: 'rgba(0, 0, 0, 0.75)',
                        color: '#FFF',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        borderRadius: '20px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontFamily: "'Inter', sans-serif",
                        fontWeight: 600,
                        cursor: 'pointer',
                        backdropFilter: 'blur(4px)',
                        zIndex: 10,
                      }}
                    >
                      🔇 Click to Unmute
                    </button>
                  )}
                </div>
              ) : clips.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888', gap: '12px', padding: '40px' }}>
                  <span style={{ fontSize: '32px' }}>⚡</span>
                  <p style={{ fontFamily: "'Inter', sans-serif", fontSize: '14px', color: '#FAF8F3' }}>Synchronizing video stream...</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#888', gap: '12px', padding: '40px' }}>
                  <span style={{ fontSize: '32px' }}>🎬</span>
                  <p style={{ fontFamily: "'Inter', sans-serif", fontSize: '14px' }}>Upload a video file to begin automated processing</p>
                </div>
              )}
            </div>
          </div>

          {/* Extracted Viral Clips Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <h3 style={{ fontSize: '24px', fontWeight: 700, color: '#121212', margin: 0 }}>Extracted Viral Moments</h3>
              <p style={{ fontSize: '13px', fontFamily: "'Inter', sans-serif", color: '#666', margin: '4px 0 0 0' }}>Click any card below to play cut video segment</p>
            </div>

            {/* Candidate Cards Grid with Micro-Animation Hover Effects */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {clips.length > 0 ? (
                clips.map((clip) => {
                  const isSelected = activeClip?.id === clip.id;
                  const isHovered = hoveredClipId === clip.id;

                  return (
                    <div
                      key={clip.id}
                      onClick={() => handleSelectClip(clip)}
                      onMouseEnter={() => setHoveredClipId(clip.id)}
                      onMouseLeave={() => setHoveredClipId(null)}
                      style={{
                        backgroundColor: isSelected ? '#FAF8F3' : isHovered ? '#FFF' : '#FAF8F3',
                        border: isSelected ? '2px solid #121212' : isHovered ? '2px solid #059669' : '1px solid #D8D2C2',
                        borderRadius: '16px',
                        padding: '16px',
                        cursor: 'pointer',
                        transform: isHovered ? 'translateY(-4px) scale(1.03)' : 'translateY(0) scale(1)',
                        boxShadow: isHovered ? '0 12px 28px rgba(0,0,0,0.12)' : isSelected ? '0 6px 20px rgba(0,0,0,0.08)' : '0 4px 12px rgba(0,0,0,0.03)',
                        transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span
                          style={{
                            backgroundColor: isSelected ? '#121212' : '#059669',
                            color: '#fff',
                            fontSize: '11px',
                            fontFamily: "'Inter', sans-serif",
                            fontWeight: 700,
                            padding: '3px 10px',
                            borderRadius: '12px',
                            transition: 'all 0.2s ease',
                          }}
                        >
                          {clip.score}% FIT
                        </span>
                        <span style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: '#666' }}>
                          {formatTime(clip.start_time)} - {formatTime(clip.end_time)}
                        </span>
                      </div>
                      <h4
                        style={{
                          fontSize: '14px',
                          fontWeight: 700,
                          color: '#121212',
                          margin: 0,
                          lineHeight: 1.35,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {resolveClipSeo(clip).yt_title || clip.title}
                      </h4>
                      <p style={{ fontSize: '12px', fontFamily: "'Inter', sans-serif", color: '#666', margin: 0 }}>
                        {formatTime(clip.end_time - clip.start_time)} Cut • Retention Peak
                      </p>
                      {resolveClipSeo(clip).hashtags.length > 0 && (
                        <div style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", color: '#047857', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {resolveClipSeo(clip).hashtags.slice(0, 4).join(' ')}
                        </div>
                      )}
                    </div>
                  );
                })

              ) : (
                <div style={{ gridColumn: 'span 3', padding: '32px', backgroundColor: '#FAF8F3', borderRadius: '16px', border: '1px border #D8D2C2', textAlign: 'center', color: '#666', fontFamily: "'Inter', sans-serif", fontSize: '13px' }}>
                  {isUploading ? 'Extracting candidate clips...' : 'No clips generated yet. Upload a video file to run automated analysis.'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column (AI Director Insights Panel) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div
            style={{
              backgroundColor: '#FAF8F3',
              border: '1px solid #D8D2C2',
              borderRadius: '20px',
              padding: '24px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
              display: 'flex',
              flexDirection: 'column',
              gap: '24px',
            }}
          >
            {/* Big Score Header */}
            <div style={{ borderBottom: '1px solid #E2DEC5', paddingBottom: '20px' }}>
              <div style={{ fontSize: '11px', fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: '0.08em', color: '#666', textTransform: 'uppercase', marginBottom: '6px' }}>
                ✨ AI DIRECTOR INSIGHTS
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                {clips.length > 0 ? (
                  <>
                    <span style={{ fontSize: '64px', fontWeight: 700, color: '#121212', lineHeight: 1 }}>{confidenceScore}</span>
                    <span style={{ fontSize: '28px', color: '#121212' }}>%</span>
                  </>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0' }}>
                    <div
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        border: '3px solid #121212',
                        borderTopColor: 'transparent',
                        animation: 'spin 1s linear infinite',
                      }}
                    />
                    <span style={{ fontSize: '18px', fontFamily: "'Inter', sans-serif", fontWeight: 600, color: '#555' }}>
                      Analyzing Viral Hooks...
                    </span>
                  </div>
                )}
              </div>



              <p style={{ fontSize: '13px', fontFamily: "'Inter', sans-serif", color: '#666', margin: '8px 0 0 0', fontWeight: 500 }}>
                {clips.length > 0 ? 'Overall Audience Fit Confidence' : 'Multimodal Engine Evaluating Scene Motion & Audio Energy'}
              </p>
            {/* YouTube SEO Package & Custom Moment Generator for Active Clip */}
            {currentClip && (
              <div
                style={{
                  borderTop: '1px solid #E2DEC5',
                  paddingTop: '16px',
                  marginTop: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  fontFamily: "'Inter', sans-serif",
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <label style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', color: '#121212', textTransform: 'uppercase' }}>
                    🎯 YOUTUBE SEO · TITLE, TAGS & DESCRIPTION
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const allText = [
                        `TITLE:\n${editTitle}`,
                        `\nDESCRIPTION:\n${editDescription}`,
                        editHashtags ? `\nHASHTAGS:\n${editHashtags}` : '',
                        editTags ? `\nTAGS:\n${editTags}` : '',
                      ].filter(Boolean).join('\n');
                      copySeoField('all', allText);
                    }}
                    style={{
                      padding: '4px 9px',
                      borderRadius: '6px',
                      backgroundColor: '#121212',
                      color: '#FAF8F3',
                      border: 'none',
                      fontSize: '10px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {copiedKey === 'all' ? '✓ Copied All' : 'Copy All SEO'}
                  </button>
                </div>

                {/* Custom "What Happened with Streamer?" Generator */}
                <div
                  style={{
                    backgroundColor: '#FFF',
                    border: '1px solid #D8D2C2',
                    borderRadius: '10px',
                    padding: '9px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                  }}
                >
                  <span style={{ fontSize: '10px', fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    ✨ CUSTOMIZE: WHAT HAPPENED IN THIS CLIP?
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      value={customMomentPrompt}
                      onChange={(e) => setCustomMomentPrompt(e.target.value)}
                      placeholder="e.g. IShowSpeed freaked out when GTA 6 charged him rent..."
                      style={{
                        flex: 1,
                        fontSize: '11px',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        border: '1px solid #D8D2C2',
                        backgroundColor: '#FAF8F3',
                        color: '#121212',
                        outline: 'none',
                      }}
                    />
                    <button
                      type="button"
                      disabled={seoBusy !== 'idle'}
                      onClick={handleRegenerateCustomSeo}
                      style={{
                        padding: '6px 10px',
                        borderRadius: '6px',
                        backgroundColor: '#044e39',
                        color: '#FFF',
                        border: 'none',
                        fontSize: '10px',
                        fontWeight: 700,
                        cursor: seoBusy !== 'idle' ? 'wait' : 'pointer',
                        whiteSpace: 'nowrap',
                        opacity: seoBusy !== 'idle' ? 0.7 : 1,
                      }}
                    >
                      {seoBusy === 'regenerating' ? 'Generating...' : '✨ Custom SEO'}
                    </button>
                  </div>
                </div>

                {/* AI Male Hook Intro Line */}
                {editHookNarration && (
                  <div
                    style={{
                      backgroundColor: '#FFFBEB',
                      border: '1px solid #FDE68A',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: '#92400E' }}>🎙️ AI MALE HOOK VOICEOVER</span>
                      <button
                        type="button"
                        onClick={() => copySeoField('hook', editHookNarration)}
                        style={{ fontSize: '10px', background: 'transparent', border: 'none', color: '#92400E', fontWeight: 700, cursor: 'pointer' }}
                      >
                        {copiedKey === 'hook' ? '✓' : 'Copy'}
                      </button>
                    </div>
                    <input
                      type="text"
                      value={editHookNarration}
                      onChange={(e) => setEditHookNarration(e.target.value)}
                      style={{
                        fontSize: '11px',
                        color: '#78350F',
                        backgroundColor: 'transparent',
                        border: 'none',
                        outline: 'none',
                        width: '100%',
                        fontWeight: 600,
                      }}
                    />
                  </div>
                )}

                {/* Editable YouTube Title */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#555' }}>
                      YOUTUBE TITLE ({editTitle.length}/95)
                    </span>
                    <button
                      type="button"
                      onClick={() => copySeoField('title', editTitle)}
                      style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '4px', border: '1px solid #D8D2C2', backgroundColor: '#FFF', cursor: 'pointer', fontWeight: 600 }}
                    >
                      {copiedKey === 'title' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={editTitle}
                    maxLength={95}
                    onChange={(e) => setEditTitle(e.target.value)}
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      padding: '7px 9px',
                      borderRadius: '7px',
                      border: '1px solid #D8D2C2',
                      backgroundColor: '#FFF',
                      color: '#121212',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* Editable YouTube Description */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#555' }}>DESCRIPTION</span>
                    <button
                      type="button"
                      onClick={() => copySeoField('desc', editDescription)}
                      style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '4px', border: '1px solid #D8D2C2', backgroundColor: '#FFF', cursor: 'pointer', fontWeight: 600 }}
                    >
                      {copiedKey === 'desc' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    style={{
                      fontSize: '11px',
                      lineHeight: 1.45,
                      padding: '7px 9px',
                      borderRadius: '7px',
                      border: '1px solid #D8D2C2',
                      backgroundColor: '#FFF',
                      color: '#121212',
                      resize: 'vertical',
                      outline: 'none',
                      fontFamily: "'Inter', sans-serif",
                    }}
                  />
                </div>

                {/* Editable Hashtags */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#555' }}>HASHTAGS</span>
                    <button
                      type="button"
                      onClick={() => copySeoField('hashtags', editHashtags)}
                      style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '4px', border: '1px solid #D8D2C2', backgroundColor: '#FFF', cursor: 'pointer', fontWeight: 600 }}
                    >
                      {copiedKey === 'hashtags' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={editHashtags}
                    onChange={(e) => setEditHashtags(e.target.value)}
                    placeholder="#shorts #ishowspeed #gta6 #live"
                    style={{
                      fontSize: '11px',
                      fontFamily: "'JetBrains Mono', monospace",
                      padding: '6px 9px',
                      borderRadius: '7px',
                      border: '1px solid #D8D2C2',
                      backgroundColor: '#FFF',
                      color: '#047857',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* Editable SEO Tags */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#555' }}>
                      SEO TAGS ({editTags.length}/500 chars)
                    </span>
                    <button
                      type="button"
                      onClick={() => copySeoField('tags', editTags)}
                      style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '4px', border: '1px solid #D8D2C2', backgroundColor: '#FFF', cursor: 'pointer', fontWeight: 600 }}
                    >
                      {copiedKey === 'tags' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    placeholder="ishowspeed, gta 6, viral clip, shorts..."
                    style={{
                      fontSize: '11px',
                      lineHeight: 1.4,
                      padding: '6px 9px',
                      borderRadius: '7px',
                      border: '1px solid #D8D2C2',
                      backgroundColor: '#FFF',
                      color: '#333',
                      resize: 'vertical',
                      outline: 'none',
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  />
                </div>

                {/* Save Custom Edits Button + Status */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <button
                    type="button"
                    disabled={seoBusy !== 'idle'}
                    onClick={handleSaveCustomSeo}
                    style={{
                      padding: '7px 12px',
                      borderRadius: '7px',
                      backgroundColor: '#121212',
                      color: '#FFF',
                      border: 'none',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: seoBusy !== 'idle' ? 'wait' : 'pointer',
                    }}
                  >
                    {seoBusy === 'saving' ? 'Saving...' : '💾 Save Custom SEO'}
                  </button>
                  {seoFeedback && (
                    <span style={{ fontSize: '11px', fontWeight: 600, color: seoFeedback.startsWith('✗') ? '#B42318' : '#059669' }}>
                      {seoFeedback}
                    </span>
                  )}
                </div>
              </div>
            )}

            </div>

            {/* Open Source Multimodal Tech Stack Engine Specs */}
            <div style={{ borderTop: '1px solid #E2DEC5', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '10px', fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: '0.1em', color: '#666', textTransform: 'uppercase', display: 'block' }}>
                ⚡ OPEN SOURCE ENGINE STACK
              </label>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', fontFamily: "'Inter', sans-serif" }}>
                {[
                  { name: 'FFmpeg', free: '✅ Yes', note: 'Completely open source render engine' },
                  { name: 'OpenCV', free: '✅ Yes', note: 'Open source computer vision library' },
                  { name: 'MediaPipe', free: '✅ Yes', note: 'Free face & active speaker tracking' },
                  { name: 'Whisper (local)', free: '✅ Yes', note: 'Run on local PC • Zero API cost' },
                  { name: 'WhisperX', free: '✅ Yes', note: 'Open source local word alignment' },
                ].map((comp) => (
                  <div
                    key={comp.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      backgroundColor: '#FFF',
                      border: '1px solid #E2DEC5',
                      borderRadius: '6px',
                      padding: '6px 10px',
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 700, color: '#121212' }}>{comp.name}</span>
                      <span style={{ display: 'block', fontSize: '10px', color: '#666' }}>{comp.note}</span>
                    </div>
                    <span style={{ fontWeight: 700, color: '#059669', fontSize: '10px', backgroundColor: 'rgba(5,150,105,0.08)', padding: '2px 6px', borderRadius: '4px' }}>
                      {comp.free}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Format Distribution Preset Selection */}
            <div>
              <label style={{ fontSize: '10px', fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: '0.1em', color: '#666', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
                OPTIMIZED FOR
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', fontSize: '12px', fontFamily: "'Inter', sans-serif" }}>
                {['REELS', 'TIKTOK', 'SHORTS'].map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => setSelectedFormat(fmt)}
                    style={{
                      padding: '8px',
                      borderRadius: '8px',
                      border: selectedFormat === fmt ? '1px solid #121212' : '1px solid #D8D2C2',
                      backgroundColor: selectedFormat === fmt ? '#121212' : '#FFF',
                      color: selectedFormat === fmt ? '#FFF' : '#444',
                      fontWeight: selectedFormat === fmt ? 600 : 500,
                      textAlign: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>


            {/* Generate Final Master CTA Button & Download Link */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={() => {
                  onGenerateMaster();
                  setIsDownloadModalOpen(true);
                }}
                style={{
                  backgroundColor: '#044e39',
                  color: '#FFF',
                  fontFamily: "'Inter', sans-serif",
                  fontWeight: 700,
                  fontSize: '14px',
                  padding: '14px',
                  borderRadius: '12px',
                  border: 'none',
                  boxShadow: '0 4px 14px rgba(4, 78, 57, 0.3)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                <span>🎬</span> RENDER FINAL MASTER VIDEO
              </button>

              {clips.length > 0 && (
                <button
                  onClick={() => {
                    const clipId = activeClip?.id || clips[0]?.id;
                    if (clipId) {
                      window.location.href = `${API_BASE_URL}/api/clips/${clipId}/download`;
                    } else if (inferredJobId) {
                      window.location.href = `${API_BASE_URL}/api/jobs/${inferredJobId}/download`;
                    }
                  }}
                  style={{
                    backgroundColor: '#121212',
                    color: '#FFF',
                    fontFamily: "'Inter', sans-serif",
                    fontWeight: 600,
                    fontSize: '12px',
                    padding: '10px',
                    borderRadius: '8px',
                    textAlign: 'center',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <span>⬇️</span> Download Current Clip ({selectedFormat})
                </button>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* Confirmation Popup Modal for Direct Video Download */}
      {isDownloadModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: '#FAF8F3',
              border: '1px solid #D8D2C2',
              borderRadius: '24px',
              padding: '32px',
              maxWidth: '440px',
              width: '90%',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              fontFamily: "'Inter', sans-serif",
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>🎬</div>
            <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#121212', margin: '0 0 8px 0' }}>
              Download Master Video?
            </h3>
            <p style={{ fontSize: '13px', color: '#666', margin: '0 0 24px 0', lineHeight: 1.5 }}>
              Are you sure you want to download <strong>"{activeClip?.title}"</strong> in <strong>{selectedFormat}</strong> format?
            </p>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={() => setIsDownloadModalOpen(false)}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '10px',
                  border: '1px solid #D8D2C2',
                  backgroundColor: '#FFF',
                  color: '#444',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                No, Cancel
              </button>
              <button
                onClick={() => {
                  setIsDownloadModalOpen(false);
                  const clipId = activeClip?.id || clips[0]?.id;
                  if (clipId) {
                    window.location.href = `${API_BASE_URL}/api/clips/${clipId}/download`;
                  } else if (inferredJobId) {
                    window.location.href = `${API_BASE_URL}/api/jobs/${inferredJobId}/download`;
                  } else if (currentVideoSrc) {
                    const downloadAnchor = document.createElement('a');
                    downloadAnchor.href = currentVideoSrc;
                    downloadAnchor.download = `OpenClip_${activeClip?.title || 'Master'}.mp4`;
                    document.body.appendChild(downloadAnchor);
                    downloadAnchor.click();
                    document.body.removeChild(downloadAnchor);
                  }
                }}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: '#044e39',
                  color: '#FFF',
                  fontWeight: 700,
                  fontSize: '13px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(4,78,57,0.3)',
                }}
              >
                Yes, Download Now
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Bottom Timeline Section (Dynamic Time-Clipped Waveform Bar) */}
      <div
        style={{
          backgroundColor: '#FAF8F3',
          borderTop: '1px solid #E2DEC5',
          padding: '24px',
          maxWidth: '1360px',
          width: '100%',
          margin: '0 auto 32px auto',
          borderRadius: '20px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.02)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', fontFamily: "'Inter', sans-serif", fontWeight: 600, color: '#121212' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>⚙️ Cut Timeline Segment:</span>
            <span style={{ color: '#059669', fontFamily: "'JetBrains Mono', monospace" }}>
              {formatTime(activeStartTime)} ➔ {formatTime(activeEndTime)} ({formatTime(clipDuration)} duration)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: '#666' }}>
            <span>TIMELINE ZOOM</span>
            <input
              type="range"
              min="10"
              max="100"
              value={waveformZoom}
              onChange={(e) => setWaveformZoom(Number(e.target.value))}
              style={{ width: '100px' }}
            />
          </div>
        </div>

        {/* Dynamic Waveform Visualizer for Cut Segment */}
        <div
          style={{
            backgroundColor: '#EBE6DA',
            borderRadius: '12px',
            padding: '16px',
            height: '90px',
            position: 'relative',
            overflowX: 'auto',
            overflowY: 'hidden',
            display: 'flex',
            alignItems: 'center',
            border: '1px solid #D8D2C2',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: '3px',
              width: `${Math.max(100, waveformZoom * 2)}%`,
              height: '100%',
              padding: '0 8px',
              transition: 'width 0.2s ease',
            }}
          >
            {(() => {
              const totalBars = Math.floor(waveformZoom * 1.5);
              const videoDuration = videoRef.current?.duration || 0;
              const maxClipEnd = clips.reduce((max, c) => Math.max(max, c.end_time), 0);
              const totalDuration = videoDuration > 0 ? videoDuration : Math.max(10, maxClipEnd);

              return Array.from({ length: totalBars }).map((_, i) => {
                const barTime = (i / totalBars) * totalDuration;
                const isCutSegment = barTime >= activeStartTime && barTime <= activeEndTime;
                const heightPct = Math.sin(i * 0.25) * 40 + 50;

                return (
                  <div
                    key={i}
                    style={{
                      height: `${heightPct}%`,
                      flex: '1 0 3px',
                      borderRadius: '3px',
                      backgroundColor: isCutSegment ? '#059669' : '#C7C1B2',
                      transition: 'all 0.2s ease',
                    }}
                  />
                );
              });
            })()}
          </div>
          {(() => {
            const videoDuration = videoRef.current?.duration || 0;
            const maxClipEnd = clips.reduce((max, c) => Math.max(max, c.end_time), 0);
            const totalDuration = videoDuration > 0 ? videoDuration : Math.max(10, maxClipEnd);
            const playheadPercent = Math.min(98, Math.max(1, (activeStartTime / totalDuration) * 100));

            return (
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${playheadPercent}%`,
                  width: '3px',
                  backgroundColor: '#121212',
                  boxShadow: '0 0 8px rgba(0,0,0,0.3)',
                  pointerEvents: 'none',
                  zIndex: 10,
                  transition: 'left 0.2s ease',
                }}
              />
            );
          })()}
        </div>

      </div>
    </div>
  );
};



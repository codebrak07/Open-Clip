import React, { useState } from 'react';
import { API_BASE_URL } from '../../config';
import type { ClipData } from '../workspace/ClipReviewCard';
import { usePlaybackStore } from '../../store/usePlaybackStore';

interface StudioHubProps {
  onUploadClick: () => void;
  isUploading: boolean;
  onYouTubeImport?: (jobId: string, clips?: ClipData[]) => void;
  onOpenDirectorWorkspace?: (jobId?: string) => void;
  onNavigateToFootball?: () => void;
}

interface VideoMetadata {
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string;
  view_count: number;
  video_id: string;
  is_live?: boolean;
}

type IngestionState = 'idle' | 'probing' | 'loaded' | 'processing' | 'done' | 'error';
type LiveCaptureMode = 'live_and_behind' | 'live' | 'behind';

export const StudioHub: React.FC<StudioHubProps> = ({
  onUploadClick,
  isUploading,
  onYouTubeImport,
  onOpenDirectorWorkspace,
  onNavigateToFootball,
}) => {
  const [selectedRatio, setSelectedRatio] = useState<string>('9:16');
  const [captionStyle, setCaptionStyle] = useState<string>('Hormozi');
  const [aiProvider, setAiProvider] = useState<string>('nvidia');
  const [targetClipCount, setTargetClipCount] = useState<number>(5);
  const [youtubeUrl, setYoutubeUrl] = useState<string>('');
  const [liveMode, setLiveMode] = useState<LiveCaptureMode>('live_and_behind');
  const [dvrBehindSec, setDvrBehindSec] = useState<number>(900);

  // Video ingestion & completion states
  const [ingestionState, setIngestionState] = useState<IngestionState>('idle');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [videoMeta, setVideoMeta] = useState<VideoMetadata | null>(null);
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);
  const [extractedClips, setExtractedClips] = useState<ClipData[]>([]);
  const [expandedSeoId, setExpandedSeoId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [aiHookIntro, setAiHookIntro] = useState<boolean>(true);
  const [narratorVoice, setNarratorVoice] = useState<string>('en-US-ChristopherNeural');

  const handleCopySeo = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const aspectRatios = [
    { id: '9:16', label: '9:16 Vertical', desc: 'TikTok, Reels, Shorts' },
    { id: '16:9', label: '16:9 Landscape', desc: 'YouTube Standard' },
    { id: '1:1', label: '1:1 Square', desc: 'Feed & Carousel' },
    { id: '4:5', label: '4:5 Portrait', desc: 'Instagram Feed' },
    { id: '3:4', label: '3:4 Frame', desc: 'Social Feeds' },
    { id: '21:9', label: '21:9 Ultrawide', desc: 'Cinematic' },
  ];

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleImport = async (targetUrl?: string) => {
    const url = (targetUrl || youtubeUrl).trim();
    if (!url) return;

    setIngestionState('probing');
    setProgressPercent(20);
    setStatusMessage('Inspecting remote stream & loading metadata via Python engine...');

    try {
      // Step 1: Probe metadata fast
      const probeRes = await fetch(`${API_BASE_URL}/api/jobs/youtube/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      let meta: VideoMetadata = {
        title: 'YouTube Stream',
        uploader: 'YouTube Creator',
        duration: 210,
        thumbnail: 'https://i.ytimg.com/vi/q6fgVVmdpgY/hqdefault.jpg',
        view_count: 1420000,
        video_id: 'video',
      };

      if (probeRes.ok) {
        const probeData = await probeRes.json();
        if (probeData.metadata) {
          meta = {
            title: probeData.metadata.title || meta.title,
            uploader: probeData.metadata.uploader || meta.uploader,
            duration: probeData.metadata.duration || meta.duration,
            thumbnail: probeData.metadata.thumbnail || meta.thumbnail,
            view_count: probeData.metadata.view_count || meta.view_count,
            video_id: probeData.metadata.video_id || meta.video_id,
            is_live: Boolean(probeData.metadata.is_live),
          };
        }
      }

      setVideoMeta(meta);
      setIngestionState('loaded');
      setProgressPercent(45);
      setStatusMessage(
        meta.is_live
          ? '● LIVE Stream Detected · Cutting live edge + DVR rewind clips & transcribing speech...'
          : '● Video Loaded · Demuxing high-speed 1080p streams & extracting 16kHz audio...'
      );

      // Step 2: High-speed import & viral clip generation via Python
      setIngestionState('processing');
      setProgressPercent(70);
      setStatusMessage(
        meta.is_live
          ? '⚡ Capturing live & behind-live DVR segments + generating captions...'
          : '⚡ Analyzing virality retention hooks & speech alignment...'
      );

      const importRes = await fetch(`${API_BASE_URL}/api/jobs/youtube/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          provider: aiProvider,
          aspectRatio: selectedRatio,
          captionStyle: captionStyle,
          clipCount: targetClipCount,
          liveMode,
          dvrBehindSec,
          aiHookIntro,
          narratorVoice,
        }),
      });

      if (importRes.ok) {
        const importData = await importRes.json();
        const jobId = importData.jobId || `job_${Date.now()}`;
        const clips: ClipData[] = (importData.clips || []).map((c: any, idx: number) => ({
          id: c.id || `${jobId}_clip_${idx + 1}`,
          start_time: c.start_time ?? (idx * 20),
          end_time: c.end_time ?? (idx * 20 + 15),
          score: c.score ?? 90,
          title: c.yt_title || c.title || `Clip ${idx + 1}`,
          hook_rationale: c.hook_rationale || 'High-retention hook detected by AI Director.',
          video_url: c.video_url,
          subtitles_url: c.subtitles_url,
          yt_title: c.yt_title || c.seo?.yt_title || c.title,
          description: c.description || c.seo?.description || '',
          tags: c.tags || c.seo?.tags || [],
          hashtags: c.hashtags || c.seo?.hashtags || [],
          hook_narration: c.hook_narration || c.seo?.hook_narration || '',
          intro_duration: c.intro_duration || c.seo?.intro_duration || 0,
          seo: c.seo || null,
        }));

        setCreatedJobId(jobId);
        setExtractedClips(clips);
        setProgressPercent(100);
        setIngestionState('done');
        setStatusMessage(`✓ Work is done! ${clips.length} 1080p HD clips with ${captionStyle} captions`);

        // Immediately update playback store with the real extracted 1080p HD clip stream & aspect ratio
        if (selectedRatio === '9:16' || selectedRatio === '16:9') {
          usePlaybackStore.getState().setAspectRatio(selectedRatio);
        }
        const primaryUrl = clips[0]?.video_url || importData.video_url || `/api/jobs/${jobId}/video`;
        const fullStreamUrl = primaryUrl.startsWith('http') ? primaryUrl : `${API_BASE_URL}${primaryUrl}`;
        usePlaybackStore.getState().setSourceVideoUrl(fullStreamUrl);
        if (clips.length > 0) {
          usePlaybackStore.getState().previewClip(clips[0]);
        }

        if (onYouTubeImport) {
          onYouTubeImport(jobId, clips);
        }
      } else {
        const errBody = await importRes.json().catch(() => ({}));
        throw new Error(errBody.error || 'Import request returned error');
      }
    } catch (err: any) {
      console.error('[StudioHub Import Error]', err);
      setIngestionState('error');
      setProgressPercent(0);
      const rawMsg = String(err?.message || 'Unable to extract video stream');
      const lines = rawMsg.split('\n').map((l) => l.trim()).filter(Boolean);
      const concise = lines.length > 0 ? lines[lines.length - 1].slice(0, 180) : rawMsg.slice(0, 180);
      setStatusMessage(`✕ Import failed: ${concise}`);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pastedText = e.clipboardData.getData('text').trim();
    if (pastedText && (pastedText.includes('youtube.com') || pastedText.includes('youtu.be'))) {
      e.preventDefault();
      setYoutubeUrl(pastedText);
      handleImport(pastedText);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        width: '100%',
        backgroundColor: '#F5F4F0',
        color: '#171717',
        padding: '56px 32px',
        overflowY: 'auto',
      }}
    >
      {/* Editorial Hero Header */}
      <div
        style={{
          maxWidth: '1080px',
          margin: '0 auto 48px auto',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            fontSize: '11px',
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            letterSpacing: '0.14em',
            color: '#C99E35',
            backgroundColor: '#FFFFFF',
            padding: '6px 18px',
            borderRadius: '999px',
            border: '1px solid #DFDDD5',
            marginBottom: '20px',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.03)',
          }}
        >
          ✨ OPENCLIP AI · VIRAL CLIP FACTORY
        </div>

        <h1
          style={{
            fontSize: '52px',
            fontWeight: 800,
            color: '#171717',
            margin: '0 0 16px 0',
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
          }}
        >
          Intelligent Video Studio & Viral Engine
        </h1>

        <p
          style={{
            color: '#62615D',
            fontSize: '17px',
            maxWidth: '720px',
            margin: '0 0 32px 0',
            lineHeight: 1.6,
          }}
        >
          Transform long-form podcasts, educational videos, and matches into high-retention short clips with smart reframing, Hormozi captions, and explainable virality scores.
        </p>

        {/* Dual Workflow Switcher Buttons */}
        <div style={{ display: 'flex', gap: '14px', marginBottom: '40px' }}>
          <button
            onClick={onUploadClick}
            disabled={isUploading}
            style={{
              backgroundColor: '#171717',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: '14px',
              padding: '12px 28px',
              borderRadius: '8px',
              border: 'none',
              cursor: isUploading ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.1)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ color: '#C99E35' }}>⚡</span> {isUploading ? 'Uploading Video...' : 'Upload Video File'}
          </button>

          {onNavigateToFootball && (
            <button
              onClick={onNavigateToFootball}
              style={{
                backgroundColor: '#FFFFFF',
                color: '#171717',
                fontWeight: 600,
                fontSize: '14px',
                padding: '12px 28px',
                borderRadius: '8px',
                border: '1px solid #DFDDD5',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.03)',
              }}
            >
              <span>⚽</span> Switch to Football Studio
            </button>
          )}
        </div>
      </div>

      {/* Main Studio Controls Grid */}
      <div
        style={{
          maxWidth: '1080px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '1.2fr 1fr',
          gap: '32px',
        }}
      >
        {/* Left Column: Input Sources (Upload / YouTube) */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #DFDDD5',
            borderRadius: '16px',
            padding: '32px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#171717', margin: '0 0 20px 0' }}>
            Media Ingestion
          </h2>

          {/* YouTube Link Ingestion */}
          <div style={{ marginBottom: '24px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', monospace",
                color: '#898781',
                marginBottom: '8px',
              }}
            >
              IMPORT YOUTUBE URL OR LIVE STREAM (yt-dlp)
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                onPaste={handlePaste}
                placeholder="https://www.youtube.com/watch?v=... or /live/..."
                style={{
                  flex: 1,
                  backgroundColor: '#F9F9F8',
                  border: '1px solid #DFDDD5',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  color: '#171717',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
              <button
                onClick={() => handleImport()}
                disabled={ingestionState === 'probing' || ingestionState === 'processing'}
                style={{
                  backgroundColor: '#171717',
                  color: '#FFFFFF',
                  padding: '0 20px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: ingestionState === 'probing' || ingestionState === 'processing' ? 'not-allowed' : 'pointer',
                  opacity: ingestionState === 'probing' || ingestionState === 'processing' ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {ingestionState === 'probing' || ingestionState === 'processing' ? 'Loading...' : 'Import'}
              </button>
            </div>

            {/* Live + Behind (DVR) controls when a live URL or live stream is active */}
            {(youtubeUrl.toLowerCase().includes('/live/') || videoMeta?.is_live) && (
              <div
                style={{
                  marginTop: '10px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  backgroundColor: '#FFF7F5',
                  border: '1px solid #F3D1C8',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  fontSize: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: '#B42318' }}>
                  <span>● LIVE DVR</span>
                  {([
                    { id: 'live_and_behind', label: 'Live + Behind' },
                    { id: 'live', label: 'Live Edge' },
                    { id: 'behind', label: 'Behind Only' },
                  ] as const).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setLiveMode(m.id)}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '6px',
                        border: liveMode === m.id ? '1px solid #B42318' : '1px solid #E5D4CE',
                        backgroundColor: liveMode === m.id ? '#B42318' : '#FFFFFF',
                        color: liveMode === m.id ? '#FFFFFF' : '#4A4945',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                {liveMode !== 'live' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#62615D' }}>
                    <span style={{ fontSize: '11px' }}>Lookback:</span>
                    {[
                      { sec: 300, label: '5m' },
                      { sec: 900, label: '15m' },
                      { sec: 1800, label: '30m' },
                      { sec: 3600, label: '60m' },
                    ].map((w) => (
                      <button
                        key={w.sec}
                        type="button"
                        onClick={() => setDvrBehindSec(w.sec)}
                        style={{
                          padding: '3px 7px',
                          borderRadius: '5px',
                          border: dvrBehindSec === w.sec ? '1px solid #171717' : '1px solid #DFDDD5',
                          backgroundColor: dvrBehindSec === w.sec ? '#171717' : '#FFFFFF',
                          color: dvrBehindSec === w.sec ? '#FFFFFF' : '#4A4945',
                          fontSize: '11px',
                          cursor: 'pointer',
                        }}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Drag & Drop File Zone */}
          <div
            onClick={onUploadClick}
            style={{
              border: '2px dashed #DFDDD5',
              borderRadius: '12px',
              padding: '36px 20px',
              textAlign: 'center',
              backgroundColor: '#F9F9F8',
              cursor: 'pointer',
              transition: 'border-color 0.2s ease',
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📁</div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#171717', marginBottom: '4px' }}>
              Drop video file here or click to browse
            </div>
            <div style={{ fontSize: '12px', color: '#62615D' }}>
              MP4, MOV, MKV, WebM up to 4GB · Auto 16kHz speech extraction
            </div>
          </div>

          {/* Bottom Ingestion Status Card: Appears immediately when URL is pasted or imported */}
          {ingestionState !== 'idle' && (
            <div
              style={{
                marginTop: '24px',
                padding: '20px',
                borderRadius: '12px',
                backgroundColor: '#FBFBFA',
                border: '1px solid #DFDDD5',
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.03)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              {/* Header Status Badge Row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {ingestionState === 'done' ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        backgroundColor: '#ECFDF5',
                        color: '#047857',
                        border: '1px solid #A7F3D0',
                        padding: '4px 12px',
                        borderRadius: '999px',
                        fontSize: '11px',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      ✓ WORK IS DONE
                    </span>
                  ) : (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        backgroundColor: '#FFFBEB',
                        color: '#B45309',
                        border: '1px solid #FDE68A',
                        padding: '4px 12px',
                        borderRadius: '999px',
                        fontSize: '11px',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      ● VIDEO LOADED
                    </span>
                  )}

                  <span
                    style={{
                      fontSize: '12px',
                      color: ingestionState === 'done' ? '#047857' : '#62615D',
                      fontWeight: 600,
                    }}
                  >
                    {ingestionState === 'done'
                      ? `${extractedClips.length} Real HD Clips Ready`
                      : ingestionState === 'error'
                      ? 'Extraction Error'
                      : ingestionState === 'loaded'
                      ? 'Stream Synchronized'
                      : `Extracting ${targetClipCount} HD Clips in Parallel...`}
                  </span>
                </div>

                <div
                  style={{
                    fontSize: '10px',
                    fontFamily: "'JetBrains Mono', monospace",
                    color: '#898781',
                    backgroundColor: '#FFFFFF',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    border: '1px solid #DFDDD5',
                  }}
                >
                  ⚡ PYTHON ENGINE
                </div>
              </div>

              {/* Video Metadata Preview */}
              {videoMeta && (
                <div
                  style={{
                    display: 'flex',
                    gap: '14px',
                    backgroundColor: '#FFFFFF',
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #DFDDD5',
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      position: 'relative',
                      width: '120px',
                      height: '68px',
                      borderRadius: '6px',
                      overflow: 'hidden',
                      backgroundColor: '#171717',
                      flexShrink: 0,
                    }}
                  >
                    <img
                      src={videoMeta.thumbnail}
                      alt={videoMeta.title}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=500&q=80';
                      }}
                    />
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '4px',
                        right: '4px',
                        backgroundColor: 'rgba(0, 0, 0, 0.75)',
                        color: '#FFFFFF',
                        fontSize: '10px',
                        fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: '3px',
                      }}
                    >
                      {formatDuration(videoMeta.duration)}
                    </div>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color: '#171717',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        marginBottom: '4px',
                      }}
                    >
                      {videoMeta.title}
                    </div>
                    <div style={{ fontSize: '12px', color: '#62615D', marginBottom: '4px' }}>
                      {videoMeta.uploader}
                    </div>
                    <div
                      style={{
                        fontSize: '10px',
                        fontFamily: "'JetBrains Mono', monospace",
                        color: '#898781',
                      }}
                    >
                      HD 720p Stream · 16kHz Audio · High Retention
                    </div>
                  </div>
                </div>
              )}

              {/* Live Progress Bar & Message */}
              <div>
                <div
                  style={{
                    height: '6px',
                    width: '100%',
                    backgroundColor: '#ECEAE4',
                    borderRadius: '999px',
                    overflow: 'hidden',
                    marginBottom: '8px',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${progressPercent}%`,
                      backgroundColor: ingestionState === 'done' ? '#059669' : '#C99E35',
                      borderRadius: '999px',
                      transition: 'width 0.4s ease, background-color 0.4s ease',
                    }}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    fontFamily: "'JetBrains Mono', monospace",
                    color: '#62615D',
                  }}
                >
                  <span>{statusMessage}</span>
                  <span style={{ fontWeight: 700, color: ingestionState === 'done' ? '#059669' : '#171717' }}>
                    {progressPercent}%
                  </span>
                </div>
              </div>

              {/* Extracted Clips Showcase (when done) */}
              {ingestionState === 'done' && extractedClips.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                  <div
                    style={{
                      fontSize: '11px',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 700,
                      color: '#898781',
                      letterSpacing: '0.08em',
                    }}
                  >
                    EXTRACTED VIRAL CLIPS ({extractedClips.length})
                  </div>

                  {extractedClips.map((c, i) => {
                    const cid = c.id || String(i);
                    const ytTitle = c.seo?.yt_title || c.yt_title || c.title;
                    const desc = c.seo?.description || c.description || '';
                    const tags = c.seo?.tags || c.tags || [];
                    const hashtags = c.seo?.hashtags || c.hashtags || [];
                    const hasSeo = Boolean(desc || tags.length > 0 || hashtags.length > 0);
                    const isOpen = expandedSeoId === cid || (expandedSeoId === null && i === 0);

                    return (
                      <div
                        key={cid}
                        style={{
                          padding: '10px 12px',
                          borderRadius: '8px',
                          backgroundColor: '#FFFFFF',
                          border: '1px solid #DFDDD5',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '12px', fontWeight: 700, color: '#171717' }}>
                              {ytTitle}
                            </div>
                            <div
                              style={{
                                fontSize: '10px',
                                fontFamily: "'JetBrains Mono', monospace",
                                color: '#898781',
                                marginTop: '2px',
                              }}
                            >
                              {formatDuration(c.start_time)} - {formatDuration(c.end_time)} · {c.hook_rationale?.slice(0, 56)}
                            </div>
                            {(c.hook_narration || c.seo?.hook_narration) && (
                              <div
                                style={{
                                  marginTop: '4px',
                                  fontSize: '10px',
                                  color: '#92400E',
                                  backgroundColor: '#FFFBEB',
                                  border: '1px solid #FDE68A',
                                  borderRadius: '5px',
                                  padding: '3px 7px',
                                  display: 'inline-block',
                                }}
                              >
                                🎙️ AI Intro ({Number(c.intro_duration || c.seo?.intro_duration || 3).toFixed(1)}s): “{c.hook_narration || c.seo?.hook_narration}”
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {hasSeo && (
                              <button
                                type="button"
                                onClick={() => setExpandedSeoId(isOpen ? '__none__' : cid)}
                                style={{
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  backgroundColor: '#F5F4F0',
                                  border: '1px solid #DFDDD5',
                                  color: '#171717',
                                  fontSize: '10px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {isOpen ? '▾ YT SEO' : '▸ YT SEO'}
                              </button>
                            )}
                            <div
                              style={{
                                padding: '3px 8px',
                                borderRadius: '999px',
                                backgroundColor: '#FFFBEB',
                                border: '1px solid #FDE68A',
                                color: '#B45309',
                                fontSize: '11px',
                                fontWeight: 700,
                                fontFamily: "'JetBrains Mono', monospace",
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {c.score} Score
                            </div>
                          </div>
                        </div>

                        {hasSeo && isOpen && (
                          <div
                            style={{
                              padding: '10px',
                              borderRadius: '6px',
                              backgroundColor: '#F9F9F7',
                              border: '1px solid #E7E5DF',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px',
                              fontSize: '11px',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '10px', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#62615D' }}>
                                YOUTUBE SEO PACKAGE
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopySeo(
                                    `${cid}_all`,
                                    `TITLE:\n${ytTitle}\n\nDESCRIPTION:\n${desc}\n\nHASHTAGS:\n${hashtags.join(' ')}\n\nTAGS:\n${tags.join(', ')}`
                                  )
                                }
                                style={{
                                  padding: '3px 8px',
                                  borderRadius: '5px',
                                  border: '1px solid #171717',
                                  backgroundColor: '#171717',
                                  color: '#FFFFFF',
                                  fontSize: '10px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                {copiedKey === `${cid}_all` ? '✓ Copied All' : 'Copy All SEO'}
                              </button>
                            </div>

                            {/* YT Title */}
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#898781', marginBottom: '2px' }}>
                                <span>TITLE</span>
                                <button type="button" onClick={() => handleCopySeo(`${cid}_t`, ytTitle)} style={{ background: 'none', border: 'none', color: '#B45309', fontWeight: 600, fontSize: '10px', cursor: 'pointer' }}>
                                  {copiedKey === `${cid}_t` ? '✓ Copied' : 'Copy'}
                                </button>
                              </div>
                              <div style={{ color: '#171717', fontWeight: 600 }}>{ytTitle}</div>
                            </div>

                            {/* Description */}
                            {desc && (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#898781', marginBottom: '2px' }}>
                                  <span>DESCRIPTION</span>
                                  <button type="button" onClick={() => handleCopySeo(`${cid}_d`, desc)} style={{ background: 'none', border: 'none', color: '#B45309', fontWeight: 600, fontSize: '10px', cursor: 'pointer' }}>
                                    {copiedKey === `${cid}_d` ? '✓ Copied' : 'Copy'}
                                  </button>
                                </div>
                                <div style={{ color: '#4A4945', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{desc}</div>
                              </div>
                            )}

                            {/* Hashtags */}
                            {hashtags.length > 0 && (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#898781', marginBottom: '4px' }}>
                                  <span>HASHTAGS</span>
                                  <button type="button" onClick={() => handleCopySeo(`${cid}_h`, hashtags.join(' '))} style={{ background: 'none', border: 'none', color: '#B45309', fontWeight: 600, fontSize: '10px', cursor: 'pointer' }}>
                                    {copiedKey === `${cid}_h` ? '✓ Copied' : 'Copy'}
                                  </button>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                  {hashtags.map((h, hi) => (
                                    <span key={hi} style={{ padding: '2px 7px', borderRadius: '999px', backgroundColor: '#EEF2FF', color: '#3730A3', fontSize: '10px', fontWeight: 600 }}>
                                      {h}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* SEO Tags */}
                            {tags.length > 0 && (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#898781', marginBottom: '4px' }}>
                                  <span>SEO TAGS ({tags.length})</span>
                                  <button type="button" onClick={() => handleCopySeo(`${cid}_g`, tags.join(', '))} style={{ background: 'none', border: 'none', color: '#B45309', fontWeight: 600, fontSize: '10px', cursor: 'pointer' }}>
                                    {copiedKey === `${cid}_g` ? '✓ Copied' : 'Copy'}
                                  </button>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                  {tags.map((t, ti) => (
                                    <span key={ti} style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: '#FFFFFF', border: '1px solid #DFDDD5', color: '#4A4945', fontSize: '10px' }}>
                                      {t}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Primary CTA Button: Open in Director Workspace */}
                  <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                    <button
                      onClick={() => {
                        if (createdJobId) {
                          usePlaybackStore.getState().setSourceVideoUrl(`${API_BASE_URL}/api/jobs/${createdJobId}/video`);
                          if (extractedClips.length > 0) {
                            usePlaybackStore.getState().previewClip(extractedClips[0]);
                          }
                        }
                        if (onOpenDirectorWorkspace) {
                          onOpenDirectorWorkspace(createdJobId || undefined);
                        }
                      }}
                      style={{
                        flex: 1,
                        backgroundColor: '#171717',
                        color: '#FFFFFF',
                        fontSize: '13px',
                        fontWeight: 700,
                        padding: '12px 18px',
                        borderRadius: '8px',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                      }}
                    >
                      <span>Open in Director Workspace</span>
                      <span>→</span>
                    </button>

                    <button
                      onClick={() => {
                        setIngestionState('idle');
                        setYoutubeUrl('');
                        setVideoMeta(null);
                        setExtractedClips([]);
                      }}
                      style={{
                        backgroundColor: '#FFFFFF',
                        color: '#62615D',
                        fontSize: '12px',
                        fontWeight: 600,
                        padding: '12px 16px',
                        borderRadius: '8px',
                        border: '1px solid #DFDDD5',
                        cursor: 'pointer',
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Processing Presets & AI Options */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #DFDDD5',
            borderRadius: '16px',
            padding: '32px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
          }}
        >
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#171717', margin: 0 }}>
            Studio Presets
          </h2>

          {/* Aspect Ratio Selection */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', monospace",
                color: '#898781',
                marginBottom: '8px',
              }}
            >
              TARGET ASPECT RATIO (SMART REFRAME)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              {aspectRatios.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRatio(r.id)}
                  style={{
                    padding: '10px 8px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: selectedRatio === r.id ? 'rgba(201, 158, 53, 0.1)' : '#F9F9F8',
                    color: selectedRatio === r.id ? '#C99E35' : '#62615D',
                    border: selectedRatio === r.id ? '1.5px solid #C99E35' : '1px solid #DFDDD5',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{r.id}</div>
                  <div style={{ fontSize: '10px', color: '#898781', fontWeight: 400, marginTop: '2px' }}>
                    {r.id === '9:16' ? 'Vertical' : r.id === '16:9' ? 'Wide' : 'Square'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Caption Style */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', monospace",
                color: '#898781',
                marginBottom: '8px',
              }}
            >
              BURNT-IN CAPTION STYLE
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                { id: 'KaraokePop', label: '✨ Karaoke Pop', desc: '1-word Times Serif · neon glow + vertical smear' },
                { id: 'Kinetic', label: '🌈 Kinetic Lime/Cyan', desc: '1-word 1-color · vertical blur in/out' },
                { id: 'Hormozi', label: '🟡 Hormozi Amber', desc: 'Bold white + amber punchline' },
                { id: 'Minimalist', label: '⚪ Minimalist', desc: 'Clean editorial fade' },
                { id: 'Banner', label: '⬛ Subtitle Bar', desc: 'Dark pill container' },
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setCaptionStyle(s.id)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'left',
                    gridColumn: s.id === 'KaraokePop' ? 'span 2' : undefined,
                    backgroundColor: captionStyle === s.id ? 'rgba(201, 158, 53, 0.1)' : '#F9F9F8',
                    color: captionStyle === s.id ? '#171717' : '#62615D',
                    border: captionStyle === s.id ? '1.5px solid #C99E35' : '1px solid #DFDDD5',
                  }}
                >
                  <div style={{ fontWeight: 700, color: captionStyle === s.id ? '#A67C1E' : '#171717' }}>{s.label}</div>
                  <div style={{ fontSize: '10px', color: '#898781', fontWeight: 400, marginTop: '2px' }}>{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Target Clip Quantity */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', monospace",
                color: '#898781',
                marginBottom: '8px',
              }}
            >
              TARGET CLIP QUANTITY (HOW MANY CLIPS)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) 1.2fr', gap: '8px' }}>
              {[3, 5, 8, 10].map((num) => (
                <button
                  key={num}
                  onClick={() => setTargetClipCount(num)}
                  style={{
                    padding: '10px 8px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: targetClipCount === num ? 'rgba(201, 158, 53, 0.1)' : '#F9F9F8',
                    color: targetClipCount === num ? '#C99E35' : '#62615D',
                    border: targetClipCount === num ? '1.5px solid #C99E35' : '1px solid #DFDDD5',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{num} Clips</div>
                  <div style={{ fontSize: '10px', color: '#898781', fontWeight: 400, marginTop: '2px' }}>
                    {num === 3 ? 'Fast 3' : num === 5 ? 'Popular 5' : num === 8 ? 'Deep 8' : 'Max 10'}
                  </div>
                </button>
              ))}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: '#F9F9F8',
                  border: '1px solid #DFDDD5',
                  borderRadius: '8px',
                  padding: '0 8px',
                }}
              >
                <span style={{ fontSize: '11px', color: '#898781', marginRight: '4px' }}>Qty:</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={targetClipCount}
                  onChange={(e) => setTargetClipCount(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))}
                  style={{
                    width: '100%',
                    backgroundColor: 'transparent',
                    border: 'none',
                    outline: 'none',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: '#171717',
                    textAlign: 'center',
                  }}
                />
              </div>
            </div>
          </div>

          {/* Cold-Open Preview + Male AI Narrator Hook Intro */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <label
                style={{
                  fontSize: '11px',
                  fontFamily: "'JetBrains Mono', monospace",
                  color: '#898781',
                }}
              >
                COLD-OPEN PREVIEW + AI MALE HOOK VOICE
              </label>
              <button
                type="button"
                onClick={() => setAiHookIntro(!aiHookIntro)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  backgroundColor: aiHookIntro ? '#171717' : '#F3F2EE',
                  color: aiHookIntro ? '#FFFFFF' : '#62615D',
                  border: aiHookIntro ? '1px solid #171717' : '1px solid #DFDDD5',
                }}
              >
                {aiHookIntro ? '● ON' : '○ OFF'}
              </button>
            </div>
            <div style={{ fontSize: '11px', color: '#62615D', marginBottom: aiHookIntro ? '8px' : '0' }}>
              Shows a peak preview flash first with a Male AI voiceover (“This is what happened when...”), then cuts right into the clip.
            </div>
            {aiHookIntro && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                {[
                  { id: 'en-US-ChristopherNeural', label: 'Christopher', desc: 'Deep Viral' },
                  { id: 'en-US-GuyNeural', label: 'Guy', desc: 'Energetic' },
                  { id: 'en-US-EricNeural', label: 'Eric', desc: 'Narrator' },
                ].map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setNarratorVoice(v.id)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '8px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'left',
                      backgroundColor: narratorVoice === v.id ? 'rgba(201, 158, 53, 0.1)' : '#F9F9F8',
                      color: narratorVoice === v.id ? '#A67C1E' : '#62615D',
                      border: narratorVoice === v.id ? '1.5px solid #C99E35' : '1px solid #DFDDD5',
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>🎙️ {v.label}</div>
                    <div style={{ fontSize: '10px', color: '#898781', fontWeight: 400 }}>{v.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* AI Reasoning Provider */}
          <div>
            <label
              style={{
                display: 'block',
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', monospace",
                color: '#898781',
                marginBottom: '8px',
              }}
            >
              CREATIVE DIRECTOR REASONING MODEL
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[
                { id: 'nvidia', label: 'NVIDIA NIM' },
                { id: 'groq', label: 'Groq LPU' },
                { id: 'gemini', label: 'Google Gemini' },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setAiProvider(p.id)}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: aiProvider === p.id ? '#171717' : '#F9F9F8',
                    color: aiProvider === p.id ? '#FFFFFF' : '#62615D',
                    border: aiProvider === p.id ? '1px solid #171717' : '1px solid #DFDDD5',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudioHub;

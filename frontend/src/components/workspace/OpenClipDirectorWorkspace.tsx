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
  const [selectedAudience, setSelectedAudience] = useState('LUXURY HUMANS');

  const [selectedFormat, setSelectedFormat] = useState('TIKTOK');
  const [waveformZoom, setWaveformZoom] = useState(50);

  React.useEffect(() => {
    if (!activeClip && clips.length > 0) {
      previewClip(clips[0]);
    }
  }, [activeClip, clips, previewClip]);

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

  const handleSelectClip = (clip: ClipData) => {
    previewClip(clip);
    if (videoRef.current) {
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
                    poster="https://i.ytimg.com/vi/q6fgVVmdpgY/hqdefault.jpg"
                    style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'pointer' }}
                    controls
                    autoPlay
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
                        videoRef.current.currentTime = activeClip.start_time;
                        videoRef.current.play().catch(() => {});
                      }
                    }}
                    onTimeUpdate={() => {
                      if (videoRef.current && activeClip) {
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
                      <h4 style={{ fontSize: '15px', fontWeight: 700, color: '#121212', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip.title}</h4>
                      <p style={{ fontSize: '12px', fontFamily: "'Inter', sans-serif", color: '#666', margin: 0 }}>{formatTime(clip.end_time - clip.start_time)} Cut • Retention Peak</p>
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
            {/* Dynamic Content & Audience Tags derived from Video Analysis */}
            <div>
              <label style={{ fontSize: '10px', fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: '0.1em', color: '#666', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
                DETECTED VIDEO CATEGORY & AUDIENCE
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '12px', fontFamily: "'Inter', sans-serif" }}>
                {(() => {
                  if (!clips || clips.length === 0) {
                    return ['ANALYZING CONTENT...'].map(t => (
                      <span key={t} style={{ padding: '6px 14px', borderRadius: '20px', backgroundColor: '#EBE6DA', color: '#666', fontSize: '11px', fontWeight: 600 }}>{t}</span>
                    ));
                  }

                  // Dynamically extract key words from actual video clips (title & rationale)
                  const words = clips
                    .flatMap(c => `${c.title} ${c.hook_rationale || ''}`.split(/\s+/))
                    .map(w => w.replace(/[^a-zA-Z]/g, '').toUpperCase())
                    .filter(w => w.length > 3 && !['FAST', 'WITH', 'THIS', 'THAT', 'FROM', 'THEIR', 'PEAK', 'HIGH', 'CUTS', 'BEST', 'BEAT'].includes(w));

                  const uniqueWords = Array.from(new Set(words)).slice(0, 4);
                  const dynamicTags = uniqueWords.length > 0 
                    ? uniqueWords.map(w => `${w} CONTENT`) 
                    : ['VIRAL VIDEO', 'HIGH RETENTION', 'GEN-Z EDIT'];

                  return dynamicTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setSelectedAudience(tag)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '20px',
                        border: selectedAudience === tag ? '1px solid #121212' : '1px solid #D8D2C2',
                        backgroundColor: selectedAudience === tag ? '#121212' : '#FFF',
                        color: selectedAudience === tag ? '#FFF' : '#444',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '11px',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      {tag}
                    </button>
                  ));
                })()}
              </div>
            </div>

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



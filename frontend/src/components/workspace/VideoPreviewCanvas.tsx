import React, { useRef, useEffect } from 'react';
import { usePlaybackStore } from '../../store/usePlaybackStore';

export const VideoPreviewCanvas: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);

  const {
    sourceVideoUrl,
    activeClip,
    currentTime,
    isPlaying,
    isLoopingSegment,
    aspectRatio,
    setAspectRatio,
    setCurrentTime,
    setIsPlaying,
  } = usePlaybackStore();

  // Priority URL: Rendered clip preferred, fallback to uploaded source video
  const activeUrl = activeClip?.video_url
    ? `http://localhost:5001${activeClip.video_url}`
    : sourceVideoUrl;

  // Synchronize Playback Controller state with HTMLVideoElement
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !activeUrl) return;

    if (isPlaying) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying, activeUrl]);

  // Handle Seek Updates from PlaybackController
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (Math.abs(video.currentTime - currentTime) > 0.3) {
      video.currentTime = currentTime;
    }
  }, [currentTime]);

  // Handle TimeUpdate event & Segment Bounding Loop
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    setCurrentTime(video.currentTime);

    // Segment bounding logic: if previewing a clip, enforce end_time
    if (activeClip && activeClip.end_time > 0 && !activeClip.video_url) {
      if (video.currentTime >= activeClip.end_time) {
        if (isLoopingSegment) {
          video.currentTime = activeClip.start_time;
        } else {
          video.pause();
          setIsPlaying(false);
        }
      }
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-canvas)',
        padding: 'var(--space-6)',
        position: 'relative',
      }}
    >
      {/* Aspect Ratio Switcher */}
      <div
        style={{
          position: 'absolute',
          top: 'var(--space-4)',
          right: 'var(--space-4)',
          display: 'flex',
          gap: 'var(--space-2)',
          backgroundColor: 'var(--bg-surface)',
          padding: 'var(--space-1)',
          borderRadius: '6px',
          border: '1px solid var(--border-subtle)',
          zIndex: 10,
        }}
      >
        <button
          onClick={() => setAspectRatio('9:16')}
          style={{
            padding: 'var(--space-1) var(--space-3)',
            borderRadius: '4px',
            fontSize: 'var(--text-xs)',
            backgroundColor: aspectRatio === '9:16' ? 'var(--bg-surface-active)' : 'transparent',
            color: aspectRatio === '9:16' ? 'var(--text-primary)' : 'var(--text-secondary)',
          }}
        >
          9:16 Vertical
        </button>
        <button
          onClick={() => setAspectRatio('16:9')}
          style={{
            padding: 'var(--space-1) var(--space-3)',
            borderRadius: '4px',
            fontSize: 'var(--text-xs)',
            backgroundColor: aspectRatio === '16:9' ? 'var(--bg-surface-active)' : 'transparent',
            color: aspectRatio === '16:9' ? 'var(--text-primary)' : 'var(--text-secondary)',
          }}
        >
          16:9 Original
        </button>
      </div>

      {/* Single Global HTMLVideoElement */}
      <div
        style={{
          width: aspectRatio === '9:16' ? '340px' : '680px',
          height: aspectRatio === '9:16' ? '600px' : '380px',
          backgroundColor: '#000',
          borderRadius: '12px',
          border: '1px solid var(--border-subtle)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all var(--duration-normal) var(--ease-apple)',
          boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
        }}
      >
        {activeUrl ? (
          <video
            ref={videoRef}
            src={activeUrl}
            onTimeUpdate={handleTimeUpdate}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            controls
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center', padding: 'var(--space-4)' }}>
            Upload video footage to begin AI preview playback.
          </div>
        )}
      </div>
    </div>
  );
};

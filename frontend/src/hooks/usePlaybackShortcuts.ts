import { useEffect } from 'react';
import { usePlaybackStore, type PlaybackStore } from '../store/usePlaybackStore';
import type { ClipData } from '../components/workspace/ClipReviewCard';

export function usePlaybackShortcuts(clips: ClipData[]) {
  const {
    toggle,
    pause,
    seekRelative,
    toggleLoop,
    toggleMute,
    previewClip,
    activeClip,
    approveClip,
    setFullscreen,
    isFullscreen,
  } = usePlaybackStore((state: PlaybackStore) => state);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (activeClip) approveClip(activeClip.id);
        return;
      }

      switch (e.key) {
        case ' ':
          if (e.shiftKey) {
            e.preventDefault();
            toggleLoop();
          } else {
            e.preventDefault();
            toggle();
          }
          break;
        case 'j':
        case 'J':
          e.preventDefault();
          seekRelative(-10);
          break;
        case 'k':
        case 'K':
          e.preventDefault();
          pause();
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          seekRelative(+10);
          break;
        case 'm':
        case 'M':
          if (e.shiftKey) {
            e.preventDefault();
            toggleMute();
          }
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          setFullscreen(!isFullscreen);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekRelative(-0.1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekRelative(+0.1);
          break;
        default:
          const num = parseInt(e.key, 10);
          if (!isNaN(num) && num >= 1 && num <= clips.length) {
            e.preventDefault();
            previewClip(clips[num - 1]);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle, pause, seekRelative, toggleLoop, toggleMute, previewClip, activeClip, approveClip, setFullscreen, isFullscreen, clips]);
}

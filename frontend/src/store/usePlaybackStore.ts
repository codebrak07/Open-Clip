import { create } from 'zustand';
import type { ClipData } from '../components/workspace/ClipReviewCard';

export interface PlaybackStore {
  sourceVideoUrl?: string;
  activeClip: ClipData | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  isLoopingSegment: boolean;
  playbackRate: number;
  aspectRatio: '9:16' | '16:9' | '1:1';

  isFullscreen: boolean;
  renderStatus?: string;
  approvedClipIds: string[];

  // Actions
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  seekRelative: (delta: number) => void;
  previewClip: (clip: ClipData) => void;
  toggleLoop: () => void;
  toggleMute: () => void;
  setVolume: (vol: number) => void;
  setAspectRatio: (aspect: '9:16' | '16:9') => void;
  setPlaybackRate: (rate: number) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (dur: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setSourceVideoUrl: (url: string) => void;
  setFullscreen: (full: boolean) => void;
  approveClip: (clipId: string) => void;
}

export const usePlaybackStore = create<PlaybackStore>((set) => ({
  sourceVideoUrl: undefined,
  activeClip: null,
  currentTime: 0,
  duration: 60,
  isPlaying: false,
  isMuted: false,
  volume: 1.0,
  isLoopingSegment: true,
  playbackRate: 1.0,
  aspectRatio: '9:16',
  isFullscreen: false,
  renderStatus: undefined,
  approvedClipIds: [],

  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  toggle: () => set((state: PlaybackStore) => ({ isPlaying: !state.isPlaying })),
  
  seek: (time: number) => {
    set({ currentTime: Math.max(0, time) });
  },

  seekRelative: (delta: number) => {
    set((state: PlaybackStore) => ({
      currentTime: Math.max(0, Math.min(state.duration, state.currentTime + delta)),
    }));
  },

  previewClip: (clip: ClipData) => {
    set({
      activeClip: clip,
      currentTime: clip.start_time,
      isPlaying: true,
    });
  },

  toggleLoop: () => set((state: PlaybackStore) => ({ isLoopingSegment: !state.isLoopingSegment })),
  toggleMute: () => set((state: PlaybackStore) => ({ isMuted: !state.isMuted })),
  setVolume: (vol: number) => set({ volume: Math.max(0, Math.min(1, vol)) }),
  setAspectRatio: (aspect: '9:16' | '16:9') => set({ aspectRatio: aspect }),
  setPlaybackRate: (rate: number) => set({ playbackRate: rate }),
  setCurrentTime: (time: number) => set({ currentTime: time }),
  setDuration: (dur: number) => set({ duration: dur }),
  setIsPlaying: (playing: boolean) => set({ isPlaying: playing }),
  setSourceVideoUrl: (url: string) => set({ sourceVideoUrl: url }),
  setFullscreen: (full: boolean) => set({ isFullscreen: full }),
  
  approveClip: (clipId: string) => {
    set((state: PlaybackStore) => ({
      approvedClipIds: state.approvedClipIds.includes(clipId)
        ? state.approvedClipIds
        : [...state.approvedClipIds, clipId],
    }));
  },
}));

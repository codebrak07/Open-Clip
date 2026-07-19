import React, { useState, useEffect } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { StudioHub } from './components/hub/StudioHub';
import { type ClipData } from './components/workspace/ClipReviewCard';
import { CommandPalette } from './components/command/CommandPalette';
import { OpenClipDirectorWorkspace } from './components/workspace/OpenClipDirectorWorkspace';
import { usePlaybackStore } from './store/usePlaybackStore';
import { usePlaybackShortcuts } from './hooks/usePlaybackShortcuts';

import { API_BASE_URL } from './config';

export function App() {
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [clips, setClips] = useState<ClipData[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const { activeClip, previewClip, setSourceVideoUrl } = usePlaybackStore();

  usePlaybackShortcuts(clips);

  useEffect(() => {
    if (!activeJobId) return;

    const interval = setInterval(async () => {
      try {
        const clipRes = await fetch(`${API_BASE_URL}/api/jobs/${activeJobId}/clips`);
        if (clipRes.ok) {
          const clipData = await clipRes.json();
          const fetchedClips = clipData.clips || [];
          setClips(fetchedClips);
          if (!activeClip && fetchedClips.length > 0) {
            previewClip(fetchedClips[0]);
          }
        }
      } catch (err) {
        console.error('Error polling job status:', err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [activeJobId, activeClip, previewClip]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const localUrl = URL.createObjectURL(file);
    setSourceVideoUrl(localUrl);

    setIsUploading(true);
    const formData = new FormData();
    formData.append('video', file);
    formData.append('provider', 'groq');

    try {
      const res = await fetch(`${API_BASE_URL}/api/jobs/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.jobId) {
        setActiveJobId(data.jobId);
      }
    } catch (err) {
      console.error('Failed to upload video:', err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleBatchRender = async () => {
    if (!activeJobId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/jobs/${activeJobId}/batch-render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minScore: 80, aspect: '9:16' }),
      });
      const data = await res.json();
      if (data.renderedClips && data.renderedClips.length > 0) {
        setClips((prev) =>
          prev.map((c) => {
            const found = data.renderedClips.find((r: any) => r.clipId === c.id);
            return found ? { ...c, video_url: found.video_url } : c;
          })
        );
      }
    } catch (err) {
      console.error('Batch render error:', err);
    }
  };





  return (
    <AppLayout onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}>
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectAction={(action) => console.log('Action selected:', action)}
      />

      {activeJobId || clips.length > 0 ? (
        <OpenClipDirectorWorkspace
          clips={clips}
          onUploadClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'video/*';
            input.onchange = (e: any) => handleFileUpload(e);
            input.click();
          }}
          isUploading={isUploading}
          onGenerateMaster={handleBatchRender}
        />
      ) : (
        <StudioHub
          onUploadClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'video/*';
            input.onchange = (e: any) => handleFileUpload(e);
            input.click();
          }}
          isUploading={isUploading}
        />
      )}
    </AppLayout>
  );
}

export default App;

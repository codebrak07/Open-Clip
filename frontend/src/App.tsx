import React, { useState, useEffect } from 'react';
import { AppLayout, type AppView } from './components/layout/AppLayout';
import { CinematicLandingHero } from './components/landing/CinematicLandingHero';
import { OrganicRibbonFlow } from './components/ribbon/OrganicRibbonFlow';
import { HorizontalChapterExploration } from './components/exploration/HorizontalChapterExploration';
import { ClosingThankYouSection } from './components/closing/ClosingThankYouSection';
import { StudioHub } from './components/hub/StudioHub';
import { FootballCreatorStudio } from './components/football/FootballCreatorStudio';
import { AIProvidersStudio } from './components/providers/AIProvidersStudio';
import { DiagnosticsStudio } from './components/DiagnosticsStudio';
import { OpenClipDirectorWorkspace } from './components/workspace/OpenClipDirectorWorkspace';
import { CommandPalette } from './components/command/CommandPalette';
import { type ClipData } from './components/workspace/ClipReviewCard';
import { usePlaybackStore } from './store/usePlaybackStore';
import { usePlaybackShortcuts } from './hooks/usePlaybackShortcuts';
import { API_BASE_URL } from './config';

export function App() {
  const [activeView, setActiveView] = useState<AppView>('journey');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [clips, setClips] = useState<ClipData[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const { activeClip, previewClip, setSourceVideoUrl } = usePlaybackStore();

  usePlaybackShortcuts(clips);

  useEffect(() => {
    if (!activeJobId) return;

    // Fetch job details to synchronize source video stream
    fetch(`${API_BASE_URL}/api/jobs/${activeJobId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.job?.video_url) {
          const fullUrl = data.job.video_url.startsWith('http')
            ? data.job.video_url
            : `${API_BASE_URL}${data.job.video_url}`;
          setSourceVideoUrl(fullUrl);
        }
      })
      .catch(() => {});

    const interval = setInterval(async () => {
      try {
        const clipRes = await fetch(`${API_BASE_URL}/api/jobs/${activeJobId}/clips`);
        if (clipRes.ok) {
          const clipData = await clipRes.json();
          const fetchedClips = clipData.clips || [];
          setClips(fetchedClips);
          if (!activeClip && fetchedClips.length > 0) {
            previewClip(fetchedClips[0]);
            if (fetchedClips[0].video_url) {
              const fullUrl = fetchedClips[0].video_url.startsWith('http')
                ? fetchedClips[0].video_url
                : `${API_BASE_URL}${fetchedClips[0].video_url}`;
              setSourceVideoUrl(fullUrl);
            }
          }
        }
      } catch (err) {
        console.error('Error polling job status:', err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [activeJobId, activeClip, previewClip, setSourceVideoUrl]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const localUrl = URL.createObjectURL(file);
    setSourceVideoUrl(localUrl);

    setIsUploading(true);
    const formData = new FormData();
    formData.append('video', file);
    formData.append('provider', 'nvidia');

    try {
      const res = await fetch(`${API_BASE_URL}/api/jobs/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.jobId) {
        setActiveJobId(data.jobId);
        setActiveView('workspace');
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

  const triggerFilePicker = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.onchange = (e: any) => handleFileUpload(e);
    input.click();
  };

  return (
    <AppLayout
      activeView={activeView}
      onSelectView={(v) => setActiveView(v as AppView)}
      onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
    >
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectAction={(action) => {
          if (action.includes('workspace')) setActiveView('workspace');
          else if (action.includes('football')) setActiveView('football-studio');
          else if (action.includes('diagnostics')) setActiveView('diagnostics');
          else if (action.includes('providers')) setActiveView('providers');
          else if (action.includes('upload')) triggerFilePicker();
        }}
      />

      {/* Main View Router */}
      {activeView === 'journey' && (
        <div style={{ width: '100%' }}>
          {/* 1. Cinematic Landing Page */}
          <CinematicLandingHero
            onEnterStudio={() => setActiveView('viral-factory')}
            onLaunchFootball={() => setActiveView('football-studio')}
            onExploreJourney={() => {
              const el = document.getElementById('ribbon-journey-section');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
          />

          {/* 2. Multidirectional Organic Ribbon Flow Journey */}
          <div id="ribbon-journey-section">
            <OrganicRibbonFlow
              onLaunchFactory={() => setActiveView('viral-factory')}
              onLaunchFootball={() => setActiveView('football-studio')}
            />
          </div>

          {/* 3. Horizontal Spatial Exploration Chapters */}
          <div id="horizontal-exploration-section">
            <HorizontalChapterExploration
              onOpenViralFactory={() => setActiveView('viral-factory')}
              onOpenFootballStudio={() => setActiveView('football-studio')}
              onOpenProviders={() => setActiveView('providers')}
              onOpenDirectorWorkspace={() => setActiveView('workspace')}
            />
          </div>

          {/* 4. Closing Intentional Conclusion & Trustworthy Footer */}
          <div id="closing-section">
            <ClosingThankYouSection
              onOpenViralFactory={() => setActiveView('viral-factory')}
              onOpenFootballStudio={() => setActiveView('football-studio')}
              onOpenProviders={() => setActiveView('providers')}
              onOpenDiagnostics={() => setActiveView('diagnostics')}
            />
          </div>
        </div>
      )}

      {activeView === 'viral-factory' && (
        <StudioHub
          onUploadClick={triggerFilePicker}
          isUploading={isUploading}
          onNavigateToFootball={() => setActiveView('football-studio')}
          onOpenDirectorWorkspace={(jobId) => {
            if (jobId) {
              setActiveJobId(jobId);
              setSourceVideoUrl(`${API_BASE_URL}/api/jobs/${jobId}/video`);
            }
            setActiveView('workspace');
          }}
          onYouTubeImport={(jobId, importedClips) => {
            if (jobId) {
              setActiveJobId(jobId);
              setSourceVideoUrl(`${API_BASE_URL}/api/jobs/${jobId}/video`);
            }
            if (importedClips && importedClips.length > 0) {
              setClips(importedClips);
              if (!activeClip) {
                previewClip(importedClips[0]);
              }
            }
          }}
        />
      )}

      {activeView === 'football-studio' && <FootballCreatorStudio />}

      {activeView === 'workspace' && (
        <OpenClipDirectorWorkspace
          clips={clips}
          onUploadClick={triggerFilePicker}
          isUploading={isUploading}
          onGenerateMaster={handleBatchRender}
        />
      )}

      {activeView === 'providers' && <AIProvidersStudio />}

      {activeView === 'diagnostics' && <DiagnosticsStudio />}
    </AppLayout>
  );
}

export default App;

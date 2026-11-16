import React, { useRef, useEffect, useState, useCallback } from 'react';

interface HorizontalChapterExplorationProps {
  onOpenViralFactory: () => void;
  onOpenFootballStudio: () => void;
  onOpenProviders: () => void;
  onOpenDirectorWorkspace: () => void;
}

export const HorizontalChapterExploration: React.FC<HorizontalChapterExplorationProps> = ({
  onOpenViralFactory,
  onOpenFootballStudio,
  onOpenProviders,
  onOpenDirectorWorkspace,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const rafId = useRef<number | null>(null);

  const [activeChapterIndex, setActiveChapterIndex] = useState(0);

  // Measure actual track dimensions and compute exact vertical scroll distance required
  const updateMetricsAndTranslate = useCallback(() => {
    if (!containerRef.current || !trackRef.current) return;

    const navOffset = 56;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight - navOffset;
    const trackWidth = trackRef.current.scrollWidth;

    // Exact horizontal travel required to bring the final chapter cleanly into full view
    const maxTranslateX = Math.max(0, trackWidth - viewportWidth + 64);

    // 1px vertical scroll drives 1.0px horizontal travel for natural, fluid pacing
    const scrollTravelDistance = Math.max(600, maxTranslateX);
    // 280px dwell buffer where Chapter 05 remains resting and fully accessible before exit
    const dwellDistance = 280;
    const totalVerticalScroll = scrollTravelDistance + dwellDistance;

    // Dynamically update container height: exactly travel + dwell + viewport
    const calculatedTotalHeight = totalVerticalScroll + viewportHeight;
    containerRef.current.style.height = `${calculatedTotalHeight}px`;

    const rect = containerRef.current.getBoundingClientRect();
    const currentScroll = navOffset - rect.top;

    // Horizontal travel progress [0, 1]
    const travelProg = Math.max(0, Math.min(1, currentScroll / scrollTravelDistance));

    // Active chapter tracking (0 to 4)
    const chapterIndex = Math.min(4, Math.floor(travelProg * 4.99));
    setActiveChapterIndex(chapterIndex);

    // 1:1 Instantaneous translation
    const currentTranslateX = travelProg * maxTranslateX;
    trackRef.current.style.transform = `translate3d(-${currentTranslateX}px, 0, 0)`;
  }, []);

  useEffect(() => {
    updateMetricsAndTranslate();

    const onScroll = () => {
      updateMetricsAndTranslate();
    };

    const onResize = () => {
      updateMetricsAndTranslate();
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });

    const timer = setTimeout(updateMetricsAndTranslate, 100);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [updateMetricsAndTranslate]);

  const scrollToChapter = (index: number) => {
    if (!containerRef.current || !trackRef.current) return;
    const navOffset = 56;
    const viewportWidth = window.innerWidth;
    const trackWidth = trackRef.current.scrollWidth;
    const maxTranslateX = Math.max(0, trackWidth - viewportWidth + 64);
    const scrollTravelDistance = Math.max(600, maxTranslateX);

    const targetFraction = index / 4;
    const targetScrollY = containerRef.current.offsetTop - navOffset + targetFraction * scrollTravelDistance;

    window.scrollTo({
      top: targetScrollY,
      behavior: 'smooth',
    });
  };

  return (
    <section
      ref={containerRef}
      id="horizontal-exploration-container"
      style={{
        position: 'relative',
        width: '100%',
        backgroundColor: '#F5F4F0',
        color: '#171717',
      }}
    >
      {/* Sticky Full-Viewport Horizontal Canvas (Pinned below 56px header) */}
      <div
        style={{
          position: 'sticky',
          top: '56px',
          height: 'calc(100vh - 56px)',
          width: '100%',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '20px 0 20px 0',
          boxSizing: 'border-box',
          backgroundColor: '#F5F4F0',
        }}
      >
        {/* Section Header & Chapter Navigation HUD */}
        <div
          style={{
            padding: '0 clamp(20px, 4vw, 48px)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            zIndex: 10,
          }}
        >
          <div>
            <div
              style={{
                fontSize: '11px',
                fontFamily: 'ui-monospace, monospace',
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: '#C99E35',
                marginBottom: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#C99E35' }} />
              PRODUCTION ARCHITECTURE · HORIZONTAL SPATIAL EXPLORATION
            </div>
            <h2
              style={{
                fontSize: 'clamp(20px, 2.5vw, 28px)',
                fontWeight: 800,
                margin: 0,
                letterSpacing: '-0.02em',
                color: '#171717',
              }}
            >
              Production Intelligence Chapters
            </h2>
          </div>
        </div>

        {/* Horizontal Moving Track with Distinct Chapter Environments */}
        <div
          ref={trackRef}
          style={{
            display: 'flex',
            gap: '32px',
            paddingLeft: 'clamp(20px, 4vw, 48px)',
            paddingRight: '64px',
            alignItems: 'center',
            willChange: 'transform',
            flex: 1,
            boxSizing: 'border-box',
          }}
        >
          {/* Chapter 01: Viral Clip Factory */}
          <div
            id="chapter-card-viral_factory"
            style={{
              flexShrink: 0,
              width: 'clamp(340px, 40vw, 500px)',
              height: 'clamp(380px, calc(100vh - 210px), 460px)',
              background: 'linear-gradient(155deg, rgba(201, 158, 53, 0.08) 0%, rgba(255, 255, 255, 0.98) 55%, #FFFFFF 100%)',
              borderRadius: '14px',
              border: activeChapterIndex === 0 ? '1.5px solid #C99E35' : '1px solid #DFDDD5',
              padding: 'clamp(20px, 2.5vw, 30px)',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: activeChapterIndex === 0 ? '0 20px 48px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)' : '0 8px 24px rgba(0, 0, 0, 0.04)',
              transition: 'border 0.2s ease, box-shadow 0.2s ease',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '11px', fontFamily: 'ui-monospace, monospace', color: '#C99E35', fontWeight: 700 }}>
                  CHAPTER 01 · VIRAL CLIP FACTORY
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: 'ui-monospace, monospace',
                    fontWeight: 600,
                    backgroundColor: 'rgba(201, 158, 53, 0.1)',
                    color: '#C99E35',
                    border: '1px solid rgba(201, 158, 53, 0.3)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                  }}
                >
                  +84% RETENTION
                </span>
              </div>

              <h3 style={{ fontSize: 'clamp(18px, 1.8vw, 22px)', fontWeight: 800, margin: '0 0 10px 0', letterSpacing: '-0.02em', color: '#171717' }}>
                Long-Form Video to High-Retention Shorts
              </h3>

              <p style={{ fontSize: '13px', color: '#62615D', lineHeight: 1.55, margin: '0 0 16px 0' }}>
                Ingest 4K podcasts and streams via yt-dlp or direct upload. The modular Python engine executes sub-second Whisper alignment, detects opening hooks, and scores virality using the unified matrix.
              </p>
            </div>

            {/* Live Hook Telemetry Snippet */}
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: '#F9F9F8',
                borderRadius: '8px',
                border: '1px solid #DFDDD5',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '11px',
                color: '#171717',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#C99E35' }} />
                <span>HOOK SCORE: 96/100 · 3 HIGH CUTS</span>
              </div>
              <span style={{ color: '#C99E35', fontWeight: 700 }}>14:32 - 15:12</span>
            </div>

            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                {['Whisper Word Timestamps (<0.3s)', 'Opening Hook Priority (1.5s)', 'Hormozi Kinetic Captions'].map((h, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: '11px',
                      fontFamily: 'ui-monospace, monospace',
                      backgroundColor: '#F5F4F0',
                      color: '#171717',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid #DFDDD5',
                    }}
                  >
                    {h}
                  </span>
                ))}
              </div>

              <button
                onClick={onOpenViralFactory}
                style={{
                  width: '100%',
                  backgroundColor: '#171717',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '13px',
                  padding: '12px 18px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                  transition: 'opacity 0.15s ease',
                }}
              >
                <span style={{ color: '#C99E35' }}>⚡</span> Launch Viral Clip Factory
              </button>
            </div>
          </div>

          {/* Chapter 02: Football Creator Studio */}
          <div
            id="chapter-card-football_studio"
            style={{
              flexShrink: 0,
              width: 'clamp(340px, 40vw, 500px)',
              height: 'clamp(380px, calc(100vh - 210px), 460px)',
              background: 'linear-gradient(155deg, rgba(189, 112, 69, 0.08) 0%, rgba(255, 255, 255, 0.98) 55%, #FFFFFF 100%)',
              borderRadius: '14px',
              border: activeChapterIndex === 1 ? '1.5px solid #BD7045' : '1px solid #DFDDD5',
              padding: 'clamp(20px, 2.5vw, 30px)',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: activeChapterIndex === 1 ? '0 20px 48px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)' : '0 8px 24px rgba(0, 0, 0, 0.04)',
              transition: 'border 0.2s ease, box-shadow 0.2s ease',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '11px', fontFamily: 'ui-monospace, monospace', color: '#BD7045', fontWeight: 700 }}>
                  CHAPTER 02 · FOOTBALL CREATOR STUDIO
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: 'ui-monospace, monospace',
                    fontWeight: 600,
                    backgroundColor: 'rgba(189, 112, 69, 0.1)',
                    color: '#BD7045',
                    border: '1px solid rgba(189, 112, 69, 0.3)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                  }}
                >
                  6 COMMENTARY STYLES
                </span>
              </div>

              <h3 style={{ fontSize: 'clamp(18px, 1.8vw, 22px)', fontWeight: 800, margin: '0 0 10px 0', letterSpacing: '-0.02em', color: '#171717' }}>
                Match Intelligence & Multilingual Commentary
              </h3>

              <p style={{ fontSize: '13px', color: '#62615D', lineHeight: 1.55, margin: '0 0 16px 0' }}>
                Resolve match fixtures, verify scorelines, extract key turning points, and generate timed commentary scripts in English, Hindi, or Hinglish across 6 creator styles (Tactical, Passionate, Peter Drury, Radio, Comedic, Gen-Z).
              </p>
            </div>

            {/* Match Fixture Preview */}
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: '#F9F9F8',
                borderRadius: '8px',
                border: '1px solid #DFDDD5',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '11px',
                color: '#171717',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#BD7045' }} />
                <span>DEMO FIXTURE · REAL MADRID 3 - 2 BARCELONA</span>
              </div>
              <span style={{ color: '#BD7045', fontWeight: 700 }}>DEMO 88' GOAL</span>
            </div>

            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                {['English, Hindi & Hinglish', 'Verified Scorelines', 'Tactical & Drury Styles'].map((h, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: '11px',
                      fontFamily: 'ui-monospace, monospace',
                      backgroundColor: '#F5F4F0',
                      color: '#171717',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid #DFDDD5',
                    }}
                  >
                    {h}
                  </span>
                ))}
              </div>

              <button
                onClick={onOpenFootballStudio}
                style={{
                  width: '100%',
                  backgroundColor: '#BD7045',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '13px',
                  padding: '12px 18px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(189, 112, 69, 0.25)',
                  transition: 'opacity 0.15s ease',
                }}
              >
                <span>⚽</span> Open Football Studio
              </button>
            </div>
          </div>

          {/* Chapter 03: AI Creative Director Reasoning */}
          <div
            id="chapter-card-creative_director"
            style={{
              flexShrink: 0,
              width: 'clamp(340px, 40vw, 500px)',
              height: 'clamp(380px, calc(100vh - 210px), 460px)',
              background: 'linear-gradient(155deg, rgba(169, 78, 80, 0.08) 0%, rgba(255, 255, 255, 0.98) 55%, #FFFFFF 100%)',
              borderRadius: '14px',
              border: activeChapterIndex === 2 ? '1.5px solid #A94E50' : '1px solid #DFDDD5',
              padding: 'clamp(20px, 2.5vw, 30px)',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: activeChapterIndex === 2 ? '0 20px 48px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)' : '0 8px 24px rgba(0, 0, 0, 0.04)',
              transition: 'border 0.2s ease, box-shadow 0.2s ease',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '11px', fontFamily: 'ui-monospace, monospace', color: '#A94E50', fontWeight: 700 }}>
                  CHAPTER 03 · AI CREATIVE DIRECTOR
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: 'ui-monospace, monospace',
                    fontWeight: 600,
                    backgroundColor: 'rgba(169, 78, 80, 0.1)',
                    color: '#A94E50',
                    border: '1px solid rgba(169, 78, 80, 0.3)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                  }}
                >
                  9-DIM MATRIX
                </span>
              </div>

              <h3 style={{ fontSize: 'clamp(18px, 1.8vw, 22px)', fontWeight: 800, margin: '0 0 10px 0', letterSpacing: '-0.02em', color: '#171717' }}>
                Multi-Agent Editorial Reasoning
              </h3>

              <p style={{ fontSize: '13px', color: '#62615D', lineHeight: 1.55, margin: '0 0 16px 0' }}>
                Hierarchical agents evaluate narrative setup, comedic punchlines, and retention dynamics. Natural language creator directives automatically trigger punchline zoom-ins and pacing cuts.
              </p>
            </div>

            {/* Matrix Scoring Snippet */}
            <div
              style={{
                padding: '10px 14px',
                backgroundColor: '#F9F9F8',
                borderRadius: '8px',
                border: '1px solid #DFDDD5',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '11px',
                color: '#171717',
                marginBottom: '14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>HOOK: 96 · STORY: 88 · NOVELTY: 91</span>
                <span style={{ color: '#A94E50', fontWeight: 700 }}>CONF: 0.94</span>
              </div>
              <span style={{ fontSize: '10px', color: '#62615D' }}>DIRECTIVE: make_funnier + remove_pauses (&gt;0.3s)</span>
            </div>

            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                {['9-Dimension Virality Matrix', 'Punchline Zoom Triggers', 'Creator Directives'].map((h, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: '11px',
                      fontFamily: 'ui-monospace, monospace',
                      backgroundColor: '#F5F4F0',
                      color: '#171717',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid #DFDDD5',
                    }}
                  >
                    {h}
                  </span>
                ))}
              </div>

              <button
                onClick={onOpenDirectorWorkspace}
                style={{
                  width: '100%',
                  backgroundColor: '#A94E50',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '13px',
                  padding: '12px 18px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(169, 78, 80, 0.25)',
                  transition: 'opacity 0.15s ease',
                }}
              >
                <span>🎬</span> Open Director Workspace
              </button>
            </div>
          </div>

          {/* Chapter 04: Dark Architectural Contrast Identity (Phase 4 Principle) */}
          <div
            id="chapter-card-reframing_render"
            style={{
              flexShrink: 0,
              width: 'clamp(340px, 40vw, 500px)',
              height: 'clamp(380px, calc(100vh - 210px), 460px)',
              backgroundColor: '#1C1E24',
              borderRadius: '14px',
              border: activeChapterIndex === 3 ? '1.5px solid #FFFFFF' : '1px solid rgba(255, 255, 255, 0.14)',
              padding: 'clamp(20px, 2.5vw, 30px)',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: activeChapterIndex === 3 ? '0 20px 48px rgba(0, 0, 0, 0.25)' : '0 8px 24px rgba(0, 0, 0, 0.12)',
              transition: 'border 0.2s ease, box-shadow 0.2s ease',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '11px', fontFamily: 'ui-monospace, monospace', color: '#94A3B8', fontWeight: 700 }}>
                  CHAPTER 04 · PRODUCTION EDITOR
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: 'ui-monospace, monospace',
                    fontWeight: 600,
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    color: '#FFFFFF',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                  }}
                >
                  7 RATIOS
                </span>
              </div>

              <h3 style={{ fontSize: 'clamp(18px, 1.8vw, 22px)', fontWeight: 800, margin: '0 0 10px 0', letterSpacing: '-0.02em', color: '#FFFFFF' }}>
                Smart Reframing & H.264 Encoder
              </h3>

              <p style={{ fontSize: '13px', color: '#94A3B8', lineHeight: 1.55, margin: '0 0 16px 0' }}>
                Dynamic computer vision crops wide footage to 9:16, 4:5, 1:1, and 21:9 with speaker tracking, safe margin protection, and high-contrast caption styling.
              </p>
            </div>

            {/* Target Ratio Badges */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
              {['9:16 Shorts', '4:5 Social', '1:1 Square', '21:9 Cinema'].map((ratio, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    padding: '6px 2px',
                    textAlign: 'center',
                    backgroundColor: '#252830',
                    borderRadius: '4px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: '10px',
                    color: '#FFFFFF',
                    fontWeight: 600,
                  }}
                >
                  {ratio}
                </div>
              ))}
            </div>

            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                {['Face Centering', '10% Platform Safe Zones', 'Fast H.264 Encoding'].map((h, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: '11px',
                      fontFamily: 'ui-monospace, monospace',
                      backgroundColor: '#252830',
                      color: '#E2E8F0',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    {h}
                  </span>
                ))}
              </div>

              <button
                onClick={onOpenDirectorWorkspace}
                style={{
                  width: '100%',
                  backgroundColor: '#FFFFFF',
                  color: '#171717',
                  fontWeight: 700,
                  fontSize: '13px',
                  padding: '12px 18px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                  transition: 'opacity 0.15s ease',
                }}
              >
                <span>🎬</span> Open Video Editor
              </button>
            </div>
          </div>

          {/* Chapter 05: AI Infrastructure (Grand Finale Canvas) */}
          <div
            id="chapter-card-ai_infrastructure"
            style={{
              flexShrink: 0,
              width: 'clamp(340px, 40vw, 500px)',
              height: 'clamp(380px, calc(100vh - 210px), 460px)',
              background: 'linear-gradient(155deg, rgba(46, 125, 96, 0.08) 0%, rgba(255, 255, 255, 0.98) 55%, #FFFFFF 100%)',
              borderRadius: '14px',
              border: activeChapterIndex === 4 ? '1.5px solid #2E7D60' : '1px solid #DFDDD5',
              padding: 'clamp(20px, 2.5vw, 30px)',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              boxShadow: activeChapterIndex === 4 ? '0 20px 48px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)' : '0 8px 24px rgba(0, 0, 0, 0.04)',
              transition: 'border 0.2s ease, box-shadow 0.2s ease',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '11px', fontFamily: 'ui-monospace, monospace', color: '#2E7D60', fontWeight: 700 }}>
                  CHAPTER 05 · AI ORCHESTRATION
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: 'ui-monospace, monospace',
                    fontWeight: 600,
                    backgroundColor: 'rgba(46, 125, 96, 0.1)',
                    color: '#2E7D60',
                    border: '1px solid rgba(46, 125, 96, 0.3)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                  }}
                >
                  ZERO LOCK-IN
                </span>
              </div>

              <h3 style={{ fontSize: 'clamp(18px, 1.8vw, 22px)', fontWeight: 800, margin: '0 0 10px 0', letterSpacing: '-0.02em', color: '#171717' }}>
                NVIDIA, Groq & Gemini Infrastructure
              </h3>

              <p style={{ fontSize: '13px', color: '#62615D', lineHeight: 1.55, margin: '0 0 16px 0' }}>
                Task-aware router dispatches reasoning to NVIDIA NIM (Nemotron), Groq LPU (Llama 3.3), and Google Gemini (Flash) with dynamic failover chains and encrypted credentials.
              </p>
            </div>

            {/* Provider Topology Visual */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '8px',
                marginBottom: '14px',
              }}
            >
              {[
                { name: 'NVIDIA NIM', model: 'Nemotron-3.5', ping: 'Active' },
                { name: 'Groq LPU', model: 'Llama 3.3', ping: 'Active' },
                { name: 'Google Gemini', model: 'Gemini Flash', ping: 'Active' },
              ].map((p, i) => (
                <div
                  key={i}
                  style={{
                    padding: '8px 6px',
                    backgroundColor: '#F9F9F8',
                    borderRadius: '6px',
                    border: '1px solid #DFDDD5',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '10px', fontFamily: 'ui-monospace, monospace', color: '#171717', fontWeight: 700 }}>{p.name}</div>
                  <div style={{ fontSize: '9px', color: '#62615D', marginTop: '2px' }}>{p.model}</div>
                  <div style={{ fontSize: '9px', fontFamily: 'ui-monospace, monospace', color: '#2E7D60', fontWeight: 700, marginTop: '3px' }}>{p.ping}</div>
                </div>
              ))}
            </div>

            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
                {['Automated Failover', 'Task-Based Routing', 'AES-256 Encrypted Keys'].map((h, i) => (
                  <span
                    key={i}
                    style={{
                      fontSize: '11px',
                      fontFamily: 'ui-monospace, monospace',
                      backgroundColor: '#F5F4F0',
                      color: '#171717',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid #DFDDD5',
                    }}
                  >
                    {h}
                  </span>
                ))}
              </div>

              <button
                onClick={onOpenProviders}
                style={{
                  width: '100%',
                  backgroundColor: '#171717',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '13px',
                  padding: '12px 18px',
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                  transition: 'opacity 0.15s ease',
                }}
              >
                <span style={{ color: '#2E7D60' }}>🌐</span> Open AI Providers Studio
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Navigation Controls & Status Footer */}
        <div
          style={{
            padding: '0 clamp(20px, 4vw, 48px)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11px',
            fontFamily: 'ui-monospace, monospace',
            color: '#62615D',
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <span>SCROLL VERTICALLY TO COMPLETE X-AXIS JOURNEY</span>
            <span>·</span>
            <span>CHAPTER {activeChapterIndex + 1} OF 5</span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => scrollToChapter(Math.max(0, activeChapterIndex - 1))}
              disabled={activeChapterIndex === 0}
              style={{
                backgroundColor: '#FFFFFF',
                color: activeChapterIndex === 0 ? '#898781' : '#171717',
                border: '1px solid #DFDDD5',
                padding: '6px 14px',
                borderRadius: '6px',
                cursor: activeChapterIndex === 0 ? 'not-allowed' : 'pointer',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '11px',
                fontWeight: 600,
                transition: 'all 0.15s ease',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
              }}
            >
              ← PREV
            </button>
            <button
              onClick={() => scrollToChapter(Math.min(4, activeChapterIndex + 1))}
              disabled={activeChapterIndex === 4}
              style={{
                backgroundColor: '#FFFFFF',
                color: activeChapterIndex === 4 ? '#898781' : '#171717',
                border: '1px solid #DFDDD5',
                padding: '6px 14px',
                borderRadius: '6px',
                cursor: activeChapterIndex === 4 ? 'not-allowed' : 'pointer',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '11px',
                fontWeight: 600,
                transition: 'all 0.15s ease',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
              }}
            >
              NEXT →
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HorizontalChapterExploration;

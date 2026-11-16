import React, { useState, useEffect } from 'react';

interface CinematicLandingHeroProps {
  onEnterStudio: () => void;
  onExploreJourney: () => void;
  onLaunchFootball: () => void;
}

export const CinematicLandingHero: React.FC<CinematicLandingHeroProps> = ({
  onEnterStudio,
  onExploreJourney,
  onLaunchFootball,
}) => {
  const [activeTab, setActiveTab] = useState<'reframing' | 'captions' | 'virality'>('reframing');
  const [isRevealed, setIsRevealed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsRevealed(true), 60);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section
      style={{
        position: 'relative',
        width: '100%',
        minHeight: 'calc(100vh - 56px)',
        backgroundColor: '#F5F4F0',
        color: '#171717',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: 'clamp(36px, 5vw, 64px) clamp(20px, 5vw, 64px)',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* Subtle Architectural Grid */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(23, 23, 23, 0.035) 1px, transparent 0)',
          backgroundSize: '48px 48px',
          pointerEvents: 'none',
        }}
      />

      {/* Main Asymmetric Grid: 60/40 Editorial Balance */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          width: '100%',
          maxWidth: '1380px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 'clamp(32px, 4vw, 64px)',
          alignItems: 'center',
        }}
      >
        {/* Left Column: Authoritative Editorial Positioning */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            opacity: isRevealed ? 1 : 0,
            transform: isRevealed ? 'translateY(0)' : 'translateY(16px)',
            transition: 'opacity 0.6s ease-out, transform 0.6s ease-out',
          }}
        >
          {/* Engine Status Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '11px',
              fontFamily: 'ui-monospace, monospace',
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: '#171717',
              backgroundColor: '#FFFFFF',
              padding: '6px 14px',
              borderRadius: '6px',
              border: '1px solid #DFDDD5',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              marginBottom: '24px',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#C99E35',
              }}
            />
            OPENCLIP AI · STUDIO CORE V8.5
          </div>

          {/* Monumental Headline */}
          <h1
            style={{
              fontSize: 'clamp(36px, 4.6vw, 68px)',
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: '-0.035em',
              color: '#171717',
              margin: '0 0 20px 0',
            }}
          >
            Turn raw footage into <br />
            <span
              style={{
                fontFamily: 'Playfair Display, Georgia, serif',
                fontStyle: 'italic',
                fontWeight: 400,
                color: '#C99E35',
                letterSpacing: '-0.01em',
              }}
            >
              high-retention shorts.
            </span>
          </h1>

          {/* Concrete Substance Copy */}
          <p
            style={{
              fontSize: 'clamp(15px, 1.2vw, 17px)',
              color: '#62615D',
              lineHeight: 1.6,
              maxWidth: '540px',
              margin: '0 0 32px 0',
              fontWeight: 400,
            }}
          >
            OpenClip pairs sub-second Whisper speech alignment, MediaPipe 468-point face tracking, and multi-provider reasoning from NVIDIA, Groq, and Gemini to identify viral hooks and export ready-to-publish vertical clips.
          </p>

          {/* High-Contrast Action Triggers */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px',
              alignItems: 'center',
              marginBottom: '32px',
            }}
          >
            <button
              onClick={onEnterStudio}
              style={{
                backgroundColor: '#171717',
                color: '#FFFFFF',
                fontWeight: 700,
                fontSize: '14px',
                letterSpacing: '-0.01em',
                padding: '14px 28px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 14px rgba(23, 23, 23, 0.15)',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#262626')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#171717')}
            >
              <span>⚡</span> Start Creating — Viral Factory
            </button>

            <button
              onClick={onLaunchFootball}
              style={{
                backgroundColor: '#FFFFFF',
                color: '#171717',
                fontWeight: 600,
                fontSize: '14px',
                padding: '14px 24px',
                borderRadius: '6px',
                border: '1px solid #DFDDD5',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#C99E35';
                e.currentTarget.style.backgroundColor = '#F0EFEA';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#DFDDD5';
                e.currentTarget.style.backgroundColor = '#FFFFFF';
              }}
            >
              <span>⚽</span> Football Creator Studio
            </button>

            <button
              onClick={onExploreJourney}
              style={{
                backgroundColor: 'transparent',
                color: '#62615D',
                fontWeight: 600,
                fontSize: '13px',
                padding: '14px 16px',
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'color 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#171717')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#62615D')}
            >
              <span>〰️</span> Explore Pipeline ↓
            </button>
          </div>

          {/* Architectural Capabilities Footer */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '16px',
              paddingTop: '18px',
              borderTop: '1px solid #DFDDD5',
              fontFamily: 'ui-monospace, monospace',
              fontSize: '11px',
              color: '#898781',
            }}
          >
            <span>LOSSLESS H.264 / AAC</span>
            <span>·</span>
            <span>468-PT FACE MESH</span>
            <span>·</span>
            <span>9-DIM VIRALITY MATRIX</span>
            <span>·</span>
            <span>NVIDIA · GROQ · GEMINI</span>
          </div>
        </div>

        {/* Right Column: Genuine Media Reframing Engine Transformation */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            opacity: isRevealed ? 1 : 0,
            transform: isRevealed ? 'translateY(0)' : 'translateY(20px)',
            transition: 'opacity 0.7s ease-out 0.1s, transform 0.7s ease-out 0.1s',
          }}
        >
          <div
            style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #DFDDD5',
              borderRadius: '8px',
              padding: '20px',
              boxShadow: '0 20px 48px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.03)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Header Control Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingBottom: '14px',
                marginBottom: '16px',
                borderBottom: '1px solid #ECEAE4',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#C99E35' }} />
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '11px', fontWeight: 700, color: '#171717' }}>
                  MEDIA REFRAMING ENGINE
                </span>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px', color: '#898781' }}>
                  // DEMO FRAME 00:14:32:08
                </span>
              </div>

              {/* Angle Switcher */}
              <div style={{ display: 'flex', gap: '4px', backgroundColor: '#F0EFEA', padding: '2px', borderRadius: '6px', border: '1px solid #DFDDD5' }}>
                {(['reframing', 'captions', 'virality'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '4px',
                      fontSize: '10px',
                      fontFamily: 'ui-monospace, monospace',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      backgroundColor: activeTab === tab ? '#FFFFFF' : 'transparent',
                      color: activeTab === tab ? '#171717' : '#62615D',
                      boxShadow: activeTab === tab ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {tab.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Transformation Stage: 16:9 Ingestion to 9:16 Shorts */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '14px',
                alignItems: 'stretch',
                minHeight: '320px',
              }}
            >
              {/* 16:9 Long-Form Source with Dynamic Speaker Crop Box */}
              <div
                style={{
                  backgroundColor: '#F0EFEA',
                  borderRadius: '6px',
                  border: '1px solid #DFDDD5',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px', color: '#62615D' }}>
                      SOURCE 16:9 · 3840×2160
                    </span>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px', color: '#C99E35', fontWeight: 700 }}>
                      FACE DETECT: 99.4%
                    </span>
                  </div>

                  {/* Simulated Frame Canvas with 9:16 Crop Boundary */}
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '16 / 9',
                      backgroundColor: '#E2E0D8',
                      borderRadius: '4px',
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      border: '1px solid #DFDDD5',
                    }}
                  >
                    {/* Widescreen Scene Backdrop */}
                    <div style={{ position: 'absolute', inset: 0, opacity: 0.25 }}>
                      <div style={{ position: 'absolute', top: '20%', left: '15%', width: '120px', height: '60px', backgroundColor: '#CBD5E1', borderRadius: '4px' }} />
                      <div style={{ position: 'absolute', bottom: '10%', right: '10%', width: '80px', height: '50px', backgroundColor: '#94A3B8', borderRadius: '4px' }} />
                    </div>

                    {/* Active Speaker Silhouette */}
                    <div
                      style={{
                        width: '54px',
                        height: '74px',
                        backgroundColor: '#FFFFFF',
                        borderRadius: '27px 27px 8px 8px',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'flex-start',
                        paddingTop: '8px',
                        border: '1px solid #C99E35',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                      }}
                    >
                      <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#C99E35', opacity: 0.9 }} />
                      <div style={{ width: '38px', height: '34px', backgroundColor: '#CBD5E1', borderRadius: '12px 12px 0 0', marginTop: '6px' }} />
                    </div>

                    {/* 9:16 Vertical Crop Guide Box */}
                    <div
                      style={{
                        position: 'absolute',
                        width: '28%',
                        height: '92%',
                        border: '1.5px dashed #C99E35',
                        backgroundColor: 'rgba(201, 158, 53, 0.08)',
                        borderRadius: '3px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        padding: '4px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '8px', fontFamily: 'ui-monospace, monospace', color: '#171717', fontWeight: 700 }}>9:16 CROP</span>
                        <span style={{ width: '4px', height: '4px', backgroundColor: '#C99E35' }} />
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <span style={{ fontSize: '7px', fontFamily: 'ui-monospace, monospace', color: '#C99E35', fontWeight: 700 }}>TRACKING</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Live Speech Waveform Analysis */}
                <div style={{ marginTop: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px', color: '#62615D' }}>
                      WHISPER ASR TIMESTAMPS
                    </span>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px', color: '#2E7D60', fontWeight: 700 }}>
                      &lt;0.3s SYNC
                    </span>
                  </div>

                  {/* Audio Bars */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '22px', padding: '2px 0' }}>
                    {[35, 60, 85, 45, 95, 70, 50, 80, 100, 65, 40, 75, 90, 55, 30, 85, 60, 45, 90, 70, 40].map((h, i) => (
                      <div
                        key={i}
                        style={{
                          flex: 1,
                          height: `${h}%`,
                          backgroundColor: i >= 8 && i <= 14 ? '#C99E35' : '#DFDDD5',
                          borderRadius: '1px',
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* 9:16 Vertical Short Output Render */}
              <div
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '6px',
                  border: '1px solid #DFDDD5',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  position: 'relative',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px', color: '#171717', fontWeight: 700 }}>
                      TARGET 9:16 VERTICAL
                    </span>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px', color: '#2E7D60', fontWeight: 700 }}>
                      READY
                    </span>
                  </div>

                  {/* 9:16 Short Viewport Simulation */}
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '9 / 16',
                      maxHeight: '210px',
                      backgroundColor: '#171717',
                      borderRadius: '4px',
                      margin: '0 auto',
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      padding: '10px 8px',
                      boxSizing: 'border-box',
                      overflow: 'hidden',
                      boxShadow: '0 8px 20px rgba(0, 0, 0, 0.15)',
                    }}
                  >
                    {/* Top Safe-Zone Boundary (10%) */}
                    <div style={{ width: '100%', height: '14px', borderBottom: '1px dashed rgba(255, 255, 255, 0.25)', display: 'flex', justifyContent: 'flex-end' }}>
                      <span style={{ fontSize: '7px', fontFamily: 'ui-monospace, monospace', color: 'rgba(255, 255, 255, 0.7)' }}>SAFE ZONE</span>
                    </div>

                    {/* Centered Speaker Profile */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', backgroundColor: '#C99E35', opacity: 0.9, marginBottom: '4px' }} />
                      <div style={{ width: '48px', height: '36px', backgroundColor: '#334155', borderRadius: '12px 12px 0 0' }} />
                    </div>

                    {/* Animated Kinetic Hormozi Subtitles */}
                    <div
                      style={{
                        backgroundColor: '#0A0A0A',
                        border: '1px solid #C99E35',
                        borderRadius: '3px',
                        padding: '4px 6px',
                        textAlign: 'center',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
                          fontSize: '10px',
                          fontWeight: 800,
                          color: '#FFFFFF',
                          letterSpacing: '-0.01em',
                          textTransform: 'uppercase',
                        }}
                      >
                        THE FUTURE OF <span style={{ color: '#C99E35' }}>VIRAL MEDIA</span>
                      </span>
                    </div>

                    {/* Bottom Platform UI Margin (15%) */}
                    <div style={{ width: '100%', height: '16px', borderTop: '1px dashed rgba(255, 255, 255, 0.25)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '7px', fontFamily: 'ui-monospace, monospace', color: 'rgba(255, 255, 255, 0.7)' }}>UI MARGIN</span>
                      <span style={{ fontSize: '7px', fontFamily: 'ui-monospace, monospace', color: '#FFFFFF' }}>1080×1920</span>
                    </div>
                  </div>
                </div>

                {/* Virality Score Badge */}
                <div
                  style={{
                    marginTop: '10px',
                    padding: '8px 12px',
                    backgroundColor: '#F0EFEA',
                    borderRadius: '4px',
                    border: '1px solid #DFDDD5',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '10px', color: '#62615D' }}>
                    HOOK VIRALITY
                  </span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '12px', fontWeight: 800, color: '#C99E35' }}>
                    96 / 100
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CinematicLandingHero;

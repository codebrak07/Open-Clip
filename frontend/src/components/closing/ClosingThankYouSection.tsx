import React from 'react';

interface ClosingThankYouSectionProps {
  onOpenViralFactory: () => void;
  onOpenFootballStudio: () => void;
  onOpenProviders: () => void;
  onOpenDiagnostics: () => void;
}

export const ClosingThankYouSection: React.FC<ClosingThankYouSectionProps> = ({
  onOpenViralFactory,
  onOpenFootballStudio,
  onOpenProviders,
  onOpenDiagnostics,
}) => {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div style={{ width: '100%', backgroundColor: '#F5F4F0', color: '#171717' }}>
      {/* 1. High-Impact Closing CTA (Light Editorial Stone Surface) */}
      <section
        style={{
          position: 'relative',
          width: '100%',
          padding: 'clamp(72px, 8vw, 120px) clamp(20px, 5vw, 64px)',
          boxSizing: 'border-box',
          borderTop: '1px solid #DFDDD5',
          backgroundColor: '#ECEAE4',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            maxWidth: '1280px',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
          }}
        >
          {/* Eyebrow Milestone Badge */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 16px',
              backgroundColor: '#FFFFFF',
              border: '1px solid #DFDDD5',
              borderRadius: '999px',
              fontFamily: 'ui-monospace, monospace',
              fontSize: '11px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#C99E35',
              marginBottom: '28px',
              boxShadow: '0 2px 6px rgba(0, 0, 0, 0.03)',
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
            THE JOURNEY RESOLVES INTO CREATION
          </div>

          {/* Editorial Heading */}
          <h2
            style={{
              fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
              fontSize: 'clamp(32px, 4.8vw, 64px)',
              fontWeight: 800,
              lineHeight: 1.08,
              letterSpacing: '-0.03em',
              color: '#171717',
              margin: '0 0 20px 0',
              maxWidth: '860px',
            }}
          >
            Ready to transform raw footage into{' '}
            <span
              style={{
                fontFamily: 'Playfair Display, Georgia, serif',
                fontStyle: 'italic',
                fontWeight: 400,
                color: '#C99E35',
              }}
            >
              compelling stories?
            </span>
          </h2>

          {/* Subheading */}
          <p
            style={{
              fontSize: 'clamp(15px, 1.2vw, 18px)',
              lineHeight: 1.6,
              color: '#62615D',
              margin: '0 0 40px 0',
              maxWidth: '640px',
            }}
          >
            Every stage of the pipeline is live and verified on your local system: Whisper ASR, MediaPipe face tracking, multi-provider AI reasoning, and high-speed H.264 rendering. Enter your dedicated creation workspace.
          </p>

          {/* Action CTAs */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '14px',
              alignItems: 'center',
              marginBottom: '56px',
            }}
          >
            <button
              onClick={onOpenViralFactory}
              style={{
                padding: '16px 32px',
                backgroundColor: '#171717',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '6px',
                fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
                fontSize: '15px',
                fontWeight: 700,
                letterSpacing: '-0.01em',
                cursor: 'pointer',
                transition: 'opacity 0.15s ease',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '10px',
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.12)',
              }}
            >
              <span style={{ color: '#C99E35' }}>⚡</span> Enter Viral Clip Factory
            </button>

            <button
              onClick={onOpenFootballStudio}
              style={{
                padding: '16px 28px',
                backgroundColor: '#FFFFFF',
                color: '#171717',
                border: '1px solid #DFDDD5',
                borderRadius: '6px',
                fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.03)',
              }}
            >
              <span>⚽</span> Launch Football Studio
            </button>

            <button
              onClick={onOpenProviders}
              style={{
                padding: '16px 20px',
                backgroundColor: 'transparent',
                color: '#62615D',
                border: 'none',
                borderRadius: '6px',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'color 0.15s ease',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>⚙️</span> Manage AI Providers →
            </button>
          </div>

          {/* Three Pillar Metric Boxes (Light Solid Cards) */}
          <div
            style={{
              width: '100%',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '20px',
              paddingTop: '32px',
              borderTop: '1px solid #DFDDD5',
            }}
          >
            <div
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #DFDDD5',
                borderRadius: '10px',
                padding: '24px',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.03)',
              }}
            >
              <div
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '11px',
                  color: '#C99E35',
                  letterSpacing: '0.1em',
                  marginBottom: '8px',
                  fontWeight: 700,
                }}
              >
                ENGINE 01 // SPEECH & AUDIO
              </div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color: '#171717',
                  marginBottom: '6px',
                  letterSpacing: '-0.02em',
                }}
              >
                Whisper Large-v3
              </div>
              <p style={{ fontSize: '13px', color: '#62615D', margin: 0, lineHeight: 1.55 }}>
                Word-level timestamp synchronization with sub-0.3s speech boundaries and animated kinetic subtitles.
              </p>
            </div>

            <div
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #DFDDD5',
                borderRadius: '10px',
                padding: '24px',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.03)',
              }}
            >
              <div
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '11px',
                  color: '#BD7045',
                  letterSpacing: '0.1em',
                  marginBottom: '8px',
                  fontWeight: 700,
                }}
              >
                ENGINE 02 // COMPUTER VISION
              </div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color: '#171717',
                  marginBottom: '6px',
                  letterSpacing: '-0.02em',
                }}
              >
                MediaPipe 468-pt Mesh
              </div>
              <p style={{ fontSize: '13px', color: '#62615D', margin: 0, lineHeight: 1.55 }}>
                Dynamic camera tracking across 7 aspect ratios with safe-zone dampening to protect on-screen framing.
              </p>
            </div>

            <div
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #DFDDD5',
                borderRadius: '10px',
                padding: '24px',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.03)',
              }}
            >
              <div
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '11px',
                  color: '#A94E50',
                  letterSpacing: '0.1em',
                  marginBottom: '8px',
                  fontWeight: 700,
                }}
              >
                ENGINE 03 // MULTI-MODEL AI
              </div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color: '#171717',
                  marginBottom: '6px',
                  letterSpacing: '-0.02em',
                }}
              >
                NVIDIA · Groq · Gemini
              </div>
              <p style={{ fontSize: '13px', color: '#62615D', margin: 0, lineHeight: 1.55 }}>
                Sub-second hook analysis with Groq LPU, high-concurrency Gemini, and NVIDIA NIM with encrypted keys.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Structured, Professional Light Editorial Footer */}
      <footer
        style={{
          width: '100%',
          backgroundColor: '#F5F4F0',
          borderTop: '1px solid #DFDDD5',
          padding: 'clamp(48px, 6vw, 80px) clamp(20px, 5vw, 64px) 40px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            maxWidth: '1280px',
            margin: '0 auto',
          }}
        >
          {/* Main 4-Column Navigation Layout */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '40px',
              marginBottom: '56px',
            }}
          >
            {/* Column 1: Brand & Operational Status */}
            <div style={{ maxWidth: '320px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '16px',
                }}
              >
                <div
                  style={{
                    width: '14px',
                    height: '14px',
                    backgroundColor: '#C99E35',
                    borderRadius: '3px',
                  }}
                />
                <span
                  style={{
                    fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
                    fontSize: '18px',
                    fontWeight: 800,
                    letterSpacing: '0.04em',
                    color: '#171717',
                  }}
                >
                  OPENCLIP AI
                </span>
              </div>

              <p
                style={{
                  fontSize: '13px',
                  lineHeight: 1.6,
                  color: '#62615D',
                  margin: '0 0 20px 0',
                }}
              >
                Autonomous video intelligence, multi-provider virality discovery, and sports tactical extraction built for high-performance production.
              </p>

              {/* Status Pill */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '5px 12px',
                  backgroundColor: '#FFFFFF',
                  border: '1px solid #DFDDD5',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontFamily: 'ui-monospace, monospace',
                  color: '#2E7D32',
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: '#2E7D32',
                  }}
                />
                CORE PIPELINE: OPERATIONAL
              </div>
            </div>

            {/* Column 2: Workspaces */}
            <div>
              <div
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '11px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#898781',
                  marginBottom: '16px',
                  fontWeight: 700,
                }}
              >
                Workspaces
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                <li style={{ marginBottom: '10px' }}>
                  <button
                    onClick={onOpenViralFactory}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: '#171717',
                      fontSize: '14px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'color 0.15s ease',
                    }}
                  >
                    Viral Clip Factory
                  </button>
                </li>
                <li style={{ marginBottom: '10px' }}>
                  <button
                    onClick={onOpenFootballStudio}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: '#171717',
                      fontSize: '14px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'color 0.15s ease',
                    }}
                  >
                    Football Creator Studio
                  </button>
                </li>
                <li style={{ marginBottom: '10px' }}>
                  <button
                    onClick={onOpenProviders}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: '#171717',
                      fontSize: '14px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'color 0.15s ease',
                    }}
                  >
                    AI Providers Control Center
                  </button>
                </li>
                <li style={{ marginBottom: '10px' }}>
                  <button
                    onClick={onOpenDiagnostics}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: '#171717',
                      fontSize: '14px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'color 0.15s ease',
                    }}
                  >
                    System Diagnostics & Logs
                  </button>
                </li>
              </ul>
            </div>

            {/* Column 3: Media Architecture */}
            <div>
              <div
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '11px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#898781',
                  marginBottom: '16px',
                  fontWeight: 700,
                }}
              >
                Core Architecture
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                <li style={{ marginBottom: '10px', fontSize: '13px', color: '#62615D' }}>
                  Whisper Large-v3 Speech ASR
                </li>
                <li style={{ marginBottom: '10px', fontSize: '13px', color: '#62615D' }}>
                  MediaPipe 468-pt Dynamic Framing
                </li>
                <li style={{ marginBottom: '10px', fontSize: '13px', color: '#62615D' }}>
                  YOLOv8 Ball & Pitch Analytics
                </li>
                <li style={{ marginBottom: '10px', fontSize: '13px', color: '#62615D' }}>
                  SQLite Vector Index & Cache
                </li>
                <li style={{ marginBottom: '10px', fontSize: '13px', color: '#62615D' }}>
                  Lossless FFmpeg Render Engine
                </li>
              </ul>
            </div>

            {/* Column 4: Trust & Standards */}
            <div>
              <div
                style={{
                  fontFamily: 'ui-monospace, monospace',
                  fontSize: '11px',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#898781',
                  marginBottom: '16px',
                  fontWeight: 700,
                }}
              >
                Trust & Standards
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                <li style={{ marginBottom: '10px', fontSize: '13px', color: '#62615D' }}>
                  Local Media Engine & Hybrid AI
                </li>
                <li style={{ marginBottom: '10px', fontSize: '13px', color: '#62615D' }}>
                  Zero External Telemetry Leaks
                </li>
                <li style={{ marginBottom: '10px', fontSize: '13px', color: '#62615D' }}>
                  Creative OS Governance Standard
                </li>
                <li style={{ marginBottom: '10px', fontSize: '13px', color: '#62615D' }}>
                  AES-256 Key Encryption at Rest
                </li>
                <li style={{ marginBottom: '10px', fontSize: '13px', color: '#62615D' }}>
                  MIT Licensed Open Architecture
                </li>
              </ul>
            </div>
          </div>

          {/* Bottom Bar: Copyright & Back to Top */}
          <div
            style={{
              paddingTop: '28px',
              borderTop: '1px solid #DFDDD5',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '16px',
            }}
          >
            <div
              style={{
                fontFamily: 'ui-monospace, monospace',
                fontSize: '12px',
                color: '#898781',
              }}
            >
              © {new Date().getFullYear()} OPENCLIP AI. ALL RIGHTS RESERVED. ZERO DATA RETENTION.
            </div>

            <button
              onClick={scrollToTop}
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #DFDDD5',
                borderRadius: '6px',
                padding: '6px 14px',
                color: '#171717',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.15s ease',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
              }}
            >
              ↑ BACK TO TOP
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default ClosingThankYouSection;

import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface MilestoneNode {
  step: number;
  label: string;
  title: string;
  description: string;
  branches: string[];
  metrics: string;
  badge: string;
  progressThreshold: number;
  coord: { x: number; y: number };
}

const MILESTONES: MilestoneNode[] = [
  {
    step: 1,
    label: 'INGESTION & STREAM EXTRACTION',
    title: 'Zero-Loss Video & Audio Demuxing',
    description: 'High-speed ingestion of 4K sources via yt-dlp and direct upload. Extracts pristine 16kHz mono audio streams and verifies SHA-256 deduplication cache.',
    branches: ['yt-dlp Ingestion', 'FFprobe Stream Analyzer', 'SHA-256 Cache'],
    metrics: 'Lossless H.264 / AAC 16kHz',
    badge: 'INPUT STAGE',
    progressThreshold: 0.08,
    coord: { x: 320, y: 560 },
  },
  {
    step: 2,
    label: 'MULTIMODAL INTELLIGENCE',
    title: 'Whisper Alignment & Computer Vision',
    description: 'Word-level timestamp synchronization with sub-0.3s speech boundary accuracy. MediaPipe 468-pt face tracking, OpenCV shot boundary detection, and on-frame OCR.',
    branches: ['Whisper Sub-Second Bounds', 'MediaPipe 468-pt Mesh', 'PySceneDetect Cuts'],
    metrics: '<0.3s Speech Bounds Sync',
    badge: 'CV & AUDIO STAGE',
    progressThreshold: 0.28,
    coord: { x: 1060, y: 1150 },
  },
  {
    step: 3,
    label: 'CREATIVE DIRECTOR REASONING',
    title: 'Hierarchical Multi-Agent Viral Discovery',
    description: 'NVIDIA Nemotron, Groq LPU, and Google Gemini agents evaluate opening narrative hooks, comedic punchlines, and retention dynamics using the unified 9-Dimension Virality Matrix.',
    branches: ['Opening Hook Priority', 'Comedic Punchline Zoom-in', '9-Dimension Virality Matrix'],
    metrics: '9-Dimension Virality Engine',
    badge: 'REASONING CORE',
    progressThreshold: 0.52,
    coord: { x: 300, y: 1920 },
  },
  {
    step: 4,
    label: 'SMART REFRAMING & SAFE ZONES',
    title: 'Dynamic Aspect-Ratio & UI Margin Defense',
    description: 'Continuous speaker centering with rule-of-thirds composition across 7 aspect ratios (9:16 Shorts, 4:5, 1:1, 21:9). Protects on-screen elements with 10% platform UI safe zones.',
    branches: ['9:16 Vertical Shorts', '4:5 Social Feed Crop', '10% Safe Zones', 'Speaker Smoothing'],
    metrics: '7 Ratios + Custom Bounds',
    badge: 'COMPOSITION STAGE',
    progressThreshold: 0.76,
    coord: { x: 1040, y: 2740 },
  },
  {
    step: 5,
    label: 'PUBLISHING INTELLIGENCE',
    title: 'Dual-Path Thumbnails & SEO Packages',
    description: 'Curiosity-driven titles, niche-targeted hashtags, animated Hormozi captions, and dual-mode thumbnails (AI generative vs. keyframe composition) ready for 1-click export.',
    branches: ['Curiosity Titles', 'Hormozi Kinetic Captions', 'Dual Thumbnails', 'Automated Package'],
    metrics: '1-Click Multi-Platform Export',
    badge: 'DISTRIBUTION STAGE',
    progressThreshold: 0.92,
    coord: { x: 700, y: 3560 },
  },
];

// Light Editorial Environment Tokens
const RIBBON_ENV = {
  bg: '#F5F4F0',
  textColor: '#171717',
  subTextColor: '#62615D',
  accentAmber: '#D4A017', // Rich golden yellow
  cardBg: '#FFFFFF',
  borderColor: '#DFDDD5',
};

export const OrganicRibbonFlow: React.FC<{
  onLaunchFactory?: () => void;
  onLaunchFootball?: () => void;
}> = ({ onLaunchFactory, onLaunchFootball }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Main kinetic warm amber ribbon
  const pathRef = useRef<SVGPathElement>(null);
  const glowPathRef = useRef<SVGPathElement>(null);

  // 4 Independent Decorative Ribbons (Left & Right Flanks)
  const leftDeco1Ref = useRef<SVGPathElement>(null);
  const leftDeco2Ref = useRef<SVGPathElement>(null);
  const rightDeco1Ref = useRef<SVGPathElement>(null);
  const rightDeco2Ref = useRef<SVGPathElement>(null);

  const [scrollProgress, setScrollProgress] = useState(0);
  const [activeMilestone, setActiveMilestone] = useState(1);
  const [windowWidth, setWindowWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);

  // Main Storytelling Ribbon Geometry (Preserved multidirectional loop)
  const mainRibbonD =
    'M 700 80 ' +
    'C 420 120, 180 260, 260 480 ' +
    'C 300 580, 480 620, 640 580 ' +
    'C 780 540, 780 400, 620 420 ' +
    'C 460 440, 520 680, 720 760 ' +
    'C 920 840, 1140 960, 1060 1150 ' +
    'C 980 1340, 780 1460, 480 1560 ' +
    'C 220 1650, 160 1800, 300 1920 ' +
    'C 420 2020, 560 1980, 520 2160 ' +
    'C 460 2320, 240 2280, 380 2460 ' +
    'C 520 2620, 860 2560, 1040 2740 ' +
    'C 1160 2920, 960 3120, 700 3220 ' +
    'C 480 3300, 520 3460, 700 3560';

  // Independent Decorative Ribbon 1 (Left Flank - Upper Closed Loop & Swoop)
  const leftDeco1D =
    'M 160 520 C 60 420, -10 560, 50 700 C 120 820, 260 780, 240 640 C 220 500, 180 460, 160 520 Z ' +
    'M 80 920 C -40 1120, 20 1400, 180 1560 C 280 1680, 120 1860, -30 2020';

  // Independent Decorative Ribbon 2 (Left Flank - Lower Closed Orbital & Sweep)
  const leftDeco2D =
    'M 180 2340 C 70 2220, -10 2400, 50 2560 C 110 2720, 250 2690, 260 2520 C 270 2340, 220 2290, 180 2340 Z ' +
    'M 60 2880 C 210 3060, 130 3280, 50 3460 C -30 3640, 150 3750, 250 3790';

  // Independent Decorative Ribbon 3 (Right Flank - Upper Closed Loop & Orbit)
  const rightDeco1D =
    'M 1240 500 C 1340 400, 1420 540, 1360 680 C 1300 820, 1160 800, 1180 640 C 1200 480, 1280 440, 1240 500 Z ' +
    'M 1280 960 C 1410 1160, 1350 1440, 1230 1600 C 1130 1740, 1250 1960, 1390 2080';

  // Independent Decorative Ribbon 4 (Right Flank - Lower Closed Orbital & Helix)
  const rightDeco2D =
    'M 1220 2380 C 1340 2260, 1440 2420, 1360 2580 C 1280 2740, 1140 2700, 1160 2540 C 1180 2380, 1260 2340, 1220 2380 Z ' +
    'M 1330 2940 C 1190 3120, 1270 3360, 1390 3520 C 1470 3640, 1310 3770, 1190 3800';

  // Measure and initialize SVG path lengths
  const initializePaths = useCallback(() => {
    if (pathRef.current && glowPathRef.current) {
      const len = pathRef.current.getTotalLength();
      pathRef.current.style.strokeDasharray = `${len} ${len}`;
      glowPathRef.current.style.strokeDasharray = `${len} ${len}`;
    }

    [
      { ref: leftDeco1Ref },
      { ref: leftDeco2Ref },
      { ref: rightDeco1Ref },
      { ref: rightDeco2Ref },
    ].forEach(({ ref }) => {
      if (ref.current) {
        const dLen = ref.current.getTotalLength();
        ref.current.style.strokeDasharray = `${dLen} ${dLen}`;
      }
    });
  }, []);

  const updateScrollGeometry = useCallback(() => {
    if (!containerRef.current) return;

    const navOffset = 56;
    const rect = containerRef.current.getBoundingClientRect();
    const windowHeight = window.innerHeight;
    const totalScrollable = rect.height - windowHeight;

    if (totalScrollable <= 0) return;

    const rawProgress = Math.max(0, Math.min(1, (navOffset - rect.top) / totalScrollable));
    setScrollProgress(rawProgress);

    let currentStep = 1;
    for (let i = 0; i < MILESTONES.length; i++) {
      if (rawProgress >= MILESTONES[i].progressThreshold - 0.05) {
        currentStep = MILESTONES[i].step;
      }
    }
    setActiveMilestone(currentStep);

    // Rich Golden Yellow Ribbon: smooth, calm, controlled progression
    if (pathRef.current && glowPathRef.current) {
      const len = pathRef.current.getTotalLength() || 4600;

      // Smooth, gentle ribbon progression (not rushing)
      const strokeRate = Math.min(1, rawProgress * 1.05);

      const targetOffset = len * (1 - strokeRate);
      pathRef.current.style.strokeDashoffset = `${targetOffset}`;
      glowPathRef.current.style.strokeDashoffset = `${targetOffset}`;

      const dynamicGlowOpacity = 0.14 + 0.12 * Math.sin(rawProgress * Math.PI);
      const dynamicGlowWidth = 28 + 8 * Math.sin(rawProgress * Math.PI);
      glowPathRef.current.style.opacity = `${dynamicGlowOpacity}`;
      glowPathRef.current.style.strokeWidth = `${dynamicGlowWidth}`;
    }

    if (leftDeco1Ref.current) {
      const d1Len = leftDeco1Ref.current.getTotalLength() || 2400;
      const d1Rate = Math.min(1, rawProgress * 1.05);
      leftDeco1Ref.current.style.strokeDashoffset = `${d1Len * (1 - d1Rate)}`;
      leftDeco1Ref.current.style.opacity = `${d1Rate > 0.02 ? 0.22 : 0.06}`;
    }

    if (leftDeco2Ref.current) {
      const d2Len = leftDeco2Ref.current.getTotalLength() || 2000;
      const d2Rate = Math.max(0, Math.min(1, (rawProgress - 0.42) / 0.5));
      leftDeco2Ref.current.style.strokeDashoffset = `${d2Len * (1 - d2Rate)}`;
      leftDeco2Ref.current.style.opacity = `${d2Rate > 0.02 ? 0.18 : 0.06}`;
    }

    if (rightDeco1Ref.current) {
      const d3Len = rightDeco1Ref.current.getTotalLength() || 2500;
      const d3Rate = Math.min(1, rawProgress * 1.04);
      rightDeco1Ref.current.style.strokeDashoffset = `${d3Len * (1 - d3Rate)}`;
      rightDeco1Ref.current.style.opacity = `${d3Rate > 0.02 ? 0.20 : 0.06}`;
    }

    if (rightDeco2Ref.current) {
      const d4Len = rightDeco2Ref.current.getTotalLength() || 2100;
      const d4Rate = Math.max(0, Math.min(1, (rawProgress - 0.40) / 0.5));
      rightDeco2Ref.current.style.strokeDashoffset = `${d4Len * (1 - d4Rate)}`;
      rightDeco2Ref.current.style.opacity = `${d4Rate > 0.02 ? 0.18 : 0.06}`;
    }

    if (stageRef.current) {
      const viewportHeight = windowHeight - navOffset;
      const viewportCenter = viewportHeight / 2;
      const terminalMilestoneY = 3535;
      const maxCameraTravel = Math.max(0, terminalMilestoneY - viewportCenter);
      const stageTranslateY = -rawProgress * maxCameraTravel;
      stageRef.current.style.transform = `translate3d(0, ${stageTranslateY}px, 0)`;
    }
  }, []);

  useEffect(() => {
    initializePaths();
    updateScrollGeometry();

    const handleScroll = () => {
      updateScrollGeometry();
    };

    const handleResize = () => {
      setWindowWidth(window.innerWidth);
      initializePaths();
      updateScrollGeometry();
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize, { passive: true });

    const timer = setTimeout(() => {
      initializePaths();
      updateScrollGeometry();
    }, 100);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [initializePaths, updateScrollGeometry]);

  return (
    <section
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '320vh', // Normal, comfortable scroll pacing
        backgroundColor: RIBBON_ENV.bg,
        overflow: 'visible',
      }}
    >
      {/* Sticky Viewport Frame */}
      <div
        ref={stickyRef}
        style={{
          position: 'sticky',
          top: '56px',
          height: 'calc(100vh - 56px)',
          width: '100%',
          overflow: 'hidden',
          backgroundColor: RIBBON_ENV.bg,
        }}
      >
        {/* Subtle Ambient Pattern */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(201, 158, 53, 0.08) 1px, transparent 0)',
            backgroundSize: '48px 48px',
            pointerEvents: 'none',
          }}
        />

        {/* Translating Inner Stage Canvas */}
        <div
          ref={stageRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '3800px',
            willChange: 'transform',
          }}
        >
          {/* Stage Intro Headline */}
          <div
            style={{
              position: 'absolute',
              top: '64px',
              left: 0,
              right: 0,
              textAlign: 'center',
              zIndex: 10,
              padding: '0 20px',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '11px',
                fontFamily: 'ui-monospace, monospace',
                fontWeight: 700,
                letterSpacing: '0.14em',
                color: RIBBON_ENV.accentAmber,
                marginBottom: '14px',
              }}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: RIBBON_ENV.accentAmber }} />
              ORGANIC RIBBON FLOW · KINETIC PIPELINE
            </div>

            <h2
              style={{
                fontSize: 'clamp(32px, 4.4vw, 52px)',
                fontWeight: 800,
                letterSpacing: '-0.03em',
                lineHeight: 1.1,
                margin: '0 0 12px 0',
                color: RIBBON_ENV.textColor,
              }}
            >
              The Physical Creation Pipeline
            </h2>

            <p
              style={{
                fontSize: '16px',
                color: RIBBON_ENV.subTextColor,
                maxWidth: '640px',
                margin: '0 auto',
                lineHeight: 1.6,
              }}
            >
              A disciplined warm amber trajectory guiding through speech demuxing, multimodal tracking, creative reasoning, and automated publishing.
            </p>
          </div>

          {/* SVG Canvas: Primary Ribbon + Decorative Ribbons (Strictly Layer 2: zIndex 5, behind milestone cards at zIndex 20) */}
          <svg
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '3800px',
              pointerEvents: 'none',
              overflow: 'visible',
              zIndex: 5,
            }}
            viewBox="0 0 1400 3800"
            preserveAspectRatio="none"
          >
            {/* Left Decorative Ribbon 1 */}
            <path
              ref={leftDeco1Ref}
              d={leftDeco1D}
              fill="none"
              stroke="rgba(201, 158, 53, 0.22)"
              strokeWidth="10"
              strokeLinecap="round"
              style={{ willChange: 'stroke-dashoffset, opacity' }}
            />

            {/* Left Decorative Ribbon 2 */}
            <path
              ref={leftDeco2Ref}
              d={leftDeco2D}
              fill="none"
              stroke="rgba(189, 112, 69, 0.18)"
              strokeWidth="8"
              strokeLinecap="round"
              style={{ willChange: 'stroke-dashoffset, opacity' }}
            />

            {/* Right Decorative Ribbon 1 */}
            <path
              ref={rightDeco1Ref}
              d={rightDeco1D}
              fill="none"
              stroke="rgba(201, 158, 53, 0.20)"
              strokeWidth="10"
              strokeLinecap="round"
              style={{ willChange: 'stroke-dashoffset, opacity' }}
            />

            {/* Right Decorative Ribbon 2 */}
            <path
              ref={rightDeco2Ref}
              d={rightDeco2D}
              fill="none"
              stroke="rgba(189, 112, 69, 0.16)"
              strokeWidth="8"
              strokeLinecap="round"
              style={{ willChange: 'stroke-dashoffset, opacity' }}
            />

            {/* Ground Contact Shadow (Soft natural occlusion shadow) */}
            <path
              d={mainRibbonD}
              fill="none"
              stroke="rgba(0, 0, 0, 0.06)"
              strokeWidth="36"
              strokeLinecap="round"
            />

            {/* Blueprint Guide Track */}
            <path
              d={mainRibbonD}
              fill="none"
              stroke="rgba(201, 158, 53, 0.12)"
              strokeWidth="20"
              strokeLinecap="round"
            />

            {/* Subtle Ambient Warm Glow */}
            <path
              ref={glowPathRef}
              d={mainRibbonD}
              fill="none"
              stroke={RIBBON_ENV.accentAmber}
              strokeWidth="28"
              strokeLinecap="round"
              opacity="0.14"
              style={{ willChange: 'stroke-dashoffset, opacity, stroke-width' }}
            />

            {/* Main Kinetic Ribbon Path (Warm Muted Amber #C99E35) */}
            <path
              ref={pathRef}
              d={mainRibbonD}
              fill="none"
              stroke={RIBBON_ENV.accentAmber}
              strokeWidth="20"
              strokeLinecap="round"
              style={{ willChange: 'stroke-dashoffset' }}
            />
          </svg>

          {/* ==================================================== */}
          {/* Milestone Nodes (Layer 4: Functional Interface zIndex 20) */}
          {/* Opaque solid #FFFFFF surfaces occluding the ribbon underneath */}
          {/* ==================================================== */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '3800px',
              zIndex: 20,
              maxWidth: '1360px',
              margin: '0 auto',
              pointerEvents: 'none',
            }}
          >
            {MILESTONES.map((m, idx) => {
              const anchors = [
                { top: 440, side: 'left' },
                { top: 1040, side: 'right' },
                { top: 1810, side: 'left' },
                { top: 2630, side: 'right' },
                { top: 3360, side: 'center' },
              ];
              const anchor = anchors[idx];
              const isCenter = anchor.side === 'center';
              const isPassed = scrollProgress >= m.progressThreshold - 0.05;
              const isCurrent = activeMilestone === m.step;
              const isMobile = windowWidth < 960;

              return (
                <div
                  key={m.step}
                  id={`milestone-${m.step}`}
                  style={{
                    position: 'absolute',
                    top: `${anchor.top}px`,
                    left: isMobile || isCenter ? '50%' : anchor.side === 'left' ? 'clamp(24px, 4vw, 80px)' : 'auto',
                    right: !isMobile && anchor.side === 'right' ? 'clamp(24px, 4vw, 80px)' : 'auto',
                    transform: isMobile || isCenter ? 'translateX(-50%)' : 'none',
                    width: isMobile ? 'calc(100% - 32px)' : '100%',
                    maxWidth: isMobile ? '480px' : isCenter ? '620px' : '520px',
                    pointerEvents: 'auto',
                  }}
                >
                  {/* Milestone Card Surface (100% Opaque Solid #FFFFFF Container) */}
                  <div
                    style={{
                      width: '100%',
                      padding: '28px 24px',
                      position: 'relative',
                      backgroundColor: '#FFFFFF',
                      borderRadius: '14px',
                      border: isCurrent
                        ? `1.5px solid ${RIBBON_ENV.accentAmber}`
                        : `1px solid ${RIBBON_ENV.borderColor}`,
                      boxShadow: isCurrent
                        ? '0 20px 48px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04)'
                        : '0 8px 24px rgba(0, 0, 0, 0.04)',
                      transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                      boxSizing: 'border-box',
                    }}
                  >
                    {/* Header: Sculptural Numeral & Telemetry Pill */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        {/* Sculptural Floating Stage Numeral */}
                        <div
                          style={{
                            fontFamily: 'Playfair Display, Georgia, serif',
                            fontStyle: 'italic',
                            fontSize: '32px',
                            fontWeight: 700,
                            lineHeight: 1,
                            color: isCurrent ? RIBBON_ENV.accentAmber : isPassed ? RIBBON_ENV.textColor : '#898781',
                            transition: 'color 0.2s ease',
                          }}
                        >
                          0{m.step}
                        </div>

                        <div>
                          <span
                            style={{
                              fontFamily: 'ui-monospace, monospace',
                              fontSize: '11px',
                              fontWeight: 700,
                              color: isCurrent ? RIBBON_ENV.accentAmber : RIBBON_ENV.subTextColor,
                              letterSpacing: '0.1em',
                              display: 'block',
                              marginBottom: '2px',
                            }}
                          >
                            {m.label}
                          </span>
                          <span
                            style={{
                              fontSize: '10px',
                              fontFamily: 'ui-monospace, monospace',
                              color: '#898781',
                              fontWeight: 600,
                            }}
                          >
                            {m.badge}
                          </span>
                        </div>
                      </div>

                      {/* Floating Telemetry Pill */}
                      <span
                        style={{
                          fontFamily: 'ui-monospace, monospace',
                          fontSize: '11px',
                          fontWeight: 700,
                          color: RIBBON_ENV.textColor,
                          backgroundColor: '#F5F4F0',
                          border: `1px solid ${RIBBON_ENV.borderColor}`,
                          padding: '4px 10px',
                          borderRadius: '4px',
                        }}
                      >
                        {m.metrics}
                      </span>
                    </div>

                    {/* Editorial Milestone Title */}
                    <h3
                      style={{
                        fontSize: 'clamp(22px, 2.5vw, 28px)',
                        fontWeight: 800,
                        color: RIBBON_ENV.textColor,
                        margin: '0 0 10px 0',
                        letterSpacing: '-0.025em',
                        lineHeight: 1.2,
                        transition: 'color 0.2s ease',
                      }}
                    >
                      {m.title}
                    </h3>

                    {/* Milestone Description */}
                    <p
                      style={{
                        fontSize: '14px',
                        color: RIBBON_ENV.subTextColor,
                        lineHeight: 1.6,
                        margin: '0 0 18px 0',
                        transition: 'color 0.2s ease',
                      }}
                    >
                      {m.description}
                    </p>

                    {/* Floating Capability Tags */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: isCenter ? '24px' : '0' }}>
                      {m.branches.map((b, bIdx) => (
                        <span
                          key={bIdx}
                          style={{
                            fontSize: '11px',
                            fontFamily: 'ui-monospace, monospace',
                            color: RIBBON_ENV.textColor,
                            backgroundColor: '#F5F4F0',
                            border: `1px solid ${RIBBON_ENV.borderColor}`,
                            padding: '4px 10px',
                            borderRadius: '4px',
                          }}
                        >
                          {b}
                        </span>
                      ))}
                    </div>

                    {/* Final Step Action Triggers */}
                    {isCenter && (
                      <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                        {onLaunchFactory && (
                          <button
                            onClick={onLaunchFactory}
                            style={{
                              flex: 1,
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
                            }}
                          >
                            <span style={{ color: RIBBON_ENV.accentAmber }}>⚡</span> Viral Clip Factory
                          </button>
                        )}
                        {onLaunchFootball && (
                          <button
                            onClick={onLaunchFootball}
                            style={{
                              flex: 1,
                              backgroundColor: '#FFFFFF',
                              color: '#171717',
                              fontWeight: 600,
                              fontSize: '13px',
                              padding: '12px 18px',
                              borderRadius: '6px',
                              border: `1px solid ${RIBBON_ENV.borderColor}`,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '8px',
                            }}
                          >
                            <span>⚽</span> Football Studio
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

export default OrganicRibbonFlow;

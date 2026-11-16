import React, { useState } from 'react';

interface StudioHubProps {
  onUploadClick: () => void;
  isUploading: boolean;
  onYouTubeImport?: (url: string) => void;
  onNavigateToFootball?: () => void;
}

export const StudioHub: React.FC<StudioHubProps> = ({
  onUploadClick,
  isUploading,
  onYouTubeImport,
  onNavigateToFootball,
}) => {
  const [selectedRatio, setSelectedRatio] = useState<string>('9:16');
  const [captionStyle, setCaptionStyle] = useState<string>('Hormozi');
  const [aiProvider, setAiProvider] = useState<string>('nvidia');
  const [youtubeUrl, setYoutubeUrl] = useState<string>('');

  const aspectRatios = [
    { id: '9:16', label: '9:16 Vertical', desc: 'TikTok, Reels, Shorts' },
    { id: '16:9', label: '16:9 Landscape', desc: 'YouTube Standard' },
    { id: '1:1', label: '1:1 Square', desc: 'Feed & Carousel' },
    { id: '4:5', label: '4:5 Portrait', desc: 'Instagram Feed' },
    { id: '3:4', label: '3:4 Frame', desc: 'Social Feeds' },
    { id: '21:9', label: '21:9 Ultrawide', desc: 'Cinematic' },
  ];

  return (
    <div
      style={{
        flex: 1,
        width: '100%',
        backgroundColor: '#F5F4F0',
        color: '#171717',
        padding: '56px 32px',
        overflowY: 'auto',
      }}
    >
      {/* Editorial Hero Header */}
      <div
        style={{
          maxWidth: '1080px',
          margin: '0 auto 48px auto',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            fontSize: '11px',
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            letterSpacing: '0.14em',
            color: '#C99E35',
            backgroundColor: '#FFFFFF',
            padding: '6px 18px',
            borderRadius: '999px',
            border: '1px solid #DFDDD5',
            marginBottom: '20px',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.03)',
          }}
        >
          ✨ OPENCLIP AI · VIRAL CLIP FACTORY
        </div>

        <h1
          style={{
            fontSize: '52px',
            fontWeight: 800,
            color: '#171717',
            margin: '0 0 16px 0',
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
          }}
        >
          Intelligent Video Studio & Viral Engine
        </h1>

        <p
          style={{
            color: '#62615D',
            fontSize: '17px',
            maxWidth: '720px',
            margin: '0 0 32px 0',
            lineHeight: 1.6,
          }}
        >
          Transform long-form podcasts, educational videos, and matches into high-retention short clips with smart reframing, Hormozi captions, and explainable virality scores.
        </p>

        {/* Dual Workflow Switcher Buttons */}
        <div style={{ display: 'flex', gap: '14px', marginBottom: '40px' }}>
          <button
            onClick={onUploadClick}
            disabled={isUploading}
            style={{
              backgroundColor: '#171717',
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: '14px',
              padding: '12px 28px',
              borderRadius: '8px',
              border: 'none',
              cursor: isUploading ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 14px rgba(0, 0, 0, 0.1)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ color: '#C99E35' }}>⚡</span> {isUploading ? 'Uploading Video...' : 'Upload Video File'}
          </button>

          {onNavigateToFootball && (
            <button
              onClick={onNavigateToFootball}
              style={{
                backgroundColor: '#FFFFFF',
                color: '#171717',
                fontWeight: 600,
                fontSize: '14px',
                padding: '12px 28px',
                borderRadius: '8px',
                border: '1px solid #DFDDD5',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.03)',
              }}
            >
              <span>⚽</span> Switch to Football Studio
            </button>
          )}
        </div>
      </div>

      {/* Main Studio Controls Grid */}
      <div
        style={{
          maxWidth: '1080px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '1.2fr 1fr',
          gap: '32px',
        }}
      >
        {/* Left Column: Input Sources (Upload / YouTube) */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #DFDDD5',
            borderRadius: '16px',
            padding: '32px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
          }}
        >
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#171717', margin: '0 0 20px 0' }}>
            Media Ingestion
          </h2>

          {/* YouTube Link Ingestion */}
          <div style={{ marginBottom: '28px' }}>
            <label style={{ display: 'block', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: '#898781', marginBottom: '8px' }}>
              IMPORT YOUTUBE URL (yt-dlp)
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                style={{
                  flex: 1,
                  backgroundColor: '#F9F9F8',
                  border: '1px solid #DFDDD5',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  color: '#171717',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
              <button
                onClick={() => onYouTubeImport && onYouTubeImport(youtubeUrl)}
                style={{
                  backgroundColor: '#171717',
                  color: '#FFFFFF',
                  padding: '0 18px',
                  borderRadius: '8px',
                  border: 'none',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Import
              </button>
            </div>
          </div>

          {/* Drag & Drop File Zone */}
          <div
            onClick={onUploadClick}
            style={{
              border: '2px dashed #DFDDD5',
              borderRadius: '12px',
              padding: '48px 24px',
              textAlign: 'center',
              backgroundColor: '#F9F9F8',
              cursor: 'pointer',
              transition: 'border-color 0.2s ease',
            }}
          >
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>📁</div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: '#171717', marginBottom: '6px' }}>
              Drop video file here or click to browse
            </div>
            <div style={{ fontSize: '12px', color: '#62615D' }}>
              MP4, MOV, MKV, WebM up to 4GB · Auto 16kHz speech extraction
            </div>
          </div>
        </div>

        {/* Right Column: Processing Presets & AI Options */}
        <div
          style={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #DFDDD5',
            borderRadius: '16px',
            padding: '32px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
          }}
        >
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#171717', margin: 0 }}>
            Studio Presets
          </h2>

          {/* Aspect Ratio Selection */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: '#898781', marginBottom: '8px' }}>
              TARGET ASPECT RATIO (SMART REFRAME)
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              {aspectRatios.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedRatio(r.id)}
                  style={{
                    padding: '10px 8px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: selectedRatio === r.id ? 'rgba(201, 158, 53, 0.1)' : '#F9F9F8',
                    color: selectedRatio === r.id ? '#C99E35' : '#62615D',
                    border: selectedRatio === r.id ? '1.5px solid #C99E35' : '1px solid #DFDDD5',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{r.id}</div>
                  <div style={{ fontSize: '10px', color: '#898781', fontWeight: 400, marginTop: '2px' }}>
                    {r.id === '9:16' ? 'Vertical' : r.id === '16:9' ? 'Wide' : 'Square'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Caption Style */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: '#898781', marginBottom: '8px' }}>
              BURNT-IN CAPTION STYLE
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['Hormozi', 'Minimalist', 'Banner'].map((s) => (
                <button
                  key={s}
                  onClick={() => setCaptionStyle(s)}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: captionStyle === s ? 'rgba(201, 158, 53, 0.1)' : '#F9F9F8',
                    color: captionStyle === s ? '#C99E35' : '#62615D',
                    border: captionStyle === s ? '1.5px solid #C99E35' : '1px solid #DFDDD5',
                  }}
                >
                  {s === 'Hormozi' ? '🟡 Hormozi Amber' : s === 'Minimalist' ? '⚪ Minimalist' : '⬛ Subtitle Bar'}
                </button>
              ))}
            </div>
          </div>

          {/* AI Reasoning Provider */}
          <div>
            <label style={{ display: 'block', fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: '#898781', marginBottom: '8px' }}>
              CREATIVE DIRECTOR REASONING MODEL
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[
                { id: 'nvidia', label: 'NVIDIA NIM' },
                { id: 'groq', label: 'Groq LPU' },
                { id: 'gemini', label: 'Google Gemini' },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setAiProvider(p.id)}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: aiProvider === p.id ? '#171717' : '#F9F9F8',
                    color: aiProvider === p.id ? '#FFFFFF' : '#62615D',
                    border: aiProvider === p.id ? '1px solid #171717' : '1px solid #DFDDD5',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudioHub;

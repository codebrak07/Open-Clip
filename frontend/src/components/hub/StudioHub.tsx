import React, { useState } from 'react';

interface StudioHubProps {
  onUploadClick: () => void;
  isUploading: boolean;
}

export const StudioHub: React.FC<StudioHubProps> = ({ onUploadClick, isUploading }) => {
  const [selectedRatio, setSelectedRatio] = useState<string>('9:16');
  const [customRatio, setCustomRatio] = useState<string>('4:5');
  const [isCustomRatio, setIsCustomRatio] = useState<boolean>(false);
  const [captionStyle, setCaptionStyle] = useState<string>('Hormozi');
  const [captionBg, setCaptionBg] = useState<string>('Pure White Box');
  const [aiModel, setAiModel] = useState<string>('groq');
  const [userApiKey, setUserApiKey] = useState<string>('');

  const effectiveRatio = isCustomRatio ? customRatio : selectedRatio;

  return (
    <div
      style={{
        flex: 1,
        backgroundColor: '#F7F5F0',
        color: '#1C1C18',
        padding: '64px 48px',
        overflowY: 'auto',
        fontFamily: "'Playfair Display', Georgia, serif",
        minHeight: '100vh',
        perspective: '1000px',
      }}
    >
      {/* 3D Hero Section */}
      <div
        style={{
          maxWidth: '1000px',
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
            letterSpacing: '0.12em',
            color: '#059669',
            backgroundColor: 'rgba(5, 150, 105, 0.08)',
            padding: '6px 18px',
            borderRadius: '30px',
            border: '1px solid rgba(5, 150, 105, 0.2)',
            marginBottom: '24px',
            boxShadow: '0 4px 12px rgba(5, 150, 105, 0.1)',
          }}
        >
          ✨ AI-NATIVE VIDEO INTELLIGENCE

        </div>

        <h1
          style={{
            fontSize: '56px',
            fontWeight: 700,
            color: '#121212',
            margin: '0 0 16px 0',
            lineHeight: 1.08,
            letterSpacing: '-0.03em',
          }}
        >
          Instant Viral Cut & Subtitle Studio
        </h1>

        <p
          style={{
            color: '#555',
            fontSize: '18px',
            fontFamily: "'Inter', sans-serif",
            maxWidth: '740px',
            margin: '0 0 36px 0',
            lineHeight: 1.6,
          }}
        >
          Customize aspect ratios, burnt-in caption styles, and high-contrast white text backdrops before running AI video processing.
        </p>

        {/* Advanced Pre-Upload Presets Card */}
        <div
          style={{
            width: '100%',
            maxWidth: '780px',
            backgroundColor: '#FAF8F3',
            border: '1px solid #D8D2C2',
            borderRadius: '24px',
            padding: '28px 36px',
            marginBottom: '28px',
            boxShadow: '0 12px 32px rgba(0,0,0,0.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: '12px', fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: '0.08em', color: '#121212', textTransform: 'uppercase' }}>
              ⚙️ ADVANCED PRE-UPLOAD PRESETS
            </div>
            <span style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: '#059669', fontWeight: 600 }}>
              AI AUTO-RECOLOR READY
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', fontFamily: "'Inter', sans-serif" }}>
            {/* Target & Custom Aspect Ratio */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#666', display: 'block', marginBottom: '8px' }}>
                ASPECT RATIO
              </label>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                {['9:16', '16:9', '1:1'].map((ratio) => (
                  <button
                    key={ratio}
                    onClick={() => {
                      setSelectedRatio(ratio);
                      setIsCustomRatio(false);
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 0',
                      borderRadius: '8px',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: (!isCustomRatio && selectedRatio === ratio) ? '1px solid #121212' : '1px solid #D8D2C2',
                      backgroundColor: (!isCustomRatio && selectedRatio === ratio) ? '#121212' : '#FFF',
                      color: (!isCustomRatio && selectedRatio === ratio) ? '#FFF' : '#444',
                      cursor: 'pointer',
                    }}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
              
              {/* Custom Ratio Toggle & Input */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="customRatioToggle"
                  checked={isCustomRatio}
                  onChange={(e) => setIsCustomRatio(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="customRatioToggle" style={{ fontSize: '11px', fontWeight: 600, color: '#444', cursor: 'pointer' }}>
                  Custom Ratio:
                </label>
                {isCustomRatio && (
                  <input
                    type="text"
                    value={customRatio}
                    onChange={(e) => setCustomRatio(e.target.value)}
                    placeholder="e.g. 4:5 or 21:9"
                    style={{
                      width: '80px',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: '1px solid #D8D2C2',
                      fontSize: '11px',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 600,
                    }}
                  />
                )}
              </div>
            </div>

            {/* Caption Style Dropdown */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#666', display: 'block', marginBottom: '8px' }}>
                CAPTION ANIMATION
              </label>
              <select
                value={captionStyle}
                onChange={(e) => setCaptionStyle(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  border: '1px solid #D8D2C2',
                  backgroundColor: '#FFF',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#121212',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                  cursor: 'pointer',
                }}
              >
                <option value="Hormozi">⚡ Alex Hormozi (Bold Highlight)</option>
                <option value="MrBeast">🔥 MrBeast Pop (Yellow/White)</option>
                <option value="Cinematic Luxury">💎 Cinematic Luxury (Playfair Serif)</option>
                <option value="TikTok Dynamic">📱 TikTok Kinetic (Word Zoom)</option>
                <option value="Clean Minimal">✨ Clean Minimal Fade</option>
              </select>
            </div>

            {/* Caption Background & Glow */}
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#666', display: 'block', marginBottom: '8px' }}>
                CAPTION BACKGROUND
              </label>
              <select
                value={captionBg}
                onChange={(e) => setCaptionBg(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  border: '1px solid #D8D2C2',
                  backgroundColor: '#FFF',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#121212',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
                  cursor: 'pointer',
                }}
              >
                <option value="Pure White Box">⚪ Pure White Solid Box</option>
                <option value="Frosted Glass">🥛 Frosted Glassmorphic</option>
                <option value="Neon Cyber Glow">🌟 Neon Cyber Glow</option>
                <option value="Dark Obsidian Box">⬛ Dark Obsidian Box</option>
                <option value="Transparent Text">🚫 Transparent Clean Text</option>
              </select>
            </div>
          </div>

          {/* AI Model & Custom API Key */}
          <div style={{ borderTop: '1px solid #E2DEC5', paddingTop: '16px', display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px', fontFamily: "'Inter', sans-serif" }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#666', display: 'block', marginBottom: '8px' }}>
                AI MODEL ENGINE
              </label>
              <select
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  border: '1px solid #D8D2C2',
                  backgroundColor: '#FFF',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#121212',
                }}
              >
                <option value="groq">⚡ Groq Llama 3 70B (Sub-Second High Speed)</option>
                <option value="openai">🧠 OpenAI GPT-4o (Deep Reasoning)</option>
                <option value="gemini">✨ Google Gemini 1.5 Pro (Multimodal)</option>
                <option value="anthropic">🎭 Claude 3.5 Sonnet (Creative Hooks)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#666', display: 'block', marginBottom: '8px' }}>
                CUSTOM API KEY (OPTIONAL - MULTI-KEY FAILOVER ACTIVE)
              </label>
              <input
                type="password"
                value={userApiKey}
                onChange={(e) => setUserApiKey(e.target.value)}
                placeholder="Enter custom API key..."
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  border: '1px solid #D8D2C2',
                  backgroundColor: '#FFF',
                  fontSize: '12px',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontWeight: 500,
                  color: '#121212',
                }}
              />
            </div>
          </div>
        </div>

        {/* 3D Glassmorphic Dropzone CTA */}
        <div
          onClick={onUploadClick}
          style={{
            width: '100%',
            maxWidth: '780px',
            backgroundColor: 'rgba(250, 248, 243, 0.75)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '2px dashed #121212',
            borderRadius: '32px',
            padding: '56px 40px',
            cursor: 'pointer',
            boxShadow: '0 20px 50px rgba(0,0,0,0.08), inset 0 0 30px rgba(255,255,255,0.8)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '20px',
            transform: 'rotateX(2deg)',
            transition: 'all 0.3s ease',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              backgroundColor: '#121212',
              color: '#FFF',
              borderRadius: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            }}
          >
            🎬
          </div>

          <div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: '#121212' }}>
              {isUploading ? 'Analyzing Video & Extracting Viral Clips...' : 'Upload Video File to Process'}
            </div>
            <div style={{ fontSize: '14px', fontFamily: "'Inter', sans-serif", color: '#666', marginTop: '8px' }}>
              Selected Preset: {effectiveRatio} • {captionStyle} • {captionBg}
            </div>
          </div>

          <button
            style={{
              backgroundColor: '#121212',
              color: '#FAF8F3',
              padding: '14px 36px',
              borderRadius: '14px',
              fontFamily: "'Inter', sans-serif",
              fontWeight: 700,
              fontSize: '15px',
              border: 'none',
              marginTop: '12px',
              cursor: 'pointer',
              boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
            }}
          >
            {isUploading ? 'Executing Analysis DAG...' : '+ Select Video File'}
          </button>
        </div>
      </div>
    </div>
  );
};

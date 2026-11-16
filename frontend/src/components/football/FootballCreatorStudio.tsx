import React, { useState } from 'react';
import { API_BASE_URL } from '../../config';

export const FootballCreatorStudio: React.FC = () => {
  const [matchInput, setMatchInput] = useState('Real Madrid vs Barcelona 3-2 Champions League');
  const [language, setLanguage] = useState('Hinglish');
  const [style, setStyle] = useState('Passionate Fan');
  const [isResolving, setIsResolving] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'commentary' | 'hooks' | 'publishing'>('commentary');

  const handleResolveMatch = async () => {
    if (!matchInput.trim()) return;
    setIsResolving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/football/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchText: matchInput,
          language,
          style,
        }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error('Failed to resolve football match:', err);
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        width: '100%',
        backgroundColor: '#09090b',
        color: '#f4f4f5',
        padding: '48px 32px',
        overflowY: 'auto',
      }}
    >
      {/* Header Banner */}
      <div style={{ maxWidth: '1200px', margin: '0 auto 40px auto' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11px',
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            letterSpacing: '0.12em',
            color: '#10B981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            padding: '6px 16px',
            borderRadius: '999px',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            marginBottom: '16px',
          }}
        >
          <span>⚽</span> MODE 2 · FOOTBALL CREATOR STUDIO
        </div>

        <h1
          style={{
            fontSize: '38px',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: '#ffffff',
            margin: '0 0 12px 0',
          }}
        >
          Match Intelligence & Multilingual Commentary Engine
        </h1>
        <p style={{ color: '#a1a1aa', fontSize: '16px', margin: 0, maxWidth: '780px' }}>
          Ground your football storytelling in verified event data. Generate dramatic hooks and synchronized commentary in English, Hindi, or Hinglish.
        </p>
      </div>

      {/* Main Workflow Grid */}
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'minmax(320px, 420px) 1fr',
          gap: '32px',
        }}
      >
        {/* Left Column: Match Input & Controls */}
        <div
          style={{
            backgroundColor: '#121215',
            border: '1px solid #27272a',
            borderRadius: '20px',
            padding: '28px',
            height: 'fit-content',
          }}
        >
          <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 20px 0', color: '#fff' }}>
            Match Configuration
          </h2>

          {/* Match Query Input */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#a1a1aa', marginBottom: '8px', fontFamily: "'JetBrains Mono', monospace" }}>
              MATCH TITLE OR YOUTUBE LINK
            </label>
            <input
              type="text"
              value={matchInput}
              onChange={(e) => setMatchInput(e.target.value)}
              placeholder="e.g. Arsenal vs Liverpool 2-2 Premier League"
              style={{
                width: '100%',
                backgroundColor: '#18181b',
                border: '1px solid #3f3f46',
                borderRadius: '10px',
                padding: '12px 14px',
                color: '#fff',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Language Selector */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#a1a1aa', marginBottom: '8px', fontFamily: "'JetBrains Mono', monospace" }}>
              COMMENTARY LANGUAGE
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['Hinglish', 'English', 'Hindi'].map((l) => (
                <button
                  key={l}
                  onClick={() => setLanguage(l)}
                  style={{
                    flex: 1,
                    padding: '10px 8px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: language === l ? 'rgba(16, 185, 129, 0.15)' : '#18181b',
                    color: language === l ? '#10B981' : '#a1a1aa',
                    border: language === l ? '1px solid #10B981' : '1px solid #27272a',
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Style Selector */}
          <div style={{ marginBottom: '28px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: '#a1a1aa', marginBottom: '8px', fontFamily: "'JetBrains Mono', monospace" }}>
              COMMENTARY STYLE
            </label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: '#18181b',
                border: '1px solid #3f3f46',
                borderRadius: '10px',
                padding: '12px 14px',
                color: '#fff',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            >
              <option value="Passionate Fan">🔥 Passionate Fan</option>
              <option value="Professional Commentator">🎙️ Professional Commentator</option>
              <option value="Tactical Analyst">♟️ Tactical Analyst</option>
              <option value="Cinematic Storyteller">🎬 Cinematic Storyteller</option>
              <option value="Funny Creator">😂 Funny Creator</option>
              <option value="Dramatic Narrator">⚡ Dramatic Narrator</option>
            </select>
          </div>

          <button
            onClick={handleResolveMatch}
            disabled={isResolving}
            style={{
              width: '100%',
              backgroundColor: '#10B981',
              color: '#09090b',
              fontWeight: 700,
              fontSize: '14px',
              padding: '14px',
              borderRadius: '10px',
              border: 'none',
              cursor: isResolving ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 16px rgba(16, 185, 129, 0.3)',
            }}
          >
            {isResolving ? 'Analyzing Match & Generating...' : '⚽ Resolve Match & Script'}
          </button>
        </div>

        {/* Right Column: Results & Workspace */}
        <div
          style={{
            backgroundColor: '#121215',
            border: '1px solid #27272a',
            borderRadius: '20px',
            padding: '28px',
            minHeight: '400px',
          }}
        >
          {result ? (
            <div>
              {/* Context Summary Bar */}
              <div
                style={{
                  padding: '18px 24px',
                  backgroundColor: '#18181b',
                  borderRadius: '14px',
                  border: '1px solid #27272a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '24px',
                }}
              >
                <div>
                  <div style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: '#10B981', fontWeight: 700 }}>
                    MATCH RESOLVED · VERIFIED FACTS
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff', marginTop: '4px' }}>
                    {result.commentary?.match_title || matchInput}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', backgroundColor: 'rgba(234, 179, 8, 0.1)', color: '#EAB308', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
                    {language}
                  </span>
                  <span style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', backgroundColor: 'rgba(59, 130, 246, 0.1)', color: '#3B82F6', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                    {style}
                  </span>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #27272a', paddingBottom: '12px', marginBottom: '24px' }}>
                <button
                  onClick={() => setActiveTab('commentary')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: activeTab === 'commentary' ? '#27272a' : 'transparent',
                    color: activeTab === 'commentary' ? '#fff' : '#a1a1aa',
                    border: 'none',
                  }}
                >
                  🎙️ Timed Commentary Script
                </button>
                <button
                  onClick={() => setActiveTab('hooks')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: activeTab === 'hooks' ? '#27272a' : 'transparent',
                    color: activeTab === 'hooks' ? '#fff' : '#a1a1aa',
                    border: 'none',
                  }}
                >
                  ⚡ Opening Hook
                </button>
              </div>

              {/* Tab 1: Commentary Script */}
              {activeTab === 'commentary' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {result.commentary?.segments?.map((seg: any, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        padding: '16px 20px',
                        backgroundColor: '#18181b',
                        borderRadius: '12px',
                        border: '1px solid #27272a',
                        display: 'flex',
                        gap: '20px',
                        alignItems: 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: '12px',
                          fontWeight: 700,
                          color: '#10B981',
                          backgroundColor: 'rgba(16, 185, 129, 0.1)',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {seg.timestamp_display}
                      </div>

                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: '#a1a1aa', marginBottom: '4px', textTransform: 'uppercase' }}>
                          ROLE: {seg.speaker_role}
                        </div>
                        <p style={{ margin: 0, fontSize: '15px', color: '#f4f4f5', lineHeight: 1.5 }}>
                          "{seg.text}"
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Tab 2: Opening Hooks */}
              {activeTab === 'hooks' && (
                <div style={{ padding: '24px', backgroundColor: '#18181b', borderRadius: '14px', border: '1px solid #27272a' }}>
                  <div style={{ fontSize: '12px', color: '#EAB308', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, marginBottom: '10px' }}>
                    PRIMARY OPENING HOOK (FIRST 3 SECONDS)
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#fff', lineHeight: 1.4 }}>
                    "{result.commentary?.opening_hook}"
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                minHeight: '340px',
                color: '#71717a',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚽</div>
              <div style={{ fontSize: '16px', fontWeight: 600, color: '#a1a1aa', marginBottom: '6px' }}>
                No Match Selected Yet
              </div>
              <div style={{ fontSize: '13px', maxWidth: '380px' }}>
                Enter a football fixture or match highlights URL to generate verified timelines, dramatic hooks, and commentary.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

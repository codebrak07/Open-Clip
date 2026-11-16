import React, { useState } from 'react';
import { API_BASE_URL } from '../../config';

export const AIProvidersStudio: React.FC = () => {
  const [activeProvider, setActiveProvider] = useState<string>('nvidia');
  const [testResults, setTestResults] = useState<Record<string, any>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('openclip_provider_keys');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const handleSaveAndTest = async (id: string) => {
    setTestingId(id);
    const key = apiKeys[id]?.trim() || '';
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/providers/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: id, apiKey: key }),
      });
      const data = await res.json();
      const testResult = data.test || data;
      setTestResults((prev) => ({ ...prev, [id]: testResult }));
      if (key) {
        const nextKeys = { ...apiKeys, [id]: key };
        setApiKeys(nextKeys);
        try {
          localStorage.setItem('openclip_provider_keys', JSON.stringify(nextKeys));
        } catch {}
      }
    } catch (err: any) {
      setTestResults((prev) => ({ ...prev, [id]: { success: false, error: err.message } }));
    } finally {
      setTestingId(null);
    }
  };

  const providers = [
    {
      id: 'nvidia',
      name: 'NVIDIA NIM API',
      badge: 'HIGH-PRECISION REASONING',
      models: ['nvidia/nemotron-3.5-bolt-e4b', 'meta/llama-3.3-70b-instruct'],
      description: 'Hosted inference via NVIDIA API Catalog. Engineered for hierarchical reasoning, viral hook extraction, and creative selection.',
      accent: '#2E7D32',
      accentBg: 'rgba(46, 125, 50, 0.08)',
      accentBorder: 'rgba(46, 125, 50, 0.25)',
    },
    {
      id: 'groq',
      name: 'Groq LPU Inference',
      badge: 'ULTRA-FAST SPEED',
      models: ['llama-3.3-70b-versatile', 'llama-3.2-3b-preview'],
      description: 'Sub-second word extraction, fast transcript parsing, rapid hook generation, and structured video editing instructions.',
      accent: '#BD7045',
      accentBg: 'rgba(189, 112, 69, 0.08)',
      accentBorder: 'rgba(189, 112, 69, 0.25)',
    },
    {
      id: 'gemini',
      name: 'Google Gemini AI',
      badge: 'MULTIMODAL & LONG CONTEXT',
      models: ['gemini-3.8-flash', 'gemini-3-flash'],
      description: 'Million-token contextual reasoning across multi-hour long-form podcasts, video understanding, and thumbnail synthesis.',
      accent: '#355C7D',
      accentBg: 'rgba(53, 92, 125, 0.08)',
      accentBorder: 'rgba(53, 92, 125, 0.25)',
    },
  ];

  return (
    <div
      style={{
        flex: 1,
        width: '100%',
        backgroundColor: '#F5F4F0',
        color: '#171717',
        padding: '48px 32px',
        overflowY: 'auto',
      }}
    >
      <div style={{ maxWidth: '1100px', margin: '0 auto 40px auto' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11px',
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            letterSpacing: '0.12em',
            color: '#171717',
            backgroundColor: '#FFFFFF',
            padding: '6px 16px',
            borderRadius: '999px',
            border: '1px solid #DFDDD5',
            marginBottom: '16px',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)',
          }}
        >
          <span>🧠</span> MULTI-PROVIDER AI ORCHESTRATION
        </div>

        <h1
          style={{
            fontSize: '36px',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: '#171717',
            margin: '0 0 12px 0',
          }}
        >
          First-Class Intelligence Providers
        </h1>
        <p style={{ color: '#62615D', fontSize: '16px', margin: 0, maxWidth: '780px' }}>
          OpenClip operates with zero provider lock-in. Switch seamlessly between NVIDIA NIM, Groq LPU, and Google Gemini with runtime failover and local verification.
        </p>
      </div>

      <div
        style={{
          maxWidth: '1100px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '24px',
        }}
      >
        {providers.map((p) => {
          const testRes = testResults[p.id];
          const isSelected = activeProvider === p.id;
          const isTesting = testingId === p.id;

          return (
            <div
              key={p.id}
              style={{
                backgroundColor: '#FFFFFF',
                border: isSelected ? `2px solid ${p.accent}` : '1px solid #DFDDD5',
                borderRadius: '20px',
                padding: '28px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                boxShadow: isSelected ? '0 12px 32px rgba(0, 0, 0, 0.08)' : '0 4px 16px rgba(0, 0, 0, 0.03)',
                transition: 'all 0.25s ease',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <span
                    style={{
                      fontSize: '10px',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 700,
                      color: p.accent,
                      backgroundColor: p.accentBg,
                      border: `1px solid ${p.accentBorder}`,
                      padding: '4px 10px',
                      borderRadius: '6px',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {p.badge}
                  </span>
                  {isSelected && (
                    <span style={{ fontSize: '11px', color: '#2E7D32', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
                      ● ACTIVE
                    </span>
                  )}
                </div>

                <h3 style={{ fontSize: '22px', fontWeight: 700, color: '#171717', margin: '0 0 8px 0', letterSpacing: '-0.02em' }}>
                  {p.name}
                </h3>

                <p style={{ fontSize: '14px', color: '#62615D', lineHeight: 1.55, margin: '0 0 20px 0' }}>
                  {p.description}
                </p>

                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: '#898781', marginBottom: '8px', letterSpacing: '0.06em' }}>
                    MODELS SUPPORTED
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {p.models.map((m) => (
                      <span
                        key={m}
                        style={{
                          fontSize: '12px',
                          fontFamily: "'JetBrains Mono', monospace",
                          padding: '6px 10px',
                          borderRadius: '6px',
                          backgroundColor: '#F9F9F8',
                          border: '1px solid #DFDDD5',
                          color: '#171717',
                        }}
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>

                {/* API Key Configuration Input */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", color: '#898781', letterSpacing: '0.06em' }}>
                      API KEY CREDENTIAL
                    </label>
                    {apiKeys[p.id] && (
                      <span style={{ fontSize: '10px', color: '#2E7D32', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
                        KEY CONFIGURED
                      </span>
                    )}
                  </div>
                  <input
                    type="password"
                    placeholder={`Enter ${p.name} key...`}
                    value={apiKeys[p.id] || ''}
                    onChange={(e) => setApiKeys({ ...apiKeys, [p.id]: e.target.value })}
                    style={{
                      width: '100%',
                      backgroundColor: '#F9F9F8',
                      border: '1px solid #DFDDD5',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      fontSize: '12px',
                      color: '#171717',
                      fontFamily: "'JetBrains Mono', monospace",
                      boxSizing: 'border-box',
                      outline: 'none',
                    }}
                  />
                </div>

                {testRes && (
                  <div
                    style={{
                      padding: '12px 14px',
                      borderRadius: '8px',
                      marginBottom: '16px',
                      backgroundColor: testRes.success ? 'rgba(46, 125, 50, 0.08)' : 'rgba(169, 78, 80, 0.08)',
                      border: testRes.success ? '1px solid rgba(46, 125, 50, 0.25)' : '1px solid rgba(169, 78, 80, 0.25)',
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 600, color: testRes.success ? '#2E7D32' : '#A94E50' }}>
                      {testRes.success ? `✓ Connected (${testRes.latencyMs}ms)` : `✗ Connection Failed`}
                    </div>
                    {testRes.error && (
                      <div style={{ fontSize: '11px', color: '#A94E50', marginTop: '4px' }}>
                        {testRes.error}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button
                  onClick={() => handleSaveAndTest(p.id)}
                  disabled={isTesting}
                  style={{
                    flex: 1,
                    padding: '11px',
                    borderRadius: '8px',
                    backgroundColor: '#171717',
                    color: '#FFFFFF',
                    border: 'none',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: isTesting ? 'not-allowed' : 'pointer',
                    transition: 'opacity 0.2s',
                    opacity: isTesting ? 0.7 : 1,
                  }}
                >
                  {isTesting ? 'Verifying...' : apiKeys[p.id] ? 'Save & Test Key' : 'Test Connection'}
                </button>

                <button
                  onClick={() => setActiveProvider(p.id)}
                  style={{
                    padding: '11px 18px',
                    borderRadius: '8px',
                    backgroundColor: isSelected ? p.accentBg : '#F5F4F0',
                    color: isSelected ? p.accent : '#62615D',
                    border: `1px solid ${isSelected ? p.accentBorder : '#DFDDD5'}`,
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {isSelected ? 'Default' : 'Set Default'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

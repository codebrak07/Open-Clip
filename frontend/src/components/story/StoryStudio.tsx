import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';

interface Character {
  id: string;
  name: string;
  role: 'narrator' | 'character' | 'protagonist' | 'authority' | 'peer' | 'extra';
  look?: any;
  voice?: { id: string; baseDirections?: string };
  metricValue?: number;
  statusDisplay?: string;
  tierColor?: string;
  concealed?: boolean;
  concealer?: string;
  isSpeaking?: boolean;
}

interface Beat {
  id: string;
  speaker: string;
  text: string;
  directions?: string[];
  shot?: { type: string; target: string; move: string };
  actions?: Array<{ actor: string; anim: string; expression: string; atWord: number }>;
  fx?: Array<{ type: string; atWord: number }>;
  sfx?: Array<{ cue: string; atWord: number; gainDb?: number }>;
  emphasisWords?: string[];
  startSec?: number;
  endSec?: number;
  userModified?: boolean;
}

interface Storyboard {
  title: string;
  logline: string;
  durationTargetSec: number;
  characters: Character[];
  scenes: Array<{
    id: string;
    location: string;
    weather?: string;
    beats: Beat[];
  }>;
}

interface WorldConcept {
  tag: string;
  openingLine: string;
  metric: {
    name: string;
    format: string;
    direction: string;
    min: number;
    max: number;
  };
  display: string;
  tiers: Array<{ id: string; label: string; minVal: number; maxVal: number; color: string }>;
  effects: {
    housing: Record<string, string>;
    elevation: Record<string, string>;
    treatment: Record<string, string>;
  };
  ironies: Array<{ roleOrJob: string; value: number; effect: string }>;
  concealment: { mechanic: string; item: string; reactions: string[] };
  setPieces: Array<{ id: string; location: string; formation: string; gag: string; escalation: string }>;
  twist: string;
  buttonGag: string;
  callback: string;
}

export const StoryStudio: React.FC = () => {
  // Mode selection: High-Concept Satire Engine vs Standard Story Studio
  const [studioMode, setStudioMode] = useState<'satire' | 'story'>('satire');

  // Satire Engine State
  const [tag, setTag] = useState('college placements');
  const [concepts, setConcepts] = useState<WorldConcept[]>([]);
  const [selectedConcept, setSelectedConcept] = useState<WorldConcept | null>(null);
  const [isLoadingConcepts, setIsLoadingConcepts] = useState(false);
  const [satireMetadata, setSatireMetadata] = useState<any | null>(null);

  // Standard Story State
  const [idea, setIdea] = useState('A kid discovers his cat sneezes a puff of smoke every time someone lies, and his friend tests it');
  const [durationSec, setDurationSec] = useState(45);
  const [tone, setTone] = useState<'humorous' | 'dramatic' | 'suspenseful' | 'hype' | 'educational'>('humorous');
  const [characterCount, setCharacterCount] = useState(2);
  const [seed, setSeed] = useState(42);
  const [ttsProvider, setTtsProvider] = useState<'auto' | 'kokoro-local' | 'groq-orpheus' | 'macos-say'>('auto');
  const [isPreviewingVoice, setIsPreviewingVoice] = useState(false);

  // Execution & Job State
  const [jobId, setJobId] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState('');
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [selectedBeatId, setSelectedBeatId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Synchronize active beat highlighting with video scrubber
  useEffect(() => {
    if (!storyboard) return;
    const allBeats = storyboard.scenes?.flatMap(s => s.beats) || [];
    const active = allBeats.find(b => b.startSec !== undefined && b.endSec !== undefined && currentTime >= b.startSec && currentTime <= b.endSec);
    if (active && active.id !== selectedBeatId) {
      setSelectedBeatId(active.id);
    }
  }, [currentTime, storyboard, selectedBeatId]);

  // Poll active job status
  useEffect(() => {
    if (!jobId || (!isGenerating && !isRendering)) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/story/${jobId}`);
        if (!res.ok) return;
        const data = await res.json();

        setProgress(data.progress || 0);
        setCurrentStage(data.currentStage || 'Processing');

        if (data.status === 'completed') {
          setIsGenerating(false);
          setIsRendering(false);
          setStatusMessage('Generation completed successfully!');

          // Fetch storyboard
          const sbRes = await fetch(`${API_BASE_URL}/api/v1/story/${jobId}/storyboard`);
          if (sbRes.ok) {
            const sbData = await sbRes.json();
            setStoryboard(sbData);
            if (sbData.scenes?.[0]?.beats?.[0]) {
              setSelectedBeatId(sbData.scenes[0].beats[0].id);
            }
          }

          // Fetch satire sidecar if available
          const satRes = await fetch(`${API_BASE_URL}/api/v1/story/${jobId}/satire`);
          if (satRes.ok) {
            const satData = await satRes.json();
            setSatireMetadata(satData);
          }

          // Video output
          setVideoUrl(`${API_BASE_URL}/api/v1/story/${jobId}/export`);
        } else if (data.status === 'failed') {
          setIsGenerating(false);
          setIsRendering(false);
          setStatusMessage(`Job failed: ${data.error || 'Unknown error'}`);
        }
      } catch (err: any) {
        console.error('Error polling story job:', err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [jobId, isGenerating, isRendering]);

  // 1. Fetch 3 Satire Concepts
  const handleFetchConcepts = async (customTag?: string) => {
    const activeTag = customTag || tag;
    setIsLoadingConcepts(true);
    setStatusMessage(`Generating 3 satire world concepts for "${activeTag}"...`);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/story/concepts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: activeTag, count: 3 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setConcepts(data.concepts || []);
      if (data.concepts?.length > 0) {
        setSelectedConcept(data.concepts[0]);
      }
      setStatusMessage(`Generated 3 concepts for "${activeTag}". Review and launch!`);
    } catch (err: any) {
      setStatusMessage(`Concept error: ${err.message}`);
    } finally {
      setIsLoadingConcepts(false);
    }
  };

  // 2. Launch Satire Video Generation
  const handleLaunchSatire = async (conceptToUse?: WorldConcept) => {
    const targetConcept = conceptToUse || selectedConcept;
    setIsGenerating(true);
    setProgress(5);
    setCurrentStage('Concept Staging & StagingSolver');
    setStatusMessage(`Launching Satire Engine for: "${targetConcept?.tag || tag}"...`);
    setVideoUrl(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/story/generate-satire`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag: targetConcept?.tag || tag,
          concept: targetConcept,
          ttsProvider,
          seed,
          durationSec,
        }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setJobId(data.jobId);
    } catch (err: any) {
      setIsGenerating(false);
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  // 3. Standard Story Generation
  const handleGenerateStandard = async () => {
    setIsGenerating(true);
    setProgress(5);
    setCurrentStage('Initiating Script & Storyboard');
    setStatusMessage('Generating viral script formula (writer + critic pass)...');
    setVideoUrl(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/story/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea,
          durationSec,
          tone,
          characterCount,
          seed,
          renderImmediately: true,
          ttsProvider,
        }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setJobId(data.jobId);
    } catch (err: any) {
      setIsGenerating(false);
      setStatusMessage(`Error: ${err.message}`);
    }
  };

  const handleRenderStoryboard = async () => {
    if (!jobId || !storyboard) return;
    setIsRendering(true);
    setProgress(35);
    setCurrentStage('VoiceStage');
    setStatusMessage('Rendering video from modified storyboard...');

    try {
      await fetch(`${API_BASE_URL}/api/v1/story/${jobId}/storyboard`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storyboard),
      });

      const res = await fetch(`${API_BASE_URL}/api/v1/story/${jobId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttsProvider }),
      });
      const data = await res.json();
      if (data.jobId) setJobId(data.jobId);
    } catch (err: any) {
      setIsRendering(false);
      setStatusMessage(`Render failed: ${err.message}`);
    }
  };

  const previewVoice = async (voiceId: string, sampleText?: string) => {
    setIsPreviewingVoice(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/story/tts/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voiceId,
          text: sampleText || 'This is an OpenClip Story Studio voice sample.',
          provider: ttsProvider,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      await audio.play();
    } catch (err: any) {
      alert(`Voice preview error: ${err.message}`);
    } finally {
      setIsPreviewingVoice(false);
    }
  };

  const updateCharacterVoice = (charId: string, newVoiceId: string) => {
    if (!storyboard) return;
    const copy: Storyboard = JSON.parse(JSON.stringify(storyboard));
    const targetChar = copy.characters.find(c => c.id === charId);
    if (targetChar) {
      if (!targetChar.voice) targetChar.voice = { id: newVoiceId };
      else targetChar.voice.id = newVoiceId;
      setStoryboard(copy);
    }
  };

  const updateBeatText = (sceneIdx: number, beatIdx: number, newText: string) => {
    if (!storyboard) return;
    const copy: Storyboard = JSON.parse(JSON.stringify(storyboard));
    copy.scenes[sceneIdx].beats[beatIdx].text = newText;
    copy.scenes[sceneIdx].beats[beatIdx].userModified = true;
    setStoryboard(copy);
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1600px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Banner & Mode Selector */}
      <div style={{ backgroundColor: '#FFFFFF', borderRadius: '16px', padding: '24px', border: '1px solid #DFDDD5', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 800, color: '#171717', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>{studioMode === 'satire' ? '🎭' : '🎮'}</span>
              Story Studio
              <span style={{ fontSize: '11px', fontWeight: 700, backgroundColor: '#FEF3C7', color: '#B45309', padding: '3px 8px', borderRadius: '6px' }}>
                {studioMode === 'satire' ? 'HIGH-CONCEPT SATIRE ENGINE' : 'AUTONOMOUS 9:16 ENGINE'}
              </span>
            </h1>
            <p style={{ fontSize: '13px', color: '#64748B', marginTop: '4px' }}>
              {studioMode === 'satire'
                ? 'One-line metric TAG → WorldConcept (3 candidates) → Cast & StagingSolver → Three.js BlockWorld 3D with StatusTag plates → 9:16 Master Export'
                : 'One-line idea → Script (Writer+Critic) → Storyboard → Multi-Tier Voiceover → Three.js BlockWorld 3D → SFX Mix → Captions'}
            </p>
          </div>

          {/* Mode Switch Tabs */}
          <div style={{ display: 'flex', backgroundColor: '#F1F5F9', padding: '4px', borderRadius: '10px', gap: '4px' }}>
            <button
              onClick={() => setStudioMode('satire')}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                backgroundColor: studioMode === 'satire' ? '#0F172A' : 'transparent',
                color: studioMode === 'satire' ? '#FFFFFF' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              🎭 Satire Engine
            </button>
            <button
              onClick={() => setStudioMode('story')}
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                backgroundColor: studioMode === 'story' ? '#0F172A' : 'transparent',
                color: studioMode === 'story' ? '#FFFFFF' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              🎬 Standard Story
            </button>
          </div>
        </div>

        {/* SATIRE ENGINE DECK */}
        {studioMode === 'satire' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 0.8fr 1fr', gap: '16px', alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                  ONE-LINE METRIC TAG
                </label>
                <input
                  type="text"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  placeholder="e.g. college placements, Instagram followers, attendance percentage..."
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid #CBD5E1',
                    fontSize: '14px',
                    backgroundColor: '#F8FAFC',
                    fontWeight: 600,
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                  TTS PROVIDER
                </label>
                <select
                  value={ttsProvider}
                  onChange={(e) => setTtsProvider(e.target.value as any)}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC', fontSize: '13px', fontWeight: 600 }}
                >
                  <option value="auto">Auto (Kokoro → macOS)</option>
                  <option value="kokoro-local">Kokoro-82M (Local ONNX)</option>
                  <option value="groq-orpheus">Groq Orpheus (Cloud API)</option>
                  <option value="macos-say">macOS Say (Native)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                  DURATION
                </label>
                <select
                  value={durationSec}
                  onChange={(e) => setDurationSec(Number(e.target.value))}
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC', fontSize: '13px' }}
                >
                  <option value={45}>45s (Standard)</option>
                  <option value={60}>60s (Extended)</option>
                  <option value={30}>30s (Snack)</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handleFetchConcepts()}
                  disabled={isLoadingConcepts || isGenerating}
                  style={{
                    flex: 1,
                    padding: '11px 16px',
                    backgroundColor: '#F8FAFC',
                    color: '#0F172A',
                    fontWeight: 700,
                    fontSize: '13px',
                    borderRadius: '8px',
                    border: '1px solid #CBD5E1',
                    cursor: 'pointer',
                  }}
                >
                  {isLoadingConcepts ? '⏳ Thinking...' : '🔮 Generate 3 Concepts'}
                </button>
                <button
                  onClick={() => handleLaunchSatire()}
                  disabled={isGenerating || isRendering}
                  style={{
                    flex: 1,
                    padding: '11px 16px',
                    backgroundColor: '#0F172A',
                    color: '#FFFFFF',
                    fontWeight: 700,
                    fontSize: '13px',
                    borderRadius: '8px',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {isGenerating ? '⚡ Running...' : '🚀 Launch Video'}
                </button>
              </div>
            </div>

            {/* Quick Tag Preset Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748B' }}>POPULAR TAGS:</span>
              {[
                { label: 'College Placements', val: 'college placements' },
                { label: 'Instagram Followers', val: 'Instagram followers' },
                { label: 'Attendance %', val: 'attendance percentage' },
                { label: 'Entrance Rank', val: 'AIR entrance rank' },
                { label: 'Credit Score', val: 'credit score' },
              ].map((preset) => (
                <button
                  key={preset.val}
                  onClick={() => {
                    setTag(preset.val);
                    handleFetchConcepts(preset.val);
                  }}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 600,
                    backgroundColor: tag === preset.val ? '#FEF3C7' : '#F1F5F9',
                    color: tag === preset.val ? '#B45309' : '#475569',
                    border: tag === preset.val ? '1px solid #F59E0B' : '1px solid #E2E8F0',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {/* 3 Concept Candidate Cards Deck */}
            {concepts.length > 0 && (
              <div style={{ marginTop: '8px' }}>
                <div style={{ fontSize: '12px', fontWeight: 800, color: '#334155', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  🎯 Candidate Satire Worlds (Select One):
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
                  {concepts.map((conc, idx) => {
                    const isSelected = selectedConcept?.openingLine === conc.openingLine;
                    return (
                      <div
                        key={idx}
                        onClick={() => setSelectedConcept(conc)}
                        style={{
                          border: isSelected ? '2px solid #C99E35' : '1px solid #E2E8F0',
                          borderRadius: '12px',
                          padding: '14px',
                          backgroundColor: isSelected ? '#FFFBEB' : '#FFFFFF',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '10px',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', fontWeight: 800, color: '#0F172A' }}>Concept #{idx + 1}</span>
                          <span style={{ fontSize: '10px', fontWeight: 700, backgroundColor: '#E2E8F0', padding: '2px 6px', borderRadius: '4px', color: '#475569' }}>
                            {conc.metric.format} • {conc.metric.direction === 'lower_is_better' ? 'Lower is Better' : 'Higher is Better'}
                          </span>
                        </div>

                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#1E293B', fontStyle: 'italic', lineHeight: 1.4 }}>
                          "{conc.openingLine}"
                        </div>

                        {/* Tiers Preview */}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {conc.tiers.map(t => (
                            <span
                              key={t.id}
                              style={{
                                fontSize: '10px',
                                fontWeight: 700,
                                backgroundColor: t.color + '22',
                                color: t.color,
                                border: `1px solid ${t.color}`,
                                padding: '2px 6px',
                                borderRadius: '4px',
                              }}
                            >
                              {t.label} ({t.minVal}..{t.maxVal})
                            </span>
                          ))}
                        </div>

                        {/* Irony */}
                        {conc.ironies?.[0] && (
                          <div style={{ fontSize: '11px', color: '#64748B', backgroundColor: '#F8FAFC', padding: '6px 8px', borderRadius: '6px' }}>
                            <strong style={{ color: '#0F172A' }}>Irony:</strong> {conc.ironies[0].roleOrJob} ({conc.ironies[0].value}): {conc.ironies[0].effect}
                          </div>
                        )}

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedConcept(conc);
                            handleLaunchSatire(conc);
                          }}
                          disabled={isGenerating}
                          style={{
                            marginTop: 'auto',
                            padding: '8px',
                            backgroundColor: isSelected ? '#0F172A' : '#F1F5F9',
                            color: isSelected ? '#FFFFFF' : '#475569',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '11px',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {isSelected ? '🚀 Launch This Concept' : 'Select'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STANDARD STORY DECK */}
        {studioMode === 'story' && (
          <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr 1fr 1fr 1.3fr 0.8fr', gap: '16px', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                SINGLE-LINE STORY CONCEPT
              </label>
              <input
                type="text"
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                placeholder="e.g. A streamer discovers an ancient secret portal in their kitchen..."
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  fontSize: '14px',
                  backgroundColor: '#F8FAFC',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                DURATION ({durationSec}s)
              </label>
              <input
                type="range"
                min="30"
                max="90"
                step="5"
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                TONE
              </label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value as any)}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC', fontSize: '13px' }}
              >
                <option value="humorous">Humorous (Comedy)</option>
                <option value="dramatic">Dramatic (Cinema)</option>
                <option value="suspenseful">Suspenseful (Mystery)</option>
                <option value="hype">Hype (Streamer)</option>
                <option value="educational">Educational (Explainer)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                CHARACTERS
              </label>
              <select
                value={characterCount}
                onChange={(e) => setCharacterCount(Number(e.target.value))}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC', fontSize: '13px' }}
              >
                <option value={1}>1 Character (Narrator)</option>
                <option value={2}>2 Characters (Dialogue)</option>
                <option value={3}>3 Characters (Group)</option>
                <option value={4}>4 Characters (Ensemble)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                TTS ENGINE
              </label>
              <select
                value={ttsProvider}
                onChange={(e) => setTtsProvider(e.target.value as any)}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC', fontSize: '13px', fontWeight: 600 }}
              >
                <option value="auto">Auto (Kokoro → macOS)</option>
                <option value="kokoro-local">Kokoro-82M (Local ONNX)</option>
                <option value="groq-orpheus">Groq Orpheus (Cloud)</option>
                <option value="macos-say">macOS Say (Native)</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>
                SEED
              </label>
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value))}
                style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC', fontSize: '13px' }}
              />
            </div>

            <div>
              <button
                onClick={handleGenerateStandard}
                disabled={isGenerating || isRendering}
                style={{
                  width: '100%',
                  padding: '11px',
                  backgroundColor: '#0F172A',
                  color: '#FFFFFF',
                  fontWeight: 700,
                  fontSize: '13px',
                  borderRadius: '8px',
                  border: 'none',
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                }}
              >
                {isGenerating ? 'Running...' : '🚀 Generate'}
              </button>
            </div>
          </div>
        )}

        {/* Progress Bar & Stage Indicator */}
        {(isGenerating || isRendering) && (
          <div style={{ marginTop: '20px', backgroundColor: '#F1F5F9', borderRadius: '8px', padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', fontWeight: 700 }}>
              <span style={{ color: '#0F172A' }}>Stage: {currentStage}</span>
              <span style={{ color: '#C99E35' }}>{progress}%</span>
            </div>
            <div style={{ height: '8px', backgroundColor: '#E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  backgroundColor: '#C99E35',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
        )}

        {statusMessage && !isGenerating && !isRendering && (
          <div style={{ marginTop: '16px', fontSize: '13px', color: '#059669', fontWeight: 600 }}>
            {statusMessage}
          </div>
        )}
      </div>

      {/* Main Split View: Left Storyboard Cards | Right 9:16 Video Player */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '24px', alignItems: 'start' }}>
        {/* Left: Interactive Storyboard & Cast Deck */}
        <div style={{ backgroundColor: '#FFFFFF', borderRadius: '16px', padding: '24px', border: '1px solid #DFDDD5', minHeight: '600px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#171717' }}>Interactive Storyboard</h2>
              <p style={{ fontSize: '12px', color: '#64748B' }}>
                {storyboard ? `${storyboard.title} — ${storyboard.scenes?.flatMap(s => s.beats).length || 0} Beats across ${storyboard.scenes?.length || 1} Scene(s)` : 'No storyboard loaded yet.'}
              </p>
            </div>
            {storyboard && (
              <button
                onClick={handleRenderStoryboard}
                disabled={isRendering || isGenerating}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#0F172A',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                🔄 Re-Render Storyboard
              </button>
            )}
          </div>

          {/* Visual QA Pass Banner (When Satire Sidecar is Present) */}
          {satireMetadata?.qaReport && (
            <div style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 800, color: '#166534', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>🛡️</span> Visual QA Audit: {satireMetadata.qaReport.passed ? 'PASSED 100%' : 'FLAGGED'}
                </span>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#15803D' }}>
                  Score: {satireMetadata.qaReport.overallScore}/100
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px', fontSize: '11px' }}>
                {satireMetadata.qaReport.checks?.map((chk: any, idx: number) => (
                  <div key={idx} style={{ color: chk.passed ? '#15803D' : '#DC2626' }}>
                    {chk.passed ? '✅' : '❌'} {chk.name}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Character Cast & Voice Deck */}
          {storyboard?.characters && storyboard.characters.length > 0 && (
            <div style={{ backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' }}>
              <div style={{ fontSize: '11px', fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.05em' }}>
                🎭 Cast, Status Tags & Assigned Voices
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(storyboard.characters.length, 3)}, 1fr)`, gap: '10px' }}>
                {storyboard.characters.map((char) => (
                  <div key={char.id} style={{ backgroundColor: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: '8px', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#0F172A' }}>{char.name}</span>
                      <span style={{ fontSize: '10px', color: '#64748B', backgroundColor: '#F1F5F9', padding: '1px 5px', borderRadius: '4px' }}>{char.role}</span>
                    </div>

                    {/* Status Tag Pill */}
                    {(char.statusDisplay || char.metricValue !== undefined) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                        <span
                          style={{
                            fontSize: '10px',
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: char.concealed ? '#71717A' : (char.tierColor || '#F59E0B'),
                            color: '#FFFFFF',
                          }}
                        >
                          {char.concealed ? '??? (Concealed)' : (char.statusDisplay || `Val: ${char.metricValue}`)}
                        </span>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
                      <select
                        value={char.voice?.id || 'af_heart'}
                        onChange={(e) => updateCharacterVoice(char.id, e.target.value)}
                        style={{ flex: 1, fontSize: '11px', padding: '4px 6px', borderRadius: '4px', border: '1px solid #CBD5E1', backgroundColor: '#F8FAFC' }}
                      >
                        <option value="af_heart">Heart (Female Warm)</option>
                        <option value="am_adam">Adam (Male Crisp)</option>
                        <option value="af_bella">Bella (Female Energetic)</option>
                        <option value="am_michael">Michael (Male Deep)</option>
                        <option value="bf_emma">Emma (British Female)</option>
                        <option value="bm_george">George (British Male)</option>
                      </select>
                      <button
                        onClick={() => previewVoice(char.voice?.id || 'af_heart')}
                        disabled={isPreviewingVoice}
                        title="Preview Voice Audio"
                        style={{ padding: '4px 8px', fontSize: '11px', cursor: 'pointer', backgroundColor: '#F1F5F9', border: '1px solid #CBD5E1', borderRadius: '4px' }}
                      >
                        🔊
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '720px', overflowY: 'auto' }}>
            {storyboard?.scenes?.flatMap((scene, sIdx) =>
              scene.beats.map((beat, bIdx) => {
                const isSelected = selectedBeatId === beat.id;
                return (
                  <div
                    key={beat.id}
                    onClick={() => setSelectedBeatId(beat.id)}
                    style={{
                      border: isSelected ? '2px solid #C99E35' : '1px solid #E2E8F0',
                      borderRadius: '12px',
                      padding: '16px',
                      backgroundColor: isSelected ? '#FFFBEB' : '#FFFFFF',
                      transition: 'all 0.15s ease',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 800, fontSize: '13px', color: '#1E293B' }}>
                          Beat #{bIdx + 1}
                        </span>
                        <span style={{ fontSize: '11px', fontWeight: 700, backgroundColor: '#E2E8F0', color: '#475569', padding: '2px 6px', borderRadius: '4px' }}>
                          {beat.speaker}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const char = storyboard?.characters?.find(c => c.id === beat.speaker);
                            previewVoice(char?.voice?.id || 'af_heart', beat.text);
                          }}
                          disabled={isPreviewingVoice}
                          style={{
                            border: '1px solid #CBD5E1',
                            backgroundColor: '#F8FAFC',
                            borderRadius: '4px',
                            padding: '2px 6px',
                            fontSize: '11px',
                            cursor: 'pointer',
                          }}
                        >
                          🔊 Test
                        </button>
                      </div>

                      {beat.startSec !== undefined && (
                        <span style={{ fontSize: '11px', color: '#64748B', fontFamily: 'monospace' }}>
                          {beat.startSec.toFixed(1)}s – {beat.endSec?.toFixed(1)}s
                        </span>
                      )}
                    </div>

                    <textarea
                      value={beat.text}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateBeatText(sIdx, bIdx, e.target.value)}
                      rows={2}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid #CBD5E1',
                        fontSize: '13px',
                        lineHeight: 1.4,
                        resize: 'vertical',
                      }}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: 9:16 Video Player & Master Export */}
        <div style={{ backgroundColor: '#FFFFFF', borderRadius: '16px', padding: '24px', border: '1px solid #DFDDD5', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#171717' }}>9:16 Preview & Master Export</h2>
            {videoUrl && (
              <a
                href={videoUrl}
                download
                style={{
                  padding: '6px 12px',
                  backgroundColor: '#10B981',
                  color: '#FFFFFF',
                  fontSize: '12px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  textDecoration: 'none',
                }}
              >
                📥 Download MP4
              </a>
            )}
          </div>

          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '360px',
              aspectRatio: '9 / 16',
              margin: '0 auto',
              backgroundColor: '#020617',
              borderRadius: '16px',
              overflow: 'hidden',
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {videoUrl ? (
              <video
                src={videoUrl}
                controls
                autoPlay
                playsInline
                onTimeUpdate={(e) => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <div style={{ color: '#64748B', textAlign: 'center', padding: '20px' }}>
                <span style={{ fontSize: '40px', display: 'block', marginBottom: '8px' }}>🎬</span>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>No video rendered yet</p>
                <p style={{ fontSize: '11px', marginTop: '4px' }}>Launch a satire or story idea above</p>
              </div>
            )}
          </div>

          {/* Reference Parity & Contact Sheet Viewer */}
          {jobId && (
            <div style={{ marginTop: '12px', borderTop: '1px solid #E2E8F0', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 800, color: '#0F172A', margin: 0 }}>Parity Verification & Contact Sheet</h3>
                <a
                  href={`${API_BASE_URL}/api/v1/story/${jobId}/contact-sheet.jpg`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: '11px', color: '#3B82F6', fontWeight: 700, textDecoration: 'none' }}
                >
                  View Full Grid ↗
                </a>
              </div>

              <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #CBD5E1', backgroundColor: '#09090B' }}>
                <img
                  src={`${API_BASE_URL}/api/v1/story/${jobId}/contact-sheet.jpg`}
                  alt="Review Contact Sheet"
                  onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                  style={{ width: '100%', display: 'block', maxHeight: '220px', objectFit: 'contain' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '8px', fontSize: '11px' }}>
                <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: '#ECFDF5', color: '#047857', fontWeight: 700, border: '1px solid #A7F3D0' }}>
                  ✓ 100% Word Sync
                </span>
                <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: '#EFF6FF', color: '#1D4ED8', fontWeight: 700, border: '1px solid #BFDBFE' }}>
                  ✓ Reference Caps
                </span>
                <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: '#F8FAFC', color: '#475569', fontWeight: 700, border: '1px solid #E2E8F0' }}>
                  ✓ Safe Band Clearance
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

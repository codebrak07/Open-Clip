import React, { useState } from 'react';

export interface CreatorControlState {
  customPrompt: string;
  targetAudience: string;
  tone: string;
  subtitleStyle: string;
}

interface AIDirectorControlsProps {
  onApplyControls: (controls: CreatorControlState) => void;
  onBatchRender?: () => void;
  isBatchRendering?: boolean;
}

export const AIDirectorControls: React.FC<AIDirectorControlsProps> = ({
  onApplyControls,
  onBatchRender,
  isBatchRendering = false,
}) => {
  const [customPrompt, setCustomPrompt] = useState('');
  const [targetAudience, setTargetAudience] = useState('Developers');
  const [tone, setTone] = useState('Viral');
  const [subtitleStyle, setSubtitleStyle] = useState('Alex Hormozi');

  const handleApply = () => {
    onApplyControls({
      customPrompt,
      targetAudience,
      tone,
      subtitleStyle,
    });
  };

  return (
    <div
      style={{
        padding: 'var(--space-4) var(--space-6)',
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-family-mono)', letterSpacing: '0.05em' }}>
          AI DIRECTOR CUSTOM INTENT & STRUCTURED CONTROLS
        </div>
        {onBatchRender && (
          <button
            onClick={onBatchRender}
            disabled={isBatchRendering}
            style={{
              backgroundColor: isBatchRendering ? 'var(--accent-warning)' : 'var(--accent-viral)',
              color: '#000',
              padding: 'var(--space-1) var(--space-3)',
              borderRadius: '4px',
              fontWeight: 700,
              fontSize: '11px',
              cursor: isBatchRendering ? 'not-allowed' : 'pointer',
            }}
          >
            {isBatchRendering ? 'Batch Rendering Top Clips...' : 'Batch Render Top 5 Clips'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Custom Prompt Input */}
        <input
          type="text"
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="Custom AI Director Prompt (e.g. 'Extract startup advice & funny moments')..."
          style={{
            flex: 2,
            minWidth: '280px',
            backgroundColor: 'var(--bg-canvas)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: '6px',
            fontSize: 'var(--text-xs)',
          }}
        />

        {/* Target Audience Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Audience:</span>
          <select
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            style={{
              backgroundColor: 'var(--bg-canvas)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              padding: 'var(--space-1) var(--space-2)',
              borderRadius: '4px',
              fontSize: '11px',
            }}
          >
            <option value="General">General</option>
            <option value="Developers">Developers</option>
            <option value="Founders">Founders</option>
            <option value="Students">Students</option>
            <option value="Gamers">Gamers</option>
            <option value="Fitness">Fitness</option>
            <option value="Finance">Finance</option>
          </select>
        </div>

        {/* Tone Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Tone:</span>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            style={{
              backgroundColor: 'var(--bg-canvas)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              padding: 'var(--space-1) var(--space-2)',
              borderRadius: '4px',
              fontSize: '11px',
            }}
          >
            <option value="Viral">Viral</option>
            <option value="Educational">Educational</option>
            <option value="Funny">Funny</option>
            <option value="Serious">Serious</option>
            <option value="Inspirational">Inspirational</option>
            <option value="Professional">Professional</option>
          </select>
        </div>

        {/* Subtitle Style Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Captions:</span>
          <select
            value={subtitleStyle}
            onChange={(e) => setSubtitleStyle(e.target.value)}
            style={{
              backgroundColor: 'var(--bg-canvas)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              padding: 'var(--space-1) var(--space-2)',
              borderRadius: '4px',
              fontSize: '11px',
            }}
          >
            <option value="Alex Hormozi">Alex Hormozi</option>
            <option value="MrBeast">MrBeast</option>
            <option value="Ali Abdaal">Ali Abdaal</option>
            <option value="Minimal">Minimal</option>
          </select>
        </div>

        <button
          onClick={handleApply}
          style={{
            backgroundColor: 'var(--accent-primary)',
            color: '#fff',
            padding: 'var(--space-2) var(--space-4)',
            borderRadius: '6px',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
          }}
        >
          Apply Controls
        </button>
      </div>
    </div>
  );
};

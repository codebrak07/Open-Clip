import React, { useState } from 'react';
import { usePlaybackStore, type PlaybackStore } from '../../store/usePlaybackStore';

interface AICopilotPanelProps {
  onRefinePrompt: (query: string) => void;
}

export const AICopilotPanel: React.FC<AICopilotPanelProps> = ({ onRefinePrompt }) => {
  const [messages, setMessages] = useState<Array<{ sender: 'ai' | 'user'; text: string }>>([
    {
      sender: 'ai',
      text: 'Hello! I am your AI Copilot. Ask me to refine hooks, find high-energy segments (e.g. 00:15), or re-rank candidate clips.',
    },
  ]);
  const [input, setInput] = useState('');
  const seek = usePlaybackStore((state: PlaybackStore) => state.seek);

  const handleSend = () => {
    if (!input.trim()) return;
    const userText = input;
    setMessages((prev) => [...prev, { sender: 'user', text: userText }]);
    setInput('');
    onRefinePrompt(userText);

    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          sender: 'ai',
          text: `Analyzed query: "${userText}". Try reviewing the segment at 00:10 for optimal engagement hook potential.`,
        },
      ]);
    }, 1000);
  };

  // Helper to parse timestamp strings like 00:15 or 01:32 into seconds
  const parseTimestamp = (str: string): number => {
    const parts = str.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  };

  // Render message text with interactive timestamp buttons
  const renderMessageContent = (text: string) => {
    const timestampRegex = /\b(\d{2}:\d{2})\b/g;
    const parts = text.split(timestampRegex);

    return parts.map((part, idx) => {
      if (timestampRegex.test(part)) {
        const sec = parseTimestamp(part);
        return (
          <button
            key={idx}
            onClick={() => seek(sec)}
            style={{
              backgroundColor: 'var(--accent-viral-bg)',
              color: 'var(--accent-viral)',
              border: 'none',
              borderRadius: '4px',
              padding: '1px 6px',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer',
              margin: '0 2px',
              textDecoration: 'underline',
            }}
          >
            {part}
          </button>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  return (
    <aside
      style={{
        width: '340px',
        borderLeft: '1px solid var(--border-subtle)',
        backgroundColor: 'var(--bg-surface)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', fontFamily: 'var(--font-family-mono)' }}>
          AI COPILOT CHAT
        </div>
        <h4 style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>Natural Language Editor</h4>
      </div>

      <div style={{ flex: 1, padding: 'var(--space-4)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.sender === 'user' ? 'flex-end' : 'flex-start',
              backgroundColor: m.sender === 'user' ? 'var(--accent-primary)' : 'var(--bg-canvas)',
              color: m.sender === 'user' ? '#fff' : 'var(--text-primary)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: '8px',
              maxWidth: '85%',
              fontSize: 'var(--text-xs)',
              lineHeight: 1.5,
            }}
          >
            {renderMessageContent(m.text)}
          </div>
        ))}
      </div>

      <div style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 'var(--space-2)' }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Ask AI Copilot..."
          style={{
            flex: 1,
            backgroundColor: 'var(--bg-canvas)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            padding: 'var(--space-2)',
            borderRadius: '4px',
            fontSize: 'var(--text-xs)',
          }}
        />
        <button
          onClick={handleSend}
          style={{
            backgroundColor: 'var(--accent-primary)',
            color: '#fff',
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: '4px',
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
          }}
        >
          Send
        </button>
      </div>
    </aside>
  );
};

import React, { useEffect } from 'react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAction: (action: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, onSelectAction }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else onSelectAction('open');
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onSelectAction]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '100px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '560px',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-focus)',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        }}
      >
        <input
          autoFocus
          placeholder="Type a command or search clips... (Esc to close)"
          style={{
            width: '100%',
            padding: 'var(--space-4)',
            backgroundColor: 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)',
            fontSize: 'var(--text-base)',
            outline: 'none',
          }}
        />

        <div style={{ padding: 'var(--space-2)' }}>
          {[
            { id: 'upload', label: 'Upload New Video', shortcut: '⌘U' },
            { id: 'retry', label: 'Retry Pipeline Stage', shortcut: '⌘R' },
            { id: 'export', label: 'Export All Rendered Clips', shortcut: '⌘E' },
            { id: 'settings', label: 'Open Provider & API Key Settings', shortcut: '⌘S' },
          ].map((cmd) => (
            <button
              key={cmd.id}
              onClick={() => {
                onSelectAction(cmd.id);
                onClose();
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                fontSize: 'var(--text-sm)',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <span>{cmd.label}</span>
              <kbd style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-family-mono)' }}>
                {cmd.shortcut}
              </kbd>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

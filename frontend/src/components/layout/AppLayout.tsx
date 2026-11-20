import React from 'react';

export type AppView = 'journey' | 'viral-factory' | 'football-studio' | 'story-studio' | 'workspace' | 'providers' | 'diagnostics';

interface AppLayoutProps {
  children: React.ReactNode;
  activeView: AppView;
  onSelectView: (view: AppView) => void;
  onOpenCommandPalette: () => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  activeView,
  onSelectView,
  onOpenCommandPalette,
}) => {
  const navItems: Array<{ id: AppView; label: string; icon: string }> = [
    { id: 'journey', label: 'Journey', icon: '〰️' },
    { id: 'viral-factory', label: 'Viral Clip Factory', icon: '⚡' },
    { id: 'story-studio', label: 'Story Studio', icon: '🎮' },
    { id: 'football-studio', label: 'Football Studio', icon: '⚽' },
    { id: 'workspace', label: 'Director Workspace', icon: '🎬' },
    { id: 'providers', label: 'AI Providers', icon: '🧠' },
    { id: 'diagnostics', label: 'Diagnostics', icon: '🩺' },
  ];

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#F5F4F0',
        color: '#171717',
      }}
    >
      {/* Zero-Margin Editorial Top Navigation Bar */}
      <header
        style={{
          height: '56px',
          borderBottom: '1px solid #DFDDD5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          backgroundColor: 'rgba(245, 244, 240, 0.95)',
          backdropFilter: 'blur(12px)',
          zIndex: 50,
          position: 'sticky',
          top: 0,
        }}
      >
        {/* Brand Logo & Editorial Indicator */}
        <div
          onClick={() => onSelectView('journey')}
          style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
        >
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#C99E35',
            }}
          />
          <span style={{ fontWeight: 800, fontSize: '17px', letterSpacing: '-0.02em', color: '#171717' }}>
            OpenClip <span style={{ color: '#C99E35', fontSize: '12px', fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>AI</span>
          </span>
        </div>

        {/* Mode Switcher Tabs */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {navItems.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectView(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  backgroundColor: isActive ? '#FFFFFF' : 'transparent',
                  color: isActive ? '#171717' : '#62615D',
                  border: isActive ? '1px solid #DFDDD5' : '1px solid transparent',
                  boxShadow: isActive ? '0 2px 6px rgba(0, 0, 0, 0.04)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Command Palette Trigger (⌘K) */}
        <button
          onClick={onOpenCommandPalette}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#FFFFFF',
            border: '1px solid #DFDDD5',
            padding: '6px 12px',
            borderRadius: '6px',
            color: '#62615D',
            fontSize: '12px',
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.03)',
          }}
        >
          <span>Search or command...</span>
          <kbd
            style={{
              backgroundColor: '#ECEAE4',
              padding: '2px 5px',
              borderRadius: '4px',
              fontSize: '10px',
              fontFamily: "'JetBrains Mono', monospace",
              color: '#171717',
              border: '1px solid #DFDDD5',
            }}
          >
            ⌘K
          </kbd>
        </button>
      </header>

      {/* Main Full-Width Content Container */}
      <main
        style={{
          flex: 1,
          width: '100%',
          display: 'flex',
          overflow: 'visible',
          backgroundColor: '#F5F4F0',
        }}
      >
        {children}
      </main>
    </div>
  );
};

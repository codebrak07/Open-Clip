import React from 'react';

interface AppLayoutProps {
  children: React.ReactNode;
  onOpenCommandPalette: () => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  onOpenCommandPalette,
}) => {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#F7F5F0' }}>
      {/* Clean Single Header Bar */}
      <header
        style={{
          height: '60px',
          borderBottom: '1px solid #E2DEC5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 32px',
          backgroundColor: '#FAF8F3',
          fontFamily: "'Playfair Display', Georgia, serif",
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: '#059669',
              boxShadow: '0 0 8px rgba(5,150,105,0.4)',
            }}
          />
          <span style={{ fontWeight: 700, fontSize: '20px', letterSpacing: '-0.02em', color: '#121212' }}>
            OpenClip AI
          </span>
        </div>


        {/* Quick Command Palette Trigger */}
        <button
          onClick={onOpenCommandPalette}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#EBE6DA',
            border: '1px solid #D8D2C2',
            padding: '6px 14px',
            borderRadius: '10px',
            color: '#555',
            fontSize: '12px',
            fontFamily: "'Inter', sans-serif",
            cursor: 'pointer',
          }}
        >
          <span>Search or command...</span>
          <kbd
            style={{
              backgroundColor: '#FAF8F3',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '10px',
              fontFamily: "'JetBrains Mono', monospace",
              border: '1px solid #D8D2C2',
            }}
          >
            ⌘K
          </kbd>
        </button>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>{children}</main>
    </div>
  );
};

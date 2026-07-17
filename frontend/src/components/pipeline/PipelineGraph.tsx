import React, { useState } from 'react';

export interface StageStatus {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  durationMs?: number;
  cacheHit?: boolean;
  provider?: string;
  artifactName?: string;
}

interface PipelineGraphProps {
  stages: StageStatus[];
  currentStage?: string;
}

export const PipelineGraph: React.FC<PipelineGraphProps> = ({ stages, currentStage }) => {
  const [hoveredStage, setHoveredStage] = useState<StageStatus | null>(null);

  return (
    <div
      style={{
        padding: 'var(--space-4)',
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-subtle)',
        position: 'relative',
      }}
    >
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)', fontFamily: 'var(--font-family-mono)' }}>
        DECLARATIVE DAG EXECUTION GRAPH
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', overflowX: 'auto', paddingBottom: 'var(--space-1)' }}>
        {stages.map((stage, idx) => {
          const isCurrent = currentStage === stage.id || currentStage === stage.name;
          const isCompleted = stage.status === 'completed';
          const isFailed = stage.status === 'failed';

          let statusColor = 'var(--border-subtle)';
          if (isCompleted) statusColor = 'var(--accent-viral)';
          if (isCurrent) statusColor = 'var(--accent-primary)';
          if (isFailed) statusColor = 'var(--accent-error)';

          return (
            <React.Fragment key={stage.id}>
              <div
                onMouseEnter={() => setHoveredStage(stage)}
                onMouseLeave={() => setHoveredStage(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: '16px',
                  border: `1px solid ${statusColor}`,
                  backgroundColor: isCurrent ? 'var(--bg-surface-active)' : 'transparent',
                  fontSize: 'var(--text-xs)',
                  color: isCompleted || isCurrent ? 'var(--text-primary)' : 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: 'all var(--duration-normal) var(--ease-apple)',
                }}
              >
                <div
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: statusColor,
                  }}
                />
                <span>{stage.name}</span>
              </div>
              {idx < stages.length - 1 && (
                <div style={{ width: '12px', height: '1px', backgroundColor: 'var(--border-subtle)' }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Node Hover Metadata Popover */}
      {hoveredStage && (
        <div
          style={{
            position: 'absolute',
            bottom: '-48px',
            left: 'var(--space-6)',
            backgroundColor: 'var(--bg-canvas)',
            border: '1px solid var(--border-focus)',
            padding: 'var(--space-2) var(--space-4)',
            borderRadius: '6px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            display: 'flex',
            gap: 'var(--space-4)',
            boxShadow: '0 10px 20px rgba(0,0,0,0.5)',
            zIndex: 100,
          }}
        >
          <div><strong>Stage:</strong> {hoveredStage.name}</div>
          <div><strong>Status:</strong> {hoveredStage.status.toUpperCase()}</div>
          <div><strong>Cache:</strong> {hoveredStage.cacheHit ? 'HIT (SHA256)' : 'MISS'}</div>
          <div><strong>Provider:</strong> {hoveredStage.provider || 'Core Engine'}</div>
        </div>
      )}
    </div>
  );
};

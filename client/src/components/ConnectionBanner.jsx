import React from 'react';

/**
 * Banner displaying current signaling connection status.
 * @param {{ status: 'connecting' | 'connected' | 'disconnected' }} props
 */
export function ConnectionBanner({ status }) {
  if (status === 'connected') return null; // Only show when not in standard connected state

  const isConnecting = status === 'connecting';

  return (
    <div
      style={{
        padding: '8px 14px',
        backgroundColor: isConnecting ? 'var(--color-warning-bg)' : 'var(--color-surface-hover)',
        border: `1px solid ${isConnecting ? 'var(--color-warning-border)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-md)',
        color: isConnecting ? 'var(--color-warning)' : 'var(--color-text-muted)',
        fontSize: '0.85rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px'
      }}
    >
      <span className={isConnecting ? 'pulse-dot' : ''}>
        {isConnecting ? '●' : '○'}
      </span>
      <span>
        {isConnecting ? 'Connecting to signaling server...' : 'Signaling server offline'}
      </span>
    </div>
  );
}

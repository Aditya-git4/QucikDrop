import React from 'react';

/**
 * Modern iOS glassmorphic banner displaying current signaling connection status.
 * @param {{ status: 'connecting' | 'connected' | 'disconnected' }} props
 */
export function ConnectionBanner({ status }) {
  if (status === 'connected') return null;

  const isConnecting = status === 'connecting';

  return (
    <div
      className="animate-entrance"
      style={{
        padding: '10px 18px',
        backgroundColor: isConnecting ? 'rgba(250, 204, 21, 0.12)' : 'rgba(45, 62, 44, 0.45)',
        border: `1px solid ${isConnecting ? 'rgba(250, 204, 21, 0.35)' : 'var(--glass-border)'}`,
        borderRadius: 'var(--radius-full)',
        color: isConnecting ? 'var(--color-warning)' : 'var(--color-text-muted)',
        fontSize: '0.84rem',
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: 'var(--glass-shadow-sm)'
      }}
    >
      <span className={isConnecting ? 'pulse-dot' : ''}>
        {isConnecting ? '●' : '○'}
      </span>
      <span>
        {isConnecting ? 'Connecting to signaling network...' : 'Signaling server offline — check connection'}
      </span>
    </div>
  );
}

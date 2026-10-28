import React from 'react';

/**
 * Modern VisionOS/iOS Paired Device Bridge.
 * Displays local and peer devices in a sleek, unified horizontal connection bridge.
 * @param {{
 *   myDeviceName: string,
 *   peerDeviceName: string,
 *   isOwner: boolean,
 *   isConnected: boolean,
 *   isP2PConnected?: boolean,
 *   connectionType?: string,
 *   connectionStats?: any
 * }} props
 */
export function DeviceStatus({
  myDeviceName,
  peerDeviceName,
  isOwner,
  isConnected,
  isP2PConnected = false,
  connectionType = 'unknown',
  connectionStats = null
}) {
  const getBadgeText = () => {
    if (isP2PConnected) {
      if (connectionType === 'lan') return '⚡ LAN Direct';
      if (connectionType === 'relay') return '🔄 Relayed (TURN)';
      return '⚡ STUN Direct';
    }
    if (isConnected) return '● Connected';
    return '○ Waiting for Peer';
  };

  return (
    <div
      className="card animate-entrance"
      style={{
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        background: 'var(--glass-surface-2)',
        border: '1px solid var(--glass-border)',
        boxShadow: 'var(--glass-shadow-sm)'
      }}
    >
      {/* Local Device */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-lime-dim)',
            border: '1px solid rgba(228, 253, 151, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.2rem',
            flexShrink: 0
          }}
        >
          💻
        </div>
        <div>
          <div style={{ fontSize: '0.70rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {isOwner ? 'Host (You)' : 'Guest (You)'}
          </div>
          <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--color-text-main)', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {myDeviceName || 'This Device'}
          </div>
        </div>
      </div>

      {/* Connection Bridge Indicator */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flex: '1 1 180px',
          justifyContent: 'center',
          padding: '0 8px'
        }}
      >
        <div style={{ height: '1px', flex: 1, background: 'linear-gradient(90deg, transparent, rgba(228, 253, 151, 0.3))' }} />
        <span
          className={`badge ${isP2PConnected ? 'badge-connected' : isConnected ? 'badge-connected' : 'badge-waiting'}`}
          style={{ fontSize: '0.74rem', padding: '3px 10px' }}
        >
          {getBadgeText()}
        </span>
        <div style={{ height: '1px', flex: 1, background: 'linear-gradient(90deg, rgba(228, 253, 151, 0.3), transparent)' }} />
      </div>

      {/* Peer Device */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.70rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {isOwner ? 'Guest Peer' : 'Host Peer'}
          </div>
          <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--color-text-main)', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {peerDeviceName || (isConnected ? 'Connecting...' : 'Waiting to join...')}
          </div>
        </div>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-sm)',
            background: isConnected ? 'var(--color-lime-dim)' : 'rgba(20, 30, 19, 0.5)',
            border: `1px solid ${isConnected ? 'rgba(228, 253, 151, 0.25)' : 'var(--glass-border)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.2rem',
            flexShrink: 0
          }}
        >
          {peerDeviceName ? '📱' : '⏳'}
        </div>
      </div>
    </div>
  );
}

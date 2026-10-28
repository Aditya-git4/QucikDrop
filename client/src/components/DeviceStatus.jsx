import React from 'react';

/**
 * Modern iOS paired device indicator with animated connection bridge.
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
  const getPeerBadgeText = () => {
    if (!isP2PConnected) {
      return isConnected ? 'Signaling Connected' : 'Waiting...';
    }
    if (connectionType === 'relay') {
      return '🔄 Relayed (TURN)';
    }
    if (connectionType === 'lan') {
      return '⚡ LAN Direct';
    }
    return '⚡ STUN Direct';
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '14px',
        alignItems: 'stretch'
      }}
    >
      {/* Local Device Card */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          background: 'rgba(28, 42, 27, 0.45)',
          border: '1px solid var(--glass-border)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            This Device • {isOwner ? 'Host' : 'Guest'}
          </span>
          <span
            className="badge badge-connected"
            style={{ fontSize: '0.7rem', padding: '2px 8px' }}
          >
            ● Active
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '1.4rem' }}>💻</span>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
              {myDeviceName}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
              Local WebRTC Node
            </div>
          </div>
        </div>
      </div>

      {/* Remote Peer Device Card */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          background: isConnected ? 'rgba(35, 52, 34, 0.55)' : 'rgba(24, 36, 23, 0.4)',
          border: isConnected
            ? '1px solid var(--glass-border-highlight)'
            : '1px solid var(--glass-border)',
          boxShadow: isP2PConnected ? '0 0 20px rgba(228, 253, 151, 0.15)' : 'none',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Peer Device • {isOwner ? 'Guest' : 'Host'}
          </span>
          <span
            className={`badge ${isConnected ? 'badge-connected' : 'badge-waiting'}`}
            style={{ fontSize: '0.7rem', padding: '2px 8px' }}
          >
            {getPeerBadgeText()}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '1.4rem' }}>📱</span>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
              {peerDeviceName || (isConnected ? 'Connected Peer' : 'Waiting to pair...')}
            </div>
            <div style={{ fontSize: '0.75rem', color: isConnected ? 'var(--color-lime)' : 'var(--color-text-subtle)' }}>
              {isP2PConnected
                ? `⚡ P2P Active${connectionStats?.rtt != null ? ` (${connectionStats.rtt}ms)` : ''}`
                : isConnected
                ? 'Signaling established'
                : 'Scan QR code to join'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

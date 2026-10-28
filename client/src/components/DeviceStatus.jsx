import React from 'react';

/**
 * Display cards for local and remote device status.
 * @param {{
 *   myDeviceName: string,
 *   peerDeviceName: string | null,
 *   isOwner: boolean,
 *   isConnected: boolean,
 *   isP2PConnected?: boolean,
 *   connectionType?: 'unknown' | 'lan' | 'direct' | 'relay',
 *   connectionStats?: {
 *     isRelayed?: boolean,
 *     connectionType?: string,
 *     localCandidateType?: string,
 *     remoteCandidateType?: string,
 *     protocol?: string,
 *     rtt?: number | null
 *   } | null
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
  const getPeerBadgeText = () => {
    if (!isP2PConnected) {
      return isConnected ? 'Connected' : 'Waiting...';
    }
    if (connectionType === 'relay') {
      return '🔄 Relayed (TURN)';
    }
    if (connectionType === 'lan') {
      return '⚡ Direct (LAN)';
    }
    return '⚡ Direct (STUN)';
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '12px',
        marginBottom: '16px'
      }}
    >
      {/* Local Device */}
      <div
        style={{
          padding: '14px',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            THIS DEVICE ({isOwner ? 'HOST' : 'GUEST'})
          </span>
          <span className="badge badge-connected" style={{ fontSize: '0.7rem', padding: '2px 6px' }}>
            You
          </span>
        </div>
        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
          {myDeviceName}
        </div>
      </div>

      {/* Remote Peer Device */}
      <div
        style={{
          padding: '14px',
          backgroundColor: 'var(--color-surface)',
          border: `1px solid ${isConnected ? 'var(--color-success-border)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            PEER DEVICE ({isOwner ? 'GUEST' : 'HOST'})
          </span>
          <span
            className={`badge ${isConnected ? 'badge-connected' : 'badge-waiting'}`}
            style={{
              fontSize: '0.7rem',
              padding: '2px 6px',
              backgroundColor: isP2PConnected && connectionType === 'relay' ? 'var(--color-warning-bg)' : undefined,
              borderColor: isP2PConnected && connectionType === 'relay' ? 'var(--color-warning-border)' : undefined,
              color: isP2PConnected && connectionType === 'relay' ? 'var(--color-warning)' : undefined
            }}
          >
            {getPeerBadgeText()}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
            {peerDeviceName || (isConnected ? 'Connected Peer' : 'Awaiting Connection...')}
          </div>
          {isP2PConnected && connectionStats?.rtt != null && (
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
              {connectionStats.rtt}ms RTT
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

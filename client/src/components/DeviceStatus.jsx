import React from 'react';

/**
 * Display cards for local and remote device status.
 * @param {{
 *   myDeviceName: string,
 *   peerDeviceName: string | null,
 *   isOwner: boolean,
 *   isConnected: boolean,
 *   isP2PConnected?: boolean
 * }} props
 */
export function DeviceStatus({ myDeviceName, peerDeviceName, isOwner, isConnected, isP2PConnected = false }) {
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
            style={{ fontSize: '0.7rem', padding: '2px 6px' }}
          >
            {isP2PConnected ? '⚡ P2P Direct' : isConnected ? 'Connected' : 'Waiting...'}
          </span>
        </div>
        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
          {peerDeviceName || (isConnected ? 'Connected Peer' : 'Awaiting Connection...')}
        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { getDeviceDefaultName } from '../utils/roomUtils.js';
import { isValidRoomId, isValidJoinToken } from '../utils/validateInput.js';

/**
 * Modern iOS glassmorphic Home view for creating or joining a temporary peer room.
 * @param {{
 *   onCreateRoom: (deviceName: string) => void,
 *   onJoinRoom: (roomId: string, joinToken: string, deviceName: string) => void,
 *   isConnecting: boolean,
 *   errorMessage: string | null
 * }} props
 */
export function Home({ onCreateRoom, onJoinRoom, isConnecting, errorMessage }) {
  const [activeTab, setActiveTab] = useState('create'); // 'create' | 'join'
  const [deviceName, setDeviceName] = useState(() => getDeviceDefaultName());
  const [manualRoomId, setManualRoomId] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [validationError, setValidationError] = useState('');

  const handleCreate = (e) => {
    e.preventDefault();
    setValidationError('');
    onCreateRoom(deviceName);
  };

  const handleManualJoin = (e) => {
    e.preventDefault();
    setValidationError('');

    const trimmedRoomId = manualRoomId.trim().toLowerCase();
    const trimmedToken = manualToken.trim().toLowerCase();

    if (!isValidRoomId(trimmedRoomId)) {
      setValidationError('Please enter a valid 32-character Room ID');
      return;
    }
    if (!isValidJoinToken(trimmedToken)) {
      setValidationError('Please enter a valid 48-character Invitation Token');
      return;
    }

    onJoinRoom(trimmedRoomId, trimmedToken, deviceName);
  };

  return (
    <div className="animate-entrance" style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Hero Glass Card */}
      <div
        className="card"
        style={{
          textAlign: 'center',
          padding: '44px 24px 36px',
          boxShadow: 'var(--glass-shadow-glow)',
          border: '1px solid var(--glass-border-highlight)'
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '64px',
            height: '64px',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-lime-dim)',
            border: '1px solid rgba(228, 253, 151, 0.3)',
            boxShadow: '0 0 30px rgba(228, 253, 151, 0.25)',
            fontSize: '2rem',
            marginBottom: '16px',
            color: 'var(--color-lime)'
          }}
        >
          ⚡
        </div>

        <h1
          style={{
            fontSize: 'clamp(1.75rem, 4vw, 2.35rem)',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: 'var(--color-text-main)',
            marginBottom: '10px'
          }}
        >
          Instant, Private P2P Sharing
        </h1>

        <p
          style={{
            fontSize: 'clamp(0.95rem, 2vw, 1.05rem)',
            color: 'var(--color-text-muted)',
            maxWidth: '520px',
            margin: '0 auto 28px',
            lineHeight: 1.6
          }}
        >
          Direct device-to-device file and text sharing. Powered by WebRTC and encrypted with zero permanent server storage.
        </p>

        {validationError && (
          <div
            style={{
              padding: '12px 18px',
              backgroundColor: 'var(--color-danger-bg)',
              color: 'var(--color-danger)',
              border: '1px solid var(--color-danger-border)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.88rem',
              fontWeight: 600,
              maxWidth: '420px',
              margin: '0 auto 20px',
              backdropFilter: 'blur(12px)'
            }}
          >
            {validationError}
          </div>
        )}

        {/* iOS Segmented Pill Control (Create vs Join) */}
        <div style={{ maxWidth: '380px', margin: '0 auto 24px' }}>
          <div className="ios-segmented-control">
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className={`ios-segment-btn ${activeTab === 'create' ? 'active' : ''}`}
            >
              ⚡ New Room
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('join')}
              className={`ios-segment-btn ${activeTab === 'join' ? 'active' : ''}`}
            >
              🔗 Join by Code
            </button>
          </div>
        </div>

        {/* Tab 1: Create Room */}
        {activeTab === 'create' && (
          <form onSubmit={handleCreate} style={{ maxWidth: '400px', margin: '0 auto', textAlign: 'left' }}>
            <div className="input-group">
              <label htmlFor="device-name-input" className="input-label">
                Your Device Name
              </label>
              <input
                id="device-name-input"
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                maxLength={40}
                className="text-input"
                placeholder="e.g. MacBook Pro, Pixel 8"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isConnecting || !deviceName.trim()}
              className="btn btn-primary"
              style={{ width: '100%', fontSize: '1.05rem', padding: '14px' }}
            >
              {isConnecting ? (
                <>
                  <span className="pulse-dot" /> Creating Secure Room...
                </>
              ) : (
                '⚡ Start Room & Show QR Code'
              )}
            </button>
          </form>
        )}

        {/* Tab 2: Manual Join */}
        {activeTab === 'join' && (
          <form onSubmit={handleManualJoin} style={{ maxWidth: '400px', margin: '0 auto', textAlign: 'left' }}>
            <div className="input-group">
              <label htmlFor="device-name-input-join" className="input-label">
                Your Device Name
              </label>
              <input
                id="device-name-input-join"
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                maxLength={40}
                className="text-input"
                placeholder="e.g. iPhone 15, Windows PC"
                required
              />
            </div>

            <div className="input-group">
              <label htmlFor="manual-room-id" className="input-label">
                Room ID (32 chars)
              </label>
              <input
                id="manual-room-id"
                type="text"
                value={manualRoomId}
                onChange={(e) => setManualRoomId(e.target.value)}
                placeholder="Hexadecimal room code"
                className="text-input"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                required
              />
            </div>

            <div className="input-group">
              <label htmlFor="manual-token" className="input-label">
                Secret Invitation Token (48 chars)
              </label>
              <input
                id="manual-token"
                type="text"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="Invitation secret token"
                className="text-input"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                required
              />
            </div>

            <button
              type="submit"
              disabled={isConnecting}
              className="btn btn-primary"
              style={{ width: '100%', marginTop: '6px', fontSize: '1.05rem', padding: '14px' }}
            >
              {isConnecting ? (
                <>
                  <span className="pulse-dot" /> Connecting to Peer...
                </>
              ) : (
                'Join Room'
              )}
            </button>
          </form>
        )}
      </div>

      {/* 3-Step Apple Glass Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '18px' }}>
        <div className="card card-interactive" style={{ padding: '24px 20px', textAlign: 'left' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-lime-dim)',
              border: '1px solid rgba(228, 253, 151, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.1rem',
              color: 'var(--color-lime)',
              marginBottom: '14px',
              fontWeight: 700
            }}
          >
            1
          </div>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '6px', color: 'var(--color-text-main)' }}>
            Start a Room
          </h3>
          <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
            Instantly generates an ephemeral cryptographic token and QR code for scanning.
          </p>
        </div>

        <div className="card card-interactive" style={{ padding: '24px 20px', textAlign: 'left' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-lime-dim)',
              border: '1px solid rgba(228, 253, 151, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.1rem',
              color: 'var(--color-lime)',
              marginBottom: '14px',
              fontWeight: 700
            }}
          >
            2
          </div>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '6px', color: 'var(--color-text-main)' }}>
            Scan with Phone
          </h3>
          <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
            Point your camera or browser at the QR code to pair both devices in under two seconds.
          </p>
        </div>

        <div className="card card-interactive" style={{ padding: '24px 20px', textAlign: 'left' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-lime-dim)',
              border: '1px solid rgba(228, 253, 151, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.1rem',
              color: 'var(--color-lime)',
              marginBottom: '14px',
              fontWeight: 700
            }}
          >
            3
          </div>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '6px', color: 'var(--color-text-main)' }}>
            P2P Direct Transfer
          </h3>
          <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
            High-speed chunked WebRTC transfers with SHA-256 integrity verification.
          </p>
        </div>
      </div>

      {/* Privacy Guarantee Pill */}
      <div
        className="card"
        style={{
          padding: '18px 24px',
          display: 'flex',
          gap: '16px',
          alignItems: 'center',
          background: 'rgba(28, 42, 27, 0.4)'
        }}
      >
        <span style={{ fontSize: '1.75rem', filter: 'drop-shadow(0 0 10px rgba(228, 253, 151, 0.3))' }}>🛡️</span>
        <div style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--color-lime)' }}>Zero-Trace Privacy:</strong> No accounts, no cookies, no cloud storage. Once you close the tab, the in-memory room evaporates permanently.
        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { getDeviceDefaultName } from '../utils/roomUtils.js';
import { isValidRoomId, isValidJoinToken } from '../utils/validateInput.js';

/**
 * Home page for creating or joining a temporary room.
 * @param {{
 *   onCreateRoom: (deviceName: string) => void,
 *   onJoinRoom: (roomId: string, joinToken: string, deviceName: string) => void,
 *   isConnecting: boolean,
 *   errorMessage: string | null
 * }} props
 */
export function Home({ onCreateRoom, onJoinRoom, isConnecting, errorMessage }) {
  const [deviceName, setDeviceName] = useState(() => getDeviceDefaultName());
  const [showManualJoin, setShowManualJoin] = useState(false);
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Hero Card */}
      <div className="card" style={{ textAlign: 'center', padding: '36px 20px' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>⚡</div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--color-text-main)', marginBottom: '8px' }}>
          Instant, Private Device Sharing
        </h1>
        <p style={{ fontSize: '1rem', color: 'var(--color-text-muted)', maxWidth: '480px', margin: '0 auto 24px' }}>
          Connect your computer and phone in seconds. Scan a QR code to exchange text and files with zero server storage.
        </p>

        {validationError && (
          <div
            style={{
              padding: '10px 14px',
              backgroundColor: 'var(--color-danger-bg)',
              color: 'var(--color-danger)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.85rem',
              maxWidth: '400px',
              margin: '0 auto 16px'
            }}
          >
            {validationError}
          </div>
        )}

        {/* Device Name Configuration */}
        <form onSubmit={handleCreate} style={{ maxWidth: '380px', margin: '0 auto', textAlign: 'left' }}>
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
              placeholder="e.g. Windows PC, Android Phone"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isConnecting || !deviceName.trim()}
            className="btn btn-primary"
            style={{ width: '100%', fontSize: '1.05rem', padding: '12px' }}
          >
            {isConnecting ? (
              <>
                <span className="pulse-dot" /> Creating Room...
              </>
            ) : (
              '⚡ Create Room'
            )}
          </button>
        </form>

        <div style={{ marginTop: '16px' }}>
          <button
            type="button"
            onClick={() => setShowManualJoin((prev) => !prev)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-primary)',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            {showManualJoin ? 'Hide manual join' : 'Have a Room ID and Token? Join manually'}
          </button>
        </div>

        {/* Manual Join Form */}
        {showManualJoin && (
          <form
            onSubmit={handleManualJoin}
            style={{
              marginTop: '20px',
              padding: '20px',
              backgroundColor: 'var(--color-bg)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              maxWidth: '420px',
              margin: '20px auto 0',
              textAlign: 'left'
            }}
          >
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '12px' }}>
              Manual Room Entry
            </h3>
            <div className="input-group">
              <label htmlFor="manual-room-id" className="input-label">
                Room ID
              </label>
              <input
                id="manual-room-id"
                type="text"
                value={manualRoomId}
                onChange={(e) => setManualRoomId(e.target.value)}
                placeholder="32-character hexadecimal room ID"
                className="text-input"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                required
              />
            </div>
            <div className="input-group">
              <label htmlFor="manual-token" className="input-label">
                Invitation Token
              </label>
              <input
                id="manual-token"
                type="text"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="48-character invitation token"
                className="text-input"
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                required
              />
            </div>
            <button
              type="submit"
              disabled={isConnecting}
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: '8px' }}
            >
              Join Room
            </button>
          </form>
        )}
      </div>

      {/* How it Works Walkthrough */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
        <div className="card" style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>1️⃣</div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '4px' }}>Create Room</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Click Create Room to generate a unique QR code and one-time invitation link.
          </p>
        </div>

        <div className="card" style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>2️⃣</div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '4px' }}>Scan with Phone</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Point your Android camera or Chrome browser at the QR code to join automatically.
          </p>
        </div>

        <div className="card" style={{ padding: '20px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>3️⃣</div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '4px' }}>Share Privately</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Exchange text immediately. Rooms expire automatically with zero trace.
          </p>
        </div>
      </div>

      {/* Privacy Guarantee Note */}
      <div
        style={{
          padding: '16px 20px',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          fontSize: '0.85rem',
          color: 'var(--color-text-muted)',
          display: 'flex',
          gap: '12px',
          alignItems: 'center'
        }}
      >
        <span style={{ fontSize: '1.5rem' }}>🛡️</span>
        <div>
          <strong style={{ color: 'var(--color-text-main)' }}>Privacy First:</strong> No user accounts, no tracking cookies, and no permanent server file storage. All room metadata is kept in temporary memory and destroyed when the room ends.
        </div>
      </div>
    </div>
  );
}

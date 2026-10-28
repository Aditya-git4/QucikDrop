import React, { useState } from 'react';
import { DeviceStatus } from '../components/DeviceStatus.jsx';
import { QRCodeDisplay } from '../components/QRCodeDisplay.jsx';
import { TextTransfer } from '../components/TextTransfer.jsx';

/**
 * Active room page handling waiting, connected, and terminated states.
 * @param {{
 *   roomId: string,
 *   joinToken: string | null,
 *   roomStatus: 'waiting' | 'connected' | 'closed' | 'expired' | 'error',
 *   isOwner: boolean,
 *   myDeviceName: string,
 *   peerDeviceName: string | null,
 *   expiresAt: number | null,
 *   messages: any[],
 *   onSendMessage: (text: string) => void,
 *   onCloseRoom: () => void,
 *   onReset: () => void,
 *   errorMessage: string | null
 * }} props
 */
export function Room({
  roomId,
  joinToken,
  roomStatus,
  isOwner,
  myDeviceName,
  peerDeviceName,
  expiresAt,
  messages,
  onSendMessage,
  onCloseRoom,
  onReset,
  errorMessage
}) {
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const isConnected = roomStatus === 'connected';
  const isTerminated = ['closed', 'expired', 'error'].includes(roomStatus);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Room Header Controls */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Room:
          </span>
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem',
              backgroundColor: 'var(--color-surface-hover)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)'
            }}
          >
            {roomId ? `${roomId.slice(0, 8)}...${roomId.slice(-6)}` : 'Active'}
          </code>
          <span
            className={`badge ${
              isConnected
                ? 'badge-connected'
                : roomStatus === 'waiting'
                ? 'badge-waiting'
                : 'badge-closed'
            }`}
          >
            {isConnected ? '● Connected' : roomStatus === 'waiting' ? '○ Waiting for Peer' : 'Closed'}
          </span>
        </div>

        {/* Room Action Buttons */}
        <div>
          {!isTerminated ? (
            showCloseConfirm ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-danger)' }}>End room?</span>
                <button
                  type="button"
                  onClick={onCloseRoom}
                  className="btn btn-danger"
                  style={{ minHeight: '36px', padding: '6px 12px', fontSize: '0.85rem' }}
                >
                  Yes, Close
                </button>
                <button
                  type="button"
                  onClick={() => setShowCloseConfirm(false)}
                  className="btn btn-secondary"
                  style={{ minHeight: '36px', padding: '6px 12px', fontSize: '0.85rem' }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCloseConfirm(true)}
                className="btn btn-secondary"
                style={{ minHeight: '38px', padding: '8px 14px', fontSize: '0.85rem' }}
              >
                {isOwner ? 'Close Room' : 'Leave Room'}
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={onReset}
              className="btn btn-primary"
              style={{ minHeight: '38px', padding: '8px 14px', fontSize: '0.85rem' }}
            >
              Start New Room
            </button>
          )}
        </div>
      </div>

      {/* Device Status Bar */}
      <DeviceStatus
        myDeviceName={myDeviceName}
        peerDeviceName={peerDeviceName}
        isOwner={isOwner}
        isConnected={isConnected}
      />

      {/* Terminated State Banner */}
      {isTerminated && (
        <div
          className="card"
          style={{
            textAlign: 'center',
            padding: '32px 20px',
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)'
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>
            {roomStatus === 'expired' ? '⏳' : '👋'}
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '8px' }}>
            {roomStatus === 'expired' ? 'Room Expired' : 'Room Ended'}
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem', maxWidth: '440px', margin: '0 auto 20px' }}>
            {errorMessage ||
              (roomStatus === 'expired'
                ? 'This temporary room exceeded its lifetime limit and has expired.'
                : 'The connection has closed. For your security, temporary room data has been discarded.')}
          </p>
          <button
            type="button"
            onClick={onReset}
            className="btn btn-primary"
            style={{ padding: '10px 24px' }}
          >
            ⚡ Create a New Room
          </button>
        </div>
      )}

      {/* Waiting for Peer: Show QR Code */}
      {roomStatus === 'waiting' && isOwner && joinToken && (
        <div className="card">
          <QRCodeDisplay
            roomId={roomId}
            joinToken={joinToken}
            expiresAt={expiresAt}
          />
        </div>
      )}

      {/* Active Connected State: Show Text Sharing Chat */}
      {(isConnected || (!isTerminated && messages.length > 0)) && (
        <TextTransfer
          messages={messages}
          onSendMessage={onSendMessage}
          disabled={!isConnected}
        />
      )}
    </div>
  );
}

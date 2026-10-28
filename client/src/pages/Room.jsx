import React, { useState, useEffect } from 'react';
import { DeviceStatus } from '../components/DeviceStatus.jsx';
import { QRCodeDisplay } from '../components/QRCodeDisplay.jsx';
import { TextTransfer } from '../components/TextTransfer.jsx';
import { FileDropZone } from '../components/FileDropZone.jsx';
import { TransferQueue } from '../components/TransferQueue.jsx';
import { playSendSound, hapticTap, isSoundEnabled, setSoundEnabled } from '../utils/soundEffects.js';

/**
 * Modern iOS glassmorphic Room page handling waiting, connected, WebRTC P2P file & text sharing.
 * Renders a unified side-by-side cockpit on desktop and an iOS segmented card on mobile.
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
  errorMessage,
  isP2PConnected = false,
  webrtcStatus = 'disconnected',
  connectionType = 'unknown',
  connectionStats = null,
  transfers = [],
  isWakeLockActive = false,
  onFilesSelected = () => {},
  onCancelTransfer = () => {}
}) {
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [mobileTab, setMobileTab] = useState('files'); // 'files' | 'chat' | 'info'

  const isConnected = roomStatus === 'connected';
  const isTerminated = ['closed', 'expired', 'error'].includes(roomStatus);

  const [soundActive, setSoundActive] = useState(() => isSoundEnabled());
  const [pasteNotice, setPasteNotice] = useState(null);

  const toggleSound = () => {
    const next = !soundActive;
    setSoundActive(next);
    setSoundEnabled(next);
    hapticTap();
  };

  // Global Clipboard Paste (Ctrl+V / Cmd+V)
  useEffect(() => {
    if (!isConnected || isTerminated || !isP2PConnected) return;

    const handlePaste = (e) => {
      // Don't intercept if user is currently typing in an input/textarea
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const clipboardFiles = e.clipboardData?.files;
      if (clipboardFiles && clipboardFiles.length > 0) {
        e.preventDefault();
        hapticTap();
        playSendSound();
        onFilesSelected(clipboardFiles);
        setPasteNotice(`Pasted ${clipboardFiles.length} item(s) from clipboard`);
        setTimeout(() => setPasteNotice(null), 3000);
        return;
      }

      const text = e.clipboardData?.getData('text');
      if (text && text.trim()) {
        e.preventDefault();
        hapticTap();
        onSendMessage(text.trim());
        setPasteNotice('Pasted text message sent');
        setTimeout(() => setPasteNotice(null), 3000);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isConnected, isTerminated, isP2PConnected, onFilesSelected, onSendMessage]);

  const getHeaderBadgeText = () => {
    if (isP2PConnected) {
      if (connectionType === 'relay') return '🔄 Relayed (TURN)';
      if (connectionType === 'lan') return '⚡ P2P Direct (LAN)';
      return '⚡ P2P Direct (STUN)';
    }
    if (isConnected) return '● Signaling Connected';
    if (roomStatus === 'waiting') return '○ Waiting for Peer';
    return 'Closed';
  };

  return (
    <div className="animate-entrance" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Glass Room Header Bar */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          background: 'rgba(28, 42, 27, 0.55)',
          border: '1px solid var(--glass-border-highlight)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Room:
          </span>
          <code
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.82rem',
              fontWeight: 600,
              backgroundColor: 'rgba(18, 28, 17, 0.7)',
              color: 'var(--color-lime)',
              padding: '3px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(228, 253, 151, 0.2)'
            }}
          >
            {roomId ? `${roomId.slice(0, 8)}...${roomId.slice(-6)}` : 'Active'}
          </code>
          <span
            className={`badge ${
              isP2PConnected
                ? 'badge-connected'
                : isConnected
                ? 'badge-connected'
                : roomStatus === 'waiting'
                ? 'badge-waiting'
                : 'badge-closed'
            }`}
          >
            {getHeaderBadgeText()}
          </span>

          {isP2PConnected && connectionStats?.rtt != null && (
            <span
              style={{
                fontSize: '0.78rem',
                color: 'var(--color-text-muted)',
                fontFamily: 'var(--font-mono)',
                background: 'rgba(228, 253, 151, 0.08)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                border: '1px solid rgba(228, 253, 151, 0.15)'
              }}
            >
              ⚡ {connectionStats.rtt}ms
            </span>
          )}

          {isWakeLockActive && (
            <span
              className="badge"
              style={{
                fontSize: '0.74rem',
                backgroundColor: 'rgba(228, 253, 151, 0.12)',
                color: 'var(--color-lime)',
                border: '1px solid rgba(228, 253, 151, 0.25)'
              }}
              title="Screen Wake Lock is active"
            >
              🔆 Screen Awake
            </span>
          )}
        </div>

        {/* Room Action Buttons & Sound Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={toggleSound}
            className="btn btn-secondary"
            style={{
              minHeight: '36px',
              padding: '6px 12px',
              fontSize: '0.82rem',
              borderRadius: 'var(--radius-full)'
            }}
            title={soundActive ? 'Mute sound effects' : 'Unmute sound effects'}
            aria-label={soundActive ? 'Mute sound effects' : 'Unmute sound effects'}
          >
            {soundActive ? '🔔 Sound On' : '🔕 Muted'}
          </button>

          {!isTerminated ? (
            showCloseConfirm ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-danger)', fontWeight: 600 }}>End room?</span>
                <button
                  type="button"
                  onClick={onCloseRoom}
                  className="btn btn-danger"
                  style={{ minHeight: '34px', padding: '6px 14px', fontSize: '0.82rem' }}
                >
                  Yes, Close
                </button>
                <button
                  type="button"
                  onClick={() => setShowCloseConfirm(false)}
                  className="btn btn-secondary"
                  style={{ minHeight: '34px', padding: '6px 14px', fontSize: '0.82rem' }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCloseConfirm(true)}
                className="btn btn-secondary"
                style={{ minHeight: '36px', padding: '8px 16px', fontSize: '0.82rem', borderRadius: 'var(--radius-full)' }}
              >
                {isOwner ? 'Close Room' : 'Leave Room'}
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={onReset}
              className="btn btn-primary"
              style={{ minHeight: '36px', padding: '8px 18px', fontSize: '0.85rem' }}
            >
              Start New Room
            </button>
          )}
        </div>
      </div>

      {/* Clipboard Paste Notification Toast */}
      {pasteNotice && (
        <div
          className="animate-entrance"
          style={{
            padding: '10px 20px',
            background: 'var(--color-lime)',
            color: 'var(--color-lime-text)',
            fontWeight: 800,
            borderRadius: 'var(--radius-full)',
            boxShadow: '0 8px 25px rgba(228, 253, 151, 0.45)',
            textAlign: 'center',
            fontSize: '0.88rem',
            letterSpacing: '0.01em'
          }}
        >
          📋 {pasteNotice}
        </div>
      )}

      {/* Paired Device Status Pill Bar */}
      <DeviceStatus
        myDeviceName={myDeviceName}
        peerDeviceName={peerDeviceName}
        isOwner={isOwner}
        isConnected={isConnected}
        isP2PConnected={isP2PConnected}
        connectionType={connectionType}
        connectionStats={connectionStats}
      />

      {/* Terminated State Banner */}
      {isTerminated && (
        <div
          className="card"
          style={{
            textAlign: 'center',
            padding: '36px 20px',
            boxShadow: 'var(--glass-shadow-glow)'
          }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>
            {roomStatus === 'expired' ? '⏳' : '👋'}
          </div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--color-text-main)', marginBottom: '8px' }}>
            {roomStatus === 'expired' ? 'Room Expired' : 'Room Ended'}
          </h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.95rem', maxWidth: '440px', margin: '0 auto 24px', lineHeight: 1.55 }}>
            {errorMessage ||
              (roomStatus === 'expired'
                ? 'This temporary room exceeded its lifetime limit and has expired.'
                : 'The connection has closed. For your security, temporary room data has been discarded.')}
          </p>
          <button
            type="button"
            onClick={onReset}
            className="btn btn-primary"
            style={{ padding: '12px 28px' }}
          >
            ⚡ Create a New Room
          </button>
        </div>
      )}

      {/* Waiting for Peer: Show QR Code & Link Card */}
      {roomStatus === 'waiting' && isOwner && joinToken && (
        <div className="card animate-entrance">
          <QRCodeDisplay
            roomId={roomId}
            joinToken={joinToken}
            expiresAt={expiresAt}
          />
        </div>
      )}

      {/* Active Room: WebRTC File & Text Sharing */}
      {isConnected && !isTerminated && (
        <>
          {/* iOS Segmented Bar for Mobile Devices */}
          <div className="mobile-room-switcher">
            <div className="ios-segmented-control" style={{ width: '100%' }}>
              <button
                type="button"
                onClick={() => setMobileTab('files')}
                className={`ios-segment-btn ${mobileTab === 'files' ? 'active' : ''}`}
              >
                <span>📁 Files</span>
                {transfers.length > 0 && (
                  <span
                    style={{
                      background: mobileTab === 'files' ? 'var(--color-canopy-dark)' : 'var(--color-lime)',
                      color: mobileTab === 'files' ? 'var(--color-lime)' : 'var(--color-lime-text)',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-full)'
                    }}
                  >
                    {transfers.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setMobileTab('chat')}
                className={`ios-segment-btn ${mobileTab === 'chat' ? 'active' : ''}`}
              >
                <span>💬 P2P Chat</span>
                {messages.length > 0 && (
                  <span
                    style={{
                      background: mobileTab === 'chat' ? 'var(--color-canopy-dark)' : 'var(--color-lime)',
                      color: mobileTab === 'chat' ? 'var(--color-lime)' : 'var(--color-lime-text)',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      padding: '1px 6px',
                      borderRadius: 'var(--radius-full)'
                    }}
                  >
                    {messages.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Desktop & Mobile Responsive Cockpit Grid */}
          <div className="room-dashboard-grid">
            {/* Left Column: File Transfer Dropzone & Queue */}
            <div className={`desktop-column-left ${mobileTab === 'files' ? 'mobile-pane-active' : 'mobile-pane-inactive'}`}>
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: 'var(--color-lime)' }}>⚡</span> Direct File Transfer
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                    {isP2PConnected ? 'P2P Active' : 'Waiting for P2P...'}
                  </span>
                </div>

                <FileDropZone
                  onFilesSelected={onFilesSelected}
                  disabled={!isP2PConnected}
                />

                <TransferQueue
                  transfers={transfers}
                  onCancelTransfer={onCancelTransfer}
                />
              </div>
            </div>

            {/* Right Column: Direct P2P Text Chat */}
            <div className={`desktop-column-right ${mobileTab === 'chat' ? 'mobile-pane-active' : 'mobile-pane-inactive'}`}>
              <TextTransfer
                messages={messages}
                onSendMessage={onSendMessage}
                disabled={!isP2PConnected}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

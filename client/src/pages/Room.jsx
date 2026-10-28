import React, { useState, useEffect, useCallback } from 'react';
import { DeviceStatus } from '../components/DeviceStatus.jsx';
import { QRCodeDisplay } from '../components/QRCodeDisplay.jsx';
import { TextTransfer } from '../components/TextTransfer.jsx';
import { FileDropZone } from '../components/FileDropZone.jsx';
import { TransferQueue } from '../components/TransferQueue.jsx';
import { playSendSound, hapticTap, hapticError, isSoundEnabled, setSoundEnabled } from '../utils/soundEffects.js';
import { extractFilesFromClipboard, readDeviceClipboard } from '../utils/fileUtils.js';

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
  onCancelTransfer = () => {},
  onClearCompleted = () => {}
}) {
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [mobileTab, setMobileTab] = useState('files'); // 'files' | 'chat' | 'info'

  const isConnected = roomStatus === 'connected';
  const isTerminated = ['closed', 'expired', 'error'].includes(roomStatus);

  const [soundActive, setSoundActive] = useState(() => isSoundEnabled());
  const [pasteNotice, setPasteNotice] = useState(null);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);

  const toggleSound = () => {
    const next = !soundActive;
    setSoundActive(next);
    setSoundEnabled(next);
    hapticTap();
  };

  // Handle files pasted from clipboard (from global keyboard or button)
  const handleClipboardFiles = useCallback((files) => {
    if (!files || files.length === 0) return;
    if (!isP2PConnected) {
      hapticError();
      setPasteNotice('⚠️ Cannot send: Waiting for peer to establish P2P connection.');
      setTimeout(() => setPasteNotice(null), 3500);
      return;
    }

    hapticTap();
    playSendSound();
    onFilesSelected(files);
    setPasteNotice(`📋 Pasted & queued ${files.length} file(s)`);
    setTimeout(() => setPasteNotice(null), 3000);
  }, [isP2PConnected, onFilesSelected]);

  // Handle text pasted from clipboard outside an input
  const handleClipboardText = useCallback((text) => {
    if (!text || !text.trim()) return;
    if (!isP2PConnected) {
      hapticError();
      setPasteNotice('⚠️ Cannot send: Waiting for peer to establish P2P connection.');
      setTimeout(() => setPasteNotice(null), 3500);
      return;
    }

    hapticTap();
    playSendSound();
    onSendMessage(text.trim());
    setPasteNotice('📋 Pasted & sent text message');
    setTimeout(() => setPasteNotice(null), 3000);
  }, [isP2PConnected, onSendMessage]);

  // 1-Tap Clipboard Button for mobile & desktop
  const handlePasteFromDeviceClipboard = useCallback(async () => {
    try {
      const data = await readDeviceClipboard();
      if (data.files && data.files.length > 0) {
        handleClipboardFiles(data.files);
      } else if (data.text) {
        handleClipboardText(data.text);
      } else {
        setPasteNotice('Clipboard is empty or unsupported format.');
        setTimeout(() => setPasteNotice(null), 3000);
      }
    } catch {
      setPasteNotice('Clipboard permission denied by browser or unavailable.');
      setTimeout(() => setPasteNotice(null), 3500);
    }
  }, [handleClipboardFiles, handleClipboardText]);

  // Global Keyboard Paste Listener (Ctrl+V / Cmd+V)
  useEffect(() => {
    if (isTerminated) return;

    const handlePaste = (e) => {
      // 1. Check for files/images (screenshots, copied files)
      const files = extractFilesFromClipboard(e.clipboardData);
      if (files.length > 0) {
        // Files/Screenshots: Always intercept regardless of active element!
        e.preventDefault();
        handleClipboardFiles(files);
        return;
      }

      // 2. If user is currently typing in an input/textarea:
      // Let the native input receive the text!
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        return;
      }

      // 3. Text pasted outside inputs: beam it over chat!
      const text = e.clipboardData?.getData('text');
      if (text && text.trim()) {
        e.preventDefault();
        handleClipboardText(text);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isTerminated, handleClipboardFiles, handleClipboardText]);

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
    <div className="animate-entrance" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Top Glass Room Header Bar */}
      <div
        className="card"
        style={{
          padding: '12px 18px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          background: 'var(--glass-surface-1)',
          border: '1px solid var(--glass-border)'
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
            <button
              type="button"
              onClick={() => setShowDiagnosticsModal(true)}
              style={{
                fontSize: '0.78rem',
                color: 'var(--color-lime)',
                fontFamily: 'var(--font-mono)',
                background: 'rgba(228, 253, 151, 0.08)',
                padding: '3px 10px',
                borderRadius: 'var(--radius-full)',
                border: '1px solid rgba(228, 253, 151, 0.25)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px'
              }}
              title="Click to view WebRTC Diagnostics & Network Telemetry"
            >
              <span>⚡ {connectionStats.rtt}ms</span>
              <span style={{ fontSize: '0.68rem', opacity: 0.7 }}>ℹ️</span>
            </button>
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
            onClick={handlePasteFromDeviceClipboard}
            className="btn btn-secondary"
            style={{
              minHeight: '36px',
              padding: '6px 12px',
              fontSize: '0.82rem',
              borderRadius: 'var(--radius-full)',
              borderColor: 'rgba(228, 253, 151, 0.3)',
              color: 'var(--color-lime)'
            }}
            title="Paste image, files, or text from device clipboard"
            aria-label="Paste from clipboard"
          >
            📋 Paste
          </button>

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

      {/* Floating Clipboard Notification Toast (Zero Layout Shift) */}
      {pasteNotice && (
        <div
          className="animate-entrance"
          style={{
            position: 'fixed',
            top: '72px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 100,
            padding: '8px 20px',
            background: 'var(--color-lime)',
            color: 'var(--color-lime-text)',
            fontWeight: 800,
            borderRadius: 'var(--radius-full)',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.5), 0 0 25px rgba(228, 253, 151, 0.45)',
            textAlign: 'center',
            fontSize: '0.86rem',
            letterSpacing: '0.01em',
            pointerEvents: 'none'
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
                  onPasteClipboard={handlePasteFromDeviceClipboard}
                  disabled={!isP2PConnected}
                />

                <TransferQueue
                  transfers={transfers}
                  onCancelTransfer={onCancelTransfer}
                  onClearCompleted={onClearCompleted}
                />
              </div>
            </div>

            {/* Right Column: Direct P2P Text Chat */}
            <div className={`desktop-column-right ${mobileTab === 'chat' ? 'mobile-pane-active' : 'mobile-pane-inactive'}`}>
              <TextTransfer
                messages={messages}
                onSendMessage={onSendMessage}
                onFilesSelected={onFilesSelected}
                disabled={!isP2PConnected}
              />
            </div>
          </div>
        </>
      )}

      {/* WebRTC P2P Diagnostics Modal */}
      {showDiagnosticsModal && (
        <div
          className="animate-entrance"
          onClick={() => setShowDiagnosticsModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '460px',
              width: '100%',
              padding: '24px',
              background: 'rgba(24, 38, 23, 0.95)',
              border: '1px solid var(--color-lime-border)',
              boxShadow: 'var(--glass-shadow-glow)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.2rem' }}>⚡</span>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-text-main)' }}>
                  WebRTC Network Telemetry
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDiagnosticsModal(false)}
                className="btn btn-secondary"
                style={{ minHeight: '30px', padding: '2px 10px', fontSize: '0.8rem' }}
              >
                ✕ Close
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(15, 24, 14, 0.6)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Connection Type:</span>
                <span style={{ fontWeight: 700, color: 'var(--color-lime)' }}>
                  {connectionType === 'lan' ? '⚡ LAN Direct (Highest Speed)' : connectionType === 'relay' ? '🔄 TURN Relayed' : '⚡ STUN Direct (P2P NAT)'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(15, 24, 14, 0.6)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Round-Trip Latency (RTT):</span>
                <span style={{ fontWeight: 700, color: 'var(--color-text-main)', fontFamily: 'var(--font-mono)' }}>
                  {connectionStats?.rtt != null ? `${connectionStats.rtt} ms` : 'Measuring...'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(15, 24, 14, 0.6)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Local Device:</span>
                <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>
                  {myDeviceName || 'Local Browser'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(15, 24, 14, 0.6)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Peer Device:</span>
                <span style={{ fontWeight: 600, color: 'var(--color-text-main)' }}>
                  {peerDeviceName || 'Connected Peer'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(15, 24, 14, 0.6)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>SCTP Data Channels:</span>
                <span style={{ fontWeight: 700, color: 'var(--color-lime)' }}>
                  control: Open • file: Open
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(15, 24, 14, 0.6)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Screen Awake Lock:</span>
                <span style={{ fontWeight: 600, color: isWakeLockActive ? 'var(--color-lime)' : 'var(--color-text-muted)' }}>
                  {isWakeLockActive ? 'Active (Prevent Sleep)' : 'Inactive'}
                </span>
              </div>
            </div>

            <div style={{ marginTop: '16px', textAlign: 'center' }}>
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                Transfers flow direct peer-to-peer via encrypted DTLS/SCTP. Zero intermediate server storage.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CopyButton } from './CopyButton.jsx';
import { downloadAllAsZip } from '../utils/fileUtils.js';
import { formatBytes } from '../utils/formatBytes.js';
import { hapticTap, playSuccessSound } from '../utils/soundEffects.js';
import { isDebugEnabled } from '../utils/debugLogger.js';
import { buildInvitationUrl } from '../utils/roomUtils.js';
import {
  Laptop,
  Smartphone,
  Zap,
  Activity,
  Share2,
  Archive,
  RefreshCw,
  QrCode,
  ShieldCheck,
  Server,
  Lock
} from 'lucide-react';

/**
 * 300px Left Sidebar for the connected room app-shell.
 * Has its own internal scrolling (min-height: 0, overflow-y: auto).
 * Contains:
 * - Session card with 2 device chips & live connection line
 * - Connection quality card with honest copy
 * - Expiry countdown ring
 * - Compact Invite section (small QR + copy link + share)
 * - Session totals & "Save all as ZIP" action
 */
export function RoomSidebar({
  roomId,
  joinToken,
  roomKey = null,
  myDeviceName,
  peerDeviceName,
  isOwner,
  isConnected,
  isPeerReconnecting,
  isP2PConnected,
  connectionType,
  connectionStats,
  expiresAt,
  transfers = [],
  onCloseMobileSheet
}) {
  const qrCanvasRef = useRef(null);
  const [timeLeft, setTimeLeft] = useState('');
  const [percentLeft, setPercentLeft] = useState(100);
  const [initialDuration, setInitialDuration] = useState(null);
  const [isZipping, setIsZipping] = useState(false);
  const [zipPercent, setZipPercent] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const isDebug = isDebugEnabled();
  const invitationUrl = joinToken
    ? buildInvitationUrl(roomId || '', joinToken, roomKey, isDebug)
    : '';

  // Render compact QR code
  useEffect(() => {
    if (!qrCanvasRef.current || !invitationUrl) return;

    QRCode.toCanvas(
      qrCanvasRef.current,
      invitationUrl,
      {
        width: 120,
        margin: 1,
        color: {
          dark: '#090a0f',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'M'
      },
      (err) => {
        if (err) console.error('Error rendering compact QR code:', err);
      }
    );
  }, [invitationUrl]);

  // Expiration countdown
  useEffect(() => {
    if (!expiresAt) return;

    const totalDur = expiresAt - Date.now();
    if (totalDur > 0 && !initialDuration) {
      setInitialDuration(totalDur);
    }

    const updateTimer = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        setTimeLeft('Expired');
        setPercentLeft(0);
        return;
      }

      const totalSec = Math.floor(remaining / 1000);
      const minutes = Math.floor(totalSec / 60);
      const seconds = totalSec % 60;
      setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`);

      const dur = initialDuration || totalDur || 600000;
      const pct = Math.max(0, Math.min(100, (remaining / dur) * 100));
      setPercentLeft(pct);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, initialDuration]);

  // Session totals calculation
  const completedTransfers = transfers.filter((t) => t.status === 'completed');
  const completedReceived = transfers.filter(
    (t) => t.direction === 'receive' && t.status === 'completed' && t.downloadUrl
  );
  const activeTransfers = transfers.filter((t) => t.status === 'transferring');
  const totalBytesTransferred = completedTransfers.reduce(
    (acc, t) => acc + (t.fileSize || 0),
    0
  );
  const totalReceivedBytes = completedReceived.reduce(
    (acc, t) => acc + (t.fileSize || 0),
    0
  );
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const maxZipBytes = isMobile ? 250 * 1024 * 1024 : 500 * 1024 * 1024;
  const isZipTooLarge = totalReceivedBytes > maxZipBytes;

  const handleDownloadZip = async () => {
    if (completedReceived.length === 0 || isZipping || isZipTooLarge) return;
    hapticTap();
    setIsZipping(true);
    setZipPercent(0);

    try {
      await downloadAllAsZip(
        completedReceived,
        `QuickDrop-${roomId ? roomId.slice(0, 8) : 'Session'}-${Date.now()}.zip`,
        (percent) => setZipPercent(percent)
      );
      playSuccessSound();
    } catch (err) {
      console.error('Failed to generate ZIP archive:', err);
    } finally {
      setIsZipping(false);
      setZipPercent(0);
    }
  };

  const handleShare = async () => {
    if (!navigator.share || !invitationUrl) return;
    hapticTap();
    try {
      await navigator.share({
        title: 'Join QuickDrop Room',
        text: 'Join my temporary QuickDrop room to send files directly without an account:',
        url: invitationUrl
      });
    } catch (err) {
      if (err.name !== 'AbortError') console.error('Share error:', err);
    }
  };

  // Connection line styling
  const getConnectionLineClass = () => {
    if (isPeerReconnecting) return 'connection-line line-pulsing';
    if (isP2PConnected || isConnected) return 'connection-line line-solid';
    return 'connection-line line-dashed';
  };

  // Honest copy following actual connection mode
  const isDirect = isP2PConnected && (connectionType === 'lan' || connectionType === 'direct');
  const isTurn = isP2PConnected && connectionType === 'relay';
  const isServerRelay = !isP2PConnected && isConnected;

  const connectionLabel = isPeerReconnecting
    ? 'Reconnecting'
    : isDirect
    ? connectionType === 'lan' ? 'Direct (LAN)' : 'Direct'
    : isTurn
    ? 'Via TURN'
    : isServerRelay
    ? 'Server relay'
    : 'Connecting...';

  const connectionExplanation = isDirect
    ? 'Sent directly between your devices (encrypted in transit)'
    : isTurn
    ? 'Relayed via Cloudflare TURN. Encrypted end to end (DTLS).'
    : isServerRelay
    ? roomKey
      ? 'Encrypted end to end, even through the relay. Nothing is stored.'
      : 'Secure relay unavailable, ask for the full invite link'
    : 'Connecting...';

  const rttMs = connectionStats && typeof connectionStats.rtt === 'number' ? Math.round(connectionStats.rtt) : null;

  // Diagnostics data derivation
  const gathered = connectionStats?.gatheredCandidateTypes || [];
  const hasSrflx = gathered.includes('srflx');
  const hasRelay = gathered.includes('relay');

  const stunStatus = hasSrflx
    ? 'Reachable (srflx candidate gathered)'
    : isDirect
    ? 'Reachable (direct path established)'
    : gathered.length > 0
    ? 'Not detected'
    : 'Checking...';

  const turnStatus = hasRelay
    ? 'Reachable (relay candidate gathered)'
    : gathered.length > 0
    ? 'Not gathered'
    : 'Checking...';

  const selectedPath = isDirect
    ? `Direct (P2P)${connectionStats?.selectedPairType ? ` • ${connectionStats.selectedPairType}` : ''}`
    : isTurn
    ? `Via TURN (Cloudflare)${connectionStats?.selectedPairType ? ` • ${connectionStats.selectedPairType}` : ''}`
    : isServerRelay
    ? 'Server relay (WebSocket)'
    : 'Negotiating...';

  const diagExplanation = isDirect
    ? 'Devices communicate directly over WebRTC. Minimal latency and maximum throughput.'
    : isTurn
    ? 'Relayed through Cloudflare Realtime TURN and encrypted end-to-end via DTLS (the relay server cannot inspect files).'
    : isServerRelay
    ? 'Relayed through QuickDrop WebSocket server with ACK flow control. Data is not stored.'
    : 'Establishing secure peer connection between devices.';

  const diagSuggestion = isDirect
    ? 'Optimal peer-to-peer connection active.'
    : isTurn
    ? 'Both devices connected. For direct speeds, connect both devices to the same local Wi-Fi network.'
    : isServerRelay
    ? 'If you want direct or TURN transfers, ensure UDP traffic or WebRTC is not blocked by your firewall or VPN.'
    : 'Keep this tab open while peers discover each other.';

  const bridgeBadgeClass = `bridge-badge ${
    isDirect ? 'badge-direct' : isTurn ? 'badge-turn' : isConnected ? 'badge-relay' : 'badge-idle'
  }`;

  const statusDotClass = isDirect
    ? 'status-dot-direct'
    : isTurn
    ? 'status-dot-turn'
    : isConnected
    ? 'status-dot-relay'
    : 'status-dot-waiting';

  return (
    <aside className="room-sidebar" aria-label="Session details and controls">
      {/* 1. Device Session Card */}
      <div className="sidebar-card session-card">
        <div className="sidebar-card-header">
          <span className="sidebar-section-title">Session</span>
          {timeLeft && (
            <div className="expiry-pill" title={`Session expires in ${timeLeft}`}>
              <svg className="expiry-svg-ring" width="16" height="16" viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="8" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
                <circle
                  cx="10"
                  cy="10"
                  r="8"
                  fill="none"
                  stroke="var(--color-brand)"
                  strokeWidth="2.5"
                  strokeDasharray={50.26}
                  strokeDashoffset={50.26 * (1 - percentLeft / 100)}
                  strokeLinecap="round"
                  transform="rotate(-90 10 10)"
                  style={{ transition: 'stroke-dashoffset 0.8s linear' }}
                />
              </svg>
              <span className="expiry-text">{timeLeft}</span>
            </div>
          )}
        </div>

        {/* Device pair with live connection line */}
        <div className="session-device-pair">
          {/* Host / You */}
          <div className="device-chip me-chip">
            <div className="device-chip-icon">
              <Laptop size={15} strokeWidth={1.75} />
            </div>
            <div className="device-chip-meta">
              <span className="device-chip-role">{isOwner ? 'Host (You)' : 'Guest (You)'}</span>
              <span className="device-chip-name">{myDeviceName || 'Windows PC'}</span>
            </div>
          </div>

          {/* Connection Bridge */}
          <div className="session-bridge">
            <div className={getConnectionLineClass()} />
            <div
              className={bridgeBadgeClass}
              title={connectionExplanation}
            >
              {isPeerReconnecting ? (
                <RefreshCw size={10} className="spin" />
              ) : isDirect ? (
                <Zap size={10} />
              ) : isTurn ? (
                <ShieldCheck size={10} />
              ) : (
                <Server size={10} />
              )}
            </div>
            <div className={getConnectionLineClass()} />
          </div>

          {/* Peer */}
          <div className="device-chip peer-chip">
            <div className="device-chip-icon">
              <Smartphone size={15} strokeWidth={1.75} />
            </div>
            <div className="device-chip-meta">
              <span className="device-chip-role">{isOwner ? 'Guest' : 'Host'}</span>
              <span className="device-chip-name">{peerDeviceName || 'Waiting to join...'}</span>
            </div>
          </div>
        </div>

        {/* Connection Quality Card */}
        <div className="connection-quality-box">
          <div className="quality-header">
            <span className="quality-pill-indicator">
              <span className={`status-dot ${statusDotClass}`} />
              <span className="quality-mode-text">
                {connectionLabel}
              </span>
              <span
                className="privacy-lock-badge"
                title="What the server sees: Room ID, connection timing, approximate transfer sizes, and IP addresses.&#10;What the server CANNOT see: File contents, file names, message text, or encryption keys."
                aria-label="Privacy guarantee: The server cannot see file contents, names, messages, or keys."
              >
                <Lock size={11} strokeWidth={2} />
              </span>
            </span>

            {rttMs !== null && (
              <span className="quality-rtt" title="Round trip network latency">
                <Activity size={11} strokeWidth={2} />
                <span>{rttMs} ms</span>
              </span>
            )}
          </div>
          <p className="quality-explanation">{connectionExplanation}</p>

          <button
            type="button"
            className="btn-connection-check"
            onClick={() => setShowDiagnostics((prev) => !prev)}
            aria-expanded={showDiagnostics}
          >
            <Activity size={11} strokeWidth={1.75} />
            <span>{showDiagnostics ? 'Hide connection check' : 'Connection check'}</span>
          </button>

          {showDiagnostics && (
            <div className="connection-diagnostics-card" aria-label="Connection diagnostics report">
              <div className="diag-title-row">
                <span>Diagnostics</span>
                <span>{connectionLabel}</span>
              </div>
              <div className="diag-metrics-list">
                <div className="diag-item">
                  <span className="diag-item-label">STUN Reachable</span>
                  <span className="diag-item-value">{stunStatus}</span>
                </div>
                <div className="diag-item">
                  <span className="diag-item-label">TURN Reachable</span>
                  <span className="diag-item-value">{turnStatus}</span>
                </div>
                <div className="diag-item">
                  <span className="diag-item-label">Selected Path</span>
                  <span className="diag-item-value">{selectedPath}</span>
                </div>
                <div className="diag-item">
                  <span className="diag-item-label">Round-Trip Time</span>
                  <span className="diag-item-value">{rttMs !== null ? `${rttMs} ms` : 'N/A'}</span>
                </div>
              </div>
              <div className="diag-note-box">
                <p className="diag-note-text">{diagExplanation}</p>
                <p className="diag-suggestion-text">{diagSuggestion}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2. Session Totals & Zip Action */}
      <div className="sidebar-card totals-card">
        <span className="sidebar-section-title">Session Totals</span>
        <div className="totals-grid">
          <div className="total-metric">
            <span className="metric-value">{completedTransfers.length}</span>
            <span className="metric-label">Transferred</span>
          </div>
          <div className="total-metric">
            <span className="metric-value">{formatBytes(totalBytesTransferred)}</span>
            <span className="metric-label">Volume</span>
          </div>
          <div className="total-metric">
            <span className="metric-value">{activeTransfers.length}</span>
            <span className="metric-label">Active</span>
          </div>
        </div>

        {completedReceived.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '4px' }}>
            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={isZipping || isZipTooLarge}
              className="btn btn-secondary btn-zip-all"
              title={
                isZipTooLarge
                  ? 'Too large to zip in the browser. Save files individually.'
                  : `Save all ${completedReceived.length} received files as ZIP archive`
              }
              aria-label={`Save all ${completedReceived.length} received files as ZIP archive`}
            >
              <Archive size={14} strokeWidth={1.75} />
              <span>
                {isZipping
                  ? `Archiving (${zipPercent}%)...`
                  : `Save all as ZIP (${completedReceived.length} ready)`}
              </span>
            </button>
            {isZipTooLarge && (
              <p className="zip-size-warning" role="alert">
                Too large to zip in browser ({formatBytes(totalReceivedBytes)}). Save files individually.
              </p>
            )}
          </div>
        )}
      </div>

      {/* 3. Compact Invite Card */}
      {joinToken && (
        <div className="sidebar-card invite-card">
          <div className="sidebar-card-header">
            <span className="sidebar-section-title">Invite Link</span>
          </div>

          <div className="compact-qr-container">
            <div className="compact-qr-frame">
              <canvas ref={qrCanvasRef} width="120" height="120" />
            </div>
            <div className="compact-invite-actions">
              <input
                type="text"
                readOnly
                value={invitationUrl}
                className="input input-mono compact-url-input"
                aria-label="Invitation URL"
              />
              <div className="compact-btn-row">
                <CopyButton text={invitationUrl} label="Copy link" copiedLabel="Copied" />
                {typeof navigator !== 'undefined' && Boolean(navigator.share) && (
                  <button
                    type="button"
                    onClick={handleShare}
                    className="btn btn-secondary compact-share-btn"
                    aria-label="Share invitation link"
                  >
                    <Share2 size={13} strokeWidth={1.75} />
                    <span>Share</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

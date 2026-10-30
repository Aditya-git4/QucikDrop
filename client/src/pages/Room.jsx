import React, { useState, useEffect, useCallback } from 'react';
import { RoomSidebar } from '../components/RoomSidebar.jsx';
import { RoomTimeline } from '../components/RoomTimeline.jsx';
import { RoomComposer } from '../components/RoomComposer.jsx';
import { WaitingRoomView } from '../components/WaitingRoomView.jsx';
import { FullWindowDropZone } from '../components/FullWindowDropZone.jsx';
import { JoinApprovalModal } from '../components/JoinApprovalModal.jsx';
import { PinPromptModal } from '../components/PinPromptModal.jsx';
import { JoinPendingView } from '../components/JoinPendingView.jsx';
import { playSendSound, hapticTap, hapticError, isSoundEnabled, setSoundEnabled } from '../utils/soundEffects.js';
import { extractFilesFromClipboard } from '../utils/fileUtils.js';
import { isDebugEnabled } from '../utils/debugLogger.js';
import { isSecureCryptoAvailable } from '../utils/relayCrypto.js';
import {
  Volume2,
  VolumeX,
  SunMedium,
  Copy,
  Check,
  RotateCw,
  LogOut,
  Plus,
  X,
  SlidersHorizontal,
  Activity,
  AlertCircle,
  Clock
} from 'lucide-react';

/**
 * Redesigned Room Screen.
 * Uses an app-shell layout: header (auto) + body (1fr, min-height: 0).
 * Document itself never scrolls; header & composer are pinned.
 * Desktop (>= 1024px): 3 zones
 *   1. Left Sidebar (300px, own scroll)
 *   2. Unified Timeline (messages + file bubbles in chronological order)
 *   3. Pinned Composer at bottom
 * Mobile (< 1024px):
 *   Single column timeline + pinned composer, with a "Session" button
 *   that opens the sidebar content as a bottom sheet.
 */
export function Room({
  roomId,
  joinToken,
  roomKey = null,
  roomStatus,
  isPeerReconnecting = false,
  isOwner,
  myDeviceName,
  peerDeviceName,
  expiresAt,
  messages = [],
  onSendMessage,
  onLeaveRoom,
  onCloseRoom,
  onReset,
  onStartFreshSession,
  errorMessage,
  isP2PConnected = false,
  webrtcStatus = 'disconnected',
  connectionType = 'unknown',
  connectionStats = null,
  transfers = [],
  isWakeLockActive = false,
  requirePin = false,
  roomPin = null,
  pendingJoinRequest = null,
  isJoinPending = false,
  pinRequired = false,
  pinError = null,
  pinAttemptsRemaining = null,
  joinDenied = false,
  onApproveJoin = () => {},
  onDenyJoin = () => {},
  onCancelJoin = () => {},
  onSubmitPin = () => {},
  onRetryJoin = () => {},
  onFilesSelected = () => {},
  onRetryTransfer = () => {},
  onCancelTransfer = () => {},
  onClearCompleted = () => {}
}) {
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);
  const [soundActive, setSoundActive] = useState(() => isSoundEnabled());
  const [pasteNotice, setPasteNotice] = useState(null);

  const isConnected = roomStatus === 'connected';
  const isTerminated = ['closed', 'expired', 'error'].includes(roomStatus);
  const isDebug = isDebugEnabled();

  const toggleSound = () => {
    const next = !soundActive;
    setSoundActive(next);
    setSoundEnabled(next);
    hapticTap();
  };

  // Clipboard copy handler for room code
  const handleCopyCode = async () => {
    if (!roomId) return;
    try {
      await navigator.clipboard.writeText(roomId);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // ignore
    }
  };

  // Global Keyboard Paste Listener (Ctrl+V / Cmd+V)
  useEffect(() => {
    if (isTerminated) return;

    const handlePaste = (e) => {
      const files = extractFilesFromClipboard(e.clipboardData);
      if (files.length > 0) {
        e.preventDefault();
        hapticTap();
        playSendSound();
        onFilesSelected(files);
        setPasteNotice(`Pasted & queued ${files.length} file(s)`);
        setTimeout(() => setPasteNotice(null), 3000);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isTerminated, onFilesSelected]);

  // Handle mobile visualViewport resizing (on-screen keyboard open/close)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const handleViewportResize = () => {
      const vh = window.visualViewport.height;
      document.documentElement.style.setProperty('--viewport-height', `${vh}px`);
    };

    handleViewportResize();
    window.visualViewport.addEventListener('resize', handleViewportResize);
    window.visualViewport.addEventListener('scroll', handleViewportResize);

    return () => {
      window.visualViewport.removeEventListener('resize', handleViewportResize);
      window.visualViewport.removeEventListener('scroll', handleViewportResize);
      document.documentElement.style.removeProperty('--viewport-height');
    };
  }, []);

  // Escape key closes mobile bottom sheet
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && showMobileSidebar) {
        setShowMobileSidebar(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showMobileSidebar]);

  const getConnectionPill = () => {
    if (isPeerReconnecting) {
      return {
        label: 'Reconnecting...',
        color: 'var(--color-status-relay)',
        dotClass: 'status-dot-relay pulse'
      };
    }
    if (isP2PConnected) {
      if (connectionType === 'relay') {
        return {
          label: 'Via TURN',
          color: 'var(--color-status-turn, #38bdf8)',
          dotClass: 'status-dot-turn'
        };
      }
      return {
        label: connectionType === 'lan' ? 'Direct (LAN)' : 'Direct',
        color: 'var(--color-status-direct)',
        dotClass: 'status-dot-direct'
      };
    }
    if (isConnected) {
      return {
        label: 'Server relay',
        color: 'var(--color-status-relay)',
        dotClass: 'status-dot-relay'
      };
    }
    if (roomStatus === 'waiting') {
      return {
        label: 'Waiting for peer',
        color: 'var(--color-text-muted)',
        dotClass: 'status-dot-waiting'
      };
    }
    return {
      label: 'Closed',
      color: 'var(--color-text-muted)',
      dotClass: 'status-dot-closed'
    };
  };

  const pill = getConnectionPill();

  return (
    <div className="room-app-shell" data-room-status={roomStatus}>
      {/* Full-window drop zone overlay */}
      <FullWindowDropZone onFilesSelected={onFilesSelected} disabled={isTerminated} />

      {/* ====================================================================
          1. Pinned Top Bar: Room Code, Connection Pill, Sound, Session Toggle, Actions
          ==================================================================== */}
      <header className="room-shell-header">
        {/* Left: Room Code Chip & Connection Pill */}
        <div className="header-left-group">
          <div className="room-code-badge" title="Room Code">
            <span className="room-code-label">ROOM</span>
            <code className="room-code-text">
              {roomId ? `${roomId.slice(0, 8)}...${roomId.slice(-4)}` : 'Active'}
            </code>
            <button
              type="button"
              onClick={handleCopyCode}
              className="btn-icon btn-copy-code"
              title="Copy room code"
              aria-label="Copy room code"
            >
              {copiedCode ? <Check size={12} className="text-direct" /> : <Copy size={12} />}
            </button>
          </div>

          {/* Connection status pill */}
          <div className="connection-pill-badge" style={{ color: pill.color }}>
            <span className={`status-dot ${pill.dotClass}`} style={{ backgroundColor: pill.color }} />
            <span>{pill.label}</span>
          </div>

          {/* Wake Lock Active Badge */}
          {isWakeLockActive && (
            <div className="wake-lock-pill" title="Screen awake lock is active while file transfers are in progress">
              <SunMedium size={12} strokeWidth={2} />
              <span>Awake</span>
            </div>
          )}
        </div>

        {/* Right: Sound toggle, Mobile Session Button, Leave, New Room */}
        <div className="header-right-group">
          {/* Diagnostics button if debug is enabled */}
          {isDebug && (
            <button
              type="button"
              onClick={() => setShowDiagnosticsModal(true)}
              className="btn btn-secondary btn-header-tool"
              title="Open WebRTC Diagnostics"
              aria-label="Open WebRTC Diagnostics"
            >
              <Activity size={14} />
              <span className="btn-label-desktop">Diagnostics</span>
            </button>
          )}

          {/* Sound Mute/Unmute */}
          <button
            type="button"
            onClick={toggleSound}
            className="btn-icon btn-header-tool"
            title={soundActive ? 'Mute audio' : 'Unmute audio'}
            aria-label={soundActive ? 'Mute audio' : 'Unmute audio'}
          >
            {soundActive ? <Volume2 size={16} strokeWidth={1.75} /> : <VolumeX size={16} strokeWidth={1.75} />}
          </button>

          {/* Mobile "Session" Button (opens bottom sheet) */}
          {isConnected && (
            <button
              type="button"
              onClick={() => setShowMobileSidebar(true)}
              className="btn btn-secondary mobile-only-btn btn-session-sheet"
              aria-label="Open session details"
              aria-expanded={showMobileSidebar}
            >
              <SlidersHorizontal size={14} strokeWidth={1.75} />
              <span>Session</span>
            </button>
          )}

          {/* Leave / Close Room button */}
          {!isTerminated ? (
            <div className="header-actions-row">
              <button
                type="button"
                onClick={() => setShowCloseConfirm(true)}
                className="btn btn-secondary btn-leave-action"
                aria-label={isOwner ? 'Close Room' : 'Leave Room'}
              >
                <LogOut size={13} strokeWidth={1.75} />
                <span>{isOwner ? 'Close room' : 'Leave room'}</span>
              </button>

              <button
                type="button"
                onClick={onStartFreshSession}
                className="btn btn-primary btn-new-room-action"
                aria-label="Start New Room"
              >
                <Plus size={14} strokeWidth={2} />
                <span>New room</span>
              </button>
            </div>
          ) : (
            <div className="header-actions-row">
              <button
                type="button"
                onClick={onReset}
                className="btn btn-secondary"
              >
                Home
              </button>
              <button
                type="button"
                onClick={onStartFreshSession}
                className="btn btn-primary"
              >
                <Plus size={14} strokeWidth={2} />
                <span>New room</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Floating Clipboard Notification Toast */}
      {pasteNotice && (
        <div role="status" aria-live="polite" className="paste-toast">
          {pasteNotice}
        </div>
      )}

      {/* ====================================================================
          2. App-Shell Body Container (1fr, min-height: 0, overflow: hidden)
          ==================================================================== */}
      <div className="room-shell-body">
        {/* State A: Waiting for peer to scan QR code */}
        {roomStatus === 'waiting' && isOwner && joinToken && (
          <WaitingRoomView
            roomId={roomId}
            joinToken={joinToken}
            roomKey={roomKey}
            requirePin={requirePin}
            roomPin={roomPin}
            expiresAt={expiresAt}
            onCloseRoom={onCloseRoom || onLeaveRoom}
          />
        )}

        {/* State B: Joiner waiting for host approval or denied */}
        {(isJoinPending || joinDenied || roomStatus === 'pending_approval' || roomStatus === 'denied') && !isConnected && !isTerminated && (
          <JoinPendingView
            isPending={isJoinPending || roomStatus === 'pending_approval'}
            isDenied={joinDenied || roomStatus === 'denied'}
            errorMessage={errorMessage}
            onCancel={onCancelJoin || onLeaveRoom || onReset}
            onRetry={onRetryJoin}
          />
        )}

        {/* State B: Connected Room (3 Zones) */}
        {isConnected && !isTerminated && (
          <>
            {/* Zone 1: Left Sidebar (300px, own scroll) */}
            <RoomSidebar
              roomId={roomId}
              joinToken={joinToken}
              myDeviceName={myDeviceName}
              peerDeviceName={peerDeviceName}
              isOwner={isOwner}
              isConnected={isConnected}
              isPeerReconnecting={isPeerReconnecting}
              isP2PConnected={isP2PConnected}
              connectionType={connectionType}
              connectionStats={connectionStats}
              expiresAt={expiresAt}
              transfers={transfers}
              onCloseMobileSheet={() => setShowMobileSidebar(false)}
            />

            {/* Zone 2: Main Column (Unified Timeline + Pinned Composer) */}
            <main className="room-main-column">
              <RoomTimeline
                messages={messages}
                transfers={transfers}
                myDeviceName={myDeviceName}
                peerDeviceName={peerDeviceName}
                onRetryTransfer={onRetryTransfer}
                onCancelTransfer={onCancelTransfer}
                connectionType={connectionType}
              />

              <div className="room-composer-wrapper">
                <RoomComposer
                  onSendMessage={onSendMessage}
                  onFilesSelected={onFilesSelected}
                  disabled={!isConnected}
                />
              </div>
            </main>

            {/* Mobile Bottom Sheet Backdrop & Sheet */}
            {showMobileSidebar && (
              <div
                className="mobile-sheet-backdrop"
                onClick={() => setShowMobileSidebar(false)}
                aria-hidden="true"
              >
                <div
                  className="mobile-sheet-content"
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Session details"
                >
                  <div className="mobile-sheet-drag-handle" />
                  <div className="mobile-sheet-header">
                    <span className="sidebar-section-title">Session Details</span>
                    <button
                      type="button"
                      onClick={() => setShowMobileSidebar(false)}
                      className="btn-icon"
                      aria-label="Close session details"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="mobile-sheet-body">
                    <RoomSidebar
                      roomId={roomId}
                      joinToken={joinToken}
                      myDeviceName={myDeviceName}
                      peerDeviceName={peerDeviceName}
                      isOwner={isOwner}
                      isConnected={isConnected}
                      isPeerReconnecting={isPeerReconnecting}
                      isP2PConnected={isP2PConnected}
                      connectionType={connectionType}
                      connectionStats={connectionStats}
                      expiresAt={expiresAt}
                      transfers={transfers}
                      onCloseMobileSheet={() => setShowMobileSidebar(false)}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* State C: Terminated / Expired / Closed Banner */}
        {isTerminated && (
          <div className="terminated-card">
            <div className="terminated-icon-tile">
              {roomStatus === 'expired' ? (
                <Clock size={28} strokeWidth={1.75} />
              ) : roomStatus === 'error' ? (
                <AlertCircle size={28} strokeWidth={1.75} />
              ) : (
                <LogOut size={28} strokeWidth={1.75} />
              )}
            </div>

            <h2 className="terminated-heading">
              {roomStatus === 'expired' ? 'Room Expired' : roomStatus === 'error' ? 'Connection Error' : 'Room Ended'}
            </h2>

            <p className="terminated-caption">
              {errorMessage ||
                (roomStatus === 'expired'
                  ? 'This temporary room exceeded its lifetime limit and has expired.'
                  : 'The connection has closed. For your security, temporary room data has been discarded.')}
            </p>

            <div className="terminated-actions">
              <button
                type="button"
                onClick={onStartFreshSession || onReset}
                className="btn btn-primary"
              >
                <Plus size={16} strokeWidth={2} />
                <span>{roomStatus === 'error' ? 'Retry Connection' : 'Create a New Room'}</span>
              </button>
              <button
                type="button"
                onClick={onReset}
                className="btn btn-secondary"
              >
                Return to Home
              </button>
            </div>
          </div>
        )}

        {/* State D: Connecting to signaling network */}
        {roomStatus === 'connecting' && (
          <div className="connecting-card">
            <RotateCw size={32} strokeWidth={1.75} className="spin text-brand" />
            <h2 className="connecting-heading">Establishing room</h2>
            <p className="connecting-caption">Connecting to signaling network and generating credentials...</p>
            <div className="connecting-actions">
              <button
                type="button"
                onClick={onStartFreshSession || onReset}
                className="btn btn-secondary"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={onReset}
                className="btn btn-ghost"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Leaving/Closing */}
      {showCloseConfirm && (
        <div className="modal-backdrop" onClick={() => setShowCloseConfirm(false)}>
          <div
            className="modal-box"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-modal-title"
          >
            <h3 id="close-modal-title" className="modal-title">
              {isOwner ? 'Close this room?' : 'Leave this room?'}
            </h3>
            <p className="modal-caption">
              {isOwner
                ? 'Closing the room will immediately disconnect the other device and discard any unsaved files.'
                : 'Leaving the room will end this transfer session.'}
            </p>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setShowCloseConfirm(false)}
                className="btn btn-secondary"
              >
                Stay in room
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCloseConfirm(false);
                  if (isOwner && onCloseRoom) {
                    onCloseRoom();
                  } else if (onLeaveRoom) {
                    onLeaveRoom();
                  }
                }}
                className="btn btn-primary btn-danger-action"
              >
                {isOwner ? 'Yes, close room' : 'Yes, leave room'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diagnostics Modal for ?debug=1 */}
      {showDiagnosticsModal && (
        <div className="modal-backdrop" onClick={() => setShowDiagnosticsModal(false)}>
          <div
            className="modal-box diagnostics-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="diag-title"
          >
            <div className="modal-header-row">
              <h3 id="diag-title" className="modal-title">Network Diagnostics</h3>
              <button
                type="button"
                onClick={() => setShowDiagnosticsModal(false)}
                className="btn-icon"
                aria-label="Close diagnostics"
              >
                <X size={16} />
              </button>
            </div>
            <div className="diagnostics-content">
              <div className="diag-row">
                <span>Room ID:</span>
                <code>{roomId}</code>
              </div>
              <div className="diag-row">
                <span>Signaling Status:</span>
                <code>{roomStatus}</code>
              </div>
              <div className="diag-row">
                <span>WebRTC Status:</span>
                <code>{webrtcStatus}</code>
              </div>
              <div className="diag-row">
                <span>Transport Mode:</span>
                <code>{isP2PConnected ? (connectionType === 'relay' ? 'WebRTC (Via TURN)' : `Direct (${connectionType})`) : 'Server relay (WebSocket)'}</code>
              </div>
              {connectionStats && (
                <div className="diag-row">
                  <span>Round Trip Time (RTT):</span>
                  <code>{Math.round(connectionStats.rtt || 0)} ms</code>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => setShowDiagnosticsModal(false)}
                className="btn btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Host Approval Modal (when a guest requests entry) */}
      {pendingJoinRequest && (
        <JoinApprovalModal
          request={pendingJoinRequest}
          onApprove={onApproveJoin}
          onDeny={onDenyJoin}
        />
      )}

      {/* Guest PIN Prompt Modal (when room requires access PIN) */}
      {pinRequired && (
        <PinPromptModal
          onSubmitPin={onSubmitPin}
          onCancel={onLeaveRoom || onReset}
          errorMessage={pinError}
          attemptsRemaining={pinAttemptsRemaining}
        />
      )}
    </div>
  );
}

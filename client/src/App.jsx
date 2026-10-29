import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSignaling } from './hooks/useSignaling.js';
import { useWebRTC } from './hooks/useWebRTC.js';
import { useFileTransfer } from './hooks/useFileTransfer.js';
import { Home } from './pages/Home.jsx';
import { Room } from './pages/Room.jsx';
import { ConnectionBanner } from './components/ConnectionBanner.jsx';
import { ErrorMessage } from './components/ErrorMessage.jsx';
import { DebugLog } from './components/DebugLog.jsx';
import { parseInvitationFromUrl, getRoomSession } from './utils/roomUtils.js';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('App ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '36px 20px', maxWidth: '440px', margin: '40px auto', textAlign: 'center' }} className="card">
          <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>⚠️</div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-main)', marginBottom: '8px' }}>
            Unable to render room
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)', marginBottom: '20px' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              window.location.href = '/';
            }}
          >
            Return to Home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const [hasNewVersion, setHasNewVersion] = useState(false);
  const {
    signalingClient,
    connectionStatus,
    roomStatus,
    isPeerReconnecting,
    roomId,
    joinToken,
    isOwner,
    myDeviceName,
    peerDeviceName,
    expiresAt,
    iceServers,
    errorMessage,
    errorCode,
    createRoom,
    joinRoom,
    rejoinRoom,
    closeRoom,
    reset,
    startFreshSession,
    setMyDeviceName
  } = useSignaling();

  const {
    webrtcStatus,
    isP2PConnected,
    connectionType,
    connectionStats,
    peerConnection,
    p2pMessages,
    sendP2PText,
    resetWebRTC
  } = useWebRTC({
    signalingClient,
    isOwner,
    roomId,
    myDeviceName,
    peerDeviceName,
    iceServers
  });

  const {
    transfers,
    queueFiles,
    retryTransfer,
    cancelTransfer,
    clearCompleted,
    isWakeLockActive,
    resetFileTransfer
  } = useFileTransfer({
    peerConnection,
    signalingClient
  });

  // PWA beforeinstallprompt handler
  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
    };

    const handleAppInstalled = () => {
      setDeferredInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // Listen for service worker updates taking control
  useEffect(() => {
    const handleNewVersion = () => {
      setHasNewVersion(true);
    };
    window.addEventListener('quickdrop:new-version', handleNewVersion);
    return () => {
      window.removeEventListener('quickdrop:new-version', handleNewVersion);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choiceResult = await deferredInstallPrompt.userChoice;
    if (choiceResult && choiceResult.outcome === 'accepted') {
      setDeferredInstallPrompt(null);
    }
  };

  const hasParsedUrlRef = useRef(false);

  // Check URL on initial load for invitation link (#token=...) or stored session
  useEffect(() => {
    if (hasParsedUrlRef.current) return;
    hasParsedUrlRef.current = true;

    const { roomId: urlRoomId, joinToken: urlJoinToken } = parseInvitationFromUrl();
    const storedSession = urlRoomId ? getRoomSession(urlRoomId) : null;

    if (storedSession && storedSession.roomId === urlRoomId && storedSession.peerSecret) {
      // Rejoin existing room using stored session credentials rather than consuming token
      rejoinRoom(storedSession.roomId, storedSession.peerId, storedSession.peerSecret, storedSession.deviceName);
    } else if (urlRoomId && urlJoinToken) {
      // Auto-join from QR code scan or link click
      joinRoom(urlRoomId, urlJoinToken);
    } else if (urlRoomId && !urlJoinToken) {
      // If user refreshed on /room/:id without token and no stored session, normalize address bar cleanly to /
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        window.history.replaceState(null, '', '/' + window.location.search);
      }
    }
  }, [joinRoom, rejoinRoom]);

  const handleReset = useCallback(() => {
    resetWebRTC();
    resetFileTransfer();
    reset();
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState(null, '', '/');
    }
  }, [resetWebRTC, resetFileTransfer, reset]);

  const handleLeaveRoom = useCallback(async () => {
    try {
      if (isOwner) {
        signalingClient.closeRoom();
      } else {
        signalingClient.leaveRoom();
      }
    } catch (err) {
      console.warn('Error sending leave/close message:', err);
    }
    // Wait briefly for the send to flush before resetting and navigating to Home
    await new Promise((r) => setTimeout(r, 60));
    handleReset();
  }, [isOwner, signalingClient, handleReset]);

  const handleStartFreshSession = useCallback(async (customName = null) => {
    resetWebRTC();
    resetFileTransfer();
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState(null, '', '/' + window.location.search);
    }
    await startFreshSession(customName || myDeviceName);
  }, [resetWebRTC, resetFileTransfer, startFreshSession, myDeviceName]);

  const isInRoomView = roomStatus !== 'idle';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', position: 'relative' }}>
      {/* Ambient Glassmorphic Refraction Orbs */}
      <div className="ambient-glow-canvas" aria-hidden="true">
        <div className="ambient-orb ambient-orb-1" />
        <div className="ambient-orb ambient-orb-2" />
        <div className="ambient-orb ambient-orb-3" />
      </div>

      {/* Top Application Header */}
      <header className="app-header">
        <div className="header-content">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              handleReset();
            }}
            className="brand-link"
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: 'var(--color-lime)', textShadow: '0 0 12px rgba(228, 253, 151, 0.4)' }}>⚡</span>
              <span>QuickDrop</span>
            </span>
            <span className="brand-badge">
              {connectionStatus === 'disconnected'
                ? 'Offline'
                : isP2PConnected
                ? connectionType === 'lan'
                  ? 'LAN P2P'
                  : 'Direct P2P'
                : connectionStatus === 'connected'
                ? 'Relay (server)'
                : 'Connecting...'}
            </span>
          </a>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {deferredInstallPrompt && (
              <button
                type="button"
                onClick={handleInstallApp}
                className="btn btn-secondary"
                style={{
                  minHeight: '32px',
                  padding: '4px 12px',
                  fontSize: '0.78rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  borderRadius: 'var(--radius-full)'
                }}
              >
                <span>📥</span>
                <span>Install</span>
              </button>
            )}

            {/* iOS Dynamic Island Status Pill */}
            <div className="dynamic-island-pill">
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: isP2PConnected
                    ? 'var(--color-lime)'
                    : connectionStatus === 'connected'
                    ? 'var(--color-warning)'
                    : 'var(--color-danger)',
                  boxShadow: isP2PConnected
                    ? '0 0 10px rgba(228, 253, 151, 0.8)'
                    : connectionStatus === 'connected'
                    ? '0 0 8px rgba(250, 204, 21, 0.6)'
                    : 'none'
                }}
              />
              <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--color-text-main)', letterSpacing: '0.01em' }}>
                {isP2PConnected
                  ? 'P2P Direct'
                  : connectionStatus === 'connected'
                  ? 'Signaling Active'
                  : connectionStatus === 'connecting'
                  ? 'Connecting...'
                  : 'Offline'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-content">
        <ErrorBoundary>
          <ConnectionBanner status={connectionStatus} />

          {/* Global Error Banner */}
          {errorMessage && roomStatus === 'idle' && (
            <ErrorMessage message={errorMessage} code={errorCode} onDismiss={handleReset} />
          )}

          {!isInRoomView ? (
            <Home
              onCreateRoom={(name) => {
                setMyDeviceName(name);
                handleStartFreshSession(name);
              }}
              onJoinRoom={(targetRoomId, targetToken, name) => {
                setMyDeviceName(name);
                joinRoom(targetRoomId, targetToken, name);
              }}
              isConnecting={connectionStatus === 'connecting'}
              errorMessage={errorMessage}
            />
          ) : (
            <Room
              roomId={roomId || ''}
              joinToken={joinToken}
              roomStatus={roomStatus}
              isPeerReconnecting={isPeerReconnecting}
              isOwner={isOwner}
              myDeviceName={myDeviceName}
              peerDeviceName={peerDeviceName}
              expiresAt={expiresAt}
              messages={p2pMessages}
              onSendMessage={sendP2PText}
              onLeaveRoom={handleLeaveRoom}
              onCloseRoom={handleLeaveRoom}
              onReset={handleReset}
              onStartFreshSession={handleStartFreshSession}
              errorMessage={errorMessage}
              isP2PConnected={isP2PConnected}
              webrtcStatus={webrtcStatus}
              connectionType={connectionType}
              connectionStats={connectionStats}
              transfers={transfers}
              isWakeLockActive={isWakeLockActive}
              onFilesSelected={queueFiles}
              onRetryTransfer={retryTransfer}
              onCancelTransfer={cancelTransfer}
              onClearCompleted={clearCompleted}
            />
          )}
        </ErrorBoundary>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>
          QuickDrop — Temporary Peer-to-Peer Sharing • Zero server file storage • Native WebRTC
        </p>
      </footer>

      {/* On-Screen Diagnostic Debug Overlay (toggled via ?debug=1) */}
      <DebugLog peerConnection={peerConnection} signalingClient={signalingClient} />

      {/* New version available notification */}
      {hasNewVersion && (
        <aside
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            backgroundColor: 'rgba(22, 29, 23, 0.95)',
            border: '1px solid var(--color-lime)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            borderRadius: '9999px',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: 'var(--color-text-main)',
            fontSize: '0.84rem'
          }}
        >
          <span style={{ fontSize: '1rem' }}>⚡</span>
          <span style={{ fontWeight: 500 }}>New version available</span>
          <button
            type="button"
            className="btn btn-primary"
            style={{
              minHeight: '28px',
              padding: '2px 12px',
              fontSize: '0.78rem',
              fontWeight: 700,
              borderRadius: '9999px'
            }}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </aside>
      )}
    </div>
  );
}

export default App;

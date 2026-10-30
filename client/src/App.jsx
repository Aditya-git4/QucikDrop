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
import { Radio, Download, Sun, Moon, AlertCircle } from 'lucide-react';

const isDemoMode = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';

let DemoRoom = null;
if (import.meta.env.DEV) {
  DemoRoom = React.lazy(() => import('./dev/DemoRoom.jsx'));
}

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
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <AlertCircle size={40} strokeWidth={1.75} color="var(--color-status-relay)" />
          </div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '8px' }}>
            Unable to render room
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
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

  // Theme management: defaults to dark, supports light via toggle & prefers-color-scheme
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('quickdrop:theme');
      if (saved === 'light' || saved === 'dark') return saved;
      if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
        return 'light';
      }
    } catch (_) {}
    return 'dark';
  });

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
      try {
        localStorage.setItem('quickdrop:theme', theme);
      } catch (_) {}
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };
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
    roomKey,
    errorMessage,
    errorCode,
    pendingJoinRequest,
    isJoinPending,
    pendingRequestId,
    requirePin,
    roomPin,
    pinRequired,
    pinError,
    pinAttemptsRemaining,
    joinDenied,
    createRoom,
    joinRoom,
    rejoinRoom,
    closeRoom,
    reset,
    startFreshSession,
    setMyDeviceName,
    approveJoinRequest,
    denyJoinRequest,
    cancelJoinRequest,
    submitPin,
    retryJoin
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
    iceServers,
    roomKey
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
    signalingClient,
    roomKey,
    isOwner
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

    const { roomId: urlRoomId, joinToken: urlJoinToken, roomKey: urlRoomKey } = parseInvitationFromUrl();
    const storedSession = urlRoomId ? getRoomSession(urlRoomId) : null;

    if (storedSession && storedSession.roomId === urlRoomId && storedSession.peerSecret) {
      // Rejoin existing room using stored session credentials rather than consuming token
      rejoinRoom(storedSession.roomId, storedSession.peerId, storedSession.peerSecret, storedSession.deviceName);
    } else if (urlRoomId && urlJoinToken) {
      // Auto-join from QR code scan or link click
      joinRoom(urlRoomId, urlJoinToken, null, urlRoomKey);
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

  const handleStartFreshSession = useCallback(async (customName = null, reqPin = false, pinCode = null) => {
    resetWebRTC();
    resetFileTransfer();
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState(null, '', '/' + window.location.search);
    }
    await startFreshSession(customName || myDeviceName, reqPin, pinCode);
  }, [resetWebRTC, resetFileTransfer, startFreshSession, myDeviceName]);

  const isInRoomView = roomStatus !== 'idle';
  const isTransferActive = transfers.some((t) => t.status === 'transferring');

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const inRoom = isInRoomView || isDemoMode;
      document.documentElement.setAttribute('data-in-room', inRoom ? 'true' : 'false');
      document.body.setAttribute('data-in-room', inRoom ? 'true' : 'false');
      document.body.setAttribute('data-transfer-active', isTransferActive ? 'true' : 'false');
    }
  }, [isInRoomView, isTransferActive]);

  if (isDemoMode && DemoRoom) {
    return (
      <React.Suspense fallback={<div style={{ color: 'var(--color-text-secondary)', padding: '40px', textAlign: 'center' }}>Loading demo...</div>}>
        <DemoRoom />
      </React.Suspense>
    );
  }

  return (
    <div
      className={`app-container ${isInRoomView ? 'app-in-room' : ''}`}
      style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh', position: 'relative' }}
      data-transfer-active={isTransferActive}
      data-in-room={isInRoomView}
    >
      {/* Static Background Spotlight & Hairline Grid */}
      <div className="bg-canvas" aria-hidden="true">
        <div className="bg-spotlight" />
        <div className="bg-hairline-grid" />
      </div>

      {/* Navigation Bar */}
      <header className="nav-bar">
        <div className="nav-container">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              handleReset();
            }}
            className="nav-brand"
          >
            <Radio className="nav-logo-icon" size={20} strokeWidth={1.75} />
            <span>QuickDrop</span>
          </a>

          {!isInRoomView && (
            <nav className="nav-links">
              <a href="#how-it-works" className="nav-link">How it works</a>
              <a href="#privacy" className="nav-link">Privacy</a>
              <a href="#faq" className="nav-link">FAQ</a>
            </nav>
          )}

          <div className="nav-actions">
            {deferredInstallPrompt && (
              <button
                type="button"
                onClick={handleInstallApp}
                className="btn btn-secondary"
                style={{ height: '36px', minHeight: '36px', padding: '0 12px', fontSize: '0.8125rem' }}
              >
                <Download size={14} strokeWidth={1.75} />
                <span>Install</span>
              </button>
            )}

            <button
              type="button"
              onClick={toggleTheme}
              className="btn-icon"
              aria-label="Toggle light/dark theme"
            >
              {theme === 'dark' ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
            </button>

            {/* Small connection dot with tooltip */}
            <div
              className="status-indicator-dot"
              data-status={connectionStatus}
              data-tooltip={
                connectionStatus === 'connected'
                  ? 'Signaling active'
                  : connectionStatus === 'connecting'
                  ? 'Connecting...'
                  : 'Offline'
              }
              aria-label={`Connection status: ${connectionStatus}`}
            />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, width: '100%', position: 'relative', zIndex: 2 }}>
        <ErrorBoundary>
          {/* Banner only appears inside a room session, never scaring users on landing */}
          {isInRoomView && <ConnectionBanner status={connectionStatus} />}

          {/* Global Error Banner */}
          {errorMessage && roomStatus === 'idle' && (
            <div style={{ maxWidth: 'var(--max-width)', margin: '16px auto', padding: '0 24px' }}>
              <ErrorMessage message={errorMessage} code={errorCode} onDismiss={handleReset} />
            </div>
          )}

          {!isInRoomView ? (
            <Home
              onCreateRoom={(name, reqPin, pinCode) => {
                setMyDeviceName(name);
                handleStartFreshSession(name, reqPin, pinCode);
              }}
              onJoinRoom={(targetRoomId, targetToken, name, key, candidatePin) => {
                setMyDeviceName(name);
                joinRoom(targetRoomId, targetToken, name, key, candidatePin);
              }}
              isConnecting={connectionStatus === 'connecting'}
              errorMessage={errorMessage}
            />
          ) : (
            <Room
              roomId={roomId || ''}
              joinToken={joinToken}
              roomKey={roomKey}
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
              requirePin={requirePin}
              roomPin={roomPin}
              pendingJoinRequest={pendingJoinRequest}
              isJoinPending={isJoinPending}
              pinRequired={pinRequired}
              pinError={pinError}
              pinAttemptsRemaining={pinAttemptsRemaining}
              joinDenied={joinDenied}
              onApproveJoin={approveJoinRequest}
              onDenyJoin={denyJoinRequest}
              onCancelJoin={cancelJoinRequest}
              onSubmitPin={submitPin}
              onRetryJoin={retryJoin}
              onFilesSelected={queueFiles}
              onRetryTransfer={retryTransfer}
              onCancelTransfer={cancelTransfer}
              onClearCompleted={clearCompleted}
            />
          )}
        </ErrorBoundary>
      </main>

      {/* Modern Product Footer */}
      <footer className="footer">
        <div className="footer-container">
          <span>QuickDrop — Two devices, one link. Direct and relayed file sharing.</span>
          <span>Files are never stored on the server.</span>
        </div>
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
            className="btn btn-secondary btn-reload"
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

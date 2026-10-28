import React, { useState, useEffect } from 'react';
import { useSignaling } from './hooks/useSignaling.js';
import { useWebRTC } from './hooks/useWebRTC.js';
import { useFileTransfer } from './hooks/useFileTransfer.js';
import { Home } from './pages/Home.jsx';
import { Room } from './pages/Room.jsx';
import { ConnectionBanner } from './components/ConnectionBanner.jsx';
import { ErrorMessage } from './components/ErrorMessage.jsx';
import { parseInvitationFromUrl } from './utils/roomUtils.js';

export function App() {
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState(null);
  const {
    signalingClient,
    connectionStatus,
    roomStatus,
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
    closeRoom,
    reset,
    setMyDeviceName
  } = useSignaling();

  const {
    webrtcStatus,
    isP2PConnected,
    connectionType,
    connectionStats,
    peerConnection,
    p2pMessages,
    sendP2PText
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
    cancelTransfer,
    isWakeLockActive
  } = useFileTransfer({
    peerConnection
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

  const handleInstallApp = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choiceResult = await deferredInstallPrompt.userChoice;
    if (choiceResult && choiceResult.outcome === 'accepted') {
      setDeferredInstallPrompt(null);
    }
  };

  // Check URL on initial load for invitation link (#token=...)
  useEffect(() => {
    const { roomId: urlRoomId, joinToken: urlJoinToken } = parseInvitationFromUrl();
    if (urlRoomId && urlJoinToken) {
      // Auto-join from QR code scan or link click
      joinRoom(urlRoomId, urlJoinToken);
    }
  }, [joinRoom]);

  const handleReset = () => {
    reset();
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState(null, '', '/');
    }
  };

  const isInRoomView = roomStatus !== 'idle';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
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
            <span>⚡ QuickDrop</span>
            <span className="brand-badge">
              {isP2PConnected
                ? connectionType === 'relay'
                  ? 'WebRTC Relayed (TURN)'
                  : connectionType === 'lan'
                  ? 'WebRTC P2P (LAN)'
                  : 'WebRTC P2P Direct'
                : 'Signaling'}
            </span>
          </a>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {deferredInstallPrompt && (
              <button
                type="button"
                onClick={handleInstallApp}
                className="btn btn-secondary"
                style={{
                  minHeight: '28px',
                  padding: '3px 10px',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                📥 Install
              </button>
            )}
            <span
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: isP2PConnected
                    ? 'var(--color-success)'
                    : connectionStatus === 'connected'
                    ? 'var(--color-warning)'
                    : 'var(--color-danger)'
                }}
              />
              {isP2PConnected
                ? 'P2P Live'
                : connectionStatus === 'connected'
                ? 'Signaling Active'
                : connectionStatus === 'connecting'
                ? 'Connecting...'
                : 'Offline'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-content">
        <ConnectionBanner status={connectionStatus} />

        {/* Global Error Banner */}
        {errorMessage && roomStatus === 'idle' && (
          <ErrorMessage message={errorMessage} code={errorCode} onDismiss={handleReset} />
        )}

        {!isInRoomView ? (
          <Home
            onCreateRoom={(name) => {
              setMyDeviceName(name);
              createRoom(name);
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
            isOwner={isOwner}
            myDeviceName={myDeviceName}
            peerDeviceName={peerDeviceName}
            expiresAt={expiresAt}
            messages={p2pMessages}
            onSendMessage={sendP2PText}
            onCloseRoom={closeRoom}
            onReset={handleReset}
            errorMessage={errorMessage}
            isP2PConnected={isP2PConnected}
            webrtcStatus={webrtcStatus}
            connectionType={connectionType}
            connectionStats={connectionStats}
            transfers={transfers}
            isWakeLockActive={isWakeLockActive}
            onFilesSelected={queueFiles}
            onCancelTransfer={cancelTransfer}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>
          QuickDrop — Temporary Peer-to-Peer Sharing • Zero server file storage • Native WebRTC
        </p>
      </footer>
    </div>
  );
}

export default App;

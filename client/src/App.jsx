import React, { useEffect } from 'react';
import { useSignaling } from './hooks/useSignaling.js';
import { Home } from './pages/Home.jsx';
import { Room } from './pages/Room.jsx';
import { ConnectionBanner } from './components/ConnectionBanner.jsx';
import { ErrorMessage } from './components/ErrorMessage.jsx';
import { parseInvitationFromUrl } from './utils/roomUtils.js';

export function App() {
  const {
    connectionStatus,
    roomStatus,
    roomId,
    joinToken,
    peerId,
    isOwner,
    myDeviceName,
    peerDeviceName,
    expiresAt,
    messages,
    errorMessage,
    errorCode,
    createRoom,
    joinRoom,
    sendMessage,
    closeRoom,
    reset,
    setMyDeviceName
  } = useSignaling();

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
            <span className="brand-badge">P2P Sharing</span>
          </a>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                  backgroundColor:
                    connectionStatus === 'connected'
                      ? 'var(--color-success)'
                      : connectionStatus === 'connecting'
                      ? 'var(--color-warning)'
                      : 'var(--color-danger)'
                }}
              />
              {connectionStatus === 'connected'
                ? 'Signaling Live'
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
            messages={messages}
            onSendMessage={sendMessage}
            onCloseRoom={closeRoom}
            onReset={handleReset}
            errorMessage={errorMessage}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>
          QuickDrop — Temporary Peer-to-Peer Sharing • No permanent server storage • WebRTC Ready
        </p>
      </footer>
    </div>
  );
}

export default App;

import React, { useState, useEffect, useRef } from 'react';
import { debugLogger, isDebugEnabled, isRelayModeEnabled } from '../utils/debugLogger.js';

export function DebugLog({ peerConnection = null, signalingClient = null }) {
  const [logs, setLogs] = useState([]);
  const [isOpen, setIsOpen] = useState(true);
  const [filter, setFilter] = useState('ALL'); // 'ALL' | 'OUT' | 'IN' | 'STATE'
  const [copied, setCopied] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (!isDebugEnabled()) return;
    const unsubscribe = debugLogger.subscribe((updatedLogs) => {
      setLogs([...updatedLogs]);
    });
    return unsubscribe;
  }, []);

  if (!isDebugEnabled()) {
    return null;
  }

  const currentSnapshot = debugLogger.getSnapshot(peerConnection, signalingClient);
  const isRelay = isRelayModeEnabled();

  const filteredLogs = logs.filter((log) => {
    if (filter === 'ALL') return true;
    return log.direction === filter;
  });

  const handleCopyLogs = () => {
    const text = logs
      .map((l) => {
        const snap = l.snapshot
          ? `[CC:${l.snapshot.controlChannelState} FC:${l.snapshot.fileChannelState} PC:${l.snapshot.pcConnectionState} ICE:${l.snapshot.pcIceState} WS:${l.snapshot.wsReadyState}]`
          : '';
        const details = l.details ? ` ${JSON.stringify(l.details)}` : '';
        return `[${l.timestamp}] [${l.direction}] [${l.transport || 'SYS'}] ${l.type} ${snap}${details}`;
      })
      .reverse()
      .join('\n');

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <aside
      className="debug-overlay-panel"
      aria-label="Debug Diagnostic Panel"
      style={{
        position: 'fixed',
        bottom: 0,
        right: 0,
        width: isOpen ? 'min(560px, 100vw)' : 'auto',
        maxHeight: isOpen ? '50vh' : 'auto',
        background: 'rgba(10, 16, 12, 0.95)',
        borderTop: '1px solid rgba(228, 253, 151, 0.3)',
        borderLeft: '1px solid rgba(228, 253, 151, 0.3)',
        borderTopLeftRadius: '12px',
        zIndex: 99999,
        fontFamily: 'monospace, Consolas, sans-serif',
        fontSize: '11px',
        color: '#e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)'
      }}
    >
      {/* Top Bar / Status Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: 'rgba(20, 30, 22, 0.95)',
          borderTopLeftRadius: '12px',
          borderBottom: isOpen ? '1px solid rgba(255, 255, 255, 0.1)' : 'none',
          gap: '8px',
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: '#e4fd97', fontWeight: 'bold' }}>🐞 DEBUG LOG</span>
          {isRelay && (
            <span
              style={{
                background: '#dc2626',
                color: '#fff',
                padding: '1px 6px',
                borderRadius: '4px',
                fontSize: '10px',
                fontWeight: 'bold'
              }}
            >
              RELAY-ONLY (?relay=1)
            </span>
          )}
          <span style={{ color: '#94a3b8' }}>({logs.length})</span>
        </div>

        {/* Live snapshot telemetry */}
        <div style={{ display: 'flex', gap: '6px', fontSize: '10px' }}>
          <span title="PeerConnection connectionState">
            PC: <b style={{ color: currentSnapshot.pcConnectionState === 'connected' ? '#4ade80' : currentSnapshot.pcConnectionState === 'failed' ? '#ef4444' : '#facc15' }}>{currentSnapshot.pcConnectionState}</b>
          </span>
          <span title="ICE connectionState">
            ICE: <b style={{ color: currentSnapshot.pcIceState === 'connected' ? '#4ade80' : currentSnapshot.pcIceState === 'failed' ? '#ef4444' : '#facc15' }}>{currentSnapshot.pcIceState}</b>
          </span>
          <span title="Control DataChannel">
            CC: <b style={{ color: currentSnapshot.controlChannelState === 'open' ? '#4ade80' : '#94a3b8' }}>{currentSnapshot.controlChannelState}</b>
          </span>
          <span title="File DataChannel">
            FC: <b style={{ color: currentSnapshot.fileChannelState === 'open' ? '#4ade80' : '#94a3b8' }}>{currentSnapshot.fileChannelState}</b>
          </span>
          <span title="WebSocket readyState">
            WS: <b style={{ color: currentSnapshot.wsReadyState === 'OPEN' ? '#4ade80' : '#ef4444' }}>{currentSnapshot.wsReadyState}</b>
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {isOpen && (
            <>
              <button
                type="button"
                onClick={handleCopyLogs}
                style={{
                  background: copied ? '#4ade80' : 'rgba(255, 255, 255, 0.1)',
                  color: copied ? '#000' : '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  cursor: 'pointer',
                  fontSize: '10px'
                }}
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => debugLogger.clear()}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '2px 8px',
                  cursor: 'pointer',
                  fontSize: '10px'
                }}
              >
                Clear
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: '10px'
            }}
          >
            {isOpen ? '▼ Hide' : '▲ Show'}
          </button>
        </div>
      </div>

      {isOpen && (
        <>
          {/* Filter Bar */}
          <div
            style={{
              display: 'flex',
              gap: '4px',
              padding: '4px 10px',
              background: 'rgba(15, 23, 17, 0.7)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
            }}
          >
            {['ALL', 'OUT', 'IN', 'STATE'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                style={{
                  background: filter === f ? '#e4fd97' : 'transparent',
                  color: filter === f ? '#000' : '#94a3b8',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '1px 6px',
                  fontSize: '10px',
                  fontWeight: filter === f ? 'bold' : 'normal',
                  cursor: 'pointer'
                }}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Log Entries List */}
          <div
            ref={listRef}
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '6px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}
          >
            {filteredLogs.length === 0 ? (
              <div style={{ color: '#64748b', textAlign: 'center', padding: '12px' }}>
                No events recorded yet. Perform an action to see logs.
              </div>
            ) : (
              filteredLogs.map((log) => {
                const dirColor =
                  log.direction === 'OUT' ? '#38bdf8' : log.direction === 'IN' ? '#4ade80' : '#facc15';
                const transportColor = log.transport === 'webrtc-dc' ? '#a3e635' : log.transport === 'websocket' ? '#c084fc' : '#94a3b8';

                return (
                  <div
                    key={log.id}
                    style={{
                      borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                      paddingBottom: '3px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ color: '#64748b' }}>{log.timestamp}</span>
                      <span
                        style={{
                          background: `${dirColor}20`,
                          color: dirColor,
                          padding: '0 4px',
                          borderRadius: '2px',
                          fontWeight: 'bold',
                          fontSize: '9px'
                        }}
                      >
                        {log.direction}
                      </span>
                      {log.transport && (
                        <span
                          style={{
                            background: `${transportColor}20`,
                            color: transportColor,
                            padding: '0 4px',
                            borderRadius: '2px',
                            fontSize: '9px'
                          }}
                        >
                          {log.transport}
                        </span>
                      )}
                      <span style={{ fontWeight: 'bold', color: '#f1f5f9' }}>{log.type}</span>

                      {log.snapshot && (
                        <span style={{ color: '#64748b', fontSize: '9px', marginLeft: 'auto' }}>
                          CC:{log.snapshot.controlChannelState} PC:{log.snapshot.pcConnectionState} ICE:{log.snapshot.pcIceState} WS:{log.snapshot.wsReadyState}
                        </span>
                      )}
                    </div>

                    {log.details && (
                      <div
                        style={{
                          color: '#94a3b8',
                          fontSize: '10px',
                          paddingLeft: '12px',
                          wordBreak: 'break-all',
                          whiteSpace: 'pre-wrap',
                          maxHeight: '60px',
                          overflowY: 'auto'
                        }}
                      >
                        {typeof log.details === 'object' ? JSON.stringify(log.details) : String(log.details)}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </aside>
  );
}

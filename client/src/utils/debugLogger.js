/**
 * Diagnostic logger for QuickDrop.
 * Active when ?debug=1 is in the URL.
 * Also provides check for ?relay=1 (pure WebSocket relay mode, WebRTC disabled).
 */

const isBrowser = typeof window !== 'undefined';

function sanitizeLogDetails(details) {
  if (!details || typeof details !== 'object') return details;
  if (Array.isArray(details)) return details.map(sanitizeLogDetails);
  const clean = { ...details };
  for (const k of Object.keys(clean)) {
    const lk = k.toLowerCase();
    if (
      lk.includes('key') ||
      lk.includes('token') ||
      lk.includes('secret') ||
      lk === 'text' ||
      lk === 'meta'
    ) {
      clean[k] = '[REDACTED]';
    } else if (clean[k] && typeof clean[k] === 'object') {
      clean[k] = sanitizeLogDetails(clean[k]);
    }
  }
  return clean;
}

export const isDebugEnabled = () => {
  if (!isBrowser) return false;
  return new URLSearchParams(window.location.search).get('debug') === '1';
};

export const isRelayModeEnabled = () => {
  if (!isBrowser) return false;
  return new URLSearchParams(window.location.search).get('relay') === '1';
};

class DebugLogger {
  constructor() {
    this.logs = [];
    this.maxLogs = 300;
    this.subscribers = new Set();
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  notify() {
    for (const callback of this.subscribers) {
      try {
        callback(this.logs);
      } catch (err) {
        console.error('DebugLogger subscriber error:', err);
      }
    }
  }

  formatTimestamp() {
    const d = new Date();
    const time = d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${time}.${ms}`;
  }

  getSnapshot(pcManager, signalingClient) {
    const pc = pcManager?.pc;
    const controlChannel = pcManager?.controlChannel;
    const fileChannel = pcManager?.fileChannel;
    const ws = signalingClient?.ws;

    const wsStateMap = {
      0: 'CONNECTING',
      1: 'OPEN',
      2: 'CLOSING',
      3: 'CLOSED'
    };
    const wsState = ws ? (wsStateMap[ws.readyState] || String(ws.readyState)) : 'NONE';

    return {
      controlChannelState: controlChannel?.readyState || 'none',
      fileChannelState: fileChannel?.readyState || 'none',
      pcConnectionState: pc?.connectionState || (isRelayModeEnabled() ? 'disabled' : 'none'),
      pcIceState: pc?.iceConnectionState || (isRelayModeEnabled() ? 'disabled' : 'none'),
      wsReadyState: wsState,
      gatheredCandidateTypes: Array.from(pcManager?.gatheredCandidateTypes || []),
      selectedPairType: pcManager?.connectionStats?.selectedPairType || 'none',
      timeToConnectMs: pcManager?.timeToConnectMs ?? null
    };
  }

  addEntry(entry) {
    const sanitizedEntry = {
      ...entry,
      details: sanitizeLogDetails(entry.details)
    };
    this.logs.unshift(sanitizedEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    if (isDebugEnabled()) {
      const snap = sanitizedEntry.snapshot;
      const snapStr = snap 
        ? `[CC:${snap.controlChannelState} FC:${snap.fileChannelState} PC:${snap.pcConnectionState} ICE:${snap.pcIceState} WS:${snap.wsReadyState}]`
        : '';
      const color = sanitizedEntry.direction === 'OUT' ? '#38bdf8' : sanitizedEntry.direction === 'IN' ? '#4ade80' : '#facc15';
      console.log(
        `%c[${sanitizedEntry.timestamp}] [${sanitizedEntry.direction}] [${sanitizedEntry.transport || 'SYSTEM'}] ${sanitizedEntry.type} ${snapStr}`,
        `color: ${color}; font-weight: bold;`,
        sanitizedEntry.details || ''
      );
    }

    this.notify();
  }

  logOutgoing(type, transport, pcManager, signalingClient, details = null) {
    const snapshot = this.getSnapshot(pcManager, signalingClient);
    this.addEntry({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: this.formatTimestamp(),
      direction: 'OUT',
      type,
      transport, // 'webrtc-dc' | 'websocket'
      snapshot,
      details
    });
  }

  logIncoming(type, transport, pcManager, signalingClient, details = null) {
    const snapshot = this.getSnapshot(pcManager, signalingClient);
    this.addEntry({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: this.formatTimestamp(),
      direction: 'IN',
      type,
      transport, // 'webrtc-dc' | 'websocket'
      snapshot,
      details
    });
  }

  logStateChange(category, state, details = null, pcManager = null, signalingClient = null) {
    const snapshot = this.getSnapshot(pcManager, signalingClient);
    this.addEntry({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: this.formatTimestamp(),
      direction: 'STATE',
      type: `${category}:${state}`,
      transport: category === 'WS' ? 'websocket' : 'webrtc',
      snapshot,
      details
    });
  }

  clear() {
    this.logs = [];
    this.notify();
  }
}

export const debugLogger = new DebugLogger();

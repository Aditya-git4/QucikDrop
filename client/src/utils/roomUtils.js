/**
 * Detect a user-friendly default name for the current device.
 * @returns {string}
 */
export function getDeviceDefaultName() {
  if (typeof navigator === 'undefined') return 'Web Device';

  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) return 'Android Phone';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux PC';

  return 'Web Device';
}

/**
 * Parse roomId from the URL path and joinToken from the URL hash.
 * Cleanly removes the secret token from the address bar after reading.
 * @returns {{ roomId: string | null, joinToken: string | null }}
 */
export function parseInvitationFromUrl() {
  if (typeof window === 'undefined') {
    return { roomId: null, joinToken: null };
  }

  // Path format: /room/:roomId
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  let roomId = null;
  if (pathParts[0] === 'room' && pathParts[1]) {
    roomId = pathParts[1];
  }

  // Hash format: #token=JOIN_TOKEN
  let joinToken = null;
  const hash = window.location.hash.replace(/^#/, '');
  if (hash) {
    const params = new URLSearchParams(hash);
    joinToken = params.get('token');

    // Clean token from address bar to prevent leaking via screenshots or history,
    // while preserving query parameters like ?debug=1 or ?relay=1
    if (joinToken) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }

  return { roomId, joinToken };
}

/**
 * Build the full invitation URL for QR codes and link sharing.
 * Places the join token strictly in the URL fragment (#).
 * @param {string} roomId
 * @param {string} joinToken
 * @param {boolean} [includeDebug=false]
 * @returns {string}
 */
export function buildInvitationUrl(roomId, joinToken, includeDebug = false) {
  if (typeof window === 'undefined') return '';
  const origin = window.location.origin;
  const isDebug = includeDebug || (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1');
  const debugParam = isDebug ? '?debug=1' : '';
  return `${origin}/room/${encodeURIComponent(roomId)}${debugParam}#token=${encodeURIComponent(joinToken)}`;
}

/**
 * Determine the appropriate WebSocket signaling URL based on current origin.
 * Works seamlessly with Vite development proxy and production unified server.
 * @returns {string}
 */
export function getWebSocketUrl() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }

  if (typeof window === 'undefined') return 'ws://localhost:5000/ws';

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/**
 * Persist active room session to sessionStorage (key per roomId).
 * Never logs secrets.
 * @param {string} roomId
 * @param {{ roomId: string, peerId: string, peerSecret: string, isOwner?: boolean, deviceName?: string }} session
 */
export function saveRoomSession(roomId, session) {
  if (typeof window === 'undefined' || !window.sessionStorage || !roomId || !session) return;
  try {
    window.sessionStorage.setItem(`quickdrop_session_${roomId}`, JSON.stringify(session));
  } catch {
    // ignore
  }
}

/**
 * Retrieve stored room session from sessionStorage.
 * @param {string} roomId
 * @returns {{ roomId: string, peerId: string, peerSecret: string, isOwner?: boolean, deviceName?: string } | null}
 */
export function getRoomSession(roomId) {
  if (typeof window === 'undefined' || !window.sessionStorage || !roomId) return null;
  try {
    const raw = window.sessionStorage.getItem(`quickdrop_session_${roomId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Remove stored room session from sessionStorage.
 * If roomId is omitted, clears all quickdrop session keys.
 * @param {string} [roomId]
 */
export function clearRoomSession(roomId = null) {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    if (roomId) {
      window.sessionStorage.removeItem(`quickdrop_session_${roomId}`);
    } else {
      const keysToRemove = [];
      for (let i = 0; i < window.sessionStorage.length; i++) {
        const key = window.sessionStorage.key(i);
        if (key && key.startsWith('quickdrop_session_')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => window.sessionStorage.removeItem(k));
    }
  } catch {
    // ignore
  }
}

import { config } from '../config/config.js';

/**
 * Check if a hostname/IP is a local private network or loopback address.
 * Allows phones on the same Wi-Fi network to connect during development.
 * @param {string} host
 * @returns {boolean}
 */
function isLocalOrPrivateNetwork(host) {
  if (host === 'localhost' || host === '127.0.0.1') return true;

  // RFC 1918 private IPv4 ranges:
  // 10.0.0.0 - 10.255.255.255
  // 172.16.0.0 - 172.31.255.255
  // 192.168.0.0 - 192.168.255.255
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }

  return false;
}

/**
 * Validate an HTTP/WebSocket Origin header.
 * @param {string | undefined} origin
 * @param {boolean} isProduction
 * @param {string[]} allowedOrigins
 * @param {string | null} [requestHost=null]
 * @returns {boolean}
 */
export function isOriginAllowed(
  origin,
  isProduction = config.isProduction,
  allowedOrigins = config.allowedOrigins,
  requestHost = null
) {
  // If no origin header is provided (e.g. non-browser client or same-origin in some environments):
  if (!origin) {
    return !isProduction; // In production, require Origin header for WebSocket connection
  }

  // Exact match against allowed origins
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  // Same-origin match against the Host header of this deployed service
  if (requestHost) {
    if (origin === `https://${requestHost}` || origin === `http://${requestHost}`) {
      return true;
    }
  }

  // In development, also permit local LAN origins (e.g. phone on same Wi-Fi)
  if (!isProduction) {
    try {
      const url = new URL(origin);
      if (isLocalOrPrivateNetwork(url.hostname)) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

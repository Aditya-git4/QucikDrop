import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Default public STUN servers for NAT discovery across multiple carriers and regions.
 */
export const DEFAULT_STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
  'stun:stun.services.mozilla.com:3478',
  'stun:stun.cloudflare.com:3478'
];

/**
 * Parse comma-separated URL string into trimmed array.
 * @param {string | undefined} urlString
 * @returns {string[]}
 */
export function parseUrls(urlString) {
  if (!urlString || typeof urlString !== 'string') return [];
  return urlString
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Generate ephemeral TURN credentials using RFC 5766 / Coturn REST API (HMAC-SHA1).
 * The root secret is never sent to the client; only the calculated HMAC-SHA1 digest is returned.
 *
 * @param {string} secret Shared secret key
 * @param {string} peerId Unique peer or room identifier
 * @param {number} [ttlSeconds=86400] Lifespan of credentials in seconds
 * @returns {{ username: string, credential: string }}
 */
export function generateEphemeralCredentials(secret, peerId = 'peer', ttlSeconds = 86400) {
  const expiryTimestamp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiryTimestamp}:${peerId}`;
  const credential = crypto
    .createHmac('sha1', secret)
    .update(username)
    .digest('base64');

  return { username, credential };
}

/**
 * Get configured WebRTC ICE servers (STUN + optional TURN) for an authenticated peer.
 *
 * Priority order for TURN:
 * 1. RFC 5766 Ephemeral TURN if TURN_SECRET and TURN_URLS are set.
 * 2. Static TURN credentials if TURN_USERNAME, TURN_CREDENTIAL, and TURN_URLS are set.
 * 3. Default STUN servers only if no TURN is configured.
 *
 * @param {string} [peerId='peer'] Peer ID used to salt ephemeral TURN usernames
 * @param {object} [customConfig] Optional override for testing
 * @returns {Array<{ urls: string | string[], username?: string, credential?: string }>}
 */
export function getIceServers(peerId = 'peer', customConfig = null) {
  const envConfig = customConfig || {
    stunUrls: process.env.STUN_URLS,
    turnUrls: process.env.TURN_URLS,
    turnSecret: process.env.TURN_SECRET,
    turnUsername: process.env.TURN_USERNAME,
    turnCredential: process.env.TURN_CREDENTIAL || process.env.TURN_PASSWORD,
    turnTtlSeconds: process.env.TURN_TTL_SECONDS ? parseInt(process.env.TURN_TTL_SECONDS, 10) : 86400
  };

  const iceServers = [];

  // 1. STUN Servers
  const stunList = parseUrls(envConfig.stunUrls);
  if (stunList.length > 0) {
    iceServers.push({ urls: stunList });
  } else {
    iceServers.push({ urls: DEFAULT_STUN_SERVERS });
  }

  // 2. TURN Servers
  const turnList = parseUrls(envConfig.turnUrls);
  if (turnList.length > 0) {
    if (envConfig.turnSecret) {
      // Ephemeral HMAC-SHA1 credentials (Coturn / RFC 5766)
      const { username, credential } = generateEphemeralCredentials(
        envConfig.turnSecret,
        peerId,
        envConfig.turnTtlSeconds
      );
      iceServers.push({
        urls: turnList,
        username,
        credential
      });
    } else if (envConfig.turnUsername && envConfig.turnCredential) {
      // Static TURN credentials
      iceServers.push({
        urls: turnList,
        username: envConfig.turnUsername,
        credential: envConfig.turnCredential
      });
    }
  }

  return iceServers;
}

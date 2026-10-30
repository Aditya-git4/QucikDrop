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
 * Cloudflare Realtime TURN Credentials Manager.
 * Fetches short-lived TURN credentials from Cloudflare's API, caches them for ~45 minutes,
 * refreshes in the background, applies exponential backoff on errors, and safely falls back
 * to STUN-only to ensure room creation is never blocked.
 */
export class CloudflareTurnManager {
  /**
   * @param {object} [options]
   * @param {string} [options.keyId]
   * @param {string} [options.apiToken]
   * @param {Function} [options.fetchFn]
   * @param {number} [options.ttlSeconds]
   * @param {number} [options.cacheDurationMs]
   * @param {number} [options.timeoutMs]
   */
  constructor(options = {}) {
    this.keyId = options.keyId ?? config.turnKeyId;
    this.apiToken = options.apiToken ?? config.turnApiToken;
    this.fetchFn = options.fetchFn || globalThis.fetch;
    this.ttlSeconds = options.ttlSeconds || 3600; // 1 hour request TTL
    this.cacheDurationMs = options.cacheDurationMs || (45 * 60 * 1000); // 45 minutes cache
    this.timeoutMs = options.timeoutMs || 5000; // 5 s timeout

    /** @type {Array<object> | null} */
    this.cachedIceServers = null;
    this.cacheExpiry = 0;
    this.credentialsHardExpiry = 0;
    this.refreshTimer = null;
    this.backoffMs = 5000;
    this.warned = false;
    this.isFetching = false;
    this.activeFetchPromise = null;

    /** @type {'configured' | 'not_configured' | 'degraded'} */
    this.status = (!this.keyId || !this.apiToken) ? 'not_configured' : 'configured';

    if (!this.keyId || !this.apiToken) {
      this.logStartupWarning();
    }
  }

  logStartupWarning() {
    if (!this.warned) {
      this.warned = true;
      console.warn('[TURN] Cloudflare Realtime TURN is not configured (missing TURN_KEY_ID or TURN_API_TOKEN). WebRTC will use STUN-only.');
    }
  }

  getHealthStatus() {
    if (!this.keyId || !this.apiToken) {
      return 'not_configured';
    }
    return this.status;
  }

  async fetchCredentials() {
    if (!this.keyId || !this.apiToken) {
      this.status = 'not_configured';
      return null;
    }

    if (this.activeFetchPromise) {
      return this.activeFetchPromise;
    }

    this.activeFetchPromise = (async () => {
      const endpoint = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(this.keyId)}/credentials/generate-ice-servers`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        this.isFetching = true;
        const res = await this.fetchFn(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ ttl: this.ttlSeconds }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          throw new Error(`Cloudflare API returned status ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        if (!data || !Array.isArray(data.iceServers)) {
          throw new Error('Cloudflare API response missing iceServers array');
        }

        // Format and merge iceServers: keep all Cloudflare TURN URL variants (including TCP/TLS)
        const cfStunUrls = [];
        const turnServers = [];

        for (const item of data.iceServers) {
          if (!item) continue;
          if (item.username && item.credential) {
            turnServers.push({
              urls: item.urls,
              username: item.username,
              credential: item.credential
            });
          } else if (item.urls) {
            const urls = Array.isArray(item.urls) ? item.urls : [item.urls];
            cfStunUrls.push(...urls);
          }
        }

        const mergedStun = Array.from(new Set([...DEFAULT_STUN_SERVERS, ...cfStunUrls]));
        const formatted = [
          { urls: mergedStun },
          ...turnServers
        ];

        this.cachedIceServers = formatted;
        this.cacheExpiry = Date.now() + this.cacheDurationMs;
        this.credentialsHardExpiry = Date.now() + (this.ttlSeconds * 1000);
        this.status = 'configured';
        this.backoffMs = 5000; // Reset backoff on success

        // Schedule background refresh
        this.scheduleRefresh(this.cacheDurationMs);

        return formatted;
      } catch (err) {
        clearTimeout(timeoutId);
        this.status = 'degraded';
        // NEVER log API tokens or credentials!
        console.warn(`[TURN] Cloudflare TURN credentials fetch failed: ${err.message || 'Error'}. Retrying in ${this.backoffMs / 1000}s.`);
        this.scheduleRefresh(this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, 60000); // Exponential backoff up to 60s
        return null;
      } finally {
        this.isFetching = false;
        this.activeFetchPromise = null;
      }
    })();

    return this.activeFetchPromise;
  }

  scheduleRefresh(delayMs) {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.fetchCredentials().catch(() => {});
    }, delayMs);
    if (this.refreshTimer?.unref) {
      this.refreshTimer.unref();
    }
  }

  stop() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

/**
 * Default global Cloudflare TURN manager instance.
 */
export const defaultTurnManager = new CloudflareTurnManager();

/**
 * Get TURN health status for /health endpoint.
 * @returns {'configured' | 'not_configured' | 'degraded'}
 */
export function getTurnHealthStatus() {
  return defaultTurnManager.getHealthStatus();
}

/**
 * Process legacy customConfig (for backward compatibility and unit tests).
 */
function handleLegacyCustomConfig(peerId, customConfig) {
  const iceServers = [];

  // STUN Servers
  const stunList = parseUrls(customConfig.stunUrls);
  if (stunList.length > 0) {
    iceServers.push({ urls: stunList });
  } else {
    iceServers.push({ urls: DEFAULT_STUN_SERVERS });
  }

  // TURN Servers
  const turnList = parseUrls(customConfig.turnUrls);
  if (turnList.length > 0) {
    if (customConfig.turnSecret) {
      const { username, credential } = generateEphemeralCredentials(
        customConfig.turnSecret,
        peerId,
        customConfig.turnTtlSeconds || 86400
      );
      iceServers.push({
        urls: turnList,
        username,
        credential
      });
    } else if (customConfig.turnUsername && customConfig.turnCredential) {
      iceServers.push({
        urls: turnList,
        username: customConfig.turnUsername,
        credential: customConfig.turnCredential
      });
    }
  }

  return iceServers;
}

/**
 * Get configured WebRTC ICE servers (STUN + optional TURN).
 * Synchronous accessor for backwards-compatibility with existing tests and callers.
 *
 * @param {string} [peerId='peer'] Peer ID
 * @param {object} [customConfig] Optional override for testing
 * @returns {Array<{ urls: string | string[], username?: string, credential?: string }>}
 */
export function getIceServers(peerId = 'peer', customConfig = null) {
  if (customConfig) {
    return handleLegacyCustomConfig(peerId, customConfig);
  }

  // If Cloudflare TURN credentials are cached and valid, return them
  if (defaultTurnManager.cachedIceServers && Date.now() < defaultTurnManager.credentialsHardExpiry) {
    // If past soft cache expiry, trigger background refresh
    if (Date.now() >= defaultTurnManager.cacheExpiry && !defaultTurnManager.isFetching) {
      defaultTurnManager.fetchCredentials().catch(() => {});
    }
    return defaultTurnManager.cachedIceServers;
  }

  // If TURN is configured but not cached yet, trigger background fetch
  if (defaultTurnManager.keyId && defaultTurnManager.apiToken && !defaultTurnManager.isFetching) {
    defaultTurnManager.fetchCredentials().catch(() => {});
  }

  // Fallback to STUN servers immediately
  return [{ urls: DEFAULT_STUN_SERVERS }];
}

/**
 * Asynchronously get ICE servers, fetching from Cloudflare if needed.
 * Never blocks room creation beyond the 5s timeout, and always falls back to STUN on error.
 *
 * @param {string} [peerId='peer']
 * @param {object} [customConfig]
 * @returns {Promise<Array<{ urls: string | string[], username?: string, credential?: string }>>}
 */
export async function getIceServersAsync(peerId = 'peer', customConfig = null) {
  if (customConfig) {
    return handleLegacyCustomConfig(peerId, customConfig);
  }

  // If cached and valid, return immediately
  if (defaultTurnManager.cachedIceServers && Date.now() < defaultTurnManager.credentialsHardExpiry) {
    if (Date.now() >= defaultTurnManager.cacheExpiry && !defaultTurnManager.isFetching) {
      defaultTurnManager.fetchCredentials().catch(() => {});
    }
    return defaultTurnManager.cachedIceServers;
  }

  // If configured, fetch fresh credentials
  if (defaultTurnManager.keyId && defaultTurnManager.apiToken) {
    try {
      const servers = await defaultTurnManager.fetchCredentials();
      if (servers && Array.isArray(servers)) {
        return servers;
      }
    } catch {
      // Fall through to STUN-only
    }
  }

  return [{ urls: DEFAULT_STUN_SERVERS }];
}

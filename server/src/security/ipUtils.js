/**
 * IP utility functions for secure client IP extraction behind trusted reverse proxies (e.g. Render).
 *
 * Rules:
 * 1. Trust exactly ONE proxy hop.
 * 2. In a single-hop setup, Render appends the remote client IP as the LAST entry in X-Forwarded-For.
 *    Any earlier entries can be spoofed by the client, so taking parts[parts.length - 1] is safe.
 * 3. Strip IPv6-mapped IPv4 prefixes (::ffff:).
 * 4. Fall back to socket remoteAddress when header is absent.
 * 5. Provide maskIp for safe diagnostic logging without leaking full PII.
 */

/**
 * Normalise IPv4 and IPv6 strings:
 * - Trims whitespace
 * - Strips ::ffff: prefix from IPv6-mapped IPv4 addresses (e.g. ::ffff:203.0.113.195 -> 203.0.113.195)
 *
 * @param {string | undefined | null} ip
 * @returns {string}
 */
export function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') {
    return '127.0.0.1';
  }
  let cleaned = ip.trim();
  if (cleaned.startsWith('::ffff:')) {
    cleaned = cleaned.slice(7);
  }
  return cleaned || '127.0.0.1';
}

/**
 * Extract client IP trusting exactly ONE proxy hop.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
export function getClientIp(req) {
  if (!req) return '127.0.0.1';

  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff && typeof xff === 'string') {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      // With trust proxy = 1, the trusted reverse proxy appends the client IP as the last entry.
      // Earlier entries may be spoofed by untrusted clients.
      const trustedProxyAddedIp = parts[parts.length - 1];
      return normalizeIp(trustedProxyAddedIp);
    }
  }

  // Fall back to socket address when X-Forwarded-For is absent
  return normalizeIp(req.socket?.remoteAddress);
}

/**
 * Mask the last octet (IPv4) or last segment (IPv6) of an IP for safe telemetry logging.
 * Example: 203.0.113.195 -> 203.0.113.xxx
 * Example: 2001:db8:85a3::8a2e:370:7334 -> 2001:db8:85a3::8a2e:370:xxxx
 *
 * @param {string} ip
 * @returns {string}
 */
export function maskIp(ip) {
  const norm = normalizeIp(ip);
  if (norm.includes('.')) {
    // IPv4: mask last octet
    const parts = norm.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
    }
    return norm.replace(/\.\d+$/, '.xxx');
  }
  if (norm.includes(':')) {
    // IPv6: mask last colon segment
    const parts = norm.split(':');
    if (parts.length > 1) {
      parts[parts.length - 1] = 'xxxx';
      return parts.join(':');
    }
  }
  return 'xxx.xxx.xxx.xxx';
}

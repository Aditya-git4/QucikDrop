import crypto from 'node:crypto';

/**
 * Generate a cryptographically secure random room ID.
 * Returns a 32-character hexadecimal string.
 * @returns {string}
 */
export function generateRoomId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generate a cryptographically secure random join token.
 * Returns a 48-character hexadecimal string.
 * @returns {string}
 */
export function generateJoinToken() {
  return crypto.randomBytes(24).toString('hex');
}

/**
 * Generate a cryptographically secure random peer ID.
 * Returns a 24-character hexadecimal string.
 * @returns {string}
 */
export function generatePeerId() {
  return crypto.randomBytes(12).toString('hex');
}

/**
 * Compute the SHA-256 hash of a raw token.
 * @param {string} token
 * @returns {string}
 */
export function hashToken(token) {
  if (typeof token !== 'string' || !token) {
    throw new TypeError('Token must be a non-empty string');
  }
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison between a candidate raw token and the stored SHA-256 hash.
 * @param {string} rawToken
 * @param {string} storedHash
 * @returns {boolean}
 */
export function verifyToken(rawToken, storedHash) {
  if (typeof rawToken !== 'string' || typeof storedHash !== 'string') {
    return false;
  }
  if (!rawToken || !storedHash) {
    return false;
  }

  try {
    const candidateHash = hashToken(rawToken);
    const bufA = Buffer.from(candidateHash, 'hex');
    const bufB = Buffer.from(storedHash, 'hex');

    if (bufA.length !== bufB.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Sanitize and validate client device name.
 * Limits length to 40 characters and strips control characters.
 * @param {unknown} name
 * @returns {string}
 */
export function sanitizeDeviceName(name) {
  if (typeof name !== 'string') {
    return 'Unknown Device';
  }
  // Strip control characters and excessive whitespace
  const sanitized = name.replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (!sanitized) {
    return 'Unknown Device';
  }
  return sanitized.slice(0, 40);
}

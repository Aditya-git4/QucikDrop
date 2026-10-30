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

/**
 * Generate a random 4-digit PIN string (e.g. '4821').
 * @returns {string}
 */
export function generatePin() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Generate a cryptographically secure 16-byte random salt for PIN hashing.
 * @returns {string} Hex-encoded salt
 */
export function generatePinSalt() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Compute salted hash of a 4-digit PIN using async PBKDF2 with SHA-256 (100,000 iterations).
 * Uses non-blocking async crypto.pbkdf2 so the Node.js event loop is never blocked.
 * Constant-time timingSafeEqual is preserved in verifyPin.
 *
 * @param {string} pin
 * @param {string} salt
 * @returns {Promise<string>} Hex-encoded hash
 */
export async function hashPin(pin, salt) {
  if (typeof pin !== 'string' || typeof salt !== 'string') {
    throw new TypeError('PIN and salt must be strings');
  }
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(pin, salt, 100000, 32, 'sha256', (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString('hex'));
    });
  });
}

/**
 * Constant-time comparison between candidate PIN and stored salted PIN hash.
 * @param {string} candidatePin
 * @param {string} storedSalt
 * @param {string} storedHash
 * @returns {Promise<boolean>}
 */
export async function verifyPin(candidatePin, storedSalt, storedHash) {
  if (typeof candidatePin !== 'string' || typeof storedSalt !== 'string' || typeof storedHash !== 'string') {
    return false;
  }
  const cleanPin = candidatePin.trim();
  if (!/^\d{4}$/.test(cleanPin)) {
    return false;
  }

  try {
    const candidateHash = await hashPin(cleanPin, storedSalt);
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
 * Extract a concise, sanitized device and browser summary from User-Agent string.
 * Limits length to 50 characters, never exposes full raw UA or control characters.
 * @param {unknown} ua
 * @returns {string}
 */
export function sanitizeUserAgent(ua) {
  if (typeof ua !== 'string' || !ua.trim()) {
    return 'Web Browser';
  }

  const s = ua.trim();
  let deviceOrOS = '';
  if (/Pixel \d+/i.test(s)) {
    const match = s.match(/Pixel \d+/i);
    deviceOrOS = match ? match[0] : 'Pixel';
  } else if (/iPhone/i.test(s)) {
    deviceOrOS = 'iPhone';
  } else if (/iPad/i.test(s)) {
    deviceOrOS = 'iPad';
  } else if (/Android/i.test(s)) {
    deviceOrOS = 'Android';
  } else if (/Macintosh|Mac OS X/i.test(s)) {
    deviceOrOS = 'macOS';
  } else if (/Windows NT/i.test(s)) {
    deviceOrOS = 'Windows';
  } else if (/Linux/i.test(s)) {
    deviceOrOS = 'Linux';
  }

  let browser = '';
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/Chrome\//i.test(s)) browser = 'Chrome';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/Safari\//i.test(s) && !/Chrome\//i.test(s)) browser = 'Safari';

  let summary = '';
  if (deviceOrOS && browser) {
    summary = `${browser} on ${deviceOrOS}`;
  } else if (deviceOrOS) {
    summary = deviceOrOS;
  } else if (browser) {
    summary = browser;
  } else {
    summary = 'Web Browser';
  }

  return summary.replace(/[\x00-\x1F\x7F]/g, '').slice(0, 50);
}

/**
 * Room cleanup utility functions.
 */

/**
 * Check if a room has expired based on current time.
 * @param {{ expiresAt: number, maxExpiresAt: number }} room
 * @param {number} [now=Date.now()]
 * @returns {boolean}
 */
export function isRoomExpired(room, now = Date.now()) {
  return now > room.expiresAt || now > room.maxExpiresAt;
}

/**
 * Format remaining time in milliseconds to human-readable string.
 * @param {number} ms
 * @returns {string}
 */
export function formatRemainingTime(ms) {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

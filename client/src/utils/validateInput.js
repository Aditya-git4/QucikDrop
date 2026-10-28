/**
 * Validate and clean a device name.
 * @param {string} name
 * @returns {string}
 */
export function validateDeviceName(name) {
  if (typeof name !== 'string') return 'My Device';
  const trimmed = name.trim();
  if (!trimmed) return 'My Device';
  return trimmed.slice(0, 40);
}

/**
 * Validate a room ID format.
 * @param {string} roomId
 * @returns {boolean}
 */
export function isValidRoomId(roomId) {
  if (typeof roomId !== 'string') return false;
  return /^[0-9a-f]{32}$/i.test(roomId);
}

/**
 * Validate a join token format.
 * @param {string} token
 * @returns {boolean}
 */
export function isValidJoinToken(token) {
  if (typeof token !== 'string') return false;
  return /^[0-9a-f]{48}$/i.test(token);
}

/**
 * Validate a chat text message.
 * @param {string} text
 * @param {number} [maxLength=4096]
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMessageText(text, maxLength = 4096) {
  if (typeof text !== 'string' || !text.trim()) {
    return { valid: false, error: 'Message cannot be empty' };
  }
  if (text.length > maxLength) {
    return { valid: false, error: `Message exceeds maximum length of ${maxLength} characters` };
  }
  return { valid: true };
}

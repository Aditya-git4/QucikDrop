import { config } from '../config/config.js';

export const ErrorCodes = {
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  INVALID_VERSION: 'INVALID_VERSION',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  INVALID_ROOM: 'INVALID_ROOM',
  INVALID_TOKEN: 'INVALID_TOKEN',
  ROOM_EXPIRED: 'ROOM_EXPIRED',
  ROOM_FULL: 'ROOM_FULL',
  TOKEN_USED: 'TOKEN_USED',
  NOT_AUTHORIZED: 'NOT_AUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  ROOM_CAPACITY_EXCEEDED: 'ROOM_CAPACITY_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

/**
 * Validate incoming raw message payload and parse JSON.
 * @param {import('ws').RawData} rawData
 * @param {boolean} isBinary
 * @returns {{ error?: { code: string, message: string }, data?: any }}
 */
export function parseAndValidateRawMessage(rawData, isBinary) {
  if (isBinary) {
    return {
      error: {
        code: ErrorCodes.INVALID_PAYLOAD,
        message: 'Binary messages are not permitted on the signaling server'
      }
    };
  }

  const length = typeof rawData === 'string' ? Buffer.byteLength(rawData) : rawData.length;
  if (length > config.maxWsMessageBytes) {
    return {
      error: {
        code: ErrorCodes.INVALID_PAYLOAD,
        message: `Message exceeds maximum allowed size of ${config.maxWsMessageBytes} bytes`
      }
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(rawData.toString('utf8'));
  } catch {
    return {
      error: {
        code: ErrorCodes.INVALID_MESSAGE,
        message: 'Malformed JSON payload'
      }
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      error: {
        code: ErrorCodes.INVALID_MESSAGE,
        message: 'Message must be a JSON object'
      }
    };
  }

  if (parsed.version !== 1) {
    return {
      error: {
        code: ErrorCodes.INVALID_VERSION,
        message: 'Protocol version must be 1'
      }
    };
  }

  if (typeof parsed.type !== 'string' || !parsed.type) {
    return {
      error: {
        code: ErrorCodes.INVALID_MESSAGE,
        message: 'Message type must be a non-empty string'
      }
    };
  }

  return { data: parsed };
}

/**
 * Validate create room message schema.
 * @param {any} msg
 * @returns {string | null} error message if invalid, null if valid
 */
export function validateCreateRoom(msg) {
  if (msg.deviceName !== undefined && typeof msg.deviceName !== 'string') {
    return 'deviceName must be a string';
  }
  return null;
}

/**
 * Validate join room message schema.
 * @param {any} msg
 * @returns {string | null}
 */
export function validateJoinRoom(msg) {
  if (typeof msg.roomId !== 'string' || !msg.roomId || msg.roomId.length > 64) {
    return 'roomId must be a non-empty string (max 64 chars)';
  }
  if (typeof msg.joinToken !== 'string' || !msg.joinToken || msg.joinToken.length > 128) {
    return 'joinToken must be a non-empty string (max 128 chars)';
  }
  if (msg.deviceName !== undefined && typeof msg.deviceName !== 'string') {
    return 'deviceName must be a string';
  }
  return null;
}

/**
 * Validate text message schema.
 * @param {any} msg
 * @returns {string | null}
 */
export function validateTextMessage(msg) {
  if (typeof msg.text !== 'string' || !msg.text) {
    return 'text must be a non-empty string';
  }
  if (msg.text.length > config.maxTextLength) {
    return `text exceeds maximum length of ${config.maxTextLength} characters`;
  }
  if (msg.clientMessageId !== undefined && typeof msg.clientMessageId !== 'string') {
    return 'clientMessageId must be a string';
  }
  return null;
}

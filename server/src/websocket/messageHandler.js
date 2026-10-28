import { config } from '../config/config.js';
import { defaultRateLimiter } from '../security/rateLimiter.js';
import {
  ErrorCodes,
  parseAndValidateRawMessage,
  validateCreateRoom,
  validateJoinRoom,
  validateTextMessage
} from './messageSchemas.js';

/**
 * Safely send JSON message over WebSocket if open.
 * @param {import('ws').WebSocket} ws
 * @param {object} message
 */
export function sendJson(ws, message) {
  if (ws && ws.readyState === 1 /* OPEN */) {
    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      // Sockets can close unexpectedly; handle gracefully
    }
  }
}

/**
 * Send an error response to a WebSocket client.
 * @param {import('ws').WebSocket} ws
 * @param {string} code
 * @param {string} message
 */
export function sendError(ws, code, message) {
  sendJson(ws, {
    type: 'room:error',
    version: 1,
    code,
    message
  });
}

/**
 * Main dispatcher for incoming WebSocket messages.
 * @param {import('../rooms/roomManager.js').RoomManager} roomManager
 * @param {import('ws').WebSocket} ws
 * @param {import('ws').RawData} rawData
 * @param {boolean} isBinary
 * @param {string} clientIp
 */
export function handleIncomingMessage(roomManager, ws, rawData, isBinary, clientIp) {
  const { error, data } = parseAndValidateRawMessage(rawData, isBinary);
  if (error) {
    return sendError(ws, error.code, error.message);
  }

  const { type } = data;

  // Handle application-level ping
  if (type === 'ping') {
    return sendJson(ws, { type: 'pong', version: 1 });
  }

  // 1. CREATE ROOM
  if (type === 'room:create' || (type === 'room' && !data.roomId)) {
    if (!defaultRateLimiter.isAllowed(clientIp, 'room_create', config.rateLimitMaxRoomCreates, config.rateLimitWindowMs)) {
      return sendError(ws, ErrorCodes.RATE_LIMITED, 'Room creation rate limit exceeded. Please wait a moment.');
    }

    const schemaError = validateCreateRoom(data);
    if (schemaError) {
      return sendError(ws, ErrorCodes.INVALID_MESSAGE, schemaError);
    }

    try {
      const { roomId, rawJoinToken, ownerPeerId, expiresAt } = roomManager.createRoom(ws, data.deviceName);

      // Respond to creator with token (never logged)
      sendJson(ws, {
        type: 'room:created',
        version: 1,
        roomId,
        peerId: ownerPeerId,
        joinToken: rawJoinToken,
        expiresAt
      });
    } catch (err) {
      const code = err.code || ErrorCodes.INTERNAL_ERROR;
      sendError(ws, code, err.message);
    }
    return;
  }

  // 2. JOIN ROOM
  if (type === 'room:join' || (type === 'room' && data.roomId)) {
    if (!defaultRateLimiter.isAllowed(clientIp, 'room_join', config.rateLimitMaxJoins, config.rateLimitWindowMs)) {
      return sendError(ws, ErrorCodes.RATE_LIMITED, 'Room join rate limit exceeded. Please wait a moment.');
    }

    const schemaError = validateJoinRoom(data);
    if (schemaError) {
      return sendError(ws, ErrorCodes.INVALID_MESSAGE, schemaError);
    }

    try {
      const { joinerPeerId, ownerPeerId, ownerDeviceName } = roomManager.joinRoom(
        data.roomId,
        data.joinToken,
        ws,
        data.deviceName
      );

      const room = roomManager.getRoom(data.roomId);
      const joinerMember = room ? room.members.get(joinerPeerId) : null;
      const joinerDeviceName = joinerMember ? joinerMember.deviceName : 'Guest';

      // Respond to the joining peer
      sendJson(ws, {
        type: 'room:joined',
        version: 1,
        roomId: data.roomId,
        peerId: joinerPeerId,
        peerCount: 2,
        ownerPeerId,
        ownerDeviceName
      });

      // Notify the room creator (owner)
      const owner = room ? room.members.get(ownerPeerId) : null;
      if (owner && owner.ws) {
        sendJson(owner.ws, {
          type: 'peer:joined',
          version: 1,
          peerId: joinerPeerId,
          deviceName: joinerDeviceName
        });
      }
    } catch (err) {
      const code = err.code || ErrorCodes.INTERNAL_ERROR;
      sendError(ws, code, err.message);
    }
    return;
  }

  // Check socket binding for authenticated room actions
  const binding = roomManager.getSocketBinding(ws);
  if (!binding) {
    return sendError(ws, ErrorCodes.NOT_AUTHORIZED, 'You must create or join a room before sending this message');
  }

  const { roomId, peerId } = binding;
  const room = roomManager.getRoom(roomId);
  if (!room) {
    return sendError(ws, ErrorCodes.INVALID_ROOM, 'Room is no longer active');
  }

  // 3. TEXT MESSAGE
  if (type === 'text') {
    if (!defaultRateLimiter.isAllowed(peerId, 'text_message', config.rateLimitMaxMessages, config.rateLimitWindowMs)) {
      return sendError(ws, ErrorCodes.RATE_LIMITED, 'Message rate limit exceeded. Please slow down.');
    }

    const schemaError = validateTextMessage(data);
    if (schemaError) {
      return sendError(ws, ErrorCodes.INVALID_MESSAGE, schemaError);
    }

    const senderMember = room.members.get(peerId);
    if (!senderMember) {
      return sendError(ws, ErrorCodes.NOT_AUTHORIZED, 'Sender is not an active member of this room');
    }

    const otherPeer = roomManager.getOtherPeer(roomId, peerId);
    if (!otherPeer || !otherPeer.ws) {
      return sendError(ws, ErrorCodes.INVALID_MESSAGE, 'No peer connected to receive text');
    }

    const now = Date.now();
    const clientMessageId = data.clientMessageId || `${now}-${Math.random().toString(36).slice(2, 9)}`;

    const relayPayload = {
      type: 'text',
      version: 1,
      clientMessageId,
      senderPeerId: peerId,
      deviceName: senderMember.deviceName,
      text: data.text,
      sentAt: now
    };

    // Forward to the recipient peer
    sendJson(otherPeer.ws, relayPayload);

    // Send confirmation ack to sender
    sendJson(ws, {
      type: 'text:ack',
      version: 1,
      clientMessageId,
      sentAt: now
    });
    return;
  }

  // 4. CLOSE ROOM
  if (type === 'room:close') {
    try {
      const memberPeerIds = roomManager.closeRoom(roomId, peerId, 'closed_by_owner');

      // Notify all former members
      for (const [id, member] of room.members.entries()) {
        sendJson(member.ws, {
          type: 'room:closed',
          version: 1,
          reason: 'closed_by_owner'
        });
        try {
          member.ws.close(1000, 'Room closed by owner');
        } catch {
          // ignore
        }
      }
    } catch (err) {
      const code = err.code || ErrorCodes.INTERNAL_ERROR;
      sendError(ws, code, err.message);
    }
    return;
  }

  // 5. UNKNOWN TYPE
  sendError(ws, ErrorCodes.UNKNOWN_TYPE, `Unsupported message type: ${type}`);
}

import { config } from '../config/config.js';
import { getIceServers } from '../config/iceServers.js';
import { defaultRateLimiter } from '../security/rateLimiter.js';
import {
  ErrorCodes,
  parseAndValidateRawMessage,
  validateCreateRoom,
  validateJoinRoom,
  validateRejoinRoom,
  validateTextMessage,
  validateRtcMessage
} from './messageSchemas.js';

/**
 * Log one line per received message on the server for telemetry and diagnostics.
 * Format: [WS-MSG] roomId=... role=... type=... isBinary=... size=... outcome=... reason="..."
 * @param {{
 *   roomId?: string,
 *   role?: string,
 *   type?: string,
 *   isBinary: boolean,
 *   size: number,
 *   outcome: 'relayed' | 'handled' | 'rate-limited' | 'rejected',
 *   reason: string
 * }} entry
 */
export function logServerMessage({ roomId, role, type, isBinary, size, outcome, reason }) {
  const ts = new Date().toISOString();
  console.log(
    `[WS-MSG ${ts}] roomId=${roomId || 'none'} role=${role || 'unbound'} type=${type || 'unknown'} isBinary=${Boolean(isBinary)} size=${size || 0}B outcome=${outcome} reason="${reason || ''}"`
  );
}

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

const peerUnavailableRateLimit = new WeakMap();

/**
 * Send PEER_UNAVAILABLE error rate-limited to at most once per second per socket.
 * @param {import('ws').WebSocket} ws
 * @param {string} message
 */
export function sendPeerUnavailable(ws, message) {
  const now = Date.now();
  const lastSent = peerUnavailableRateLimit.get(ws) || 0;
  if (now - lastSent >= 1000) {
    peerUnavailableRateLimit.set(ws, now);
    sendError(ws, ErrorCodes.PEER_UNAVAILABLE, message);
  }
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
  // 0. High-performance binary file chunk streaming relay between room peers (zero disk storage)
  if (isBinary) {
    const chunkLength = Buffer.isBuffer(rawData) ? rawData.length : rawData.byteLength || 0;
    const binding = roomManager.getSocketBinding(ws);
    if (!binding) {
      logServerMessage({
        roomId: 'none',
        role: 'unbound',
        type: 'binary:chunk',
        isBinary: true,
        size: chunkLength,
        outcome: 'rejected',
        reason: 'socket_not_bound_to_any_room'
      });
      return;
    }

    const { roomId, peerId } = binding;
    const room = roomManager.getRoom(roomId);
    const member = room?.members.get(peerId);
    const role = member?.role || 'unknown';

    if (!room || room.status !== 'connected') {
      logServerMessage({
        roomId,
        role,
        type: 'binary:chunk',
        isBinary: true,
        size: chunkLength,
        outcome: 'rejected',
        reason: 'room_not_connected'
      });
      return;
    }

    if (chunkLength > config.maxWsBinaryBytes) {
      logServerMessage({
        roomId,
        role,
        type: 'binary:chunk',
        isBinary: true,
        size: chunkLength,
        outcome: 'rejected',
        reason: `chunk_exceeds_${config.maxWsBinaryBytes}_limit`
      });
      return;
    }

    const otherPeer = roomManager.getOtherPeer(roomId, peerId);
    if (otherPeer && otherPeer.ws && otherPeer.ws.readyState === 1 /* OPEN */) {
      try {
        otherPeer.ws.send(rawData, { binary: true });
        roomManager.touchActivity(roomId, true);
        logServerMessage({
          roomId,
          role,
          type: 'binary:chunk',
          isBinary: true,
          size: chunkLength,
          outcome: 'relayed',
          reason: `forwarded_to_${otherPeer.role}`
        });
      } catch (err) {
        logServerMessage({
          roomId,
          role,
          type: 'binary:chunk',
          isBinary: true,
          size: chunkLength,
          outcome: 'rejected',
          reason: `socket_send_error: ${err.message}`
        });
      }
    } else {
      logServerMessage({
        roomId,
        role,
        type: 'binary:chunk',
        isBinary: true,
        size: chunkLength,
        outcome: 'rejected',
        reason: 'remote_peer_socket_not_open'
      });
      sendPeerUnavailable(ws, 'Peer unavailable: remote peer socket is closed or reconnecting');
    }
    return;
  }

  const msgSize = Buffer.isBuffer(rawData)
    ? rawData.length
    : Buffer.byteLength(typeof rawData === 'string' ? rawData : rawData.toString());

  const initialBinding = roomManager.getSocketBinding(ws);
  let curRoomId = initialBinding?.roomId || 'none';
  let curPeerId = initialBinding?.peerId;
  let curRole = curRoomId !== 'none' ? roomManager.getRoom(curRoomId)?.members.get(curPeerId)?.role || 'unknown' : 'unbound';

  const { error, data } = parseAndValidateRawMessage(rawData, isBinary);
  if (error) {
    logServerMessage({
      roomId: curRoomId,
      role: curRole,
      type: 'malformed_json',
      isBinary: false,
      size: msgSize,
      outcome: 'rejected',
      reason: error.message
    });
    return sendError(ws, error.code, error.message);
  }

  const { type } = data;

  // Handle application-level ping
  if (type === 'ping') {
    logServerMessage({
      roomId: curRoomId,
      role: curRole,
      type: 'ping',
      isBinary: false,
      size: msgSize,
      outcome: 'handled',
      reason: 'heartbeat_pong_sent'
    });
    return sendJson(ws, { type: 'pong', version: 1 });
  }

  // 1. CREATE ROOM
  if (type === 'room:create' || (type === 'room' && !data.roomId)) {
    if (!defaultRateLimiter.isAllowed(clientIp, 'room_create', config.rateLimitMaxRoomCreates, config.rateLimitWindowMs)) {
      logServerMessage({
        roomId: 'none',
        role: 'unbound',
        type: 'room:create',
        isBinary: false,
        size: msgSize,
        outcome: 'rate-limited',
        reason: 'room_create_rate_limit_exceeded'
      });
      return sendError(ws, ErrorCodes.RATE_LIMITED, 'Room creation rate limit exceeded. Please wait a moment.');
    }

    const schemaError = validateCreateRoom(data);
    if (schemaError) {
      logServerMessage({
        roomId: 'none',
        role: 'unbound',
        type: 'room:create',
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: schemaError
      });
      return sendError(ws, ErrorCodes.INVALID_MESSAGE, schemaError);
    }

    try {
      const { roomId, rawJoinToken, ownerPeerId, ownerPeerSecret, expiresAt } = roomManager.createRoom(ws, data.deviceName);
      const iceServers = getIceServers(ownerPeerId);

      logServerMessage({
        roomId,
        role: 'owner',
        type: 'room:create',
        isBinary: false,
        size: msgSize,
        outcome: 'handled',
        reason: 'room_created_successfully'
      });

      sendJson(ws, {
        type: 'room:created',
        version: 1,
        roomId,
        peerId: ownerPeerId,
        peerSecret: ownerPeerSecret,
        joinToken: rawJoinToken,
        expiresAt,
        iceServers
      });
    } catch (err) {
      logServerMessage({
        roomId: 'none',
        role: 'unbound',
        type: 'room:create',
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: err.message
      });
      const code = err.code || ErrorCodes.INTERNAL_ERROR;
      sendError(ws, code, err.message);
    }
    return;
  }

  // 2. JOIN ROOM
  if (type === 'room:join' || (type === 'room' && data.roomId)) {
    if (!defaultRateLimiter.isAllowed(clientIp, 'room_join', config.rateLimitMaxJoins, config.rateLimitWindowMs)) {
      logServerMessage({
        roomId: data.roomId || 'none',
        role: 'unbound',
        type: 'room:join',
        isBinary: false,
        size: msgSize,
        outcome: 'rate-limited',
        reason: 'room_join_rate_limit_exceeded'
      });
      return sendError(ws, ErrorCodes.RATE_LIMITED, 'Room join rate limit exceeded. Please wait a moment.');
    }

    const schemaError = validateJoinRoom(data);
    if (schemaError) {
      logServerMessage({
        roomId: data.roomId || 'none',
        role: 'unbound',
        type: 'room:join',
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: schemaError
      });
      return sendError(ws, ErrorCodes.INVALID_MESSAGE, schemaError);
    }

    try {
      const { joinerPeerId, joinerPeerSecret, ownerPeerId, ownerDeviceName } = roomManager.joinRoom(
        data.roomId,
        data.joinToken,
        ws,
        data.deviceName
      );

      const room = roomManager.getRoom(data.roomId);
      const joinerMember = room ? room.members.get(joinerPeerId) : null;
      const joinerDeviceName = joinerMember ? joinerMember.deviceName : 'Guest';
      const iceServers = getIceServers(joinerPeerId);

      logServerMessage({
        roomId: data.roomId,
        role: 'joiner',
        type: 'room:join',
        isBinary: false,
        size: msgSize,
        outcome: 'handled',
        reason: 'joined_room_successfully'
      });

      sendJson(ws, {
        type: 'room:joined',
        version: 1,
        roomId: data.roomId,
        peerId: joinerPeerId,
        peerSecret: joinerPeerSecret,
        peerCount: 2,
        ownerPeerId,
        ownerDeviceName,
        iceServers
      });

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
      logServerMessage({
        roomId: data.roomId || 'none',
        role: 'unbound',
        type: 'room:join',
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: `${err.code || 'JOIN_FAILED'}: ${err.message}`
      });
      const code = err.code || ErrorCodes.INTERNAL_ERROR;
      sendError(ws, code, err.message);
    }
    return;
  }

  // 2b. REJOIN ROOM
  if (type === 'room:rejoin') {
    if (!defaultRateLimiter.isAllowed(clientIp, 'room_join', config.rateLimitMaxJoins, config.rateLimitWindowMs)) {
      logServerMessage({
        roomId: data.roomId || 'none',
        role: 'unbound',
        type: 'room:rejoin',
        isBinary: false,
        size: msgSize,
        outcome: 'rate-limited',
        reason: 'rejoin_rate_limit_exceeded'
      });
      return sendError(ws, ErrorCodes.RATE_LIMITED, 'Room rejoin rate limit exceeded. Please wait a moment.');
    }

    const schemaError = validateRejoinRoom(data);
    if (schemaError) {
      logServerMessage({
        roomId: data.roomId || 'none',
        role: 'unbound',
        type: 'room:rejoin',
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: schemaError
      });
      return sendError(ws, ErrorCodes.INVALID_REJOIN, 'Failed to rejoin room');
    }

    try {
      const { room, peerId, member, otherPeer } = roomManager.rejoinRoom(
        data.roomId,
        data.peerId,
        data.peerSecret,
        ws,
        data.deviceName
      );

      const iceServers = getIceServers(peerId);

      logServerMessage({
        roomId: room.roomId,
        role: member.role,
        type: 'room:rejoin',
        isBinary: false,
        size: msgSize,
        outcome: 'handled',
        reason: 'rejoined_room_successfully'
      });

      sendJson(ws, {
        type: 'room:rejoined',
        version: 1,
        roomId: room.roomId,
        peerId,
        peerCount: room.members.size,
        peerDeviceName: otherPeer ? otherPeer.deviceName : 'Remote Peer',
        iceServers,
        status: room.status
      });

      if (otherPeer && otherPeer.ws && otherPeer.ws.readyState === 1 /* OPEN */) {
        sendJson(otherPeer.ws, {
          type: 'peer:reconnected',
          version: 1,
          peerId,
          deviceName: member.deviceName
        });
      }
    } catch {
      logServerMessage({
        roomId: data.roomId || 'none',
        role: 'unbound',
        type: 'room:rejoin',
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: 'invalid_rejoin_attempt'
      });
      sendError(ws, ErrorCodes.INVALID_REJOIN, 'Failed to rejoin room');
    }
    return;
  }

  // Check socket binding for authenticated room actions
  const binding = roomManager.getSocketBinding(ws);
  if (!binding) {
    logServerMessage({
      roomId: 'none',
      role: 'unbound',
      type,
      isBinary: false,
      size: msgSize,
      outcome: 'rejected',
      reason: 'not_authorized_must_create_or_join_room_first'
    });
    return sendError(ws, ErrorCodes.NOT_AUTHORIZED, 'You must create or join a room before sending this message');
  }

  const { roomId, peerId } = binding;
  const room = roomManager.getRoom(roomId);
  if (!room) {
    logServerMessage({
      roomId,
      role: curRole,
      type,
      isBinary: false,
      size: msgSize,
      outcome: 'rejected',
      reason: 'room_no_longer_active'
    });
    return sendError(ws, ErrorCodes.INVALID_ROOM, 'Room is no longer active');
  }

  const senderMember = room.members.get(peerId);
  const senderRole = senderMember?.role || 'unknown';

  // 3. TEXT MESSAGE
  if (type === 'text') {
    if (!defaultRateLimiter.isAllowed(peerId, 'text_message', config.rateLimitMaxMessages, config.rateLimitWindowMs)) {
      logServerMessage({
        roomId,
        role: senderRole,
        type: 'text',
        isBinary: false,
        size: msgSize,
        outcome: 'rate-limited',
        reason: 'text_rate_limit_exceeded'
      });
      return sendError(ws, ErrorCodes.RATE_LIMITED, 'Message rate limit exceeded. Please slow down.');
    }

    const schemaError = validateTextMessage(data);
    if (schemaError) {
      logServerMessage({
        roomId,
        role: senderRole,
        type: 'text',
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: schemaError
      });
      return sendError(ws, ErrorCodes.INVALID_MESSAGE, schemaError);
    }

    if (!senderMember) {
      logServerMessage({
        roomId,
        role: senderRole,
        type: 'text',
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: 'sender_not_active_member'
      });
      return sendError(ws, ErrorCodes.NOT_AUTHORIZED, 'Sender is not an active member of this room');
    }

    const otherPeer = roomManager.getOtherPeer(roomId, peerId);
    if (!otherPeer || !otherPeer.ws) {
      logServerMessage({
        roomId,
        role: senderRole,
        type: 'text',
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: 'no_peer_connected_to_receive'
      });
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

    sendJson(otherPeer.ws, relayPayload);
    roomManager.touchActivity(roomId);

    logServerMessage({
      roomId,
      role: senderRole,
      type: 'text',
      isBinary: false,
      size: msgSize,
      outcome: 'relayed',
      reason: `relayed_to_${otherPeer.role}`
    });

    sendJson(ws, {
      type: 'text:ack',
      version: 1,
      clientMessageId,
      sentAt: now
    });
    return;
  }

  // 4. WEBRTC SIGNALING (offer, answer, ice-candidate)
  if (type === 'rtc:offer' || type === 'rtc:answer' || type === 'rtc:ice-candidate') {
    if (!defaultRateLimiter.isAllowed(peerId, 'rtc_signaling', config.rateLimitMaxRtc, config.rateLimitWindowMs)) {
      logServerMessage({
        roomId,
        role: senderRole,
        type,
        isBinary: false,
        size: msgSize,
        outcome: 'rate-limited',
        reason: 'rtc_rate_limit_exceeded'
      });
      return sendError(ws, ErrorCodes.RATE_LIMITED, 'WebRTC signaling rate limit exceeded.');
    }

    const schemaError = validateRtcMessage(data, type);
    if (schemaError) {
      logServerMessage({
        roomId,
        role: senderRole,
        type,
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: schemaError
      });
      return sendError(ws, ErrorCodes.INVALID_MESSAGE, schemaError);
    }

    if (room.status !== 'connected') {
      logServerMessage({
        roomId,
        role: senderRole,
        type,
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: 'room_not_connected'
      });
      return sendError(ws, ErrorCodes.INVALID_ROOM, 'Cannot exchange WebRTC signals until both peers have joined');
    }

    const otherPeer = roomManager.getOtherPeer(roomId, peerId);
    if (!otherPeer || !otherPeer.ws) {
      logServerMessage({
        roomId,
        role: senderRole,
        type,
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: 'no_remote_peer_to_receive_signal'
      });
      return sendError(ws, ErrorCodes.INVALID_MESSAGE, 'No remote peer connected to receive WebRTC signals');
    }

    if (data.targetPeerId && data.targetPeerId !== otherPeer.peerId) {
      logServerMessage({
        roomId,
        role: senderRole,
        type,
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: 'target_peer_mismatch'
      });
      return sendError(ws, ErrorCodes.NOT_AUTHORIZED, 'Target peer is not in this room');
    }

    roomManager.touchActivity(roomId);

    sendJson(otherPeer.ws, {
      type,
      version: 1,
      senderPeerId: peerId,
      payload: data.payload
    });

    logServerMessage({
      roomId,
      role: senderRole,
      type,
      isBinary: false,
      size: msgSize,
      outcome: 'relayed',
      reason: `relayed_to_${otherPeer.role}`
    });
    return;
  }

  // 4b. FILE TRANSFER PROTOCOL RELAY (file:start, file:ready, file:complete, file:cancel)
  if (type === 'file:start' || type === 'file:ready' || type === 'file:complete' || type === 'file:cancel') {
    if (room.status !== 'connected') {
      logServerMessage({
        roomId,
        role: senderRole,
        type,
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: 'room_not_connected'
      });
      return sendError(ws, ErrorCodes.INVALID_ROOM, 'Cannot exchange file messages until both peers have joined');
    }

    const otherPeer = roomManager.getOtherPeer(roomId, peerId);
    if (!otherPeer || !otherPeer.ws || otherPeer.ws.readyState !== 1) {
      logServerMessage({
        roomId,
        role: senderRole,
        type,
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: 'remote_peer_not_connected'
      });
      return sendPeerUnavailable(ws, 'Peer unavailable: remote peer socket is closed or reconnecting');
    }

    roomManager.touchActivity(roomId);
    sendJson(otherPeer.ws, {
      ...data,
      senderPeerId: peerId
    });

    logServerMessage({
      roomId,
      role: senderRole,
      type,
      isBinary: false,
      size: msgSize,
      outcome: 'relayed',
      reason: `relayed_to_${otherPeer.role}`
    });
    return;
  }

  // 5. CLOSE OR LEAVE ROOM (Clean exit by owner or guest)
  if (type === 'room:close' || type === 'room:leave') {
    try {
      const isOwner = room.ownerPeerId === peerId;
      const closeReason = isOwner ? 'closed_by_owner' : 'guest_left';

      logServerMessage({
        roomId,
        role: senderRole,
        type,
        isBinary: false,
        size: msgSize,
        outcome: 'handled',
        reason: closeReason
      });

      // Destroy room immediately without grace period and notify remaining peers
      roomManager.destroyRoom(room, 'closed', closeReason);
    } catch (err) {
      logServerMessage({
        roomId,
        role: senderRole,
        type,
        isBinary: false,
        size: msgSize,
        outcome: 'rejected',
        reason: err.message
      });
      const code = err.code || ErrorCodes.INTERNAL_ERROR;
      sendError(ws, code, err.message);
    }
    return;
  }

  // 6. UNKNOWN TYPE
  logServerMessage({
    roomId: curRoomId,
    role: curRole,
    type,
    isBinary: false,
    size: msgSize,
    outcome: 'rejected',
    reason: `unsupported_message_type: ${type}`
  });
  sendError(ws, ErrorCodes.UNKNOWN_TYPE, `Unsupported message type: ${type}`);
}

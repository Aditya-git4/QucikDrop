import crypto from 'node:crypto';
import { config } from '../config/config.js';
import { defaultRelayLimiter } from '../websocket/relayLimiter.js';
import {
  generateRoomId,
  generateJoinToken,
  generatePeerId,
  hashToken,
  verifyToken,
  sanitizeDeviceName,
  generatePin,
  generatePinSalt,
  hashPin,
  verifyPin,
  sanitizeUserAgent
} from '../security/tokenUtils.js';

/**
 * @typedef {'waiting' | 'connected' | 'closed' | 'expired'} RoomStatus
 * @typedef {'owner' | 'joiner'} PeerRole
 * 
 * @typedef {Object} RoomMember
 * @property {string} peerId
 * @property {string} deviceName
 * @property {import('ws').WebSocket | null} ws
 * @property {PeerRole} role
 * @property {number} joinedAt
 * @property {string} hashedPeerSecret
 * @property {number | null} disconnectedAt
 * @property {NodeJS.Timeout | null} graceTimer
 * 
 * @typedef {Object} Room
 * @property {string} roomId
 * @property {RoomStatus} status
 * @property {number} createdAt
 * @property {number} lastActivityAt
 * @property {number} expiresAt
 * @property {number} maxExpiresAt
 * @property {string} ownerPeerId
 * @property {string} joinTokenHash
 * @property {boolean} joinTokenUsed
 * @property {boolean} requirePin
 * @property {string | null} pinSalt
 * @property {string | null} pinHash
 * @property {number} failedPinAttempts
 * @property {number} failedJoinAttempts
 * @property {boolean} autoApprove
 * @property {any | null} pendingJoin
 * @property {Map<string, RoomMember>} members
 * @property {number} roomGeneration
 * @property {NodeJS.Timeout | null} cleanupTimer
 * @property {number} [lastThrottledTouch]
 */

export class RoomManager {
  constructor(options = {}) {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    /** @type {WeakMap<import('ws').WebSocket, { roomId: string, peerId: string }>} */
    this.socketToPeer = new WeakMap();

    this.roomTtlMs = options.roomTtlMs ?? config.roomTtlMs;
    this.maxRoomLifetimeMs = options.maxRoomLifetimeMs ?? config.maxRoomLifetimeMs;
    this.roomReconnectGraceMs = options.roomReconnectGraceMs ?? config.roomReconnectGraceMs;
    this.maxRooms = options.maxRooms ?? config.maxRooms;
    this.requireJoinApproval = options.requireJoinApproval ?? config.requireJoinApproval;
    this.generationCounter = 0;
  }

  /**
   * Bind WebSocket to a room and peer ID.
   * @param {import('ws').WebSocket} ws
   * @param {string} roomId
   * @param {string} peerId
   */
  bindSocket(ws, roomId, peerId) {
    this.socketToPeer.set(ws, { roomId, peerId });
  }

  /**
   * Unbind WebSocket.
   * @param {import('ws').WebSocket} ws
   */
  unbindSocket(ws) {
    this.socketToPeer.delete(ws);
  }

  /**
   * Get room and peer info for a given WebSocket connection.
   * @param {import('ws').WebSocket} ws
   * @returns {{ roomId: string, peerId: string } | undefined}
   */
  getSocketBinding(ws) {
    return this.socketToPeer.get(ws);
  }

  /**
   * Create a new room with the calling WebSocket as owner.
   * @param {import('ws').WebSocket} ownerWs
   * @param {string} rawDeviceName
   * @param {{ requirePin?: boolean, pin?: string }} [options={}]
   * @returns {Promise<{ roomId: string, rawJoinToken: string, ownerPeerId: string, expiresAt: number, requirePin: boolean, pin: string | null }>}
   */
  async createRoom(ownerWs, rawDeviceName, options = {}) {
    if (this.rooms.size >= this.maxRooms) {
      const err = new Error('Server room capacity reached. Please try again later.');
      err.code = 'ROOM_CAPACITY_EXCEEDED';
      throw err;
    }

    const roomId = generateRoomId();
    const rawJoinToken = generateJoinToken();
    const joinTokenHash = hashToken(rawJoinToken);
    const ownerPeerId = generatePeerId();
    const ownerPeerSecret = crypto.randomBytes(32).toString('hex');
    const hashedPeerSecret = hashToken(ownerPeerSecret);
    const deviceName = sanitizeDeviceName(rawDeviceName);

    const now = Date.now();
    const expiresAt = now + this.roomTtlMs;
    const maxExpiresAt = now + this.maxRoomLifetimeMs;
    const roomGeneration = ++this.generationCounter;

    const requirePin = Boolean(options.requirePin || options.pin);
    let pin = null;
    let pinSalt = null;
    let pinHash = null;
    if (requirePin) {
      pin = options.pin && /^\d{4}$/.test(options.pin.trim()) ? options.pin.trim() : generatePin();
      pinSalt = generatePinSalt();
      pinHash = await hashPin(pin, pinSalt);
    }

    /** @type {Room} */
    const room = {
      roomId,
      status: 'waiting',
      createdAt: now,
      lastActivityAt: now,
      expiresAt,
      maxExpiresAt,
      ownerPeerId,
      joinTokenHash,
      joinTokenUsed: false,
      requirePin,
      pinSalt,
      pinHash,
      failedPinAttempts: 0,
      failedJoinAttempts: 0,
      autoApprove: Boolean(options.autoApprove),
      pendingJoin: null,
      members: new Map(),
      roomGeneration,
      cleanupTimer: null
    };

    // Add owner member
    room.members.set(ownerPeerId, {
      peerId: ownerPeerId,
      deviceName,
      ws: ownerWs,
      role: 'owner',
      joinedAt: now,
      hashedPeerSecret,
      disconnectedAt: null,
      graceTimer: null
    });

    this.bindSocket(ownerWs, roomId, ownerPeerId);
    this.rooms.set(roomId, room);

    // Schedule cleanup timer
    this.scheduleExpiration(room);

    return {
      roomId,
      rawJoinToken,
      ownerPeerId,
      ownerPeerSecret,
      expiresAt,
      requirePin,
      pin
    };
  }

  /**
   * Join an existing room using an invitation token.
   * If auto-approve is false, places join in pending status and requests host approval.
   * @param {string} roomId
   * @param {string} rawJoinToken
   * @param {import('ws').WebSocket} joinerWs
   * @param {string} rawDeviceName
   * @param {{ pin?: string, userAgent?: string, clientIp?: string }} [options={}]
   * @returns {Promise<{ status: 'admitted' | 'pending', joinerPeerId?: string, joinerPeerSecret?: string, ownerPeerId: string, ownerDeviceName?: string, joinerDeviceName?: string, requestId?: string, deviceName?: string, userAgent?: string }>}
   */
  async joinRoom(roomId, rawJoinToken, joinerWs, rawDeviceName, options = {}) {
    const room = this.rooms.get(roomId);
    if (!room) {
      const err = new Error('Room not found or no longer active');
      err.code = 'INVALID_ROOM';
      throw err;
    }

    const now = Date.now();
    if (now > room.expiresAt || room.status === 'expired') {
      this.expireRoom(roomId, room.roomGeneration);
      const err = new Error('Room invitation has expired');
      err.code = 'ROOM_EXPIRED';
      throw err;
    }

    if (room.status === 'closed') {
      const err = new Error('Room is closed');
      err.code = 'ROOM_CLOSED';
      throw err;
    }

    if (room.members.size >= 2 || room.status === 'connected') {
      const err = new Error('Room already has the maximum of two devices');
      err.code = 'ROOM_FULL';
      throw err;
    }

    if (room.joinTokenUsed) {
      const err = new Error('This invitation token has already been used');
      err.code = 'TOKEN_USED';
      throw err;
    }

    // 1. PIN verification (if room has PIN configured)
    if (room.requirePin) {
      if (!options.pin) {
        const err = new Error('This room requires a 4-digit PIN');
        err.code = 'PIN_REQUIRED';
        throw err;
      }

      const isPinValid = await verifyPin(options.pin, room.pinSalt, room.pinHash);
      if (!isPinValid) {
        room.failedPinAttempts = (room.failedPinAttempts || 0) + 1;
        if (room.failedPinAttempts >= 5) {
          this.destroyRoom(room, 'closed', 'too_many_attempts');
          const err = new Error('Too many incorrect PIN attempts. Room closed for security.');
          err.code = 'TOO_MANY_ATTEMPTS';
          err.isRoomClosed = true;
          throw err;
        }

        const err = new Error('Incorrect PIN');
        err.code = 'INVALID_PIN';
        err.attemptsRemaining = 5 - room.failedPinAttempts;
        throw err;
      }
    }

    // 2. Token verification
    const isTokenValid = verifyToken(rawJoinToken, room.joinTokenHash);
    if (!isTokenValid) {
      room.failedJoinAttempts = (room.failedJoinAttempts || 0) + 1;
      if (room.failedJoinAttempts >= 3) {
        this.destroyRoom(room, 'closed', 'too_many_attempts');
        const err = new Error('Too many invalid attempts. Room closed for security.');
        err.code = 'TOO_MANY_ATTEMPTS';
        err.isRoomClosed = true;
        throw err;
      }

      const err = new Error('Invalid room invitation token');
      err.code = 'INVALID_TOKEN';
      err.attemptsRemaining = 3 - room.failedJoinAttempts;
      throw err;
    }

    // 3. Approval Check
    if (room.autoApprove) {
      // Auto-approve enabled: admit joiner immediately
      room.joinTokenUsed = true;
      const joinerPeerId = generatePeerId();
      const joinerPeerSecret = crypto.randomBytes(32).toString('hex');
      const hashedPeerSecret = hashToken(joinerPeerSecret);
      const deviceName = sanitizeDeviceName(rawDeviceName);

      room.members.set(joinerPeerId, {
        peerId: joinerPeerId,
        deviceName,
        ws: joinerWs,
        role: 'joiner',
        joinedAt: now,
        hashedPeerSecret,
        disconnectedAt: null,
        graceTimer: null
      });

      room.status = 'connected';
      room.lastActivityAt = now;
      this.bindSocket(joinerWs, roomId, joinerPeerId);

      const owner = room.members.get(room.ownerPeerId);
      return {
        status: 'admitted',
        joinerPeerId,
        joinerPeerSecret,
        ownerPeerId: room.ownerPeerId,
        ownerDeviceName: owner ? owner.deviceName : 'Host',
        joinerDeviceName: deviceName
      };
    }

    // Require host approval: place in pendingJoin state
    if (room.pendingJoin) {
      if (room.pendingJoin.timer) {
        clearTimeout(room.pendingJoin.timer);
      }
      if (room.pendingJoin.ws && room.pendingJoin.ws !== joinerWs && room.pendingJoin.ws.readyState === 1 /* OPEN */) {
        try {
          room.pendingJoin.ws.send(JSON.stringify({
            type: 'room:error',
            version: 1,
            code: 'JOIN_DENIED',
            message: 'A newer join request replaced your session'
          }));
        } catch {}
      }
    }

    const requestId = crypto.randomBytes(16).toString('hex');
    const sanitizedDevice = sanitizeDeviceName(rawDeviceName);
    const uaSummary = sanitizeUserAgent(options.userAgent);

    const timer = setTimeout(() => {
      this.handleJoinTimeout(roomId, requestId);
    }, 60000);
    if (timer.unref) {
      timer.unref();
    }

    room.pendingJoin = {
      requestId,
      ws: joinerWs,
      rawDeviceName,
      sanitizedDeviceName: sanitizedDevice,
      userAgentSummary: uaSummary,
      clientIp: options.clientIp,
      timer,
      rawJoinToken
    };

    return {
      status: 'pending',
      requestId,
      deviceName: sanitizedDevice,
      userAgent: uaSummary,
      ownerPeerId: room.ownerPeerId
    };
  }

  /**
   * Host approves a pending join request.
   * @param {string} roomId
   * @param {string} ownerPeerId
   * @param {string} requestId
   * @param {boolean} [autoApprove=false]
   * @returns {{ joinerWs: import('ws').WebSocket, joinerPeerId: string, joinerPeerSecret: string, ownerPeerId: string, ownerDeviceName: string, joinerDeviceName: string }}
   */
  approveJoin(roomId, ownerPeerId, requestId, autoApprove = false) {
    const room = this.rooms.get(roomId);
    if (!room) {
      const err = new Error('Room not found');
      err.code = 'INVALID_ROOM';
      throw err;
    }

    if (room.ownerPeerId !== ownerPeerId) {
      const err = new Error('Only the room owner can approve join requests');
      err.code = 'NOT_AUTHORIZED';
      throw err;
    }

    if (!room.pendingJoin || room.pendingJoin.requestId !== requestId) {
      const err = new Error('Join request not found or expired');
      err.code = 'INVALID_REQUEST';
      throw err;
    }

    if (autoApprove) {
      room.autoApprove = true;
    }

    const pending = room.pendingJoin;
    clearTimeout(pending.timer);
    room.pendingJoin = null;

    room.joinTokenUsed = true;
    const now = Date.now();
    const joinerPeerId = generatePeerId();
    const joinerPeerSecret = crypto.randomBytes(32).toString('hex');
    const hashedPeerSecret = hashToken(joinerPeerSecret);

    room.members.set(joinerPeerId, {
      peerId: joinerPeerId,
      deviceName: pending.sanitizedDeviceName,
      ws: pending.ws,
      role: 'joiner',
      joinedAt: now,
      hashedPeerSecret,
      disconnectedAt: null,
      graceTimer: null
    });

    room.status = 'connected';
    room.lastActivityAt = now;
    this.bindSocket(pending.ws, roomId, joinerPeerId);

    const owner = room.members.get(room.ownerPeerId);

    return {
      status: 'admitted',
      joinerWs: pending.ws,
      joinerPeerId,
      joinerPeerSecret,
      ownerPeerId: room.ownerPeerId,
      ownerDeviceName: owner ? owner.deviceName : 'Host',
      joinerDeviceName: pending.sanitizedDeviceName
    };
  }

  /**
   * Host denies a pending join request.
   * @param {string} roomId
   * @param {string} ownerPeerId
   * @param {string} requestId
   * @returns {{ joinerWs: import('ws').WebSocket, isRoomClosed: boolean, attemptsRemaining: number }}
   */
  denyJoin(roomId, ownerPeerId, requestId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      const err = new Error('Room not found');
      err.code = 'INVALID_ROOM';
      throw err;
    }

    if (room.ownerPeerId !== ownerPeerId) {
      const err = new Error('Only the room owner can deny join requests');
      err.code = 'NOT_AUTHORIZED';
      throw err;
    }

    if (!room.pendingJoin || room.pendingJoin.requestId !== requestId) {
      const err = new Error('Join request not found or expired');
      err.code = 'INVALID_REQUEST';
      throw err;
    }

    const pending = room.pendingJoin;
    clearTimeout(pending.timer);
    room.pendingJoin = null;

    room.failedJoinAttempts = (room.failedJoinAttempts || 0) + 1;
    const isRoomClosed = room.failedJoinAttempts >= 3;

    if (isRoomClosed) {
      this.destroyRoom(room, 'closed', 'too_many_attempts');
    }

    return {
      joinerWs: pending.ws,
      isRoomClosed,
      attemptsRemaining: Math.max(0, 3 - room.failedJoinAttempts)
    };
  }

  /**
   * Handle auto-deny after 60s timeout for pending join request.
   * @param {string} roomId
   * @param {string} requestId
   * @returns {{ joinerWs: import('ws').WebSocket | null, ownerWs: import('ws').WebSocket | null, isRoomClosed: boolean, requestId: string } | null}
   */
  handleJoinTimeout(roomId, requestId) {
    const room = this.rooms.get(roomId);
    if (!room || !room.pendingJoin || room.pendingJoin.requestId !== requestId) {
      return null;
    }

    const pending = room.pendingJoin;
    clearTimeout(pending.timer);
    room.pendingJoin = null;

    room.failedJoinAttempts = (room.failedJoinAttempts || 0) + 1;
    const isRoomClosed = room.failedJoinAttempts >= 3;

    const owner = room.members.get(room.ownerPeerId);
    const ownerWs = owner ? owner.ws : null;
    const joinerWs = pending.ws;

    if (isRoomClosed) {
      this.destroyRoom(room, 'closed', 'too_many_attempts');
    }

    if (joinerWs && typeof joinerWs.send === 'function') {
      try {
        joinerWs.send(JSON.stringify({
          type: 'room:error',
          version: 1,
          code: 'JOIN_DENIED',
          message: 'Join request timed out. Please try again.'
        }));
      } catch {
        // ignore
      }
    }

    if (ownerWs && typeof ownerWs.send === 'function') {
      try {
        ownerWs.send(JSON.stringify({
          type: 'peer:join-timed-out',
          version: 1,
          requestId
        }));
      } catch {
        // ignore
      }
    }

    return {
      joinerWs,
      ownerWs,
      isRoomClosed,
      requestId
    };
  }

  /**
   * Cancel pending join request (when joiner cancels or disconnects).
   * @param {string} roomId
   * @param {string} [requestId]
   * @param {import('ws').WebSocket} [ws]
   * @returns {{ ownerWs: import('ws').WebSocket | null, requestId: string } | null}
   */
  cancelPendingJoin(roomId, requestId, ws) {
    const room = this.rooms.get(roomId);
    if (!room || !room.pendingJoin) return null;

    if (requestId && room.pendingJoin.requestId !== requestId) return null;
    if (ws && room.pendingJoin.ws !== ws) return null;

    const pending = room.pendingJoin;
    clearTimeout(pending.timer);
    const reqId = pending.requestId;
    room.pendingJoin = null;

    const owner = room.members.get(room.ownerPeerId);
    return {
      ownerWs: owner ? owner.ws : null,
      requestId: reqId
    };
  }

  /**
   * Close a room explicitly (by owner or system).
   * @param {string} roomId
   * @param {string} requestedByPeerId
   * @param {string} [reason='closed_by_owner']
   * @returns {string[]} Peer IDs of members that were in the room
   */
  closeRoom(roomId, requestedByPeerId, reason = 'closed_by_owner') {
    const room = this.rooms.get(roomId);
    if (!room) {
      const err = new Error('Room not found');
      err.code = 'INVALID_ROOM';
      throw err;
    }

    // Only owner can close room
    if (requestedByPeerId && room.ownerPeerId !== requestedByPeerId) {
      const err = new Error('Only the room owner is authorized to close the room');
      err.code = 'NOT_AUTHORIZED';
      throw err;
    }

    return this.destroyRoom(room, 'closed', reason);
  }

  /**
   * Handle automatic expiration of a room.
   * @param {string} roomId
   * @param {number} expectedGeneration
   */
  expireRoom(roomId, expectedGeneration) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    // Guard against race condition with reused ID / newer generation
    if (room.roomGeneration !== expectedGeneration) return;

    this.destroyRoom(room, 'expired', 'room_expired');
  }

  /**
   * Internal teardown of a room. Clears timers, unbinds sockets, removes from map.
   * @param {Room} room
   * @param {RoomStatus} finalStatus
   * @param {string} reason
   * @returns {string[]}
   */
  destroyRoom(room, finalStatus, reason) {
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }

    if (room.pendingJoin) {
      if (room.pendingJoin.timer) {
        clearTimeout(room.pendingJoin.timer);
      }
      if (room.pendingJoin.ws && room.pendingJoin.ws.readyState === 1 /* OPEN */) {
        try {
          room.pendingJoin.ws.send(JSON.stringify({
            type: 'room:closed',
            version: 1,
            reason: reason || 'room_closed'
          }));
          room.pendingJoin.ws.close(1000, reason || 'Room closed');
        } catch {
          // ignore
        }
      }
      room.pendingJoin = null;
    }

    room.status = finalStatus;

    const memberPeerIds = [];
    for (const [peerId, member] of room.members.entries()) {
      memberPeerIds.push(peerId);
      if (member.graceTimer) {
        clearTimeout(member.graceTimer);
        member.graceTimer = null;
      }
      if (member.ws) {
        this.unbindSocket(member.ws);
        if (member.ws.readyState === 1 /* OPEN */) {
          try {
            member.ws.send(JSON.stringify({
              type: 'room:closed',
              version: 1,
              reason: reason || 'room_closed'
            }));
            member.ws.close(1000, reason || 'Room closed');
          } catch {
            // ignore
          }
        }
      }
    }

    this.rooms.delete(room.roomId);
    defaultRelayLimiter.cleanupRoom(room.roomId);
    return memberPeerIds;
  }

  /**
   * Handle peer socket disconnection with grace period.
   * On socket close, DO NOT destroy the room. Set member.ws = null, record disconnectedAt,
   * start a per-member grace timer, and notify the other peer without closing the other peer's socket.
   * @param {import('ws').WebSocket} ws
   * @returns {{ status: 'grace_period', roomId: string, disconnectedPeerId: string, remainingPeer: RoomMember | null } | { status: 'pending_canceled', ownerWs: import('ws').WebSocket | null, requestId: string } | null}
   */
  handleSocketDisconnect(ws) {
    const binding = this.getSocketBinding(ws);
    if (!binding) {
      // Check if ws was a pending joiner
      for (const room of this.rooms.values()) {
        if (room.pendingJoin && room.pendingJoin.ws === ws) {
          const res = this.cancelPendingJoin(room.roomId, room.pendingJoin.requestId, ws);
          return res ? { status: 'pending_canceled', ...res } : null;
        }
      }
      return null;
    }

    const { roomId, peerId } = binding;
    this.unbindSocket(ws);

    const room = this.rooms.get(roomId);
    if (!room) return null;

    const member = room.members.get(peerId);
    if (member) {
      member.ws = null;
      member.disconnectedAt = Date.now();

      if (member.graceTimer) {
        clearTimeout(member.graceTimer);
      }

      member.graceTimer = setTimeout(() => {
        this.handleGraceTimeout(roomId, peerId);
      }, this.roomReconnectGraceMs);

      if (member.graceTimer.unref) {
        member.graceTimer.unref();
      }
    }

    // Find the remaining peer if any with active socket
    let remainingPeer = null;
    for (const [id, m] of room.members.entries()) {
      if (id !== peerId && m.ws) {
        remainingPeer = m;
        break;
      }
    }

    return {
      status: 'grace_period',
      roomId,
      disconnectedPeerId: peerId,
      remainingPeer
    };
  }

  /**
   * Called when a disconnected member's grace period expires.
   * Destroys the room and sends room:closed (reason 'peer_timeout') to the remaining peer.
   * @param {string} roomId
   * @param {string} peerId
   */
  handleGraceTimeout(roomId, peerId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    const member = room.members.get(peerId);
    if (member && member.ws === null) {
      this.destroyRoom(room, 'closed', 'peer_timeout');
    }
  }

  /**
   * Rejoin an active room during the grace period using a persistent peerSecret.
   * @param {string} roomId
   * @param {string} peerId
   * @param {string} peerSecret
   * @param {import('ws').WebSocket} newWs
   * @param {string} [rawDeviceName]
   * @returns {{ room: Room, peerId: string, member: RoomMember, otherPeer: RoomMember | null }}
   */
  rejoinRoom(roomId, peerId, peerSecret, newWs, rawDeviceName) {
    const room = this.rooms.get(roomId);
    if (!room || room.status === 'closed' || room.status === 'expired') {
      const err = new Error('Invalid rejoin: room not available');
      err.code = 'INVALID_REJOIN';
      throw err;
    }

    const member = room.members.get(peerId);
    if (!member || !member.hashedPeerSecret || typeof peerSecret !== 'string') {
      const err = new Error('Invalid rejoin: peer not found or missing secret');
      err.code = 'INVALID_REJOIN';
      throw err;
    }

    const isValidSecret = verifyToken(peerSecret, member.hashedPeerSecret);
    if (!isValidSecret) {
      const err = new Error('Invalid rejoin: token verification failed');
      err.code = 'INVALID_REJOIN';
      throw err;
    }

    // Cancel grace timer
    if (member.graceTimer) {
      clearTimeout(member.graceTimer);
      member.graceTimer = null;
    }
    member.disconnectedAt = null;

    // Close any previous half-open socket
    if (member.ws && member.ws !== newWs) {
      try {
        this.unbindSocket(member.ws);
        member.ws.close(1000, 'Replaced by new connection');
      } catch {
        // ignore
      }
    }

    member.ws = newWs;
    if (rawDeviceName) {
      member.deviceName = sanitizeDeviceName(rawDeviceName);
    }

    this.bindSocket(newWs, roomId, peerId);
    this.touchActivity(roomId);

    let otherPeer = null;
    for (const [id, m] of room.members.entries()) {
      if (id !== peerId) {
        otherPeer = m;
        break;
      }
    }

    return {
      room,
      peerId,
      member,
      otherPeer
    };
  }

  /**
   * Schedule expiration cleanup.
   * @param {Room} room
   */
  scheduleExpiration(room) {
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
    }

    const delay = Math.max(0, room.expiresAt - Date.now());
    const generation = room.roomGeneration;

    room.cleanupTimer = setTimeout(() => {
      this.expireRoom(room.roomId, generation);
    }, delay);

    if (room.cleanupTimer.unref) {
      room.cleanupTimer.unref();
    }
  }

  /**
   * Get room metadata.
   * @param {string} roomId
   * @returns {Room | undefined}
   */
  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  /**
   * Get other peer in the room.
   * @param {string} roomId
   * @param {string} peerId
   * @returns {RoomMember | null}
   */
  getOtherPeer(roomId, peerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    for (const [id, member] of room.members.entries()) {
      if (id !== peerId) {
        return member;
      }
    }
    return null;
  }

  /**
   * Update room activity on genuine data exchange (e.g. text message or file transfer).
   * Dynamically extends idle TTL up to the hard maximum lifetime.
   * Throttled on binary relay (at most once per 5 seconds).
   * @param {string} roomId
   * @param {boolean} [throttled=false]
   */
  touchActivity(roomId, throttled = false) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'connected') return;

    const now = Date.now();
    if (throttled && room.lastThrottledTouch && now - room.lastThrottledTouch < 5000) {
      return;
    }
    if (throttled) {
      room.lastThrottledTouch = now;
    }

    if (now > room.maxExpiresAt) {
      this.expireRoom(roomId, room.roomGeneration);
      return;
    }

    room.lastActivityAt = now;
    room.expiresAt = Math.min(room.maxExpiresAt, now + this.roomTtlMs);
    this.scheduleExpiration(room);
  }

  /**
   * Clean up all rooms and timers on server shutdown.
   */
  dispose() {
    for (const room of this.rooms.values()) {
      if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
      }
    }
    this.rooms.clear();
  }
}

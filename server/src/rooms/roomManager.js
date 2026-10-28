import { config } from '../config/config.js';
import {
  generateRoomId,
  generateJoinToken,
  generatePeerId,
  hashToken,
  verifyToken,
  sanitizeDeviceName
} from '../security/tokenUtils.js';

/**
 * @typedef {'waiting' | 'connected' | 'closed' | 'expired'} RoomStatus
 * @typedef {'owner' | 'joiner'} PeerRole
 * 
 * @typedef {Object} RoomMember
 * @property {string} peerId
 * @property {string} deviceName
 * @property {import('ws').WebSocket} ws
 * @property {PeerRole} role
 * @property {number} joinedAt
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
 * @property {Map<string, RoomMember>} members
 * @property {number} roomGeneration
 * @property {NodeJS.Timeout | null} cleanupTimer
 */

export class RoomManager {
  constructor(options = {}) {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    /** @type {WeakMap<import('ws').WebSocket, { roomId: string, peerId: string }>} */
    this.socketToPeer = new WeakMap();

    this.roomTtlMs = options.roomTtlMs ?? config.roomTtlMs;
    this.maxRoomLifetimeMs = options.maxRoomLifetimeMs ?? config.maxRoomLifetimeMs;
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
   * @returns {{ roomId: string, rawJoinToken: string, ownerPeerId: string, expiresAt: number }}
   */
  createRoom(ownerWs, rawDeviceName) {
    if (this.rooms.size >= this.maxRooms) {
      const err = new Error('Server room capacity reached. Please try again later.');
      err.code = 'ROOM_CAPACITY_EXCEEDED';
      throw err;
    }

    const roomId = generateRoomId();
    const rawJoinToken = generateJoinToken();
    const joinTokenHash = hashToken(rawJoinToken);
    const ownerPeerId = generatePeerId();
    const deviceName = sanitizeDeviceName(rawDeviceName);

    const now = Date.now();
    const expiresAt = now + this.roomTtlMs;
    const maxExpiresAt = now + this.maxRoomLifetimeMs;
    const roomGeneration = ++this.generationCounter;

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
      joinedAt: now
    });

    this.bindSocket(ownerWs, roomId, ownerPeerId);
    this.rooms.set(roomId, room);

    // Schedule cleanup timer
    this.scheduleExpiration(room);

    return {
      roomId,
      rawJoinToken,
      ownerPeerId,
      expiresAt
    };
  }

  /**
   * Join an existing room using an invitation token.
   * @param {string} roomId
   * @param {string} rawJoinToken
   * @param {import('ws').WebSocket} joinerWs
   * @param {string} rawDeviceName
   * @returns {{ joinerPeerId: string, ownerPeerId: string, ownerDeviceName: string }}
   */
  joinRoom(roomId, rawJoinToken, joinerWs, rawDeviceName) {
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

    const isTokenValid = verifyToken(rawJoinToken, room.joinTokenHash);
    if (!isTokenValid) {
      const err = new Error('Invalid room invitation token');
      err.code = 'INVALID_TOKEN';
      throw err;
    }

    // Token is valid: consume it now (single use!)
    room.joinTokenUsed = true;

    const joinerPeerId = generatePeerId();
    const deviceName = sanitizeDeviceName(rawDeviceName);

    room.members.set(joinerPeerId, {
      peerId: joinerPeerId,
      deviceName,
      ws: joinerWs,
      role: 'joiner',
      joinedAt: now
    });

    room.status = 'connected';
    room.lastActivityAt = now;
    this.bindSocket(joinerWs, roomId, joinerPeerId);

    const owner = room.members.get(room.ownerPeerId);

    return {
      joinerPeerId,
      ownerPeerId: room.ownerPeerId,
      ownerDeviceName: owner ? owner.deviceName : 'Host'
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

    room.status = finalStatus;

    const memberPeerIds = [];
    for (const [peerId, member] of room.members.entries()) {
      memberPeerIds.push(peerId);
      this.unbindSocket(member.ws);
    }

    this.rooms.delete(room.roomId);
    return memberPeerIds;
  }

  /**
   * Handle peer socket disconnection.
   * In MVP: when either peer disconnects, close the room and notify the other peer.
   * @param {import('ws').WebSocket} ws
   * @returns {{ room: Room, disconnectedPeerId: string, remainingPeer: RoomMember | null } | null}
   */
  handleSocketDisconnect(ws) {
    const binding = this.getSocketBinding(ws);
    if (!binding) return null;

    const { roomId, peerId } = binding;
    this.unbindSocket(ws);

    const room = this.rooms.get(roomId);
    if (!room) return null;

    // Find the remaining peer if any
    let remainingPeer = null;
    for (const [id, member] of room.members.entries()) {
      if (id !== peerId) {
        remainingPeer = member;
      }
    }

    // Teardown the room
    this.destroyRoom(room, 'closed', 'peer_disconnected');

    return {
      roomId,
      disconnectedPeerId: peerId,
      remainingPeer
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
   * Protocol heartbeats (ping/pong) must NOT call this method.
   * @param {string} roomId
   */
  touchActivity(roomId) {
    const room = this.rooms.get(roomId);
    if (!room || room.status !== 'connected') return;

    const now = Date.now();
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

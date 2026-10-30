import { config } from '../config/config.js';
import { ErrorCodes } from './messageSchemas.js';

export class RelayLimiter {
  constructor() {
    /** @type {Set<string>} Active relay room IDs */
    this.activeRelayRooms = new Set();

    /** @type {Map<string, number>} roomId -> total relayed bytes in room */
    this.roomRelayBytes = new Map();

    /** @type {Map<string, number>} clientIp -> bytes relayed today */
    this.ipRelayBytes = new Map();

    /** @type {number} Total bytes relayed today (aggregated, no per-user info) */
    this.relayBytesToday = 0;

    /** @type {string} Current date string (YYYY-MM-DD) for midnight reset */
    this.currentDate = this.getDateString();

    /** @type {WeakMap<import('ws').WebSocket, number>} ws -> last timestamp PEER_SLOW was sent */
    this.peerSlowRateLimit = new WeakMap();
  }

  getDateString() {
    return new Date().toISOString().slice(0, 10);
  }

  resetDailyIfNeeded() {
    const today = this.getDateString();
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.ipRelayBytes.clear();
      this.relayBytesToday = 0;
    }
  }

  /**
   * Reset all counters (for testing and lifecycle teardown).
   */
  reset() {
    this.activeRelayRooms.clear();
    this.roomRelayBytes.clear();
    this.ipRelayBytes.clear();
    this.relayBytesToday = 0;
    this.currentDate = this.getDateString();
    this.peerSlowRateLimit = new WeakMap();
  }

  /**
   * Clean up room relay metrics when room is closed or destroyed.
   * @param {string} roomId
   */
  cleanupRoom(roomId) {
    if (roomId) {
      this.activeRelayRooms.delete(roomId);
      this.roomRelayBytes.delete(roomId);
    }
  }

  /**
   * Get total aggregated relay bytes today for health endpoint.
   * @returns {number}
   */
  getRelayBytesToday() {
    this.resetDailyIfNeeded();
    return this.relayBytesToday;
  }

  /**
   * Check whether a binary chunk can be relayed under server safety limits.
   * Logs one line per limit hit without room tokens or peer secrets.
   *
   * @param {object} params
   * @param {import('ws').WebSocket} params.senderWs
   * @param {import('ws').WebSocket} params.receiverWs
   * @param {string} params.roomId
   * @param {string} params.senderPeerId
   * @param {string} params.clientIp
   * @param {number} params.chunkLength
   * @returns {{
   *   allowed: boolean,
   *   error?: string,
   *   message?: string,
   *   dropOnly?: boolean,
   *   sendPeerSlow?: boolean
   * }}
   */
  checkRelay({ senderWs, receiverWs, roomId, senderPeerId, clientIp, chunkLength }) {
    this.resetDailyIfNeeded();

    // 1. Slow Receiver Backpressure Check:
    // If receiver socket bufferedAmount > 4 MiB, drop the frame and send PEER_SLOW (rate-limited to 1/s).
    const receiverBuffered = (receiverWs && typeof receiverWs.bufferedAmount === 'number')
      ? receiverWs.bufferedAmount
      : 0;
    const maxBuffered = config.relayMaxBufferedAmount || (4 * 1024 * 1024);

    if (receiverBuffered > maxBuffered) {
      const now = Date.now();
      const lastSlowSent = this.peerSlowRateLimit.get(senderWs) || 0;
      let sendPeerSlow = false;
      if (now - lastSlowSent >= 1000) {
        this.peerSlowRateLimit.set(senderWs, now);
        sendPeerSlow = true;
      }
      console.log(`[RELAY-SLOW] otherPeerBuffered=${receiverBuffered}B limit=${maxBuffered}B`);
      return {
        allowed: false,
        error: ErrorCodes.PEER_SLOW,
        message: 'Receiver is slow: backpressure limit exceeded',
        dropOnly: true,
        sendPeerSlow
      };
    }

    // 2. Concurrent Relay Rooms Cap (default 20)
    const maxConcurrentRooms = config.relayMaxConcurrentRelayRooms || 20;
    if (!this.activeRelayRooms.has(roomId) && this.activeRelayRooms.size >= maxConcurrentRooms) {
      console.log(`[RELAY-LIMIT] limit=concurrent_relay_rooms max=${maxConcurrentRooms} current=${this.activeRelayRooms.size}`);
      return {
        allowed: false,
        error: ErrorCodes.RELAY_LIMIT_REACHED,
        message: 'Relay limit reached. Try a direct connection or try again later.'
      };
    }

    // 3. Per-Room Bytes Cap (default 2 GiB)
    const maxBytesPerRoom = config.relayMaxBytesPerRoom || (2 * 1024 * 1024 * 1024);
    const currentRoomBytes = this.roomRelayBytes.get(roomId) || 0;
    if (currentRoomBytes + chunkLength > maxBytesPerRoom) {
      console.log(`[RELAY-LIMIT] limit=room_bytes max=${maxBytesPerRoom} current=${currentRoomBytes}`);
      return {
        allowed: false,
        error: ErrorCodes.RELAY_LIMIT_REACHED,
        message: 'Relay limit reached. Try a direct connection or try again later.'
      };
    }

    // 4. Per-IP Daily Bytes Cap (default 5 GiB)
    const maxBytesPerIp = config.relayMaxBytesPerIpPerDay || (5 * 1024 * 1024 * 1024);
    const currentIpBytes = this.ipRelayBytes.get(clientIp) || 0;
    if (currentIpBytes + chunkLength > maxBytesPerIp) {
      console.log(`[RELAY-LIMIT] limit=ip_bytes_daily max=${maxBytesPerIp} current=${currentIpBytes}`);
      return {
        allowed: false,
        error: ErrorCodes.RELAY_LIMIT_REACHED,
        message: 'Relay limit reached. Try a direct connection or try again later.'
      };
    }

    // All safety checks passed: record usage
    this.activeRelayRooms.add(roomId);
    this.roomRelayBytes.set(roomId, currentRoomBytes + chunkLength);
    this.ipRelayBytes.set(clientIp, currentIpBytes + chunkLength);
    this.relayBytesToday += chunkLength;

    return { allowed: true };
  }
}

export const defaultRelayLimiter = new RelayLimiter();
export function getRelayBytesToday() {
  return defaultRelayLimiter.getRelayBytesToday();
}

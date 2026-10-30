import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../src/rooms/roomManager.js';
import { RateLimiter } from '../../src/security/rateLimiter.js';
import { parseAndValidateRawMessage, ErrorCodes } from '../../src/websocket/messageSchemas.js';

describe('Security and Reliability Hardening', () => {
  const mockWs = { send: () => {}, close: () => {} };
  const mockWs2 = { send: () => {}, close: () => {} };

  it('enforces hard maximum room lifetime even when activity occurs', async () => {
    // Room TTL is 50ms, max lifetime is 100ms
    const manager = new RoomManager({
      roomTtlMs: 50,
      maxRoomLifetimeMs: 100
    });

    const { roomId, rawJoinToken } = await manager.createRoom(mockWs, 'Host');
    await manager.joinRoom(roomId, rawJoinToken, mockWs2, 'Guest');

    // Simulate activity at 40ms -> extends idle TTL to 90ms
    await new Promise(r => setTimeout(r, 40));
    manager.touchActivity(roomId);

    const room = manager.getRoom(roomId);
    assert.ok(room, 'Room should still exist after 40ms');
    assert.ok(room.expiresAt <= room.maxExpiresAt, 'expiresAt must never exceed maxExpiresAt');

    // Wait until 110ms (exceeding hard max lifetime 100ms)
    await new Promise(r => setTimeout(r, 70));
    manager.touchActivity(roomId);

    // Room should now be expired and deleted
    assert.equal(manager.getRoom(roomId), undefined, 'Room must expire when max lifetime is reached');
    manager.dispose();
  });

  it('guarantees idempotent room destruction without errors on duplicate close', async () => {
    const manager = new RoomManager();
    const { roomId, ownerPeerId } = await manager.createRoom(mockWs, 'Host');

    // First close
    const closed = manager.closeRoom(roomId, ownerPeerId);
    assert.equal(closed.length, 1);

    // Second close on already closed room throws clean INVALID_ROOM
    assert.throws(
      () => manager.closeRoom(roomId, ownerPeerId),
      (err) => err.code === 'INVALID_ROOM'
    );

    manager.dispose();
  });

  it('prevents stale timers from destroying newer room generations', async () => {
    const manager = new RoomManager();
    const { roomId } = await manager.createRoom(mockWs, 'Host');
    const room = manager.getRoom(roomId);
    const staleGeneration = room.roomGeneration - 1;

    // Trigger expireRoom with older generation
    manager.expireRoom(roomId, staleGeneration);

    // Room should NOT be deleted
    assert.ok(manager.getRoom(roomId), 'Room must not be deleted by stale generation timer');
    manager.dispose();
  });

  it('strictly rejects binary payloads and enforces 16 KiB size limits', () => {
    // Binary data
    const binaryRes = parseAndValidateRawMessage(Buffer.from([0x01, 0x02]), true);
    assert.equal(binaryRes.error.code, ErrorCodes.INVALID_PAYLOAD);

    // Oversized data (> 16 KiB)
    const largeData = 'a'.repeat(20000);
    const largeRes = parseAndValidateRawMessage(largeData, false);
    assert.equal(largeRes.error.code, ErrorCodes.INVALID_PAYLOAD);
  });

  it('isolates rate limiting per client IP and action bucket', () => {
    const limiter = new RateLimiter(60000);
    const ipA = '10.0.0.1';
    const ipB = '10.0.0.2';

    // IP A exhausts room_create quota
    for (let i = 0; i < 5; i++) {
      assert.equal(limiter.isAllowed(ipA, 'room_create', 5, 1000), true);
    }
    assert.equal(limiter.isAllowed(ipA, 'room_create', 5, 1000), false);

    // IP B remains unaffected
    assert.equal(limiter.isAllowed(ipB, 'room_create', 5, 1000), true);

    // IP A can still perform a different action (e.g. text_message)
    assert.equal(limiter.isAllowed(ipA, 'text_message', 5, 1000), true);

    limiter.dispose();
  });
});

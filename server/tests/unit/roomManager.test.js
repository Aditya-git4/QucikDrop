import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../../src/rooms/roomManager.js';

describe('RoomManager', () => {
  let roomManager;
  const mockOwnerWs = { send: () => {}, close: () => {} };
  const mockJoinerWs = { send: () => {}, close: () => {} };
  const mockThirdWs = { send: () => {}, close: () => {} };

  beforeEach(() => {
    roomManager = new RoomManager({
      roomTtlMs: 500, // 500ms for quick test expiration
      maxRoomLifetimeMs: 1000,
      maxRooms: 5
    });
  });

  afterEach(() => {
    roomManager.dispose();
  });

  it('creates a room with an owner and valid expiration metadata', () => {
    const { roomId, rawJoinToken, ownerPeerId, expiresAt } = roomManager.createRoom(mockOwnerWs, 'Windows PC');

    assert.ok(roomId);
    assert.ok(rawJoinToken);
    assert.ok(ownerPeerId);
    assert.ok(expiresAt > Date.now());

    const room = roomManager.getRoom(roomId);
    assert.ok(room);
    assert.equal(room.status, 'waiting');
    assert.equal(room.ownerPeerId, ownerPeerId);
    assert.equal(room.members.size, 1);
    assert.equal(room.joinTokenUsed, false);
  });

  it('allows a second device to join with the valid raw token', () => {
    const { roomId, rawJoinToken, ownerPeerId } = roomManager.createRoom(mockOwnerWs, 'Windows PC');
    const { joinerPeerId, ownerPeerId: returnedOwnerId, ownerDeviceName } = roomManager.joinRoom(
      roomId,
      rawJoinToken,
      mockJoinerWs,
      'Android Phone'
    );

    assert.ok(joinerPeerId);
    assert.equal(returnedOwnerId, ownerPeerId);
    assert.equal(ownerDeviceName, 'Windows PC');

    const room = roomManager.getRoom(roomId);
    assert.equal(room.status, 'connected');
    assert.equal(room.members.size, 2);
    assert.equal(room.joinTokenUsed, true);
  });

  it('rejects joining with an incorrect invitation token', () => {
    const { roomId } = roomManager.createRoom(mockOwnerWs, 'Windows PC');

    assert.throws(
      () => roomManager.joinRoom(roomId, 'wrong-token-value', mockJoinerWs, 'Android Phone'),
      (err) => err.code === 'INVALID_TOKEN'
    );
  });

  it('enforces single-use token: token cannot be reused once consumed', () => {
    const { roomId, rawJoinToken } = roomManager.createRoom(mockOwnerWs, 'Windows PC');
    
    // First join succeeds
    roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Android Phone');

    // Attempt second join with same token
    assert.throws(
      () => roomManager.joinRoom(roomId, rawJoinToken, mockThirdWs, 'Attacker Phone'),
      (err) => err.code === 'ROOM_FULL' || err.code === 'TOKEN_USED'
    );
  });

  it('strictly limits room membership to two devices', () => {
    const { roomId, rawJoinToken } = roomManager.createRoom(mockOwnerWs, 'Windows PC');
    roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Android Phone');

    assert.throws(
      () => roomManager.joinRoom(roomId, rawJoinToken, mockThirdWs, 'Extra Device'),
      (err) => err.code === 'ROOM_FULL'
    );
  });

  it('rejects joining an expired room', async () => {
    const fastExpiryManager = new RoomManager({ roomTtlMs: 10 });
    const { roomId, rawJoinToken } = fastExpiryManager.createRoom(mockOwnerWs, 'PC');

    // Wait 25ms for room to expire
    await new Promise(resolve => setTimeout(resolve, 25));

    assert.throws(
      () => fastExpiryManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Phone'),
      (err) => err.code === 'ROOM_EXPIRED' || err.code === 'INVALID_ROOM'
    );
    fastExpiryManager.dispose();
  });

  it('allows owner to close room, but forbids unauthorized peers from closing', () => {
    const { roomId, rawJoinToken, ownerPeerId } = roomManager.createRoom(mockOwnerWs, 'Windows PC');
    const { joinerPeerId } = roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Android Phone');

    // Joiner tries to close room -> should be rejected
    assert.throws(
      () => roomManager.closeRoom(roomId, joinerPeerId),
      (err) => err.code === 'NOT_AUTHORIZED'
    );

    // Owner closes room -> succeeds
    const closedMembers = roomManager.closeRoom(roomId, ownerPeerId);
    assert.equal(closedMembers.length, 2);
    assert.equal(roomManager.getRoom(roomId), undefined);
  });

  it('handles peer disconnection by tearing down the room and identifying the remaining peer', () => {
    const { roomId, rawJoinToken } = roomManager.createRoom(mockOwnerWs, 'Windows PC');
    roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Android Phone');

    // Disconnect joiner
    const result = roomManager.handleSocketDisconnect(mockJoinerWs);
    assert.ok(result);
    assert.equal(result.roomId, roomId);
    assert.ok(result.remainingPeer);
    assert.equal(result.remainingPeer.role, 'owner');

    // Room should now be removed from manager
    assert.equal(roomManager.getRoom(roomId), undefined);
  });
});

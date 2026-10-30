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

  it('creates a room with an owner and valid expiration metadata', async () => {
    const { roomId, rawJoinToken, ownerPeerId, expiresAt } = await roomManager.createRoom(mockOwnerWs, 'Windows PC');

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

  it('allows a second device to request to join and owner approves', async () => {
    const { roomId, rawJoinToken, ownerPeerId } = await roomManager.createRoom(mockOwnerWs, 'Windows PC');
    const pendingRes = await roomManager.joinRoom(
      roomId,
      rawJoinToken,
      mockJoinerWs,
      'Android Phone'
    );

    assert.equal(pendingRes.status, 'pending');
    assert.ok(pendingRes.requestId);
    assert.equal(pendingRes.ownerPeerId, ownerPeerId);

    const { joinerPeerId, ownerPeerId: returnedOwnerId, ownerDeviceName } = roomManager.approveJoin(
      roomId,
      ownerPeerId,
      pendingRes.requestId
    );

    assert.ok(joinerPeerId);
    assert.equal(returnedOwnerId, ownerPeerId);
    assert.equal(ownerDeviceName, 'Windows PC');

    const room = roomManager.getRoom(roomId);
    assert.equal(room.status, 'connected');
    assert.equal(room.members.size, 2);
    assert.equal(room.joinTokenUsed, true);
  });

  it('allows immediate admission when autoApprove option is true', async () => {
    const { roomId, rawJoinToken, ownerPeerId } = await roomManager.createRoom(mockOwnerWs, 'Windows PC', { autoApprove: true });
    const { joinerPeerId, ownerPeerId: returnedOwnerId, ownerDeviceName } = await roomManager.joinRoom(
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

  it('rejects joining with an incorrect invitation token', async () => {
    const { roomId } = await roomManager.createRoom(mockOwnerWs, 'Windows PC');

    await assert.rejects(
      async () => roomManager.joinRoom(roomId, 'wrong-token-value', mockJoinerWs, 'Android Phone'),
      (err) => err.code === 'INVALID_TOKEN'
    );
  });

  it('enforces single-use token: token cannot be reused once consumed', async () => {
    const { roomId, rawJoinToken } = await roomManager.createRoom(mockOwnerWs, 'Windows PC', { autoApprove: true });
    
    // First join succeeds
    await roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Android Phone');

    // Attempt second join with same token
    await assert.rejects(
      async () => roomManager.joinRoom(roomId, rawJoinToken, mockThirdWs, 'Attacker Phone'),
      (err) => err.code === 'ROOM_FULL' || err.code === 'TOKEN_USED'
    );
  });

  it('strictly limits room membership to two devices', async () => {
    const { roomId, rawJoinToken } = await roomManager.createRoom(mockOwnerWs, 'Windows PC', { autoApprove: true });
    await roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Android Phone');

    await assert.rejects(
      async () => roomManager.joinRoom(roomId, rawJoinToken, mockThirdWs, 'Extra Device'),
      (err) => err.code === 'ROOM_FULL'
    );
  });

  it('rejects joining an expired room', async () => {
    const fastExpiryManager = new RoomManager({ roomTtlMs: 10 });
    const { roomId, rawJoinToken } = await fastExpiryManager.createRoom(mockOwnerWs, 'PC', { autoApprove: true });

    // Wait 25ms for room to expire
    await new Promise(resolve => setTimeout(resolve, 25));

    await assert.rejects(
      async () => fastExpiryManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Phone'),
      (err) => err.code === 'ROOM_EXPIRED' || err.code === 'INVALID_ROOM'
    );
    fastExpiryManager.dispose();
  });

  it('allows owner to close room, but forbids unauthorized peers from closing', async () => {
    const { roomId, rawJoinToken, ownerPeerId } = await roomManager.createRoom(mockOwnerWs, 'Windows PC', { autoApprove: true });
    const { joinerPeerId } = await roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Android Phone');

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

  it('handles peer disconnection by entering grace period and destroying room on grace timeout', async () => {
    const { roomId, rawJoinToken } = await roomManager.createRoom(mockOwnerWs, 'Windows PC', { autoApprove: true });
    const { joinerPeerId } = await roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Android Phone');

    // Disconnect joiner -> enters grace period
    const result = roomManager.handleSocketDisconnect(mockJoinerWs);
    assert.ok(result);
    assert.equal(result.status, 'grace_period');
    assert.equal(result.roomId, roomId);
    assert.ok(result.remainingPeer);
    assert.equal(result.remainingPeer.role, 'owner');

    // Room survives during grace period
    const room = roomManager.getRoom(roomId);
    assert.ok(room);
    assert.equal(room.members.get(joinerPeerId).ws, null);
    assert.ok(room.members.get(joinerPeerId).disconnectedAt > 0);

    // Grace timer fires -> destroys room
    roomManager.handleGraceTimeout(roomId, joinerPeerId);
    assert.equal(roomManager.getRoom(roomId), undefined);
  });
});

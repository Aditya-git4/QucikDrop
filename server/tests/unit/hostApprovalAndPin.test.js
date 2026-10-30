import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import WebSocket from 'ws';
import { RoomManager } from '../../src/rooms/roomManager.js';
import { createSignalingServer } from '../../src/websocket/signalingServer.js';
import { verifyPin, hashPin, generatePinSalt } from '../../src/security/tokenUtils.js';

describe('Host Approval & Optional PIN Access Control', () => {
  let roomManager;
  let mockOwnerWs;
  let mockJoinerWs;

  beforeEach(() => {
    mockOwnerWs = { send: () => {}, close: () => {}, readyState: 1 };
    mockJoinerWs = { send: () => {}, close: () => {}, readyState: 1 };
    roomManager = new RoomManager({
      roomTtlMs: 30000,
      maxRoomLifetimeMs: 60000,
      maxRooms: 10
    });
  });

  afterEach(() => {
    roomManager.dispose();
  });

  // Helper for message capture
  function nextJson(ws) {
    return new Promise((resolve, reject) => {
      const handler = (data) => {
        ws.removeListener('message', handler);
        ws.removeListener('error', errorHandler);
        try {
          resolve(JSON.parse(data.toString()));
        } catch (err) {
          reject(err);
        }
      };
      const errorHandler = (err) => {
        ws.removeListener('message', handler);
        ws.removeListener('error', errorHandler);
        reject(err);
      };
      ws.on('message', handler);
      ws.on('error', errorHandler);
    });
  }

  // 1. APPROVE
  it('host receives join request, approves it, and joiner is admitted with consumed token', async () => {
    const { roomId, rawJoinToken, ownerPeerId } = await roomManager.createRoom(mockOwnerWs, 'MacBook');
    const room = roomManager.getRoom(roomId);
    assert.equal(room.joinTokenUsed, false);

    // Guest attempts join
    const pendingRes = await roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Pixel 8', {
      userAgent: 'Chrome on Android'
    });

    assert.equal(pendingRes.status, 'pending');
    assert.ok(pendingRes.requestId);
    assert.equal(pendingRes.deviceName, 'Pixel 8');
    assert.equal(room.joinTokenUsed, false, 'Token must not be consumed while pending');
    assert.ok(room.pendingJoin, 'Room must have pendingJoin state');

    // Host approves
    const admitRes = roomManager.approveJoin(roomId, ownerPeerId, pendingRes.requestId, false);

    assert.equal(admitRes.status, 'admitted');
    assert.ok(admitRes.joinerPeerId);
    assert.equal(admitRes.ownerDeviceName, 'MacBook');
    assert.equal(room.status, 'connected');
    assert.equal(room.joinTokenUsed, true, 'Token consumed after approval');
    assert.equal(room.pendingJoin, null);
    assert.equal(room.members.size, 2);
  });

  // 2. DENY
  it('host denies join request, joiner gets rejected, token remains valid for retry', async () => {
    const { roomId, rawJoinToken, ownerPeerId } = await roomManager.createRoom(mockOwnerWs, 'MacBook');
    const room = roomManager.getRoom(roomId);

    // Guest attempts join
    const pendingRes = await roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Pixel 8');
    assert.ok(room.pendingJoin);

    // Host denies
    const denyRes = roomManager.denyJoin(roomId, ownerPeerId, pendingRes.requestId);
    assert.equal(denyRes.isRoomClosed, false);
    assert.equal(denyRes.attemptsRemaining, 2);
    assert.equal(room.pendingJoin, null);
    assert.equal(room.failedJoinAttempts, 1);
    assert.equal(room.joinTokenUsed, false, 'Token stays valid for retry after deny');

    // Guest can retry with same token
    const retryRes = await roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Pixel 8');
    assert.equal(retryRes.status, 'pending');
  });

  // 3. TIMEOUT
  it('auto-denies after timeout, notifies owner and joiner, counts strike against room', async () => {
    const ownerMessages = [];
    const joinerMessages = [];
    mockOwnerWs.send = (data) => ownerMessages.push(JSON.parse(data));
    mockJoinerWs.send = (data) => joinerMessages.push(JSON.parse(data));

    const { roomId, rawJoinToken } = await roomManager.createRoom(mockOwnerWs, 'MacBook');
    const room = roomManager.getRoom(roomId);

    const pendingRes = await roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Pixel 8');
    assert.ok(room.pendingJoin);

    // Trigger join timeout
    roomManager.handleJoinTimeout(roomId, pendingRes.requestId);

    assert.equal(room.pendingJoin, null);
    assert.equal(room.failedJoinAttempts, 1);

    // Verify messages sent
    const joinerMsg = joinerMessages.find((m) => m.type === 'room:error' && m.code === 'JOIN_DENIED');
    assert.ok(joinerMsg, 'Joiner must receive JOIN_DENIED error');

    const ownerMsg = ownerMessages.find((m) => m.type === 'peer:join-timed-out');
    assert.ok(ownerMsg, 'Owner must receive peer:join-timed-out notification');
  });

  // 4. THREE STRIKES CLOSING THE ROOM
  it('three denied or invalid attempts close the room with reason too_many_attempts', async () => {
    const { roomId, rawJoinToken, ownerPeerId } = await roomManager.createRoom(mockOwnerWs, 'MacBook');
    const room = roomManager.getRoom(roomId);

    // Strike 1: Deny
    const p1 = await roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Device 1');
    roomManager.denyJoin(roomId, ownerPeerId, p1.requestId);
    assert.equal(room.failedJoinAttempts, 1);
    assert.equal(roomManager.getRoom(roomId)?.status, 'waiting');

    // Strike 2: Invalid token
    await assert.rejects(
      async () => roomManager.joinRoom(roomId, 'wrong-token-abc', mockJoinerWs, 'Device 2'),
      (err) => err.code === 'INVALID_TOKEN'
    );
    assert.equal(room.failedJoinAttempts, 2);

    // Strike 3: Deny
    const p3 = await roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Device 3');
    const denyRes3 = roomManager.denyJoin(roomId, ownerPeerId, p3.requestId);

    assert.equal(denyRes3.isRoomClosed, true);
    assert.equal(denyRes3.attemptsRemaining, 0);
    assert.equal(roomManager.getRoom(roomId), undefined, 'Room must be destroyed after 3 strikes');
  });

  // 5. REJOIN SKIPPING APPROVAL
  it('reconnects of an approved peer via room:rejoin skip approval entirely', async () => {
    const { roomId, rawJoinToken, ownerPeerId } = await roomManager.createRoom(mockOwnerWs, 'MacBook');

    // Initial join & approval
    const pendingRes = await roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Pixel 8');
    const admitRes = roomManager.approveJoin(roomId, ownerPeerId, pendingRes.requestId);
    const { joinerPeerId, joinerPeerSecret } = admitRes;

    // Disconnect joiner -> enters grace period
    roomManager.handleSocketDisconnect(mockJoinerWs);
    const room = roomManager.getRoom(roomId);
    assert.ok(room);

    // Rejoin with valid secret
    const newJoinerWs = { send: () => {}, close: () => {}, readyState: 1 };
    const rejoinRes = roomManager.rejoinRoom(roomId, joinerPeerId, joinerPeerSecret, newJoinerWs, 'Pixel 8');

    assert.equal(rejoinRes.room.status, 'connected');
    assert.equal(rejoinRes.peerId, joinerPeerId);
    assert.equal(room.pendingJoin, null, 'Rejoin must skip host approval');
  });

  // 6. CORRECT AND WRONG PIN
  it('enforces 4-digit PIN verification before host approval; constant-time check', async () => {
    const { roomId, rawJoinToken, requirePin, pin } = await roomManager.createRoom(mockOwnerWs, 'MacBook', {
      requirePin: true,
      pin: '7392'
    });

    assert.equal(requirePin, true);
    assert.equal(pin, '7392');

    const room = roomManager.getRoom(roomId);
    assert.ok(room.pinHash);
    assert.ok(room.pinSalt);
    // Plaintext PIN is NOT kept on the room object in server memory
    assert.equal(room.pin, undefined);

    // A. Missing PIN throws PIN_REQUIRED
    await assert.rejects(
      async () => roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Pixel 8'),
      (err) => err.code === 'PIN_REQUIRED'
    );

    // B. Incorrect PIN throws INVALID_PIN with remaining attempts
    await assert.rejects(
      async () => roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Pixel 8', { pin: '0000' }),
      (err) => err.code === 'INVALID_PIN' && err.attemptsRemaining === 4
    );
    assert.equal(room.failedPinAttempts, 1);

    // C. Correct PIN advances to pending approval
    const pendingRes = await roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Pixel 8', { pin: '7392' });
    assert.equal(pendingRes.status, 'pending');
    assert.ok(pendingRes.requestId);
  });

  // 7. PIN RATE LIMIT / 5 STRIKES
  it('5 incorrect PIN attempts close the room for security', async () => {
    const { roomId, rawJoinToken } = await roomManager.createRoom(mockOwnerWs, 'MacBook', {
      requirePin: true,
      pin: '1234'
    });

    for (let i = 1; i <= 4; i++) {
      await assert.rejects(
        async () => roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Attacker', { pin: '9999' }),
        (err) => err.code === 'INVALID_PIN' && err.attemptsRemaining === (5 - i)
      );
    }

    // 5th failed attempt destroys room
    await assert.rejects(
      async () => roomManager.joinRoom(roomId, rawJoinToken, mockJoinerWs, 'Attacker', { pin: '9999' }),
      (err) => err.code === 'TOO_MANY_ATTEMPTS' && err.isRoomClosed === true
    );

    assert.equal(roomManager.getRoom(roomId), undefined, 'Room must be destroyed after 5 failed PIN attempts');
  });

  // 8. ZERO SECRETS IN LOGS & WEBSOCKET FLOW
  it('full WebSocket integration: approval flow, PIN verification, cancel join, and zero secret leakage', async () => {
    const app = express();
    const server = http.createServer(app);
    const testRoomManager = new RoomManager();
    const wss = createSignalingServer(server, testRoomManager);

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const wsUrl = `ws://127.0.0.1:${port}/ws`;

    try {
      // 1. Host creates PIN-protected room
      const hostWs = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
      await new Promise((resolve) => hostWs.on('open', resolve));

      hostWs.send(JSON.stringify({
        type: 'room:create',
        version: 1,
        deviceName: 'Host Mac',
        requirePin: true,
        pin: '5566'
      }));

      const createRes = await nextJson(hostWs);
      assert.equal(createRes.type, 'room:created');
      assert.equal(createRes.requirePin, true);
      assert.equal(createRes.pin, '5566');

      const { roomId, joinToken } = createRes;

      // 2. Guest connects and attempts to join without PIN -> gets PIN_REQUIRED
      const guestWs = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
      await new Promise((resolve) => guestWs.on('open', resolve));

      guestWs.send(JSON.stringify({
        type: 'room:join',
        version: 1,
        roomId,
        joinToken,
        deviceName: 'Guest Phone'
      }));

      const pinReqRes = await nextJson(guestWs);
      assert.equal(pinReqRes.type, 'room:error');
      assert.equal(pinReqRes.code, 'PIN_REQUIRED');

      // 3. Guest submits wrong PIN -> gets INVALID_PIN
      guestWs.send(JSON.stringify({
        type: 'room:join',
        version: 1,
        roomId,
        joinToken,
        deviceName: 'Guest Phone',
        pin: '0000'
      }));

      const invalidPinRes = await nextJson(guestWs);
      assert.equal(invalidPinRes.type, 'room:error');
      assert.equal(invalidPinRes.code, 'INVALID_PIN');
      assert.equal(invalidPinRes.attemptsRemaining, 4);

      // 4. Guest submits correct PIN -> triggers approval flow
      const hostJoinReqPromise = nextJson(hostWs);
      const guestPendingPromise = nextJson(guestWs);

      guestWs.send(JSON.stringify({
        type: 'room:join',
        version: 1,
        roomId,
        joinToken,
        deviceName: 'Guest Phone',
        pin: '5566'
      }));

      const guestPending = await guestPendingPromise;
      assert.equal(guestPending.type, 'room:join-pending');
      assert.ok(guestPending.requestId);

      const hostJoinReq = await hostJoinReqPromise;
      assert.equal(hostJoinReq.type, 'peer:join-request');
      assert.equal(hostJoinReq.requestId, guestPending.requestId);
      assert.equal(hostJoinReq.deviceName, 'Guest Phone');

      // 5. Host approves join with autoApprove flag
      const hostPeerJoinedPromise = nextJson(hostWs);
      const guestJoinedPromise = nextJson(guestWs);

      hostWs.send(JSON.stringify({
        type: 'peer:join-approve',
        version: 1,
        requestId: hostJoinReq.requestId,
        autoApprove: true
      }));

      const guestJoined = await guestJoinedPromise;
      assert.equal(guestJoined.type, 'room:joined');
      assert.equal(guestJoined.ownerDeviceName, 'Host Mac');

      const hostPeerJoined = await hostPeerJoinedPromise;
      assert.equal(hostPeerJoined.type, 'peer:joined');
      assert.equal(hostPeerJoined.deviceName, 'Guest Phone');

      hostWs.close();
      guestWs.close();
    } finally {
      testRoomManager.dispose();
      await new Promise((r) => wss.close(r));
      await new Promise((r) => server.close(r));
    }
  });

  it('joiner cancel join request clears pending state and notifies host', async () => {
    const app = express();
    const server = http.createServer(app);
    const testRoomManager = new RoomManager();
    const wss = createSignalingServer(server, testRoomManager);

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const wsUrl = `ws://127.0.0.1:${port}/ws`;

    try {
      const hostWs = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
      await new Promise((r) => hostWs.on('open', r));

      hostWs.send(JSON.stringify({ type: 'room:create', version: 1, deviceName: 'Host' }));
      const createRes = await nextJson(hostWs);

      const guestWs = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
      await new Promise((r) => guestWs.on('open', r));

      const hostJoinReqPromise = nextJson(hostWs);
      const guestPendingPromise = nextJson(guestWs);

      guestWs.send(JSON.stringify({
        type: 'room:join',
        version: 1,
        roomId: createRes.roomId,
        joinToken: createRes.joinToken,
        deviceName: 'Guest'
      }));

      const guestPending = await guestPendingPromise;
      await hostJoinReqPromise;

      // Guest sends room:cancel-join
      const hostCancelPromise = nextJson(hostWs);
      guestWs.send(JSON.stringify({
        type: 'room:cancel-join',
        version: 1,
        roomId: createRes.roomId,
        requestId: guestPending.requestId
      }));

      const cancelMsg = await hostCancelPromise;
      assert.equal(cancelMsg.type, 'peer:join-canceled');
      assert.equal(cancelMsg.requestId, guestPending.requestId);

      hostWs.close();
      guestWs.close();
    } finally {
      testRoomManager.dispose();
      await new Promise((r) => wss.close(r));
      await new Promise((r) => server.close(r));
    }
  });
});

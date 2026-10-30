import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import WebSocket from 'ws';
import { RoomManager } from '../../src/rooms/roomManager.js';
import { createSignalingServer } from '../../src/websocket/signalingServer.js';

describe('Signaling Server Integration', () => {
  let server;
  let roomManager;
  let wss;
  let wsUrl;
  let port;

  before(async () => {
    const app = express();
    roomManager = new RoomManager({
      roomTtlMs: 5000,
      maxRoomLifetimeMs: 10000,
      maxRooms: 10
    });

    server = http.createServer(app);
    wss = createSignalingServer(server, roomManager);

    await new Promise(resolve => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        wsUrl = `ws://127.0.0.1:${port}/ws`;
        resolve();
      });
    });
  });

  after(async () => {
    roomManager.dispose();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
  });

  /** Helper to wait for the next JSON message from a socket */
  function nextMessage(ws) {
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

  it('completes room creation, joining, bidirectional text relay, and closure', async () => {
    // 1. Client A connects and creates room
    const wsA = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsA.on('open', resolve));

    wsA.send(JSON.stringify({
      type: 'room:create',
      version: 1,
      deviceName: 'Windows PC',
      autoApprove: true
    }));

    const createRes = await nextMessage(wsA);
    assert.equal(createRes.type, 'room:created');
    assert.equal(createRes.version, 1);
    assert.ok(createRes.roomId);
    assert.ok(createRes.joinToken);
    assert.ok(createRes.peerId);
    assert.ok(Array.isArray(createRes.iceServers));
    assert.ok(createRes.iceServers.length > 0);

    const { roomId, joinToken } = createRes;

    // 2. Client B connects and joins the room
    const wsB = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsB.on('open', resolve));

    const peerJoinedPromise = nextMessage(wsA);

    wsB.send(JSON.stringify({
      type: 'room:join',
      version: 1,
      roomId,
      joinToken,
      deviceName: 'Android Phone'
    }));

    const joinRes = await nextMessage(wsB);
    assert.equal(joinRes.type, 'room:joined');
    assert.equal(joinRes.roomId, roomId);
    assert.ok(Array.isArray(joinRes.iceServers));
    assert.ok(joinRes.iceServers.length > 0);
    assert.equal(joinRes.peerCount, 2);
    assert.equal(joinRes.ownerDeviceName, 'Windows PC');

    // Creator receives peer:joined notification
    const peerJoined = await peerJoinedPromise;
    assert.equal(peerJoined.type, 'peer:joined');
    assert.equal(peerJoined.deviceName, 'Android Phone');

    // 3. Client A sends text message to Client B
    const clientBMessagePromise = nextMessage(wsB);
    const clientAAckPromise = nextMessage(wsA);

    wsA.send(JSON.stringify({
      type: 'text',
      version: 1,
      clientMessageId: 'msg-1',
      text: 'Hello from PC!'
    }));

    const bReceived = await clientBMessagePromise;
    assert.equal(bReceived.type, 'text');
    assert.equal(bReceived.text, 'Hello from PC!');
    assert.equal(bReceived.deviceName, 'Windows PC');
    assert.equal(bReceived.clientMessageId, 'msg-1');

    const aAck = await clientAAckPromise;
    assert.equal(aAck.type, 'text:ack');
    assert.equal(aAck.clientMessageId, 'msg-1');

    // 4. Client B sends text message back to Client A
    const clientAReceivedPromise = nextMessage(wsA);
    const clientBAckPromise = nextMessage(wsB);

    wsB.send(JSON.stringify({
      type: 'text',
      version: 1,
      clientMessageId: 'msg-2',
      text: 'Hello back from Android Phone!'
    }));

    const aReceived = await clientAReceivedPromise;
    assert.equal(aReceived.type, 'text');
    assert.equal(aReceived.text, 'Hello back from Android Phone!');
    assert.equal(aReceived.deviceName, 'Android Phone');

    const bAck = await clientBAckPromise;
    assert.equal(bAck.type, 'text:ack');
    assert.equal(bAck.clientMessageId, 'msg-2');

    // 5. Client A closes the room
    const bClosedPromise = nextMessage(wsB);
    const aClosedPromise = nextMessage(wsA);

    wsA.send(JSON.stringify({
      type: 'room:close',
      version: 1
    }));

    const aClosed = await aClosedPromise;
    assert.equal(aClosed.type, 'room:closed');

    const bClosed = await bClosedPromise;
    assert.equal(bClosed.type, 'room:closed');

    wsA.close();
    wsB.close();
  });

  it('rejects joining with an invalid token', async () => {
    const wsA = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsA.on('open', resolve));

    wsA.send(JSON.stringify({
      type: 'room:create',
      version: 1,
      deviceName: 'Host'
    }));

    const createRes = await nextMessage(wsA);
    const { roomId } = createRes;

    const wsB = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsB.on('open', resolve));

    wsB.send(JSON.stringify({
      type: 'room:join',
      version: 1,
      roomId,
      joinToken: 'invalid-token-string',
      deviceName: 'Attacker'
    }));

    const errorRes = await nextMessage(wsB);
    assert.equal(errorRes.type, 'room:error');
    assert.equal(errorRes.code, 'INVALID_TOKEN');

    wsA.close();
    wsB.close();
  });

  it('rejects malformed JSON messages gracefully without crashing', async () => {
    const ws = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => ws.on('open', resolve));

    ws.send('NOT_VALID_JSON{{{');
    const res = await nextMessage(ws);

    assert.equal(res.type, 'room:error');
    assert.equal(res.code, 'INVALID_MESSAGE');
    ws.close();
  });

  it('rejects unsupported protocol version', async () => {
    const ws = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => ws.on('open', resolve));

    ws.send(JSON.stringify({
      type: 'room:create',
      version: 99
    }));

    const res = await nextMessage(ws);
    assert.equal(res.type, 'room:error');
    assert.equal(res.code, 'INVALID_VERSION');
    ws.close();
  });

  it('correctly relays rtc:offer, rtc:answer, and rtc:ice-candidate between connected peers', async () => {
    // 1. Peer A connects and creates room
    const wsA = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsA.on('open', resolve));

    wsA.send(JSON.stringify({
      type: 'room:create',
      version: 1,
      deviceName: 'Device A',
      autoApprove: true
    }));
    const createRes = await nextMessage(wsA);
    const { roomId, joinToken, peerId: peerIdA } = createRes;

    // 2. Peer B joins room
    const wsB = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsB.on('open', resolve));

    const peerJoinedPromise = nextMessage(wsA);
    wsB.send(JSON.stringify({
      type: 'room:join',
      version: 1,
      roomId,
      joinToken,
      deviceName: 'Device B'
    }));
    const joinRes = await nextMessage(wsB);
    const { peerId: peerIdB } = joinRes;
    await peerJoinedPromise;

    // 3. Peer A sends rtc:offer to Peer B
    const offerPromise = nextMessage(wsB);
    wsA.send(JSON.stringify({
      type: 'rtc:offer',
      version: 1,
      targetPeerId: peerIdB,
      payload: {
        type: 'offer',
        sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
      }
    }));
    const offerRes = await offerPromise;
    assert.equal(offerRes.type, 'rtc:offer');
    assert.equal(offerRes.senderPeerId, peerIdA);
    assert.equal(offerRes.payload.sdp, 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n');

    // 4. Peer B sends rtc:answer to Peer A
    const answerPromise = nextMessage(wsA);
    wsB.send(JSON.stringify({
      type: 'rtc:answer',
      version: 1,
      targetPeerId: peerIdA,
      payload: {
        type: 'answer',
        sdp: 'v=0\r\no=- 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n'
      }
    }));
    const answerRes = await answerPromise;
    assert.equal(answerRes.type, 'rtc:answer');
    assert.equal(answerRes.senderPeerId, peerIdB);
    assert.equal(answerRes.payload.type, 'answer');

    // 5. Peer A sends rtc:ice-candidate
    const icePromise = nextMessage(wsB);
    wsA.send(JSON.stringify({
      type: 'rtc:ice-candidate',
      version: 1,
      targetPeerId: peerIdB,
      payload: {
        candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 50000 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0
      }
    }));
    const iceRes = await icePromise;
    assert.equal(iceRes.type, 'rtc:ice-candidate');
    assert.equal(iceRes.senderPeerId, peerIdA);
    assert.ok(iceRes.payload.candidate);

    wsA.close();
    wsB.close();
  });

  it('rejects rtc signaling messages with invalid payload or target', async () => {
    const wsA = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsA.on('open', resolve));

    wsA.send(JSON.stringify({
      type: 'room:create',
      version: 1,
      deviceName: 'Device A',
      autoApprove: true
    }));
    await nextMessage(wsA);

    // Attempting to send rtc:offer before anyone else joined
    wsA.send(JSON.stringify({
      type: 'rtc:offer',
      version: 1,
      payload: { sdp: 'fake-sdp' }
    }));
    const errRes = await nextMessage(wsA);
    assert.equal(errRes.type, 'room:error');
    assert.equal(errRes.code, 'INVALID_ROOM');

    wsA.close();
  });

  it('joiner socket drops, room survives, remaining peer socket stays open, rejoin with correct secret works', async () => {
    const wsA = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsA.on('open', resolve));

    wsA.send(JSON.stringify({ type: 'room:create', version: 1, deviceName: 'Host PC', autoApprove: true }));
    const createRes = await nextMessage(wsA);
    const { roomId, joinToken } = createRes;

    const wsB = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsB.on('open', resolve));

    wsB.send(JSON.stringify({ type: 'room:join', version: 1, roomId, joinToken, deviceName: 'Phone' }));
    const joinRes = await nextMessage(wsB);
    await nextMessage(wsA); // peer:joined

    const { peerId: peerIdB, peerSecret: peerSecretB } = joinRes;

    // 1. Joiner socket drops
    const peerDisconnPromise = nextMessage(wsA);
    wsB.close();

    // 2. Remaining peer receives peer:disconnected
    const disconnMsg = await peerDisconnPromise;
    assert.equal(disconnMsg.type, 'peer:disconnected');
    assert.equal(disconnMsg.peerId, peerIdB);

    // 3. (4) The other peer's socket is NOT closed when one peer disconnects
    assert.equal(wsA.readyState, WebSocket.OPEN);

    // 4. Room survives during grace period
    const room = roomManager.getRoom(roomId);
    assert.ok(room);

    // 5. (1) Rejoin with the correct secret works
    const wsB2 = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsB2.on('open', resolve));

    const peerReconnPromise = nextMessage(wsA);
    wsB2.send(JSON.stringify({
      type: 'room:rejoin',
      version: 1,
      roomId,
      peerId: peerIdB,
      peerSecret: peerSecretB,
      deviceName: 'Phone Reconnected'
    }));

    const rejoinRes = await nextMessage(wsB2);
    assert.equal(rejoinRes.type, 'room:rejoined');
    assert.equal(rejoinRes.roomId, roomId);
    assert.equal(rejoinRes.peerId, peerIdB);

    const reconnMsg = await peerReconnPromise;
    assert.equal(reconnMsg.type, 'peer:reconnected');
    assert.equal(reconnMsg.peerId, peerIdB);

    wsA.close();
    wsB2.close();
  });

  it('rejects rejoin with an incorrect secret', async () => {
    const wsA = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsA.on('open', resolve));

    wsA.send(JSON.stringify({ type: 'room:create', version: 1, deviceName: 'Host', autoApprove: true }));
    const createRes = await nextMessage(wsA);
    const { roomId, joinToken } = createRes;

    const wsB = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsB.on('open', resolve));

    wsB.send(JSON.stringify({ type: 'room:join', version: 1, roomId, joinToken, deviceName: 'Phone' }));
    const joinRes = await nextMessage(wsB);
    await nextMessage(wsA); // peer:joined

    wsB.close();
    await nextMessage(wsA); // peer:disconnected

    const wsB2 = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsB2.on('open', resolve));

    wsB2.send(JSON.stringify({
      type: 'room:rejoin',
      version: 1,
      roomId,
      peerId: joinRes.peerId,
      peerSecret: 'wrong_secret_12345678901234567890123456789012',
      deviceName: 'Attacker'
    }));

    const errRes = await nextMessage(wsB2);
    assert.equal(errRes.type, 'room:error');
    assert.equal(errRes.code, 'INVALID_REJOIN');

    wsA.close();
    wsB2.close();
  });

  it('keeps remaining peer socket OPEN when one peer disconnects and rejects relay with error', async () => {
    const wsA = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsA.on('open', resolve));

    wsA.send(JSON.stringify({ type: 'room:create', version: 1, deviceName: 'Host', autoApprove: true }));
    const createRes = await nextMessage(wsA);
    const { roomId, joinToken } = createRes;

    const wsB = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsB.on('open', resolve));

    wsB.send(JSON.stringify({ type: 'room:join', version: 1, roomId, joinToken, deviceName: 'Phone' }));
    await nextMessage(wsB);
    await nextMessage(wsA); // peer:joined

    // Disconnect wsB
    wsB.close();
    const disconnMsg = await nextMessage(wsA);
    assert.equal(disconnMsg.type, 'peer:disconnected');

    // 1. Verify remaining peer's socket remains OPEN (not closed by server)
    assert.equal(wsA.readyState, WebSocket.OPEN);

    // 2. When wsA attempts to send text to disconnected peer, server replies with error without closing wsA
    wsA.send(JSON.stringify({
      type: 'text',
      version: 1,
      text: 'Are you still there?'
    }));
    const textErr = await nextMessage(wsA);
    assert.equal(textErr.type, 'room:error');
    assert.equal(textErr.code, 'INVALID_MESSAGE');
    assert.ok(textErr.message.includes('No peer connected'));
    assert.equal(wsA.readyState, WebSocket.OPEN);

    // 3. When wsA attempts to send a binary chunk to disconnected peer, server replies with PEER_UNAVAILABLE
    const testChunk = Buffer.from('test-binary-data');
    wsA.send(testChunk, { binary: true });
    const chunkErr = await nextMessage(wsA);
    assert.equal(chunkErr.type, 'room:error');
    assert.equal(chunkErr.code, 'PEER_UNAVAILABLE');
    assert.ok(chunkErr.message.includes('Peer unavailable'));
    assert.equal(wsA.readyState, WebSocket.OPEN);

    // 4. Fast sender sending subsequent chunks within 1s is rate-limited (at most one PEER_UNAVAILABLE per sec)
    wsA.send(testChunk, { binary: true });
    wsA.send(testChunk, { binary: true });
    let extraMsg = null;
    const timer = new Promise(resolve => setTimeout(resolve, 50));
    const msgListener = nextMessage(wsA).then(m => { extraMsg = m; });
    await Promise.race([timer, msgListener]);
    assert.equal(extraMsg, null);

    wsA.close();
  });

  it('grace expiry destroys the room and notifies the other peer', async () => {
    const oldGrace = roomManager.roomReconnectGraceMs;
    roomManager.roomReconnectGraceMs = 80; // 80ms grace period

    try {
      const wsA = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
      await new Promise(resolve => wsA.on('open', resolve));

      wsA.send(JSON.stringify({ type: 'room:create', version: 1, deviceName: 'Host', autoApprove: true }));
      const createRes = await nextMessage(wsA);
      const { roomId, joinToken } = createRes;

      const wsB = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
      await new Promise(resolve => wsB.on('open', resolve));

      wsB.send(JSON.stringify({ type: 'room:join', version: 1, roomId, joinToken, deviceName: 'Phone' }));
      await nextMessage(wsB);
      await nextMessage(wsA); // peer:joined

      // Disconnect wsB
      wsB.close();
      const disconnMsg = await nextMessage(wsA);
      assert.equal(disconnMsg.type, 'peer:disconnected');

      // Wait for grace timeout message on wsA
      const closeMsg = await nextMessage(wsA);
      assert.equal(closeMsg.type, 'room:closed');
      assert.equal(closeMsg.reason, 'peer_timeout');

      // Room should now be destroyed
      assert.equal(roomManager.getRoom(roomId), undefined);

      wsA.close();
    } finally {
      roomManager.roomReconnectGraceMs = oldGrace;
    }
  });

  it('the server accepts a 16392-byte binary frame and rejects an oversized text frame', async () => {
    const wsA = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsA.on('open', resolve));

    wsA.send(JSON.stringify({ type: 'room:create', version: 1, deviceName: 'Host', autoApprove: true }));
    const createRes = await nextMessage(wsA);
    const { roomId, joinToken } = createRes;

    const wsB = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsB.on('open', resolve));

    wsB.send(JSON.stringify({ type: 'room:join', version: 1, roomId, joinToken, deviceName: 'Guest' }));
    await nextMessage(wsB); // room:joined
    await nextMessage(wsA); // peer:joined

    // 1. wsA sends a 16392-byte binary frame (16384 bytes payload + 8 bytes header)
    const binary16392 = Buffer.alloc(16392, 0xab);
    const peerBChunkPromise = new Promise((resolve) => {
      wsB.once('message', (data, isBinary) => {
        resolve({ data, isBinary });
      });
    });

    wsA.send(binary16392, { binary: true });
    const receivedChunk = await peerBChunkPromise;
    assert.equal(receivedChunk.isBinary, true);
    assert.equal(receivedChunk.data.length, 16392, 'Server must accept and relay 16392-byte binary frame');

    // 2. wsA sends an oversized text frame (> 16384 bytes)
    const oversizedText = 'X'.repeat(16385);
    const oversizedPayload = JSON.stringify({
      type: 'text',
      version: 1,
      text: oversizedText
    });
    assert.ok(Buffer.byteLength(oversizedPayload) > 16384);

    wsA.send(oversizedPayload);
    const errorMsg = await nextMessage(wsA);
    assert.equal(errorMsg.type, 'room:error');
    assert.equal(errorMsg.code, 'INVALID_PAYLOAD');
    assert.ok(errorMsg.message.includes('exceeds maximum allowed size'));

    wsA.close();
    wsB.close();
  });

  it('guest sends room:leave -> owner receives room:closed immediately without 60s grace timeout', async () => {
    const wsA = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsA.on('open', resolve));

    wsA.send(JSON.stringify({ type: 'room:create', version: 1, deviceName: 'Owner Device', autoApprove: true }));
    const createRes = await nextMessage(wsA);
    const { roomId, joinToken } = createRes;

    const wsB = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise(resolve => wsB.on('open', resolve));

    wsB.send(JSON.stringify({ type: 'room:join', version: 1, roomId, joinToken, deviceName: 'Guest Device' }));
    await nextMessage(wsB); // room:joined
    await nextMessage(wsA); // peer:joined

    // Guest sends room:leave
    const ownerClosedPromise = nextMessage(wsA);
    const guestClosedPromise = nextMessage(wsB);

    const startTime = Date.now();
    wsB.send(JSON.stringify({ type: 'room:leave', version: 1 }));

    const ownerClosed = await ownerClosedPromise;
    const elapsedTime = Date.now() - startTime;

    assert.equal(ownerClosed.type, 'room:closed');
    assert.equal(ownerClosed.reason, 'guest_left');
    assert.ok(elapsedTime < 2000, `Expected immediate room:closed, took ${elapsedTime}ms (must not wait 60s grace period)`);

    const guestClosed = await guestClosedPromise;
    assert.equal(guestClosed.type, 'room:closed');

    wsA.close();
    wsB.close();
  });
});

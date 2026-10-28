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
      deviceName: 'Windows PC'
    }));

    const createRes = await nextMessage(wsA);
    assert.equal(createRes.type, 'room:created');
    assert.equal(createRes.version, 1);
    assert.ok(createRes.roomId);
    assert.ok(createRes.joinToken);
    assert.ok(createRes.peerId);

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
});

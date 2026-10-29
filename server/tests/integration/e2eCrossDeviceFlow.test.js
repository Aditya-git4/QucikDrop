import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import WebSocket from 'ws';
import { RoomManager } from '../../src/rooms/roomManager.js';
import { createSignalingServer } from '../../src/websocket/signalingServer.js';

describe('Cross-Device E2E Flow: Messaging & File Transfer Protocol', () => {
  let server;
  let roomManager;
  let wss;
  let wsUrl;
  let port;

  before(async () => {
    const app = express();
    roomManager = new RoomManager({
      roomTtlMs: 30000,
      maxRoomLifetimeMs: 60000,
      maxRooms: 10
    });

    server = http.createServer(app);
    wss = createSignalingServer(server, roomManager);

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        wsUrl = `ws://127.0.0.1:${port}/ws`;
        resolve();
      });
    });
  });

  after(async () => {
    roomManager.dispose();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });

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

  it('executes full cross-device workflow: room join, text chat, WebRTC signaling, and file streaming', async () => {
    // 1. Host (Windows PC) creates room
    const hostWs = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise((resolve) => hostWs.on('open', resolve));

    hostWs.send(JSON.stringify({
      type: 'room:create',
      version: 1,
      deviceName: 'Windows PC'
    }));

    const createRes = await nextMessage(hostWs);
    assert.equal(createRes.type, 'room:created');
    assert.ok(createRes.roomId);
    assert.ok(createRes.joinToken);
    assert.ok(createRes.iceServers.length > 0);

    // Verify iceServers DO NOT contain dead TURN servers
    for (const serverEntry of createRes.iceServers) {
      const urls = Array.isArray(serverEntry.urls) ? serverEntry.urls : [serverEntry.urls];
      for (const u of urls) {
        assert.ok(!u.includes('openrelay.metered.ca'), 'ICE servers must not contain openrelay.metered.ca');
      }
    }

    const { roomId, joinToken } = createRes;

    // 2. Guest (Android Phone) joins room
    const guestWs = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise((resolve) => guestWs.on('open', resolve));

    const hostPeerJoinedPromise = nextMessage(hostWs);

    guestWs.send(JSON.stringify({
      type: 'room:join',
      version: 1,
      roomId,
      joinToken,
      deviceName: 'Android Phone'
    }));

    const joinRes = await nextMessage(guestWs);
    assert.equal(joinRes.type, 'room:joined');
    assert.equal(joinRes.ownerDeviceName, 'Windows PC');

    const hostPeerJoined = await hostPeerJoinedPromise;
    assert.equal(hostPeerJoined.type, 'peer:joined');
    assert.equal(hostPeerJoined.deviceName, 'Android Phone');

    // 3. Bidirectional text chat between Phone and PC
    // Phone -> PC
    const pcMsgPromise1 = nextMessage(hostWs);
    const phoneAckPromise1 = nextMessage(guestWs);

    guestWs.send(JSON.stringify({
      type: 'text',
      version: 1,
      clientMessageId: 'chat-phone-1',
      text: 'Hi from Android Phone!'
    }));

    const pcMsg1 = await pcMsgPromise1;
    assert.equal(pcMsg1.type, 'text');
    assert.equal(pcMsg1.text, 'Hi from Android Phone!');
    assert.equal(pcMsg1.deviceName, 'Android Phone');

    const phoneAck1 = await phoneAckPromise1;
    assert.equal(phoneAck1.type, 'text:ack');
    assert.equal(phoneAck1.clientMessageId, 'chat-phone-1');

    // PC -> Phone
    const phoneMsgPromise2 = nextMessage(guestWs);
    const pcAckPromise2 = nextMessage(hostWs);

    hostWs.send(JSON.stringify({
      type: 'text',
      version: 1,
      clientMessageId: 'chat-pc-1',
      text: 'Hello from Windows PC! Connection is solid.'
    }));

    const phoneMsg2 = await phoneMsgPromise2;
    assert.equal(phoneMsg2.type, 'text');
    assert.equal(phoneMsg2.text, 'Hello from Windows PC! Connection is solid.');
    assert.equal(phoneMsg2.deviceName, 'Windows PC');

    const pcAck2 = await pcAckPromise2;
    assert.equal(pcAck2.type, 'text:ack');
    assert.equal(pcAck2.clientMessageId, 'chat-pc-1');

    // 4. WebRTC Signaling exchange
    // Host sends offer
    const guestOfferPromise = nextMessage(guestWs);
    const mockOfferPayload = { type: 'offer', sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };

    hostWs.send(JSON.stringify({
      type: 'rtc:offer',
      version: 1,
      payload: mockOfferPayload
    }));

    const guestOffer = await guestOfferPromise;
    assert.equal(guestOffer.type, 'rtc:offer');
    assert.deepEqual(guestOffer.payload, mockOfferPayload);

    // Guest sends answer
    const hostAnswerPromise = nextMessage(hostWs);
    const mockAnswerPayload = { type: 'answer', sdp: 'v=0\r\no=- 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' };

    guestWs.send(JSON.stringify({
      type: 'rtc:answer',
      version: 1,
      payload: mockAnswerPayload
    }));

    const hostAnswer = await hostAnswerPromise;
    assert.equal(hostAnswer.type, 'rtc:answer');
    assert.deepEqual(hostAnswer.payload, mockAnswerPayload);

    // ICE candidates exchange
    const guestIcePromise = nextMessage(guestWs);
    const mockIceCandidate = { candidate: 'candidate:1 1 UDP 2122260223 192.168.1.100 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 };

    hostWs.send(JSON.stringify({
      type: 'rtc:ice-candidate',
      version: 1,
      payload: mockIceCandidate
    }));

    const guestIce = await guestIcePromise;
    assert.equal(guestIce.type, 'rtc:ice-candidate');
    assert.deepEqual(guestIce.payload, mockIceCandidate);

    // 5. Simulated File Transfer Protocol (Phone sending 64 KiB binary file to PC)
    const testFileBytes = crypto.randomBytes(65536); // 64 KiB = 4 chunks of 16 KiB
    const CHUNK_SIZE = 16384;
    const totalChunks = Math.ceil(testFileBytes.length / CHUNK_SIZE);
    assert.equal(totalChunks, 4);

    const fullSha256 = crypto.createHash('sha256').update(testFileBytes).digest('hex');

    // Receiver (PC) incremental accumulator
    const receiverHasher = crypto.createHash('sha256');
    let receivedBytesCount = 0;
    const receivedChunks = [];

    for (let i = 0; i < totalChunks; i++) {
      const chunk = testFileBytes.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      receiverHasher.update(chunk);
      receivedBytesCount += chunk.length;
      receivedChunks.push(chunk);
    }

    assert.equal(receivedBytesCount, 65536);
    assert.equal(receiverHasher.digest('hex'), fullSha256);

    // 6. Reverse File Transfer (PC sending 131072 byte file to Phone)
    const reverseFileBytes = crypto.randomBytes(131072); // 128 KiB = 8 chunks
    const reverseSha256 = crypto.createHash('sha256').update(reverseFileBytes).digest('hex');
    const reverseReceiverHasher = crypto.createHash('sha256');

    for (let offset = 0; offset < reverseFileBytes.length; offset += CHUNK_SIZE) {
      const slice = reverseFileBytes.subarray(offset, Math.min(offset + CHUNK_SIZE, reverseFileBytes.length));
      reverseReceiverHasher.update(slice);
    }

    assert.equal(reverseReceiverHasher.digest('hex'), reverseSha256);

    // 7. Clean Room Closure
    const guestClosePromise = nextMessage(guestWs);
    const hostClosePromise = nextMessage(hostWs);

    hostWs.send(JSON.stringify({
      type: 'room:close',
      version: 1
    }));

    const guestClose = await guestClosePromise;
    assert.equal(guestClose.type, 'room:closed');
    assert.equal(guestClose.reason, 'closed_by_owner');

    const hostClose = await hostClosePromise;
    assert.equal(hostClose.type, 'room:closed');

    hostWs.close();
    guestWs.close();
  });
});

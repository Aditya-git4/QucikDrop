import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import WebSocket from 'ws';
import { RoomManager } from '../../src/rooms/roomManager.js';
import { createSignalingServer } from '../../src/websocket/signalingServer.js';

describe('Signaling Server FIFO Message Ordering', () => {
  it('processes messages arriving in rapid succession on the same socket strictly in FIFO order', async () => {
    const app = express();
    const server = http.createServer(app);
    const roomManager = new RoomManager();
    const wss = createSignalingServer(server, roomManager);

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const wsUrl = `ws://127.0.0.1:${port}/ws`;

    const clientWs = new WebSocket(wsUrl, { headers: { origin: 'http://localhost:5173' } });
    await new Promise((resolve) => clientWs.on('open', resolve));

    const receivedMessages = [];
    clientWs.on('message', (data) => {
      try {
        receivedMessages.push(JSON.parse(data.toString()));
      } catch (err) {
        // Ignored
      }
    });

    // Send room:create followed immediately by another message without awaiting the response
    clientWs.send(JSON.stringify({
      type: 'room:create',
      version: 1,
      deviceName: 'Test Host'
    }));

    // Followed immediately by a second message (which will be processed second in FIFO order)
    clientWs.send(JSON.stringify({
      type: 'invalid:type',
      version: 1
    }));

    // Wait until both responses have arrived
    const startTime = Date.now();
    while (receivedMessages.length < 2 && Date.now() - startTime < 3000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.equal(receivedMessages.length, 2, 'Must receive responses for both messages');
    
    // First response must be room:created from the first message
    assert.equal(receivedMessages[0].type, 'room:created', 'First response must correspond to room:create');
    assert.ok(receivedMessages[0].roomId);
    assert.ok(receivedMessages[0].joinToken);

    // Second response must be the error for the second message
    assert.equal(receivedMessages[1].type, 'room:error', 'Second response must correspond to the second message');
    assert.equal(receivedMessages[1].code, 'UNKNOWN_TYPE');

    clientWs.close();
    wss.close();
    await new Promise((resolve) => server.close(resolve));
    roomManager.dispose();
  });
});

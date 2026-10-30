import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import WebSocket from 'ws';
import { RoomManager } from '../../src/rooms/roomManager.js';
import { createSignalingServer } from '../../src/websocket/signalingServer.js';
import { defaultRelayLimiter } from '../../src/websocket/relayLimiter.js';

describe('Relay Memory Flat Integration Test (200 MB Relayed Stream)', { timeout: 60000 }, () => {
  let server;
  let roomManager;
  let wss;
  let wsUrl;
  let port;

  before(async () => {
    defaultRelayLimiter.reset();
    const app = express();
    roomManager = new RoomManager({
      roomTtlMs: 120000,
      maxRoomLifetimeMs: 300000,
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
    defaultRelayLimiter.reset();
  });

  function waitForJson(ws, predicate) {
    return new Promise((resolve) => {
      const handler = (data, isBinary) => {
        if (isBinary) return;
        try {
          const parsed = JSON.parse(data.toString());
          if (!predicate || predicate(parsed)) {
            ws.removeListener('message', handler);
            resolve(parsed);
          }
        } catch {
          // ignore non-json
        }
      };
      ws.on('message', handler);
    });
  }

  it('streams a 200 MB file over WebSocket relay with ACK credits while keeping server memory flat', async () => {
    const ownerWs = new WebSocket(wsUrl);
    const joinerWs = new WebSocket(wsUrl);

    await Promise.all([
      new Promise((res) => ownerWs.on('open', res)),
      new Promise((res) => joinerWs.on('open', res))
    ]);

    // 1. Owner creates room
    const ownerCreatedPromise = waitForJson(ownerWs, (m) => m.type === 'room:created');
    ownerWs.send(JSON.stringify({ type: 'room:create', version: 1, deviceName: 'Sender Device', autoApprove: true }));
    const createdMsg = await ownerCreatedPromise;
    const { roomId, joinToken } = createdMsg;

    // 2. Joiner joins room
    const ownerPeerJoinedPromise = waitForJson(ownerWs, (m) => m.type === 'peer:joined');
    const joinerJoinedPromise = waitForJson(joinerWs, (m) => m.type === 'room:joined');
    joinerWs.send(JSON.stringify({
      type: 'room:join',
      version: 1,
      roomId,
      joinToken,
      deviceName: 'Receiver Device'
    }));

    await Promise.all([ownerPeerJoinedPromise, joinerJoinedPromise]);

    // 3. Sender sends file:start for a 200 MB file
    const TOTAL_BYTES = 200 * 1024 * 1024; // 200 MiB = 209,715,200 bytes
    const CHUNK_SIZE = 16384; // 16 KiB
    const TOTAL_CHUNKS = Math.ceil(TOTAL_BYTES / CHUNK_SIZE); // 12,800 chunks
    const ACK_INTERVAL = 256 * 1024; // 256 KiB
    const MAX_IN_FLIGHT = 1024 * 1024; // 1 MiB window

    const receiverReadyPromise = waitForJson(ownerWs, (m) => m.type === 'file:ready');
    ownerWs.send(JSON.stringify({
      type: 'file:start',
      version: 1,
      transferId: 'transfer-200mb-bench',
      streamId: 42,
      fileName: 'benchmark-200mb.dat',
      fileSize: TOTAL_BYTES,
      totalChunks: TOTAL_CHUNKS,
      chunkSize: CHUNK_SIZE
    }));

    // Joiner answers file:ready
    const receiverGotStartPromise = waitForJson(joinerWs, (m) => m.type === 'file:start');
    await receiverGotStartPromise;

    joinerWs.send(JSON.stringify({
      type: 'file:ready',
      version: 1,
      transferId: 'transfer-200mb-bench',
      streamId: 42,
      chunkSize: CHUNK_SIZE
    }));

    await receiverReadyPromise;

    // 4. Force GC if available or wait a tick to stabilize baseline RSS
    if (global.gc) global.gc();
    await new Promise((r) => setTimeout(r, 100));

    const initialMemory = process.memoryUsage();
    const initialRssMb = initialMemory.rss / (1024 * 1024);
    const initialHeapMb = initialMemory.heapUsed / (1024 * 1024);

    console.log(`\n[MEMORY BENCHMARK BEFORE 200 MB STREAM] RSS=${initialRssMb.toFixed(2)} MB, HeapUsed=${initialHeapMb.toFixed(2)} MB`);

    // Setup receiver chunk tracking and ACK sending
    let receiverReceivedBytes = 0;
    let receiverLastAckedBytes = 0;
    let receiverReceivedChunks = 0;

    const transferCompletePromise = new Promise((resolve) => {
      joinerWs.on('message', (data, isBinary) => {
        if (!isBinary) return;
        const payloadLength = data.length - 8; // subtract 8-byte header
        receiverReceivedBytes += payloadLength;
        receiverReceivedChunks++;

        // Send ACK back on WebSocket after every 256 KiB received or on final chunk
        if (
          receiverReceivedBytes - receiverLastAckedBytes >= ACK_INTERVAL ||
          receiverReceivedBytes >= TOTAL_BYTES
        ) {
          receiverLastAckedBytes = receiverReceivedBytes;
          joinerWs.send(JSON.stringify({
            type: 'file:ack',
            version: 1,
            transferId: 'transfer-200mb-bench',
            streamId: 42,
            bytesReceived: receiverReceivedBytes
          }));
        }

        if (receiverReceivedBytes >= TOTAL_BYTES) {
          resolve();
        }
      });
    });

    // Sender ACK tracking
    let senderAckedBytes = 0;
    let senderSentBytes = 0;
    let resolveSenderWait = null;

    ownerWs.on('message', (data, isBinary) => {
      if (isBinary) return;
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'file:ack' && msg.streamId === 42) {
          senderAckedBytes = msg.bytesReceived;
          if (resolveSenderWait) {
            const cb = resolveSenderWait;
            resolveSenderWait = null;
            cb();
          }
        }
      } catch {
        // ignore
      }
    });

    // Reuse a pre-allocated chunk buffer with header to simulate sender
    const chunkBuffer = Buffer.alloc(CHUNK_SIZE + 8);
    chunkBuffer.writeUInt32BE(42, 0); // streamId

    // 5. Sender loop: streams all 12,800 chunks respecting 1 MiB in-flight credit window
    for (let i = 0; i < TOTAL_CHUNKS; i++) {
      // Pause if in-flight window exceeds 1 MiB
      while (senderSentBytes - senderAckedBytes >= MAX_IN_FLIGHT) {
        await new Promise((res) => {
          resolveSenderWait = res;
        });
      }

      const currentPayloadSize = Math.min(CHUNK_SIZE, TOTAL_BYTES - senderSentBytes);
      chunkBuffer.writeUInt32BE(i, 4); // chunkIndex

      const sliceToSend = currentPayloadSize === CHUNK_SIZE
        ? chunkBuffer
        : chunkBuffer.subarray(0, currentPayloadSize + 8);

      ownerWs.send(sliceToSend);
      senderSentBytes += currentPayloadSize;

      // Yield loop periodically so I/O ticks can process
      if (i % 64 === 0) {
        await new Promise((r) => setImmediate(r));
      }
    }

    // Wait for receiver to finish receiving all 200 MB
    await transferCompletePromise;

    assert.equal(receiverReceivedBytes, TOTAL_BYTES, 'Receiver must receive exact 200 MB total bytes');
    assert.equal(receiverReceivedChunks, TOTAL_CHUNKS, 'Receiver must receive exact 12,800 chunks');

    // 6. Measure memory after 200 MB relayed transfer
    if (global.gc) global.gc();
    await new Promise((r) => setTimeout(r, 100));

    const finalMemory = process.memoryUsage();
    const finalRssMb = finalMemory.rss / (1024 * 1024);
    const finalHeapMb = finalMemory.heapUsed / (1024 * 1024);
    const deltaRssMb = finalRssMb - initialRssMb;

    console.log(`[MEMORY BENCHMARK AFTER 200 MB STREAM] RSS=${finalRssMb.toFixed(2)} MB, HeapUsed=${finalHeapMb.toFixed(2)} MB, DeltaRSS=${deltaRssMb.toFixed(2)} MB\n`);

    // Memory must remain flat: if the server buffered 200 MB, RSS would spike by 200+ MB.
    // Flow control keeps in-flight data <= 1 MiB, so RSS delta must stay well under 45 MB.
    assert.ok(
      deltaRssMb < 45,
      `Server memory RSS delta (${deltaRssMb.toFixed(2)} MB) must be flat and far below 200 MB`
    );

    ownerWs.close();
    joinerWs.close();
  });
});

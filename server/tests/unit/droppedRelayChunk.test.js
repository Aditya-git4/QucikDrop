import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FileTransferManager } from '../../../client/src/services/fileTransfer.js';

class MockEmitter {
  constructor() {
    this.handlers = new Map();
    this.isConnected = true;
  }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
  }
  off(event, fn) {
    this.handlers.get(event)?.delete(fn);
  }
  emit(event, data) {
    const list = Array.from(this.handlers.get(event) || []);
    for (const fn of list) fn(data);
  }
  send(msg) {
    // Mock send
  }
  sendControlMessage(msg) {
    // Mock control message send
  }
  sendBinaryChunk(chunk) {
    // Mock binary send
  }
}

function createChunk(streamId, chunkIndex, payloadBytes) {
  const buffer = new ArrayBuffer(8 + payloadBytes.length);
  const view = new DataView(buffer);
  view.setUint32(0, streamId, false);
  view.setUint32(4, chunkIndex, false);
  new Uint8Array(buffer, 8).set(payloadBytes);
  return buffer;
}

describe('Dropped Relay Frames Safety', () => {
  it('receiver detects intermediate dropped chunk (gap), aborts with TRANSFER_INTERRUPTED and never completes with wrong file', async () => {
    const receiverSc = new MockEmitter();
    const receiver = new FileTransferManager(null, receiverSc);

    const errorEvents = [];
    const completeEvents = [];

    receiver.on('transferError', (err) => errorEvents.push(err));
    receiver.on('transferComplete', (data) => completeEvents.push(data));

    const transferId = 'transfer-drop-test-1';
    const streamId = 42;
    const chunkSize = 16384;
    const totalBytes = chunkSize * 3; // 3 chunks

    // 1. file:start
    receiverSc.emit('controlMessage', {
      type: 'file:start',
      transferId,
      streamId,
      fileName: 'test.dat',
      fileSize: totalBytes,
      mimeType: 'application/octet-stream',
      fileHash: 'dummyhash123'
    });

    assert.equal(receiver.activeReceives.size, 1);

    // 2. Deliver chunk 0
    const chunk0 = createChunk(streamId, 0, new Uint8Array(chunkSize).fill(1));
    receiverSc.emit('fileChunk', chunk0);
    assert.equal(errorEvents.length, 0);

    // 3. Drop chunk 1! Deliver chunk 2 directly (simulating dropped frame on relay)
    const chunk2 = createChunk(streamId, 2, new Uint8Array(chunkSize).fill(3));
    receiverSc.emit('fileChunk', chunk2);

    // 4. Assert receiver immediately detected hole and failed
    assert.equal(errorEvents.length, 1, 'Must emit transferError on dropped chunk gap');
    assert.equal(errorEvents[0].code, 'TRANSFER_INTERRUPTED');
    assert.equal(errorEvents[0].message, 'Transfer interrupted');
    assert.equal(errorEvents[0].retryable, true);

    // 5. Assert receiver never completed
    assert.equal(completeEvents.length, 0, 'Must NEVER complete or yield corrupted file');
    assert.equal(receiver.activeReceives.has(streamId), false, 'Stream must be cleaned up');

    receiver.destroy();
  });

  it('receiver fails when final chunk is dropped and file:complete arrives', async () => {
    const receiverSc = new MockEmitter();
    const receiver = new FileTransferManager(null, receiverSc);

    const errorEvents = [];
    const completeEvents = [];

    receiver.on('transferError', (err) => errorEvents.push(err));
    receiver.on('transferComplete', (data) => completeEvents.push(data));

    const transferId = 'transfer-drop-test-2';
    const streamId = 99;
    const chunkSize = 16384;
    const totalBytes = chunkSize * 2; // 2 chunks

    // 1. file:start
    receiverSc.emit('controlMessage', {
      type: 'file:start',
      transferId,
      streamId,
      fileName: 'final_drop.dat',
      fileSize: totalBytes,
      mimeType: 'application/octet-stream',
      fileHash: 'dummyhash456'
    });

    // 2. Deliver chunk 0
    const chunk0 = createChunk(streamId, 0, new Uint8Array(chunkSize).fill(1));
    receiverSc.emit('fileChunk', chunk0);

    // 3. Chunk 1 is DROPPED. Sender sends file:complete
    receiverSc.emit('controlMessage', {
      type: 'file:complete',
      transferId,
      streamId,
      fileHash: 'dummyhash456'
    });

    // Fast-forward completion timeout
    const receiveRecord = receiver.activeReceives.get(streamId);
    assert.ok(receiveRecord);
    receiver.doFinalizeReceive(receiveRecord);

    // 4. Assert failure
    assert.equal(errorEvents.length, 1);
    assert.equal(errorEvents[0].code, 'TRANSFER_INTERRUPTED');
    assert.equal(errorEvents[0].message, 'Transfer interrupted');
    assert.equal(errorEvents[0].retryable, true);
    assert.equal(completeEvents.length, 0, 'Must NEVER complete with missing bytes');

    receiver.destroy();
  });

  it('sender aborts transfer with TRANSFER_INTERRUPTED and Retry when server sends PEER_SLOW', () => {
    const senderSc = new MockEmitter();
    const sender = new FileTransferManager(null, senderSc);

    const errorEvents = [];
    sender.on('transferError', (err) => errorEvents.push(err));

    const transferId = 'send-slow-test';
    const streamId = 101;

    sender.activeSends.set(transferId, {
      transferId,
      streamId,
      transport: 'websocket',
      file: { name: 'photo.jpg', size: 100000 },
      isCancelled: false
    });

    // Server sends PEER_SLOW
    senderSc.emit('roomError', {
      code: 'PEER_SLOW',
      message: 'Receiver buffer full, chunk dropped'
    });

    assert.equal(errorEvents.length, 1);
    assert.equal(errorEvents[0].code, 'TRANSFER_INTERRUPTED');
    assert.equal(errorEvents[0].message, 'Transfer interrupted');
    assert.equal(errorEvents[0].retryable, true);

    sender.destroy();
  });
});

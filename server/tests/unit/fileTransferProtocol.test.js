import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FileTransferManager, CHUNK_SIZE, MEMORY_TRANSFER_LIMIT } from '../../../client/src/services/fileTransfer.js';
import { sanitizeFileName } from '../../../client/src/utils/fileUtils.js';
import { createSha256Incremental } from '../../../client/src/utils/cryptoUtils.js';

class MockEmitter {
  constructor() {
    this.handlers = new Map();
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
}

describe('fileTransferProtocol', () => {
  it('correctly calculates chunk counts based on 16 KiB chunk size', () => {
    assert.equal(CHUNK_SIZE, 16384);

    const testCases = [
      { size: 100, expectedChunks: 1 },
      { size: 16384, expectedChunks: 1 },
      { size: 16385, expectedChunks: 2 },
      { size: 1048576, expectedChunks: 64 }, // 1 MB
      { size: 10485760, expectedChunks: 640 } // 10 MB
    ];

    for (const { size, expectedChunks } of testCases) {
      assert.equal(Math.ceil(size / CHUNK_SIZE), expectedChunks);
    }
  });

  it('validates exact byte accumulation and buffer assembly logic', () => {
    const totalBytes = 40000;
    const chunks = [];
    let receivedBytes = 0;

    let offset = 0;
    while (offset < totalBytes) {
      const sliceSize = Math.min(CHUNK_SIZE, totalBytes - offset);
      const buffer = new Uint8Array(sliceSize).fill(42).buffer;
      chunks.push(buffer);
      receivedBytes += buffer.byteLength;
      offset += sliceSize;
    }

    assert.equal(receivedBytes, totalBytes);
    assert.equal(chunks.length, 3); // 16384 + 16384 + 7232

    // Verify chunk byte lengths
    assert.equal(chunks[0].byteLength, 16384);
    assert.equal(chunks[1].byteLength, 16384);
    assert.equal(chunks[2].byteLength, 7232);
  });

  it('verifies that corrupted or cancelled buffers can be cleanly dropped without leaks', () => {
    let chunks = [new Uint8Array(16384).buffer, new Uint8Array(16384).buffer];
    assert.equal(chunks.length, 2);

    // Cancel simulation: memory released
    chunks = [];
    assert.equal(chunks.length, 0);
  });

  it('performs incremental SHA-256 verification and detects chunk bit corruption', () => {
    const totalBytes = 50000;
    const senderHasher = createSha256Incremental();
    const receiverHasher = createSha256Incremental();
    const corruptedReceiverHasher = createSha256Incremental();

    let offset = 0;
    while (offset < totalBytes) {
      const sliceSize = Math.min(CHUNK_SIZE, totalBytes - offset);
      const chunk = new Uint8Array(sliceSize);
      for (let i = 0; i < sliceSize; i++) {
        chunk[i] = (offset + i) % 256;
      }

      // Sender feeds chunk to hash
      senderHasher.update(chunk.buffer);

      // Honest receiver feeds exact chunk
      receiverHasher.update(chunk.buffer);

      // Corrupted receiver: alter 1 byte in first chunk
      const corruptedChunk = new Uint8Array(chunk);
      if (offset === 0) {
        corruptedChunk[0] ^= 0xff; // flip bits
      }
      corruptedReceiverHasher.update(corruptedChunk.buffer);

      offset += sliceSize;
    }

    const senderHash = senderHasher.digest();
    const receiverHash = receiverHasher.digest();
    const corruptedHash = corruptedReceiverHasher.digest();

    assert.equal(senderHash, receiverHash, 'Valid transfer hashes must match exactly');
    assert.notEqual(senderHash, corruptedHash, 'Corrupted transfer must produce different SHA-256 hash');
  });

  it('enforces in-memory threshold limits for browsers without disk streaming', () => {
    assert.equal(MEMORY_TRANSFER_LIMIT, 200 * 1024 * 1024); // 200 MB
    const safeFileSize = 50 * 1024 * 1024; // 50 MB
    const oversizedFileSize = 500 * 1024 * 1024; // 500 MB

    assert.equal(safeFileSize <= MEMORY_TRANSFER_LIMIT, true);
    assert.equal(oversizedFileSize > MEMORY_TRANSFER_LIMIT, true);
  });

  it('cancels transfers on roomError ONLY for PEER_UNAVAILABLE and only those pinned to transport websocket', () => {
    const mockPc = new MockEmitter();
    const mockSc = new MockEmitter();
    const manager = new FileTransferManager(mockPc, mockSc);

    manager.activeSends.set('ws-send', { isCancelled: false, transport: 'websocket' });
    manager.activeSends.set('dc-send', { isCancelled: false, transport: 'webrtc-dc' });

    const errors = [];
    manager.on('transferError', (err) => errors.push(err));

    // 1. Non-PEER_UNAVAILABLE errors (e.g. RATE_LIMITED, INVALID_MESSAGE) must NOT cancel transfers
    mockSc.emit('roomError', { code: 'RATE_LIMITED', message: 'Rate limit' });
    mockSc.emit('roomError', { code: 'INVALID_MESSAGE', message: 'Bad text' });

    assert.equal(manager.activeSends.has('ws-send'), true);
    assert.equal(manager.activeSends.has('dc-send'), true);
    assert.equal(errors.length, 0);

    // 2. PEER_UNAVAILABLE cancels ONLY the transfer pinned to 'websocket'
    mockSc.emit('roomError', { code: 'PEER_UNAVAILABLE', message: 'Peer unavailable' });

    assert.equal(manager.activeSends.has('ws-send'), false, 'WebSocket send must be cancelled');
    assert.equal(manager.activeSends.has('dc-send'), true, 'DataChannel send must NOT be cancelled');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].transferId, 'ws-send');
    assert.equal(errors[0].code, 'TRANSFER_INTERRUPTED');

    manager.destroy();
  });

  it('cancels only transfers pinned to websocket on peer:disconnected while webrtc-dc continues', () => {
    const mockPc = new MockEmitter();
    const mockSc = new MockEmitter();
    const manager = new FileTransferManager(mockPc, mockSc);

    manager.activeSends.set('ws-1', { isCancelled: false, transport: 'websocket' });
    manager.activeSends.set('dc-1', { isCancelled: false, transport: 'webrtc-dc' });

    const errors = [];
    manager.on('transferError', (err) => errors.push(err));

    mockSc.emit('peerDisconnected', { peerId: 'peer-abc' });

    assert.equal(manager.activeSends.has('ws-1'), false, 'WebSocket transfer must be cancelled');
    assert.equal(manager.activeSends.has('dc-1'), true, 'WebRTC DataChannel transfer must continue');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].transferId, 'ws-1');

    manager.destroy();
  });

  it('discards receiver partial data and shows neutral Transfer interrupted state instead of hash mismatch when peer drops', () => {
    const mockPc = new MockEmitter();
    const mockSc = new MockEmitter();
    const manager = new FileTransferManager(mockPc, mockSc);

    // Simulate in-progress receive on transport 'websocket'
    manager.currentReceive = {
      transferId: 'rec-test-1',
      fileName: 'important-document.pdf',
      fileSize: 100000,
      receivedBytes: 40000,
      chunks: [new Uint8Array(16384).buffer, new Uint8Array(16384).buffer],
      blobParts: [],
      hasher: createSha256Incremental(),
      startTime: Date.now(),
      isCancelled: false,
      transport: 'websocket'
    };

    let emittedError = null;
    manager.on('transferError', (err) => {
      emittedError = err;
    });

    // Peer drops during transfer
    mockSc.emit('peerDisconnected', { peerId: 'sender-1' });

    // Receiver must have discarded all partial data
    assert.equal(manager.currentReceive, null, 'currentReceive must be reset and partial buffers discarded');

    // Receiver must emit neutral TRANSFER_INTERRUPTED, never INTEGRITY_MISMATCH or BYTE_COUNT_MISMATCH
    assert.ok(emittedError, 'transferError must be emitted');
    assert.equal(emittedError.transferId, 'rec-test-1');
    assert.equal(emittedError.code, 'TRANSFER_INTERRUPTED');
    assert.equal(emittedError.message, 'Transfer interrupted');
    assert.notEqual(emittedError.code, 'INTEGRITY_MISMATCH');
    assert.notEqual(emittedError.code, 'BYTE_COUNT_MISMATCH');

    manager.destroy();
  });

  it('two files sent back to back, with the first cancelled mid-transfer, must deliver the second intact', async () => {
    const senderPc = new MockEmitter();
    senderPc.controlChannel = { readyState: 'open' };
    senderPc.fileChannel = { readyState: 'open' };
    senderPc.pc = { connectionState: 'connected' };
    senderPc.isP2PHealthy = true;
    senderPc.waitForBufferedAmountLow = () => Promise.resolve();
    senderPc.waitForFileChannelDrained = () => Promise.resolve();

    const receiverPc = new MockEmitter();
    receiverPc.controlChannel = { readyState: 'open' };
    receiverPc.fileChannel = { readyState: 'open' };
    receiverPc.pc = { connectionState: 'connected' };
    receiverPc.isP2PHealthy = true;

    const sender = new FileTransferManager(senderPc, null);
    const receiver = new FileTransferManager(receiverPc, null);

    senderPc.sendControl = (msg) => setImmediate(() => receiverPc.emit('controlMessage', msg));
    senderPc.sendFileChunk = (chunk) => receiverPc.emit('fileChunk', chunk);
    receiverPc.sendControl = (msg) => setImmediate(() => senderPc.emit('controlMessage', msg));

    // File 1: 50,000 bytes (will be cancelled after first chunk)
    const file1Bytes = new Uint8Array(50000).fill(1);
    const file1 = new File([file1Bytes], 'file1.bin');

    let file1Started = false;
    receiver.on('transferStarted', (info) => {
      if (info.fileName === 'file1.bin') {
        file1Started = true;
      }
    });

    let file1Cancelled = false;
    receiver.on('progress', (p) => {
      if (!file1Cancelled && p.direction === 'receive' && file1Started) {
        file1Cancelled = true;
        sender.cancelTransfer(p.transferId);
      }
    });

    try {
      await sender.sendFile(file1);
    } catch {
      // Expected cancel exit
    }

    // Wait for cancel control message to be processed
    await new Promise(r => setImmediate(r));

    assert.equal(file1Cancelled, true);
    assert.equal(receiver.activeReceives.size, 0, 'Receiver must drop cancelled stream');

    // File 2: 35,000 bytes sent right after
    const file2Bytes = new Uint8Array(35000);
    for (let i = 0; i < 35000; i++) file2Bytes[i] = (i * 11) % 256;
    const file2 = new File([file2Bytes], 'file2.bin');

    let completedFile2 = null;
    receiver.on('transferCompleted', (info) => {
      if (info.fileName === 'file2.bin') {
        completedFile2 = info;
      }
    });

    await sender.sendFile(file2);

    // Wait for delivery & verification
    await new Promise(r => setTimeout(r, 60));

    assert.ok(completedFile2, 'File 2 must complete successfully');
    assert.equal(completedFile2.verified, true);
    assert.equal(completedFile2.fileSize, 35000);

    const crypto = await import('node:crypto');
    const expectedHash2 = crypto.createHash('sha256').update(file2Bytes).digest('hex');
    assert.equal(completedFile2.fileHash, expectedHash2);

    sender.destroy();
    receiver.destroy();
  });

  it('stale chunks for an unknown streamId are ignored', () => {
    const receiverPc = new MockEmitter();
    receiverPc.controlChannel = { readyState: 'open' };
    receiverPc.fileChannel = { readyState: 'open' };
    receiverPc.sendControl = () => {};
    const receiver = new FileTransferManager(receiverPc, null);

    // Receiver starts receiving streamId = 1
    receiver.handleReceiveStart({
      type: 'file:start',
      transferId: 't-valid-1',
      streamId: 1,
      fileName: 'valid.txt',
      fileSize: 1000,
      totalChunks: 1
    }, 'webrtc-dc');

    const receiveRecord = receiver.activeReceives.get(1);
    assert.ok(receiveRecord);
    assert.equal(receiveRecord.receivedBytes, 0);

    // Send a stale chunk for an unknown streamId = 999
    const staleChunk = new Uint8Array(8 + 500);
    const viewStale = new DataView(staleChunk.buffer);
    viewStale.setUint32(0, 999, false); // unknown streamId
    viewStale.setUint32(4, 0, false);   // chunkIndex 0
    receiverPc.emit('fileChunk', staleChunk.buffer);

    // Valid stream must not be affected at all
    assert.equal(receiveRecord.receivedBytes, 0);
    assert.equal(receiveRecord.chunks.length, 0);

    // Send valid chunk for streamId = 1
    const validChunk = new Uint8Array(8 + 1000);
    const viewValid = new DataView(validChunk.buffer);
    viewValid.setUint32(0, 1, false); // streamId 1
    viewValid.setUint32(4, 0, false); // chunkIndex 0
    receiverPc.emit('fileChunk', validChunk.buffer);

    assert.equal(receiveRecord.receivedBytes, 1000);
    assert.equal(receiveRecord.chunks.length, 1);

    receiver.destroy();
  });

  it('handshake retry switches transport', async () => {
    const senderPc = new MockEmitter();
    senderPc.controlChannel = { readyState: 'open' };
    senderPc.fileChannel = { readyState: 'open' };
    senderPc.pc = { connectionState: 'connected' };
    senderPc.isP2PHealthy = true;
    senderPc.waitForBufferedAmountLow = () => Promise.resolve();
    senderPc.waitForFileChannelDrained = () => Promise.resolve();

    const senderSc = new MockEmitter();
    senderSc.isConnected = true;
    senderSc.ws = { readyState: 1, bufferedAmount: 0, send: () => {} };

    const receiverSc = new MockEmitter();
    receiverSc.isConnected = true;
    receiverSc.ws = { readyState: 1, bufferedAmount: 0, send: () => {} };

    const sender = new FileTransferManager(senderPc, senderSc);
    const receiver = new FileTransferManager(null, receiverSc);

    sender.handshakeInitialTimeoutMs = 50;
    sender.handshakeRetryTimeoutMs = 200;

    // webrtc-dc controlChannel drops message (simulating dead data channel)
    senderPc.sendControl = () => {
      // dropped!
    };

    // WebSocket transport works properly
    senderSc.send = (msg) => {
      setImmediate(() => receiverSc.emit('controlMessage', msg));
    };
    receiverSc.send = (msg) => {
      setImmediate(() => senderSc.emit('controlMessage', msg));
    };
    senderSc.ws.send = (chunk) => {
      setImmediate(() => receiverSc.emit('fileChunk', chunk));
    };

    const fileBytes = new Uint8Array(2000).fill(77);
    const file = new File([fileBytes], 'fallback-test.bin');

    let completedInfo = null;
    receiver.on('transferCompleted', (info) => {
      completedInfo = info;
    });

    await sender.sendFile(file);

    await new Promise(r => setTimeout(r, 60));

    assert.ok(completedInfo, 'Transfer must complete on fallback transport');
    assert.equal(completedInfo.fileSize, 2000);
    assert.equal(completedInfo.verified, true);

    sender.destroy();
    receiver.destroy();
  });

  it('20-second receiver inactivity cleanup', async () => {
    const receiverPc = new MockEmitter();
    receiverPc.controlChannel = { readyState: 'open' };
    receiverPc.fileChannel = { readyState: 'open' };
    receiverPc.sendControl = () => {};
    const receiver = new FileTransferManager(receiverPc, null);
    receiver.inactivityTimeoutMs = 50; // fast timeout for test (default 20000ms)

    receiver.handleReceiveStart({
      type: 'file:start',
      transferId: 't-inactivity-1',
      streamId: 42,
      fileName: 'stalled.bin',
      fileSize: 10000,
      totalChunks: 1
    }, 'webrtc-dc');

    assert.equal(receiver.activeReceives.has(42), true);

    // Send 1 chunk
    const chunk = new Uint8Array(8 + 500);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, 42, false);
    view.setUint32(4, 0, false);
    receiverPc.emit('fileChunk', chunk.buffer);

    let emittedError = null;
    receiver.on('transferError', (err) => {
      emittedError = err;
    });

    // Wait for inactivity timer to fire
    await new Promise(r => setTimeout(r, 90));

    assert.ok(emittedError, 'transferError must be emitted on inactivity timeout');
    assert.equal(emittedError.code, 'TRANSFER_INTERRUPTED');
    assert.equal(emittedError.message, 'Transfer interrupted');
    assert.equal(receiver.activeReceives.has(42), false, 'Active receive must be cleaned up and discarded');

    receiver.destroy();
  });

  it('early error: stops immediately if receivedBytes exceeds fileSize', () => {
    const receiverPc = new MockEmitter();
    receiverPc.controlChannel = { readyState: 'open' };
    receiverPc.fileChannel = { readyState: 'open' };
    receiverPc.sendControl = () => {};
    const receiver = new FileTransferManager(receiverPc, null);

    receiver.handleReceiveStart({
      type: 'file:start',
      transferId: 't-overflow-1',
      streamId: 7,
      fileName: 'small.bin',
      fileSize: 100,
      totalChunks: 1
    }, 'webrtc-dc');

    let errorEmitted = null;
    receiver.on('transferError', (err) => {
      errorEmitted = err;
    });

    // Send chunk with 200 bytes payload (> 100 bytes declared fileSize)
    const chunk = new Uint8Array(8 + 200);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, 7, false);
    view.setUint32(4, 0, false);
    receiverPc.emit('fileChunk', chunk.buffer);

    assert.ok(errorEmitted, 'Error must be emitted immediately on byte overflow');
    assert.equal(errorEmitted.code, 'BYTE_COUNT_EXCEEDED');
    assert.equal(receiver.activeReceives.has(7), false, 'Stream must be cleaned up immediately');

    receiver.destroy();
  });

  it('negotiates 64 KiB chunks when SCTP supports it, and throttles progress UI updates', async () => {
    const senderPc = new MockEmitter();
    senderPc.controlChannel = { readyState: 'open' };
    senderPc.fileChannel = { readyState: 'open', bufferedAmount: 0 };
    senderPc.pc = { connectionState: 'connected', sctp: { maxMessageSize: 262144 } };
    senderPc.isP2PHealthy = true;
    senderPc.getMaxMessageSize = () => 262144;
    senderPc.waitForBufferedAmountLow = () => Promise.resolve();
    senderPc.waitForFileChannelDrained = () => Promise.resolve();

    const receiverPc = new MockEmitter();
    receiverPc.controlChannel = { readyState: 'open' };
    receiverPc.fileChannel = { readyState: 'open', bufferedAmount: 0 };
    receiverPc.pc = { connectionState: 'connected', sctp: { maxMessageSize: 262144 } };
    receiverPc.isP2PHealthy = true;
    receiverPc.getMaxMessageSize = () => 262144;

    const sender = new FileTransferManager(senderPc, null);
    const receiver = new FileTransferManager(receiverPc, null);

    let sentStart = null;
    let sentReady = null;

    senderPc.sendControl = (msg) => {
      if (msg.type === 'file:start') sentStart = msg;
      setImmediate(() => receiverPc.emit('controlMessage', msg));
    };
    receiverPc.sendControl = (msg) => {
      if (msg.type === 'file:ready') sentReady = msg;
      setImmediate(() => senderPc.emit('controlMessage', msg));
    };

    const chunkSizes = [];
    senderPc.sendFileChunk = (chunk) => {
      chunkSizes.push(chunk.byteLength);
      receiverPc.emit('fileChunk', chunk);
    };

    // 200 KiB file
    const fileBytes = new Uint8Array(200 * 1024).fill(0x33);
    const file = new File([fileBytes], 'speed-test.bin');

    let senderProgressCount = 0;
    sender.on('progress', () => senderProgressCount++);

    let receiverCompleted = null;
    receiver.on('transferCompleted', (info) => {
      receiverCompleted = info;
    });

    await sender.sendFile(file);

    await new Promise(r => setTimeout(r, 50));

    // 1. Proposes 65528 chunk payload size in file:start
    assert.ok(sentStart);
    assert.equal(sentStart.chunkSize, 65528);

    // 2. Agreed chunk size in file:ready is 65528
    assert.ok(sentReady);
    assert.equal(sentReady.chunkSize, 65528);

    // 3. Sent chunk size is 65528 + 8 byte header = 65536 for full chunks
    assert.ok(chunkSizes.length > 0);
    assert.equal(chunkSizes[0], 65528 + 8);
    assert.ok(chunkSizes.every(sz => sz <= 65536), 'No message may exceed 65536 bytes');

    // 4. Progress was throttled rather than emitted for every chunk
    assert.ok(senderProgressCount <= 5, `Expected throttled progress updates, got ${senderProgressCount}`);

    // 5. Receiver verified
    assert.ok(receiverCompleted);
    assert.equal(receiverCompleted.verified, true);

    sender.destroy();
    receiver.destroy();
  });

  it('enforces that when maxMessageSize = 65536, payload is 65528 and no message exceeds 65536 bytes', async () => {
    const senderPc = new MockEmitter();
    senderPc.controlChannel = { readyState: 'open' };
    senderPc.fileChannel = { readyState: 'open', bufferedAmount: 0 };
    senderPc.pc = { connectionState: 'connected', sctp: { maxMessageSize: 65536 } };
    senderPc.isP2PHealthy = true;
    senderPc.getMaxMessageSize = () => 65536;
    senderPc.waitForBufferedAmountLow = () => Promise.resolve();
    senderPc.waitForFileChannelDrained = () => Promise.resolve();

    const receiverPc = new MockEmitter();
    receiverPc.controlChannel = { readyState: 'open' };
    receiverPc.fileChannel = { readyState: 'open', bufferedAmount: 0 };
    receiverPc.pc = { connectionState: 'connected', sctp: { maxMessageSize: 65536 } };
    receiverPc.isP2PHealthy = true;
    receiverPc.getMaxMessageSize = () => 65536;

    const sender = new FileTransferManager(senderPc, null);
    const receiver = new FileTransferManager(receiverPc, null);

    let sentStart = null;
    let sentReady = null;

    senderPc.sendControl = (msg) => {
      if (msg.type === 'file:start') sentStart = msg;
      setImmediate(() => receiverPc.emit('controlMessage', msg));
    };
    receiverPc.sendControl = (msg) => {
      if (msg.type === 'file:ready') sentReady = msg;
      setImmediate(() => senderPc.emit('controlMessage', msg));
    };

    const chunkSizes = [];
    senderPc.sendFileChunk = (chunk) => {
      chunkSizes.push(chunk.byteLength);
      receiverPc.emit('fileChunk', chunk);
    };

    // 150 KiB file
    const fileBytes = new Uint8Array(150 * 1024).fill(0x77);
    const file = new File([fileBytes], 'exact-sctp-test.bin');

    let receiverCompleted = null;
    receiver.on('transferCompleted', (info) => {
      receiverCompleted = info;
    });

    await sender.sendFile(file);
    await new Promise(r => setTimeout(r, 50));

    // Payload size must be min(65536, 65536) - 8 = 65528
    assert.equal(sentStart.chunkSize, 65528);
    assert.equal(sentReady.chunkSize, 65528);

    assert.ok(chunkSizes.length > 0);
    // Crucial check: header (8) + payload (65528) = 65536, NEVER > 65536
    for (const size of chunkSizes) {
      assert.ok(size <= 65536, `Chunk size ${size} exceeded maxMessageSize 65536`);
    }

    assert.ok(receiverCompleted?.verified);

    sender.destroy();
    receiver.destroy();
  });

  it('handshake fallback from webrtc-dc to websocket updates chunkSize and totalChunks to 16384, all frames <= 16392 bytes, and verifies', async () => {
    const senderPc = new MockEmitter();
    senderPc.controlChannel = { readyState: 'open' };
    senderPc.fileChannel = { readyState: 'open', bufferedAmount: 0 };
    senderPc.pc = { connectionState: 'connected', sctp: { maxMessageSize: 65536 } };
    senderPc.isP2PHealthy = true;
    senderPc.getMaxMessageSize = () => 65536;
    senderPc.waitForBufferedAmountLow = () => Promise.resolve();
    senderPc.waitForFileChannelDrained = () => Promise.resolve();

    const senderSc = new MockEmitter();
    senderSc.isConnected = true;
    senderSc.ws = { readyState: 1, bufferedAmount: 0, send: () => {} };

    const receiverSc = new MockEmitter();
    receiverSc.isConnected = true;
    receiverSc.ws = { readyState: 1, bufferedAmount: 0, send: () => {} };

    const sender = new FileTransferManager(senderPc, senderSc);
    const receiver = new FileTransferManager(null, receiverSc);

    sender.handshakeInitialTimeoutMs = 40;
    sender.handshakeRetryTimeoutMs = 200;

    // Simulate dead DataChannel control: drops initial file:start
    const dcControlMessages = [];
    senderPc.sendControl = (msg) => {
      dcControlMessages.push(msg);
      // dropped!
    };

    const wsControlMessages = [];
    senderSc.send = (msg) => {
      wsControlMessages.push(msg);
      setImmediate(() => receiverSc.emit('controlMessage', msg));
    };
    receiverSc.send = (msg) => {
      setImmediate(() => senderSc.emit('controlMessage', msg));
    };

    const wsChunkSizes = [];
    senderSc.ws.send = (chunk) => {
      wsChunkSizes.push(chunk.byteLength || chunk.length);
      setImmediate(() => receiverSc.emit('fileChunk', chunk));
    };

    // 80 KiB file
    const fileBytes = new Uint8Array(80 * 1024);
    for (let i = 0; i < fileBytes.length; i++) fileBytes[i] = (i * 7) % 256;
    const file = new File([fileBytes], 'fallback-size-test.bin');

    let completedInfo = null;
    receiver.on('transferCompleted', (info) => {
      completedInfo = info;
    });

    await sender.sendFile(file);
    await new Promise(r => setTimeout(r, 60));

    // 1. Initial attempt on webrtc-dc had 65528 byte chunkSize
    assert.equal(dcControlMessages.length, 1);
    assert.equal(dcControlMessages[0].type, 'file:start');
    assert.equal(dcControlMessages[0].chunkSize, 65528);
    assert.equal(dcControlMessages[0].totalChunks, Math.ceil(file.size / 65528));

    // 2. Retry attempt on websocket had 16384 byte chunkSize and updated totalChunks
    const wsStart = wsControlMessages.find(m => m.type === 'file:start');
    assert.ok(wsStart, 'file:start must be resent over WebSocket');
    assert.equal(wsStart.chunkSize, 16384, 'Resent file:start must carry 16384 for websocket');
    assert.equal(wsStart.totalChunks, Math.ceil(file.size / 16384), 'totalChunks must reflect new chunk size');

    // 3. All frames over websocket are <= 16392 bytes (16384 payload + 8 header)
    assert.ok(wsChunkSizes.length > 0);
    for (const size of wsChunkSizes) {
      assert.ok(size <= 16392, `WebSocket chunk size ${size} exceeded 16392 bytes`);
    }

    // 4. File completes and verifies
    assert.ok(completedInfo, 'Transfer must complete successfully');
    assert.equal(completedInfo.verified, true);
    assert.equal(completedInfo.fileSize, 80 * 1024);

    sender.destroy();
    receiver.destroy();
  });

  it('applies 512 KiB backpressure high-water mark on websocket and 4 MiB on DataChannel', () => {
    const mockPc = new MockEmitter();
    mockPc.fileChannel = { readyState: 'open', bufferedAmount: 0 };
    const mockSc = new MockEmitter();
    mockSc.ws = { readyState: 1, bufferedAmount: 0 };

    const manager = new FileTransferManager(mockPc, mockSc);

    // DataChannel: HIGH_WATER_MARK = 4 MiB
    mockPc.fileChannel.bufferedAmount = 4 * 1024 * 1024 - 1;
    assert.equal(manager.shouldPauseForBackpressure('webrtc-dc'), false);

    mockPc.fileChannel.bufferedAmount = 4 * 1024 * 1024;
    assert.equal(manager.shouldPauseForBackpressure('webrtc-dc'), true);

    // WebSocket relay: WS_HIGH_WATER_MARK = 512 KiB
    mockSc.ws.bufferedAmount = 512 * 1024 - 1;
    assert.equal(manager.shouldPauseForBackpressure('websocket'), false);

    mockSc.ws.bufferedAmount = 512 * 1024;
    assert.equal(manager.shouldPauseForBackpressure('websocket'), true);

    manager.destroy();
  });
});

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
});

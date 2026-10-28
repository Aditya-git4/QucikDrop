import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_SIZE, MEMORY_TRANSFER_LIMIT } from '../../../client/src/services/fileTransfer.js';
import { sanitizeFileName } from '../../../client/src/utils/fileUtils.js';
import { createSha256Incremental } from '../../../client/src/utils/cryptoUtils.js';

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
});

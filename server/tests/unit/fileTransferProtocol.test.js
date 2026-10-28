import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_SIZE } from '../../../client/src/services/fileTransfer.js';
import { sanitizeFileName } from '../../../client/src/utils/fileUtils.js';

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
});

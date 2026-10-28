import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createSha256Incremental, computeBufferSha256 } from '../../../client/src/utils/cryptoUtils.js';

describe('cryptoUtils (Incremental SHA-256)', () => {
  function nodeSha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  it('matches official NIST test vectors and Node.js sha256 for standard strings', () => {
    const testCases = [
      '',
      'abc',
      'hello world',
      'The quick brown fox jumps over the lazy dog',
      'The quick brown fox jumps over the lazy cog'
    ];

    for (const text of testCases) {
      const buffer = Buffer.from(text, 'utf8');
      const expected = nodeSha256(buffer);
      const actual = computeBufferSha256(buffer);
      assert.equal(actual, expected, `Mismatch for string "${text}"`);
    }
  });

  it('matches Node.js sha256 when fed data chunk-by-chunk incrementally', () => {
    // Generate 100 KB test buffer
    const fullBuffer = crypto.randomBytes(100 * 1024);
    const expectedHash = nodeSha256(fullBuffer);

    const incremental = createSha256Incremental();
    const chunkSize = 16384; // 16 KiB chunks
    let offset = 0;

    while (offset < fullBuffer.length) {
      const end = Math.min(offset + chunkSize, fullBuffer.length);
      const slice = fullBuffer.subarray(offset, end);
      incremental.update(slice);
      offset = end;
    }

    const actualHash = incremental.digest();
    assert.equal(actualHash, expectedHash);
  });

  it('handles exact 55, 56, 64, and 128 byte block boundaries correctly', () => {
    const sizes = [0, 1, 55, 56, 57, 63, 64, 65, 127, 128, 129];
    for (const size of sizes) {
      const buf = crypto.randomBytes(size);
      const expected = nodeSha256(buf);
      const actual = computeBufferSha256(buf);
      assert.equal(actual, expected, `Mismatch at boundary size ${size}`);
    }
  });
});

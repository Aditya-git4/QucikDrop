/**
 * High-performance incremental SHA-256 implementation in pure JavaScript.
 * Optimized for high-throughput streaming (O(1) memory, zero per-block allocations).
 * Allows chunk-by-chunk cryptographic hashing for large files without GC pressure.
 */

// Initial hash values (first 32 bits of the fractional parts of the square roots of the first 8 primes 2..19)
const INITIAL_H = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
]);

// Constants (first 32 bits of the fractional parts of the cube roots of the first 64 primes 2..311)
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotr(n, x) {
  return (x >>> n) | (x << (32 - n));
}

export class Sha256Incremental {
  constructor() {
    this.h = new Uint32Array(INITIAL_H);
    this.block = new Uint8Array(64);
    this.blockLen = 0;
    this.totalBytes = 0;
    this.w = new Uint32Array(64);
    this.finalized = false;
  }

  /**
   * Process a single 64-byte block using the pre-allocated schedule array this.w.
   * Zero heap allocations.
   */
  processWords() {
    const w = this.w;

    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, w[i - 15]) ^ rotr(18, w[i - 15]) ^ (w[i - 15] >>> 3);
      const s1 = rotr(17, w[i - 2]) ^ rotr(19, w[i - 2]) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = this.h[0];
    let b = this.h[1];
    let c = this.h[2];
    let d = this.h[3];
    let e = this.h[4];
    let f = this.h[5];
    let g = this.h[6];
    let h = this.h[7];

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.h[0] = (this.h[0] + a) >>> 0;
    this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0;
    this.h[3] = (this.h[3] + d) >>> 0;
    this.h[4] = (this.h[4] + e) >>> 0;
    this.h[5] = (this.h[5] + f) >>> 0;
    this.h[6] = (this.h[6] + g) >>> 0;
    this.h[7] = (this.h[7] + h) >>> 0;
  }

  /**
   * Feed a chunk of data (ArrayBuffer or Uint8Array) into the hasher.
   * Reads blocks in-place directly from the source buffer, eliminating subarray allocations.
   * @param {ArrayBuffer | Uint8Array} data
   */
  update(data) {
    if (this.finalized) {
      throw new Error('Cannot update SHA-256 after digest() has been called');
    }

    const bytes = data instanceof Uint8Array
      ? data
      : (ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data));

    let offset = 0;
    const len = bytes.length;
    this.totalBytes += len;

    // 1. Fill partial leftover block if any
    if (this.blockLen > 0) {
      const toCopy = Math.min(64 - this.blockLen, len);
      for (let i = 0; i < toCopy; i++) {
        this.block[this.blockLen + i] = bytes[i];
      }
      this.blockLen += toCopy;
      offset += toCopy;

      if (this.blockLen === 64) {
        for (let i = 0; i < 16; i++) {
          const j = i * 4;
          this.w[i] = ((this.block[j] << 24) | (this.block[j + 1] << 16) | (this.block[j + 2] << 8) | this.block[j + 3]) >>> 0;
        }
        this.processWords();
        this.blockLen = 0;
      }
    }

    // 2. Fast-path: process full 64-byte blocks directly from source bytes without copying
    const w = this.w;
    while (offset + 64 <= len) {
      for (let i = 0; i < 16; i++) {
        const j = offset + (i * 4);
        w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
      }
      this.processWords();
      offset += 64;
    }

    // 3. Store remaining tail bytes (< 64 bytes) into this.block
    if (offset < len) {
      const remaining = len - offset;
      for (let i = 0; i < remaining; i++) {
        this.block[this.blockLen + i] = bytes[offset + i];
      }
      this.blockLen += remaining;
    }
  }

  /**
   * Finalize the hash and return the 64-character lowercase hexadecimal string.
   * @returns {string}
   */
  digest() {
    if (!this.finalized) {
      // Padding: append 0x80 byte
      this.block[this.blockLen++] = 0x80;

      if (this.blockLen > 56) {
        this.block.fill(0, this.blockLen, 64);
        for (let i = 0; i < 16; i++) {
          const j = i * 4;
          this.w[i] = ((this.block[j] << 24) | (this.block[j + 1] << 16) | (this.block[j + 2] << 8) | this.block[j + 3]) >>> 0;
        }
        this.processWords();
        this.blockLen = 0;
      }

      this.block.fill(0, this.blockLen, 56);
      const totalBits = this.totalBytes * 8;

      // High 32 bits and low 32 bits of total bits count
      const highBits = Math.floor(totalBits / 0x100000000);
      const lowBits = totalBits >>> 0;

      this.block[56] = (highBits >>> 24) & 0xff;
      this.block[57] = (highBits >>> 16) & 0xff;
      this.block[58] = (highBits >>> 8) & 0xff;
      this.block[59] = highBits & 0xff;

      this.block[60] = (lowBits >>> 24) & 0xff;
      this.block[61] = (lowBits >>> 16) & 0xff;
      this.block[62] = (lowBits >>> 8) & 0xff;
      this.block[63] = lowBits & 0xff;

      for (let i = 0; i < 16; i++) {
        const j = i * 4;
        this.w[i] = ((this.block[j] << 24) | (this.block[j + 1] << 16) | (this.block[j + 2] << 8) | this.block[j + 3]) >>> 0;
      }
      this.processWords();
      this.finalized = true;
    }

    let hex = '';
    for (let i = 0; i < 8; i++) {
      hex += this.h[i].toString(16).padStart(8, '0');
    }
    return hex;
  }
}

/**
 * Convenience function to create an incremental SHA-256 instance.
 * @returns {Sha256Incremental}
 */
export function createSha256Incremental() {
  return new Sha256Incremental();
}

/**
 * Compute SHA-256 hex string for a single buffer.
 * @param {ArrayBuffer | Uint8Array} buffer
 * @returns {string}
 */
export function computeBufferSha256(buffer) {
  const hasher = new Sha256Incremental();
  hasher.update(buffer);
  return hasher.digest();
}

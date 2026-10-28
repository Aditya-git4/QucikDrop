import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateRoomId,
  generateJoinToken,
  generatePeerId,
  hashToken,
  verifyToken,
  sanitizeDeviceName
} from '../../src/security/tokenUtils.js';

describe('tokenUtils', () => {
  it('generates cryptographically secure room IDs of correct length and randomness', () => {
    const id1 = generateRoomId();
    const id2 = generateRoomId();

    assert.equal(typeof id1, 'string');
    assert.equal(id1.length, 32);
    assert.match(id1, /^[0-9a-f]{32}$/);
    assert.notEqual(id1, id2);
  });

  it('generates cryptographically secure join tokens of correct length', () => {
    const token1 = generateJoinToken();
    const token2 = generateJoinToken();

    assert.equal(typeof token1, 'string');
    assert.equal(token1.length, 48);
    assert.match(token1, /^[0-9a-f]{48}$/);
    assert.notEqual(token1, token2);
  });

  it('generates unique peer IDs', () => {
    const peer1 = generatePeerId();
    const peer2 = generatePeerId();

    assert.equal(typeof peer1, 'string');
    assert.equal(peer1.length, 24);
    assert.notEqual(peer1, peer2);
  });

  it('computes sha256 hashes deterministically', () => {
    const token = 'sample-secret-token-12345';
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);

    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64);
    assert.match(hash1, /^[0-9a-f]{64}$/);
  });

  it('safely verifies tokens using constant-time comparison', () => {
    const rawToken = generateJoinToken();
    const storedHash = hashToken(rawToken);

    assert.equal(verifyToken(rawToken, storedHash), true);
    assert.equal(verifyToken('wrong-token-value', storedHash), false);
    assert.equal(verifyToken('', storedHash), false);
    assert.equal(verifyToken(null, storedHash), false);
    assert.equal(verifyToken(rawToken, 'invalid-hash-length'), false);
  });

  it('sanitizes device names safely', () => {
    assert.equal(sanitizeDeviceName('   Windows PC   '), 'Windows PC');
    assert.equal(sanitizeDeviceName('Android Phone\x00\x1F'), 'Android Phone');
    assert.equal(sanitizeDeviceName(''), 'Unknown Device');
    assert.equal(sanitizeDeviceName(null), 'Unknown Device');

    // Truncates strings over 40 characters
    const longName = 'A'.repeat(50);
    const sanitized = sanitizeDeviceName(longName);
    assert.equal(sanitized.length, 40);
  });
});

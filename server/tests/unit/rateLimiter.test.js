import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../../src/security/rateLimiter.js';

describe('RateLimiter', () => {
  it('permits requests within quota and rejects excess requests', () => {
    const limiter = new RateLimiter(60000);
    const key = '192.168.1.50';
    const action = 'test_action';
    const limit = 3;
    const windowMs = 500;

    assert.equal(limiter.isAllowed(key, action, limit, windowMs), true);
    assert.equal(limiter.isAllowed(key, action, limit, windowMs), true);
    assert.equal(limiter.isAllowed(key, action, limit, windowMs), true);
    // 4th request exceeds limit
    assert.equal(limiter.isAllowed(key, action, limit, windowMs), false);

    // Another key should not be blocked
    assert.equal(limiter.isAllowed('192.168.1.51', action, limit, windowMs), true);

    limiter.dispose();
  });
});

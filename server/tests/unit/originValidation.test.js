import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isOriginAllowed } from '../../src/security/originValidation.js';

describe('originValidation', () => {
  const allowedList = ['https://quickdrop.example.com', 'http://localhost:5173'];

  it('allows exact matches in production', () => {
    assert.equal(isOriginAllowed('https://quickdrop.example.com', true, allowedList), true);
    assert.equal(isOriginAllowed('http://localhost:5173', true, allowedList), true);
  });

  it('allows same-origin matches using Host header in production', () => {
    assert.equal(
      isOriginAllowed('https://quickdrop.onrender.com', true, [], 'quickdrop.onrender.com'),
      true
    );
    assert.equal(
      isOriginAllowed('https://malicious.com', true, [], 'quickdrop.onrender.com'),
      false
    );
  });

  it('rejects disallowed origins in production', () => {
    assert.equal(isOriginAllowed('https://malicious-site.com', true, allowedList), false);
    assert.equal(isOriginAllowed('http://localhost:3000', true, allowedList), false);
    assert.equal(isOriginAllowed(undefined, true, allowedList), false);
  });

  it('allows local LAN origins and missing origins during development', () => {
    assert.equal(isOriginAllowed('http://192.168.1.100:5173', false, allowedList), true);
    assert.equal(isOriginAllowed('http://10.0.0.5:5000', false, allowedList), true);
    assert.equal(isOriginAllowed(undefined, false, allowedList), true);
  });
});

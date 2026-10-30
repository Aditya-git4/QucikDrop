import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getClientIp, normalizeIp, maskIp } from '../../src/security/ipUtils.js';

describe('Client IP Extraction Behind Render Proxy', () => {
  it('extracts the last entry from X-Forwarded-For (the entry appended by the trusted proxy), preventing client spoofing', () => {
    // Malicious client prepended "1.2.3.4, 10.0.0.1", Render reverse proxy appended the real client IP "203.0.113.195"
    const mockReq = {
      headers: {
        'x-forwarded-for': '1.2.3.4, 10.0.0.1, 203.0.113.195'
      },
      socket: {
        remoteAddress: '10.0.0.2' // Proxy internal IP
      }
    };

    const ip = getClientIp(mockReq);
    assert.equal(ip, '203.0.113.195', 'Must take rightmost IP added by trusted proxy, not spoofed first entries');
  });

  it('normalises IPv6-mapped IPv4 addresses (::ffff:)', () => {
    const mockReq = {
      headers: {
        'x-forwarded-for': '::ffff:198.51.100.42'
      },
      socket: {
        remoteAddress: '::ffff:127.0.0.1'
      }
    };

    const ip = getClientIp(mockReq);
    assert.equal(ip, '198.51.100.42');
  });

  it('falls back to socket remoteAddress when X-Forwarded-For header is absent', () => {
    const mockReq = {
      headers: {},
      socket: {
        remoteAddress: '192.168.1.100'
      }
    };

    const ip = getClientIp(mockReq);
    assert.equal(ip, '192.168.1.100');
  });

  it('handles IPv6-mapped socket remoteAddress fallback when X-Forwarded-For is missing', () => {
    const mockReq = {
      headers: {},
      socket: {
        remoteAddress: '::ffff:172.16.0.5'
      }
    };

    const ip = getClientIp(mockReq);
    assert.equal(ip, '172.16.0.5');
  });

  it('masks last octet for IPv4 and last segment for IPv6 for telemetry logs', () => {
    assert.equal(maskIp('203.0.113.195'), '203.0.113.xxx');
    assert.equal(maskIp('192.168.0.1'), '192.168.0.xxx');
    assert.equal(maskIp('::ffff:10.0.0.8'), '10.0.0.xxx');
    assert.equal(maskIp('2001:db8:85a3::8a2e:370:7334'), '2001:db8:85a3::8a2e:370:xxxx');
  });

  it('formats sample log line with masked IP without leaking full IP', () => {
    const ip = '203.0.113.195';
    const logLine = `[WS-CONN] clientIp=${maskIp(ip)} userAgent="Chrome on Windows"`;
    assert.match(logLine, /^\[WS-CONN\] clientIp=203\.0\.113\.xxx userAgent="Chrome on Windows"$/);
    assert.ok(!logLine.includes('195'), 'Full last octet must not be present in masked log');
  });
});

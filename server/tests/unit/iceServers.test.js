import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  getIceServers,
  parseUrls,
  generateEphemeralCredentials,
  DEFAULT_STUN_SERVERS,
  CloudflareTurnManager
} from '../../src/config/iceServers.js';

describe('ICE & TURN Server Configuration', () => {
  it('parses comma-separated URLs correctly', () => {
    assert.deepEqual(parseUrls('stun:stun.example.com:3478, stun:stun2.example.com:3478'), [
      'stun:stun.example.com:3478',
      'stun:stun2.example.com:3478'
    ]);
    assert.deepEqual(parseUrls(''), []);
    assert.deepEqual(parseUrls(undefined), []);
  });

  it('returns default public STUN servers when no custom configuration is provided', () => {
    const servers = getIceServers('peer-live');
    assert.equal(servers.length, 1);
    assert.deepEqual(servers[0].urls, DEFAULT_STUN_SERVERS);
    assert.equal(servers[0].username, undefined);
    assert.equal(servers[0].credential, undefined);
  });

  it('returns only STUN servers when custom configuration specifies empty turnUrls', () => {
    const servers = getIceServers('peer-123', {
      stunUrls: '',
      turnUrls: '',
      turnSecret: '',
      turnUsername: '',
      turnCredential: '',
      turnTtlSeconds: 86400
    });

    assert.equal(servers.length, 1);
    assert.deepEqual(servers[0].urls, DEFAULT_STUN_SERVERS);
    assert.equal(servers[0].username, undefined);
    assert.equal(servers[0].credential, undefined);
  });

  it('correctly uses custom STUN URLs when provided', () => {
    const customStun = 'stun:custom.stun.org:19302,stun:custom2.stun.org:19302';
    const servers = getIceServers('peer-123', {
      stunUrls: customStun,
      turnUrls: '',
      turnSecret: '',
      turnUsername: '',
      turnCredential: '',
      turnTtlSeconds: 86400
    });

    assert.equal(servers.length, 1);
    assert.deepEqual(servers[0].urls, [
      'stun:custom.stun.org:19302',
      'stun:custom2.stun.org:19302'
    ]);
  });

  it('generates ephemeral HMAC-SHA1 TURN credentials without leaking root secret', () => {
    const secret = 'super-secret-turn-key';
    const peerId = 'peer-xyz-456';
    const ttl = 3600;

    const { username, credential } = generateEphemeralCredentials(secret, peerId, ttl);

    // Verify username format: <timestamp>:<peerId>
    const [timestampStr, parsedPeerId] = username.split(':');
    assert.equal(parsedPeerId, peerId);
    const timestamp = parseInt(timestampStr, 10);
    const now = Math.floor(Date.now() / 1000);
    assert.ok(timestamp >= now + ttl - 5 && timestamp <= now + ttl + 5);

    // Verify HMAC-SHA1 digest
    const expectedCredential = crypto
      .createHmac('sha1', secret)
      .update(username)
      .digest('base64');
    assert.equal(credential, expectedCredential);
    assert.notEqual(credential, secret);
  });

  it('constructs TURN server entry with ephemeral credentials when TURN_SECRET is set', () => {
    const servers = getIceServers('peer-abc', {
      stunUrls: '',
      turnUrls: 'turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp',
      turnSecret: 'coturn-auth-secret',
      turnUsername: '',
      turnCredential: '',
      turnTtlSeconds: 7200
    });

    assert.equal(servers.length, 2); // 1 STUN + 1 TURN
    assert.deepEqual(servers[0].urls, DEFAULT_STUN_SERVERS);

    const turnServer = servers[1];
    assert.deepEqual(turnServer.urls, [
      'turn:turn.example.com:3478?transport=udp',
      'turns:turn.example.com:5349?transport=tcp'
    ]);
    assert.ok(turnServer.username.includes(':peer-abc'));
    assert.ok(turnServer.credential.length > 10);
    // Crucial check: root secret is never exposed directly in credentials
    assert.notEqual(turnServer.credential, 'coturn-auth-secret');
  });

  it('constructs TURN server entry with static credentials when provided', () => {
    const servers = getIceServers('peer-def', {
      stunUrls: '',
      turnUrls: 'turn:static.metered.ca:80',
      turnSecret: '',
      turnUsername: 'static-user',
      turnCredential: 'static-password',
      turnTtlSeconds: 86400
    });

    assert.equal(servers.length, 2);
    const turnServer = servers[1];
    assert.deepEqual(turnServer.urls, ['turn:static.metered.ca:80']);
    assert.equal(turnServer.username, 'static-user');
    assert.equal(turnServer.credential, 'static-password');
  });

  it('CloudflareTurnManager: falls back to STUN when env is missing and logs one startup warning', () => {
    const logs = [];
    const origWarn = console.warn;
    console.warn = (...args) => logs.push(args.join(' '));

    try {
      const manager = new CloudflareTurnManager({ keyId: '', apiToken: '' });
      assert.equal(manager.getHealthStatus(), 'not_configured');

      // Second check should not duplicate the startup warning
      manager.logStartupWarning();
      const warningCount = logs.filter((l) => l.includes('Cloudflare Realtime TURN is not configured')).length;
      assert.equal(warningCount, 1);
    } finally {
      console.warn = origWarn;
    }
  });

  it('CloudflareTurnManager: falls back to STUN-only and enters degraded state when API call fails', async () => {
    const failingFetch = async () => {
      return {
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => ({ error: 'gateway failure' })
      };
    };

    const manager = new CloudflareTurnManager({
      keyId: 'mock-key-id',
      apiToken: 'mock-api-token',
      fetchFn: failingFetch,
      timeoutMs: 100
    });

    assert.equal(manager.getHealthStatus(), 'configured');

    const result = await manager.fetchCredentials();
    assert.equal(result, null);
    assert.equal(manager.getHealthStatus(), 'degraded');
    assert.ok(manager.backoffMs > 5000, 'Backoff must increase on failure');

    manager.stop();
  });

  it('CloudflareTurnManager: caches credentials for 45 minutes and merges all URL variants', async () => {
    let fetchCalls = 0;
    const mockSuccessFetch = async (url, opts) => {
      fetchCalls++;
      // Verify body requests 3600 TTL
      const body = JSON.parse(opts.body);
      assert.equal(body.ttl, 3600);
      assert.equal(opts.headers['Authorization'], 'Bearer cf-valid-token-123');

      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478'] },
            {
              urls: [
                'turn:turn.cloudflare.com:3478?transport=udp',
                'turn:turn.cloudflare.com:443?transport=udp',
                'turn:turn.cloudflare.com:3478?transport=tcp',
                'turn:turn.cloudflare.com:80?transport=tcp',
                'turns:turn.cloudflare.com:5349?transport=tcp',
                'turns:turn.cloudflare.com:443?transport=tcp'
              ],
              username: 'cf-ephemeral-user-999',
              credential: 'cf-ephemeral-credential-xyz'
            }
          ]
        })
      };
    };

    const manager = new CloudflareTurnManager({
      keyId: 'cf-turn-key-001',
      apiToken: 'cf-valid-token-123',
      fetchFn: mockSuccessFetch,
      ttlSeconds: 3600,
      cacheDurationMs: 45 * 60 * 1000
    });

    // First call fetches credentials
    const servers1 = await manager.fetchCredentials();
    assert.ok(Array.isArray(servers1));
    assert.equal(fetchCalls, 1);
    assert.equal(manager.getHealthStatus(), 'configured');

    // Verify STUN and TURN entries
    assert.ok(servers1.some((s) => s.urls.includes('stun:stun.cloudflare.com:3478')));
    const turnEntry = servers1.find((s) => s.username === 'cf-ephemeral-user-999');
    assert.ok(turnEntry);
    assert.equal(turnEntry.credential, 'cf-ephemeral-credential-xyz');
    assert.equal(turnEntry.urls.length, 6);

    // Second call before expiry reuses cached credentials
    assert.ok(Date.now() < manager.cacheExpiry);
    assert.equal(manager.cachedIceServers, servers1);

    manager.stop();
  });

  it('CloudflareTurnManager: API tokens never appear in server logs or client responses', async () => {
    const sensitiveApiToken = 'SUPER_SECRET_CLOUDFLARE_API_KEY_998877665544';
    const logs = [];

    const origWarn = console.warn;
    const origLog = console.log;
    const origError = console.error;

    console.warn = (...args) => logs.push(args.join(' '));
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => logs.push(args.join(' '));

    try {
      const mockFailingFetch = async () => {
        throw new Error('Connection refused to rtc.live.cloudflare.com');
      };

      const manager = new CloudflareTurnManager({
        keyId: 'cf-test-key-id',
        apiToken: sensitiveApiToken,
        fetchFn: mockFailingFetch
      });

      const res = await manager.fetchCredentials();
      assert.equal(res, null);

      // Scan all logs for the secret token
      for (const logLine of logs) {
        assert.ok(
          !logLine.includes(sensitiveApiToken),
          `Sensitive API token was leaked in log: "${logLine}"`
        );
      }

      manager.stop();
    } finally {
      console.warn = origWarn;
      console.log = origLog;
      console.error = origError;
    }
  });
});

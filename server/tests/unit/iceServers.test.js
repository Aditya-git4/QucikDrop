import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  getIceServers,
  parseUrls,
  generateEphemeralCredentials,
  DEFAULT_STUN_SERVERS
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
});

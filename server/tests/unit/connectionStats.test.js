import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCandidatePair, PeerConnectionManager } from '../../../client/src/services/peerConnection.js';

describe('WebRTC Candidate Pair Classification & Fallback', () => {
  it('classifies relayed connections when either candidate is relay', () => {
    assert.equal(classifyCandidatePair('relay', 'host'), 'relay');
    assert.equal(classifyCandidatePair('host', 'relay'), 'relay');
    assert.equal(classifyCandidatePair('relay', 'srflx'), 'relay');
    assert.equal(classifyCandidatePair('srflx', 'relay'), 'relay');
    assert.equal(classifyCandidatePair('relay', 'relay'), 'relay');
  });

  it('classifies LAN direct connections when both candidates are host', () => {
    assert.equal(classifyCandidatePair('host', 'host'), 'lan');
  });

  it('classifies STUN direct NAT connections when candidates are reflexive or mixed', () => {
    assert.equal(classifyCandidatePair('host', 'srflx'), 'direct');
    assert.equal(classifyCandidatePair('srflx', 'host'), 'direct');
    assert.equal(classifyCandidatePair('srflx', 'srflx'), 'direct');
    assert.equal(classifyCandidatePair('prflx', 'host'), 'direct');
    assert.equal(classifyCandidatePair('host', 'prflx'), 'direct');
    assert.equal(classifyCandidatePair('prflx', 'prflx'), 'direct');
  });

  it('gracefully handles missing or unknown candidate types', () => {
    assert.equal(classifyCandidatePair('unknown', 'unknown'), 'direct');
    assert.equal(classifyCandidatePair(undefined, undefined), 'direct');
  });

  it('recovers P2P health from unhealthy when pong arrives', () => {
    const manager = new PeerConnectionManager();
    const sentMessages = [];
    const events = [];

    const mockControlChannel = {
      readyState: 'open',
      send: (msg) => sentMessages.push(msg)
    };
    const mockFileChannel = {
      readyState: 'open'
    };
    const mockPc = {
      connectionState: 'connected'
    };

    manager.pc = mockPc;
    manager.setupControlChannel(mockControlChannel);
    manager.setupFileChannel(mockFileChannel);

    manager.on('healthChange', (healthy) => events.push({ type: 'healthChange', healthy }));
    manager.on('ready', () => events.push({ type: 'ready' }));

    // 1. Force unhealthy
    manager.markP2PUnhealthy('test_timeout');
    assert.equal(manager.isP2PHealthy, false);

    // 2. Simulate runHeartbeatCheck keeping sending pings even while unhealthy
    manager.lastPongReceivedAt = Date.now() - 11000;
    manager.runHeartbeatCheck();
    assert.equal(sentMessages.length, 1);
    const sentObj = JSON.parse(sentMessages[0]);
    assert.equal(sentObj.type, '__dc_ping__');

    // 3. Simulate receiving __dc_pong__ on controlChannel.onmessage
    mockControlChannel.onmessage({
      data: JSON.stringify({ type: '__dc_pong__', pingSentAt: sentObj.sentAt })
    });

    // 4. Assert: healthy restored, events emitted
    assert.equal(manager.isP2PHealthy, true);
    assert.ok(events.some((e) => e.type === 'healthChange' && e.healthy === true));
    assert.ok(events.some((e) => e.type === 'ready'));

    manager.stopHeartbeat();
    manager.stopStatsPolling();
  });
});

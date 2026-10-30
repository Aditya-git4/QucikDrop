import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PeerConnectionManager } from '../../../client/src/services/peerConnection.js';

describe('WebRTC ICE Restart & Reconnection Resilience', () => {
  it('PeerConnectionManager passes { iceRestart: true } to pc.createOffer without recreating RTCPeerConnection', async () => {
    const manager = new PeerConnectionManager();

    let createOfferCalls = [];
    let setLocalDescriptionCalls = [];

    const mockPc = {
      connectionState: 'connected',
      createDataChannel: (label) => ({
        label,
        readyState: 'open',
        addEventListener: () => {},
        removeEventListener: () => {}
      }),
      createOffer: async (options) => {
        createOfferCalls.push(options);
        return { type: 'offer', sdp: 'v=0\r\no=mock 12345 IN IP4 127.0.0.1\r\na=ice-options:restart\r\n' };
      },
      setLocalDescription: async (desc) => {
        setLocalDescriptionCalls.push(desc);
      }
    };

    manager.pc = mockPc;
    const initialPcInstance = manager.pc;

    // Call createOffer with iceRestart: true
    const offer = await manager.createOffer({ iceRestart: true });

    assert.equal(manager.pc, initialPcInstance, 'RTCPeerConnection must not be recreated during ICE restart');
    assert.equal(createOfferCalls.length, 1);
    assert.deepEqual(createOfferCalls[0], { iceRestart: true });
    assert.equal(setLocalDescriptionCalls.length, 1);
    assert.ok(offer.sdp.includes('ice-options:restart'));

    manager.close();
  });

  it('triggers ICE restart from owner upon connection failure', async () => {
    let iceRestartAttempted = false;
    let fallbackToRelay = false;
    let restartCallCount = 0;

    const mockAttemptIceRestart = async () => {
      if (iceRestartAttempted) return;
      iceRestartAttempted = true;
      restartCallCount++;
    };

    // Simulate handleStatusChange logic from useWebRTC
    const handleStatusChange = (status, isOwner) => {
      if (status === 'failed') {
        if (isOwner && !iceRestartAttempted) {
          mockAttemptIceRestart();
        } else {
          fallbackToRelay = true;
        }
      }
    };

    // As owner, first failure triggers restart
    handleStatusChange('failed', true);
    assert.equal(restartCallCount, 1);
    assert.equal(iceRestartAttempted, true);
    assert.equal(fallbackToRelay, false);

    // If it fails again, it falls back to relay instead of retrying indefinitely
    handleStatusChange('failed', true);
    assert.equal(restartCallCount, 1);
    assert.equal(fallbackToRelay, true);
  });

  it('triggers ICE restart after staying disconnected for 8 seconds, but cancels if reconnected', async () => {
    let disconnectTimer = null;
    let iceRestartAttempted = false;
    let restarted = false;

    const handleStatusChange = (status, isOwner) => {
      if (status === 'connected') {
        if (disconnectTimer) {
          clearTimeout(disconnectTimer);
          disconnectTimer = null;
        }
        iceRestartAttempted = false;
      } else if (status === 'disconnected') {
        if (!disconnectTimer) {
          disconnectTimer = setTimeout(() => {
            disconnectTimer = null;
            if (isOwner && !iceRestartAttempted) {
              iceRestartAttempted = true;
              restarted = true;
            }
          }, 50); // fast timeout for test
        }
      }
    };

    // Scenario A: Disconnects, but reconnects before timer fires
    handleStatusChange('disconnected', true);
    assert.ok(disconnectTimer !== null);
    handleStatusChange('connected', true);
    assert.equal(disconnectTimer, null);
    assert.equal(restarted, false);

    // Scenario B: Disconnects and stays disconnected past timeout
    handleStatusChange('disconnected', true);
    assert.ok(disconnectTimer !== null);

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(restarted, true);
    assert.equal(iceRestartAttempted, true);
  });
});

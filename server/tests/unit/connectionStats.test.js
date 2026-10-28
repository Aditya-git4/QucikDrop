import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCandidatePair } from '../../../client/src/services/peerConnection.js';

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
});

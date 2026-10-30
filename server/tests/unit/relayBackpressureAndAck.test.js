import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FileTransferManager } from '../../../client/src/services/fileTransfer.js';
import { RelayLimiter, defaultRelayLimiter } from '../../src/websocket/relayLimiter.js';
import { handleIncomingMessage } from '../../src/websocket/messageHandler.js';
import { ErrorCodes } from '../../src/websocket/messageSchemas.js';
import { config } from '../../src/config/config.js';

class MockEmitter {
  constructor() {
    this.handlers = new Map();
  }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
  }
  off(event, fn) {
    this.handlers.get(event)?.delete(fn);
  }
  emit(event, data) {
    const list = Array.from(this.handlers.get(event) || []);
    for (const fn of list) fn(data);
  }
}

describe('WebSocket Relay Safety & Flow Control', () => {
  beforeEach(() => {
    defaultRelayLimiter.reset();
  });

  it('sender never exceeds the 1 MiB in-flight window against a slow mock receiver', async () => {
    const mockSc = new MockEmitter();
    mockSc.isConnected = true;

    const sentChunks = [];
    const controlMessages = [];

    mockSc.ws = {
      readyState: 1,
      bufferedAmount: 0,
      send: (chunk) => sentChunks.push(chunk)
    };

    mockSc.send = (msg) => {
      controlMessages.push(msg);
    };
    mockSc.sendControl = mockSc.send;
    mockSc.sendFileChunk = (chunk) => {
      mockSc.ws.send(chunk);
    };

    // Instantiate sender with no WebRTC connection so it forces websocket relay transport
    const sender = new FileTransferManager(null, mockSc);

    // Prepare a 3 MiB test file (approx 192 chunks of 16 KiB each)
    const totalBytes = 3 * 1024 * 1024;
    const testBytes = new Uint8Array(totalBytes).fill(7);
    const testFile = new File([testBytes], 'large-file.bin', { type: 'application/octet-stream' });

    let isWaitingReceived = false;
    sender.on('progress', (prog) => {
      if (prog.isWaitingForAck) {
        isWaitingReceived = true;
      }
    });

    // Start sending file in background
    const sendPromise = sender.sendFile(testFile);

    // Wait a tick for sender to start and emit file:start
    await new Promise((r) => setTimeout(r, 20));

    // Receiver sends file:ready on websocket transport
    const startMsg = controlMessages.find((m) => m.type === 'file:start');
    assert.ok(startMsg, 'Sender must have sent file:start');

    mockSc.emit('controlMessage', {
      type: 'file:ready',
      transferId: startMsg.transferId,
      streamId: startMsg.streamId,
      chunkSize: 16384
    });

    // Let the sender push chunks into the 1 MiB in-flight window
    await new Promise((r) => setTimeout(r, 80));

    // WS_MAX_IN_FLIGHT = 1024 * 1024 = 1,048,576 bytes
    // Each chunk is 16,384 bytes, so 64 chunks = 1,048,576 bytes
    // The sender will send 64 chunks, then pause in the while loop because sentBytes - ackedBytes >= 1 MiB
    assert.ok(sentChunks.length >= 64, `Expected at least 64 chunks sent, got ${sentChunks.length}`);
    const pausedChunkCount = sentChunks.length;
    assert.equal(pausedChunkCount, 64, `Sender must pause at exactly 64 chunks (1 MiB), got ${pausedChunkCount}`);

    // Wait another 50ms without sending any ACKs to verify sender remains paused
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sentChunks.length, pausedChunkCount, 'Sender must NOT send any additional chunks while window is full');
    assert.ok(isWaitingReceived, 'Sender must have reported isWaitingForAck = true');

    // Simulate receiver acknowledging 512 KiB (32 chunks)
    const halfAckBytes = 512 * 1024;
    mockSc.emit('controlMessage', {
      type: 'file:ack',
      transferId: startMsg.transferId,
      streamId: startMsg.streamId,
      bytesReceived: halfAckBytes
    });

    // Give sender time to consume the freed credit and send up to next window limit
    await new Promise((r) => setTimeout(r, 80));

    // 64 + 32 = 96 chunks sent (1.5 MiB sent - 0.5 MiB acked = 1.0 MiB in-flight -> paused again)
    assert.equal(sentChunks.length, 96, `Sender should have sent 96 chunks after 512 KiB ack, got ${sentChunks.length}`);

    // Acknowledge remaining data incrementally and complete transfer
    mockSc.emit('controlMessage', {
      type: 'file:ack',
      transferId: startMsg.transferId,
      streamId: startMsg.streamId,
      bytesReceived: 3 * 1024 * 1024
    });

    await sendPromise;
    assert.equal(sentChunks.length, 192, 'All 192 chunks must be transmitted once all acks arrive');
  });

  it('server does not forward when bufferedAmount is over 4 MiB and sends PEER_SLOW at most once per second', () => {
    const sentToOwner = [];
    const sentToJoiner = [];

    const ownerWs = {
      readyState: 1,
      bufferedAmount: 0,
      send: (data) => sentToOwner.push(JSON.parse(data.toString()))
    };

    // Joiner receiver socket has 5 MiB bufferedAmount (> 4 MiB limit)
    const joinerWs = {
      readyState: 1,
      bufferedAmount: 5 * 1024 * 1024,
      send: (data) => sentToJoiner.push(data)
    };

    const mockRoomManager = {
      getSocketBinding: (ws) => {
        if (ws === ownerWs) {
          return { roomId: 'test-room-1', role: 'owner', peerId: 'peer-owner' };
        }
        return { roomId: 'test-room-1', role: 'joiner', peerId: 'peer-joiner' };
      },
      getRoom: () => ({
        roomId: 'test-room-1',
        status: 'connected',
        members: new Map([
          ['peer-owner', { role: 'owner', peerId: 'peer-owner' }],
          ['peer-joiner', { role: 'joiner', peerId: 'peer-joiner' }]
        ]),
        owner: { ws: ownerWs, peerId: 'peer-owner', role: 'owner' },
        joiner: { ws: joinerWs, peerId: 'peer-joiner', role: 'joiner' },
        touchActivity: () => {}
      }),
      getOtherPeer: (roomId, peerId) => {
        if (peerId === 'peer-owner') {
          return { ws: joinerWs, role: 'joiner', peerId: 'peer-joiner' };
        }
        return { ws: ownerWs, role: 'owner', peerId: 'peer-owner' };
      }
    };

    // Prepare a mock 16 KiB binary chunk frame (8-byte header: streamId uint32 + chunkIndex uint32)
    const dummyChunk = Buffer.alloc(16392);
    dummyChunk.writeUInt32BE(1, 0); // streamId = 1
    dummyChunk.writeUInt32BE(0, 4); // chunkIndex = 0

    // Frame 1: Should be dropped; PEER_SLOW sent to owner
    handleIncomingMessage(mockRoomManager, ownerWs, dummyChunk, true, '127.0.0.1');

    assert.equal(sentToJoiner.length, 0, 'Frame must NOT be forwarded to joiner when bufferedAmount > 4 MiB');
    assert.equal(sentToOwner.length, 1, 'Owner must receive PEER_SLOW warning');
    assert.equal(sentToOwner[0].code, ErrorCodes.PEER_SLOW);

    // Frame 2, 3, 4, 5 sent immediately within the same second
    for (let i = 0; i < 4; i++) {
      handleIncomingMessage(mockRoomManager, ownerWs, dummyChunk, true, '127.0.0.1');
    }

    assert.equal(sentToJoiner.length, 0, 'Frames must still NOT be forwarded to slow receiver');
    assert.equal(sentToOwner.length, 1, 'PEER_SLOW must be rate-limited to at most 1 per second');
  });

  it('missing acks for 20 s produce the interrupted state with file:cancel on both transports', async () => {
    const mockSc = new MockEmitter();
    mockSc.isConnected = true;

    const cancelledTransports = [];
    const controlMessages = [];

    mockSc.ws = {
      readyState: 1,
      bufferedAmount: 0,
      send: () => {}
    };

    mockSc.send = (msg) => {
      controlMessages.push(msg);
      if (msg.type === 'file:cancel') {
        cancelledTransports.push({ transport: 'websocket', msg });
      }
    };
    mockSc.sendControl = mockSc.send;
    mockSc.sendFileChunk = () => {};

    const mockPc = new MockEmitter();
    mockPc.controlChannel = { readyState: 'open' };
    mockPc.sendControl = (msg) => {
      if (msg.type === 'file:cancel') {
        cancelledTransports.push({ transport: 'webrtc-dc', msg });
      }
    };

    const sender = new FileTransferManager(mockPc, mockSc);
    // Use a short ack timeout for test verification
    sender.ackTimeoutMs = 50;

    const testFile = new File([new Uint8Array(2 * 1024 * 1024)], 'timeout-test.bin');

    let capturedError = null;
    sender.on('transferError', (err) => {
      capturedError = err;
    });

    const sendPromise = sender.sendFile(testFile);

    // Wait a tick and grab the actual file:start message
    await new Promise((r) => setTimeout(r, 20));
    const startMsg = controlMessages.find((m) => m.type === 'file:start');
    assert.ok(startMsg, 'file:start must be emitted');

    // Simulate receiver ready
    mockSc.emit('controlMessage', {
      type: 'file:ready',
      transferId: startMsg.transferId,
      streamId: startMsg.streamId,
      chunkSize: 16384
    });

    // Sender pushes 1 MiB and then blocks waiting for ack. The timeout fires after 50ms.
    try {
      await sendPromise;
      assert.fail('Expected sendFile to reject with Transfer interrupted');
    } catch (err) {
      assert.equal(err.message, 'Transfer interrupted');
    }

    assert.ok(capturedError, 'transferError event must be emitted');
    assert.equal(capturedError.code, 'TRANSFER_INTERRUPTED');
    assert.equal(capturedError.message, 'Transfer interrupted');

    // Verify file:cancel was sent on both transports
    assert.ok(
      cancelledTransports.some((c) => c.transport === 'websocket'),
      'file:cancel must be sent on websocket'
    );
    assert.ok(
      cancelledTransports.some((c) => c.transport === 'webrtc-dc'),
      'file:cancel must be sent on webrtc-dc'
    );
  });

  it('per-room and per-IP caps trigger RELAY_LIMIT_REACHED', () => {
    const limiter = new RelayLimiter();

    const senderWs = { readyState: 1 };
    const receiverWs = { readyState: 1, bufferedAmount: 0 };

    // Test 1: Per-Room Cap
    const originalRoomCap = config.relayMaxBytesPerRoom;
    config.relayMaxBytesPerRoom = 100 * 1024; // 100 KiB

    try {
      // Stream 60 KiB: allowed
      const res1 = limiter.checkRelay({
        senderWs,
        receiverWs,
        roomId: 'room-cap-test',
        senderPeerId: 'peer-1',
        clientIp: '10.0.0.1',
        chunkLength: 60 * 1024
      });
      assert.equal(res1.allowed, true);

      // Stream another 30 KiB: cumulative 90 KiB: allowed
      const res2 = limiter.checkRelay({
        senderWs,
        receiverWs,
        roomId: 'room-cap-test',
        senderPeerId: 'peer-1',
        clientIp: '10.0.0.1',
        chunkLength: 30 * 1024
      });
      assert.equal(res2.allowed, true);

      // Stream another 20 KiB: cumulative 110 KiB > 100 KiB: rejected
      const res3 = limiter.checkRelay({
        senderWs,
        receiverWs,
        roomId: 'room-cap-test',
        senderPeerId: 'peer-1',
        clientIp: '10.0.0.1',
        chunkLength: 20 * 1024
      });
      assert.equal(res3.allowed, false);
      assert.equal(res3.error, ErrorCodes.RELAY_LIMIT_REACHED);
      assert.match(res3.message, /Relay limit reached/);
    } finally {
      config.relayMaxBytesPerRoom = originalRoomCap;
    }

    // Test 2: Per-IP Daily Cap
    const originalIpCap = config.relayMaxBytesPerIpPerDay;
    config.relayMaxBytesPerIpPerDay = 50 * 1024; // 50 KiB

    try {
      const resIp1 = limiter.checkRelay({
        senderWs,
        receiverWs,
        roomId: 'fresh-room',
        senderPeerId: 'peer-1',
        clientIp: '192.168.1.50',
        chunkLength: 40 * 1024
      });
      assert.equal(resIp1.allowed, true);

      // Exceeds 50 KiB
      const resIp2 = limiter.checkRelay({
        senderWs,
        receiverWs,
        roomId: 'fresh-room',
        senderPeerId: 'peer-1',
        clientIp: '192.168.1.50',
        chunkLength: 20 * 1024
      });
      assert.equal(resIp2.allowed, false);
      assert.equal(resIp2.error, ErrorCodes.RELAY_LIMIT_REACHED);
    } finally {
      config.relayMaxBytesPerIpPerDay = originalIpCap;
    }
  });

  it('concurrent relay rooms limit triggers RELAY_LIMIT_REACHED', () => {
    const limiter = new RelayLimiter();
    const senderWs = { readyState: 1 };
    const receiverWs = { readyState: 1, bufferedAmount: 0 };

    const originalConcurrentLimit = config.relayMaxConcurrentRelayRooms;
    config.relayMaxConcurrentRelayRooms = 2;

    try {
      // Room 1 streams
      const resR1 = limiter.checkRelay({
        senderWs,
        receiverWs,
        roomId: 'room-1',
        senderPeerId: 'p1',
        clientIp: '1.1.1.1',
        chunkLength: 1024
      });
      assert.equal(resR1.allowed, true);

      // Room 2 streams
      const resR2 = limiter.checkRelay({
        senderWs,
        receiverWs,
        roomId: 'room-2',
        senderPeerId: 'p2',
        clientIp: '1.1.1.2',
        chunkLength: 1024
      });
      assert.equal(resR2.allowed, true);

      // Room 3 attempts to stream: limit 2 exceeded
      const resR3 = limiter.checkRelay({
        senderWs,
        receiverWs,
        roomId: 'room-3',
        senderPeerId: 'p3',
        clientIp: '1.1.1.3',
        chunkLength: 1024
      });
      assert.equal(resR3.allowed, false);
      assert.equal(resR3.error, ErrorCodes.RELAY_LIMIT_REACHED);

      // After room 1 is cleaned up, room 3 can stream
      limiter.cleanupRoom('room-1');
      const resR3Retry = limiter.checkRelay({
        senderWs,
        receiverWs,
        roomId: 'room-3',
        senderPeerId: 'p3',
        clientIp: '1.1.1.3',
        chunkLength: 1024
      });
      assert.equal(resR3Retry.allowed, true);
    } finally {
      config.relayMaxConcurrentRelayRooms = originalConcurrentLimit;
    }
  });
});

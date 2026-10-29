import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { SignalingClient } from '../../../client/src/services/signalingClient.js';

describe('SignalingClient startFreshSession', () => {
  let createdSockets = [];
  let origWebSocket;

  beforeEach(() => {
    createdSockets = [];
    origWebSocket = globalThis.WebSocket;

    class MockWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        this.url = url;
        this.readyState = 0; // CONNECTING
        this.binaryType = 'blob';
        this.sentMessages = [];
        this.onopen = null;
        this.onclose = null;
        this.onerror = null;
        this.onmessage = null;
        createdSockets.push(this);

        // Simulate async socket open after microtask
        setTimeout(() => {
          if (this.readyState === 0) {
            this.readyState = 1; // OPEN
            if (this.onopen) {
              this.onopen({ type: 'open' });
            }
          }
        }, 15);
      }

      send(data) {
        if (this.readyState !== 1) {
          throw new Error('WebSocket is not open');
        }
        this.sentMessages.push(typeof data === 'string' ? JSON.parse(data) : data);
      }

      close(code = 1000, reason = 'Normal') {
        this.readyState = 3; // CLOSED
        if (this.onclose) {
          this.onclose({ code, reason });
        }
      }
    }

    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = origWebSocket;
  });

  it('closed room -> startFreshSession -> room:create is sent exactly once on a fresh socket; repeat 3 times in a row', async () => {
    const client = new SignalingClient();

    for (let iteration = 1; iteration <= 3; iteration++) {
      const deviceName = `Device-Session-${iteration}`;

      // 1. Trigger startFreshSession on closed or fresh state
      const startPromise = client.startFreshSession(deviceName, 'ws://localhost:5000');
      await startPromise;

      // 2. Verify a fresh socket was created for this iteration
      assert.equal(createdSockets.length, iteration, `Iteration ${iteration} must create a new socket instance`);
      const currentSocket = createdSockets[iteration - 1];

      // 3. Verify socket is connected and open
      assert.equal(currentSocket.readyState, 1 /* OPEN */);
      assert.equal(client.isConnected, true);

      // 4. Verify room:create was sent EXACTLY ONCE on this socket
      const createMessages = currentSocket.sentMessages.filter(m => m.type === 'room:create');
      assert.equal(createMessages.length, 1, `room:create must be sent exactly once in iteration ${iteration}`);
      assert.equal(createMessages[0].deviceName, deviceName);
      assert.equal(createMessages[0].version, 1);

      // 5. Verify no stale rejoin or other message was sent
      const rejoinMessages = currentSocket.sentMessages.filter(m => m.type === 'room:rejoin');
      assert.equal(rejoinMessages.length, 0, `No room:rejoin should be sent during fresh session start`);

      // 6. Simulate room closing / socket termination by server
      currentSocket.close(1000, 'Room closed');
      assert.equal(currentSocket.readyState, 3 /* CLOSED */);
      assert.equal(client.isConnected, false);
    }

    client.disconnect();
  });

  it('listener duplication: verifies that after 3 consecutive startFreshSession() calls each event fires its handler exactly once', async () => {
    const client = new SignalingClient();

    let connectedInvocations = 0;
    let roomClosedInvocations = 0;
    let textMessageInvocations = 0;

    // Simulate hook listener registration
    const handleConnected = () => connectedInvocations++;
    const handleRoomClosed = () => roomClosedInvocations++;
    const handleTextMessage = () => textMessageInvocations++;

    client.on('connected', handleConnected);
    client.on('roomClosed', handleRoomClosed);
    client.on('textMessage', handleTextMessage);

    // Run 3 consecutive startFreshSession calls
    for (let i = 1; i <= 3; i++) {
      await client.startFreshSession(`Device-${i}`, 'ws://localhost:5000');
    }

    // Now emit each event once
    client.emit('roomClosed', { type: 'room:closed', reason: 'closed_by_owner' });
    client.emit('textMessage', { type: 'text', text: 'Hello' });

    // Each event must have invoked its handler EXACTLY once, proving no duplicate listeners were registered
    assert.equal(roomClosedInvocations, 1, 'roomClosed handler must be invoked exactly once');
    assert.equal(textMessageInvocations, 1, 'textMessage handler must be invoked exactly once');

    // Connected was emitted once per startFreshSession (3 times total across 3 sessions, never multiplied)
    assert.equal(connectedInvocations, 3, 'connected handler must be invoked exactly 3 times across 3 sessions (once per session)');

    // Now verify cleanup with client.off removes the listeners completely
    client.off('connected', handleConnected);
    client.off('roomClosed', handleRoomClosed);
    client.off('textMessage', handleTextMessage);

    client.emit('roomClosed', { type: 'room:closed' });
    client.emit('textMessage', { type: 'text' });

    assert.equal(roomClosedInvocations, 1, 'No additional invocations after client.off');
    assert.equal(textMessageInvocations, 1, 'No additional invocations after client.off');

    client.disconnect();
  });
});

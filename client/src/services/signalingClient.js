import { debugLogger } from '../utils/debugLogger.js';

/**
 * SignalingClient manages the WebSocket connection and protocol message handling
 * with the QuickDrop signaling server.
 */
export class SignalingClient {
  constructor() {
    /** @type {WebSocket | null} */
    this.ws = null;
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
    this.isConnected = false;
    this.serverUrl = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectTimer = null;
    this.explicitClose = false;
    this.activeSession = null;

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (!this.isConnected && this.serverUrl && !this.explicitClose) {
            this.connect(this.serverUrl).catch(() => {});
          }
        }
      });
    }
  }

  /**
   * Set active room session to enable seamless rejoin on reconnect.
   * @param {{ roomId: string, peerId: string, peerSecret: string, deviceName?: string }} session
   */
  setActiveSession(session) {
    this.activeSession = session;
  }

  /**
   * Clear stored room session on room close, leave or expiry.
   */
  clearActiveSession() {
    this.activeSession = null;
  }

  /**
   * Subscribe to signaling events.
   * @param {string} event
   * @param {Function} handler
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
  }

  /**
   * Unsubscribe from signaling events.
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Internal event emitter.
   * @param {string} event
   * @param {any} [data]
   */
  emit(event, data) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`Error in event handler for ${event}:`, err);
        }
      }
    }
  }

  /**
   * Establish WebSocket connection.
   * @param {string} url
   * @returns {Promise<void>}
   */
  connect(url) {
    this.serverUrl = url;
    this.explicitClose = false;

    return new Promise((resolve, reject) => {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return resolve();
      }

      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        return reject(err);
      }

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        try {
          this.ws.binaryType = 'arraybuffer';
        } catch {
          // ignore
        }
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        debugLogger.logStateChange('WS', 'OPEN', null, null, this);
        this.emit('connected');

        if (this.activeSession && this.activeSession.roomId && this.activeSession.peerSecret) {
          try {
            this.rejoinRoom(
              this.activeSession.roomId,
              this.activeSession.peerId,
              this.activeSession.peerSecret,
              this.activeSession.deviceName
            );
          } catch (err) {
            console.warn('Failed to send rejoin on socket open:', err);
          }
        }

        resolve();
      };

      this.ws.onclose = (event) => {
        this.isConnected = false;
        debugLogger.logStateChange('WS', 'CLOSED', { code: event.code, reason: event.reason || 'none' }, null, this);
        this.emit('disconnected', { code: event.code, reason: event.reason });

        // Safe bounded reconnection attempt if not explicitly closed
        if (!this.explicitClose && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        debugLogger.logStateChange('WS', 'ERROR', err?.message || 'WebSocket error', null, this);
        this.emit('error', err);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    });
  }

  /**
   * Schedule a safe reconnect attempt with exponential backoff (1s, 2s, 4s).
   */
  scheduleReconnect() {
    if (this.reconnectTimer || this.explicitClose || !this.serverUrl) return;

    this.reconnectAttempts++;
    const delay = Math.min(10000, Math.pow(2, this.reconnectAttempts - 1) * 1000);

    debugLogger.logStateChange('WS', 'RECONNECTING', { attempt: this.reconnectAttempts, max: this.maxReconnectAttempts, delay }, null, this);
    this.emit('reconnecting', { attempt: this.reconnectAttempts, max: this.maxReconnectAttempts, delay });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.explicitClose && this.serverUrl) {
        this.connect(this.serverUrl).catch(() => {});
      }
    }, delay);
  }

  /**
   * Parse and dispatch incoming message from server.
   * @param {string} rawData
   */
  handleMessage(rawData) {
    if (rawData instanceof ArrayBuffer) {
      debugLogger.logIncoming('file:chunk', 'websocket', null, this, { size: rawData.byteLength });
      this.emit('fileChunk', rawData);
      return;
    }
    if (typeof Blob !== 'undefined' && rawData instanceof Blob) {
      rawData.arrayBuffer().then((buf) => {
        debugLogger.logIncoming('file:chunk', 'websocket', null, this, { size: buf.byteLength });
        this.emit('fileChunk', buf);
      }).catch(() => {});
      return;
    }

    let message;
    try {
      message = JSON.parse(rawData);
    } catch {
      console.warn('Received malformed JSON message from signaling server');
      return;
    }

    if (!message || typeof message.type !== 'string') return;
    debugLogger.logIncoming(message.type, 'websocket', null, this, message);

    switch (message.type) {
      case 'file:start':
      case 'file:ready':
      case 'file:complete':
      case 'file:cancel':
        this.emit('controlMessage', message);
        this.emit(message.type, message);
        break;
      case 'room:created':
      case 'room':
        if (message.joinToken) {
          this.emit('roomCreated', message);
        } else if (message.peerId) {
          this.emit('roomJoined', message);
        }
        break;

      case 'room:joined':
        this.emit('roomJoined', message);
        break;

      case 'room:rejoined':
        this.emit('roomRejoined', message);
        break;

      case 'peer:joined':
      case 'peer':
        this.emit('peerJoined', message);
        break;

      case 'peer:disconnected':
        this.emit('peerDisconnected', message);
        break;

      case 'peer:reconnected':
        this.emit('peerReconnected', message);
        break;

      case 'peer:left':
        this.emit('peerLeft', message);
        break;

      case 'text':
        this.emit('textMessage', message);
        break;

      case 'text:ack':
        this.emit('textAck', message);
        break;

      case 'rtc:offer':
        this.emit('rtc:offer', message);
        break;

      case 'rtc:answer':
        this.emit('rtc:answer', message);
        break;

      case 'rtc:ice-candidate':
        this.emit('rtc:ice-candidate', message);
        break;

      case 'room:closed':
        this.emit('roomClosed', message);
        break;

      case 'room:expired':
        this.emit('roomExpired', message);
        break;

      case 'room:error':
        if (['INVALID_ROOM', 'INVALID_TOKEN', 'INVALID_REJOIN', 'ROOM_EXPIRED', 'ROOM_FULL', 'TOKEN_USED'].includes(message.code)) {
          this.clearActiveSession();
        }
        this.emit('roomError', message);
        break;

      case 'pong':
        this.emit('pong');
        break;

      default:
        console.warn('Unhandled message type:', message.type);
    }
  }

  /**
   * Send JSON message over WebSocket.
   * @param {object} payload
   */
  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    debugLogger.logOutgoing(payload?.type || 'unknown', 'websocket', null, this, payload);
    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Send room creation request.
   * @param {string} deviceName
   */
  createRoom(deviceName) {
    this.send({
      type: 'room:create',
      version: 1,
      deviceName
    });
  }

  /**
   * Send room join request.
   * @param {string} roomId
   * @param {string} joinToken
   * @param {string} deviceName
   */
  joinRoom(roomId, joinToken, deviceName) {
    this.send({
      type: 'room:join',
      version: 1,
      roomId,
      joinToken,
      deviceName
    });
  }

  /**
   * Send room rejoin request with persistent peer secret.
   * Never logs peer secret.
   * @param {string} roomId
   * @param {string} peerId
   * @param {string} peerSecret
   * @param {string} [deviceName]
   */
  rejoinRoom(roomId, peerId, peerSecret, deviceName) {
    this.send({
      type: 'room:rejoin',
      version: 1,
      roomId,
      peerId,
      peerSecret,
      deviceName
    });
  }

  /**
   * Send text message to the other peer in the room.
   * @param {string} text
   * @param {string} clientMessageId
   */
  sendTextMessage(text, clientMessageId) {
    this.send({
      type: 'text',
      version: 1,
      clientMessageId,
      text
    });
  }

  /**
   * Explicitly close the room (owner action).
   */
  closeRoom() {
    this.send({
      type: 'room:close',
      version: 1
    });
  }

  /**
   * Cleanly disconnect the WebSocket and remove all event listeners.
   */
  disconnect() {
    this.explicitClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.listeners.clear();
  }
}

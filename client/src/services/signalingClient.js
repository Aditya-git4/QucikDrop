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
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.emit('connected');
        resolve();
      };

      this.ws.onclose = (event) => {
        this.isConnected = false;
        this.emit('disconnected', { code: event.code, reason: event.reason });

        // Safe bounded reconnection attempt if not explicitly closed
        if (!this.explicitClose && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
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
    let message;
    try {
      message = JSON.parse(rawData);
    } catch {
      console.warn('Received malformed JSON message from signaling server');
      return;
    }

    if (!message || typeof message.type !== 'string') return;

    switch (message.type) {
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

      case 'peer:joined':
      case 'peer':
        this.emit('peerJoined', message);
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

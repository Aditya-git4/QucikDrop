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
   * Resolves only when the connection is fully open.
   * @param {string} url
   * @returns {Promise<void>}
   */
  connect(url) {
    this.serverUrl = url;
    this.explicitClose = false;

    return new Promise((resolve, reject) => {
      // 1. If already OPEN, resolve immediately
      if (this.ws && this.ws.readyState === 1 /* OPEN */) {
        return resolve();
      }

      // 2. If currently CONNECTING, wait for it to open or fail
      if (this.ws && this.ws.readyState === 0 /* CONNECTING */) {
        const onOpen = () => {
          cleanup();
          resolve();
        };
        const onClose = (e) => {
          cleanup();
          reject(new Error(`WebSocket closed before connecting (code: ${e?.code})`));
        };
        const onError = (e) => {
          cleanup();
          reject(new Error(e?.message || 'WebSocket connection error'));
        };
        const cleanup = () => {
          if (this.ws) {
            this.ws.removeEventListener?.('open', onOpen);
            this.ws.removeEventListener?.('close', onClose);
            this.ws.removeEventListener?.('error', onError);
          }
        };
        if (typeof this.ws.addEventListener === 'function') {
          this.ws.addEventListener('open', onOpen);
          this.ws.addEventListener('close', onClose);
          this.ws.addEventListener('error', onError);
        } else {
          const origOpen = this.ws.onopen;
          this.ws.onopen = (e) => {
            if (origOpen) origOpen(e);
            onOpen();
          };
          const origClose = this.ws.onclose;
          this.ws.onclose = (e) => {
            if (origClose) origClose(e);
            onClose(e);
          };
        }
        return;
      }

      const WsClass = typeof WebSocket !== 'undefined' ? WebSocket : globalThis.WebSocket;
      if (!WsClass) {
        return reject(new Error('WebSocket is not supported in this environment'));
      }

      try {
        this.ws = new WsClass(url);
      } catch (err) {
        return reject(err);
      }

      let settled = false;
      const connectionTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try {
            this.ws?.close();
          } catch {
            // ignore
          }
          reject(new Error('Signaling server connection timed out'));
        }
      }, 10000);

      this.ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectionTimer);

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
        if (!settled) {
          settled = true;
          clearTimeout(connectionTimer);
          reject(new Error(`WebSocket closed before connecting (code: ${event.code})`));
          return;
        }

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
        if (!settled) {
          settled = true;
          clearTimeout(connectionTimer);
          reject(new Error(err?.message || 'WebSocket connection error'));
        }
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
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) {
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
   * Explicitly leave the room (guest action).
   */
  leaveRoom() {
    this.send({
      type: 'room:leave',
      version: 1
    });
  }

  /**
   * Start a fresh session: cancels reconnect timers, clears activeSession, resets intentionalClose flag,
   * cleanly closes any old socket, opens a fresh WebSocket, waits for onopen, and sends room:create once.
   * @param {string} [deviceName]
   * @param {string} [url]
   * @returns {Promise<void>}
   */
  async startFreshSession(deviceName, url = null) {
    this.clearActiveSession();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.explicitClose = false;

    // Force close any existing socket and remove handlers to avoid side effects
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.isConnected = false;

    const targetUrl = url || this.serverUrl;
    if (!targetUrl) {
      throw new Error('Signaling server URL is not configured');
    }

    // Connect fresh socket and WAIT for onopen
    await this.connect(targetUrl);

    // Send room:create once on the fresh open socket
    this.createRoom(deviceName);
  }

  /**
   * Cleanly disconnect the WebSocket and clear reconnect state.
   * Does NOT wipe event subscribers so UI hooks remain registered.
   */
  disconnect() {
    this.explicitClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.isConnected = false;
    this.reconnectAttempts = 0;
  }
}

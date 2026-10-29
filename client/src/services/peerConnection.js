import { debugLogger, isRelayModeEnabled } from '../utils/debugLogger.js';

/**
 * Classify connection type based on local and remote candidate types.
 * @param {string | undefined} localType
 * @param {string | undefined} remoteType
 * @returns {'relay' | 'lan' | 'direct'}
 */
export function classifyCandidatePair(localType, remoteType) {
  if (localType === 'relay' || remoteType === 'relay') {
    return 'relay';
  }
  if (localType === 'host' && remoteType === 'host') {
    return 'lan';
  }
  return 'direct';
}

/**
 * Default WebRTC STUN servers for client discovery.
 */
export const DEFAULT_CLIENT_ICE_SERVERS = [
  {
    urls: [
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
      'stun:stun2.l.google.com:19302',
      'stun:stun.cloudflare.com:3478',
      'stun:stun.services.mozilla.com:3478'
    ]
  }
];

/**
 * PeerConnectionManager handles the lifecycle of an RTCPeerConnection,
 * STUN/TURN candidate exchange, candidate queueing, and RTCDataChannel management.
 */
export class PeerConnectionManager {
  constructor(options = {}) {
    this.iceServers = options.iceServers || DEFAULT_CLIENT_ICE_SERVERS;

    /** @type {RTCPeerConnection | null} */
    this.pc = null;
    /** @type {RTCDataChannel | null} */
    this.controlChannel = null;
    /** @type {RTCDataChannel | null} */
    this.fileChannel = null;

    /** @type {RTCIceCandidateInit[]} */
    this.iceCandidateQueue = [];
    this.isRemoteDescriptionSet = false;

    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();

    this.connectionState = 'disconnected';
    this.connectionType = 'unknown'; // 'unknown' | 'lan' | 'direct' | 'relay'
    /** @type {object | null} */
    this.connectionStats = null;
    this.statsTimer = null;
    this.bufferedThreshold = 65536; // 64 KiB backpressure limit

    // P2P DataChannel Heartbeat & Health Monitoring (Step 3)
    this.isP2PHealthy = false;
    this.heartbeatTimer = null;
    this.lastPongReceivedAt = 0;
    this.heartbeatIntervalMs = 3000; // 3 seconds
    this.heartbeatTimeoutMs = 10000; // 10 seconds
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
  }

  off(event, handler) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  emit(event, data) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`Error in PeerConnection event [${event}]:`, err);
        }
      }
    }
  }

  /**
   * Initialize a new RTCPeerConnection instance.
   */
  initPeerConnection() {
    if (this.pc) {
      try {
        this.controlChannel?.close();
      } catch {
        // ignore
      }
      try {
        this.fileChannel?.close();
      } catch {
        // ignore
      }
      try {
        this.pc.close();
      } catch {
        // ignore
      }
      this.controlChannel = null;
      this.fileChannel = null;
      this.pc = null;
    }

    if (isRelayModeEnabled()) {
      debugLogger.logStateChange('PC', 'disabled_relay_mode', { reason: 'WebRTC disabled via ?relay=1' }, this);
      return;
    }

    this.pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.isRemoteDescriptionSet = false;
    if (!this.iceCandidateQueue) {
      this.iceCandidateQueue = [];
    }

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        const cand = event.candidate.toJSON();
        debugLogger.logStateChange('ICE:candidate', cand.type || cand.candidate?.split(' ')[7] || 'gen', cand, this);
        this.emit('iceCandidate', cand);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      if (!this.pc) return;
      debugLogger.logStateChange('ICE', this.pc.iceConnectionState, null, this);
      this.handleStateChange(this.pc.iceConnectionState);
    };

    this.pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      debugLogger.logStateChange('PC', this.pc.connectionState, null, this);
      this.handleStateChange(this.pc.connectionState);
    };

    // When remote peer creates data channels (Answerer side)
    this.pc.ondatachannel = (event) => {
      const channel = event.channel;
      if (channel.label === 'control') {
        this.setupControlChannel(channel);
      } else if (channel.label === 'file') {
        this.setupFileChannel(channel);
      }
    };
  }

  /**
   * Update the ICE server configuration (STUN/TURN).
   * @param {Array<{ urls: string | string[], username?: string, credential?: string }>} servers
   */
  setIceServers(servers) {
    if (Array.isArray(servers) && servers.length > 0) {
      this.iceServers = servers;
      if (this.pc && typeof this.pc.setConfiguration === 'function') {
        try {
          this.pc.setConfiguration({ iceServers: this.iceServers });
        } catch (err) {
          console.warn('Could not dynamically update RTCPeerConnection configuration:', err);
        }
      }
    }
  }

  handleStateChange(state) {
    this.connectionState = state;
    this.emit('statusChange', state);

    if (state === 'connected') {
      this.startStatsPolling();
      this.updateConnectionStats();
      this.startHeartbeat();
      this.checkReadyState();
    } else if (['failed', 'disconnected', 'closed'].includes(state)) {
      this.markP2PUnhealthy('pc_state_' + state);
      this.stopStatsPolling();
      this.connectionType = 'unknown';
      this.connectionStats = null;
      this.emit('connectionType', 'unknown');
      this.emit('connectionStats', null);
    }
  }

  /**
   * Set up the control DataChannel for chat and file metadata.
   * @param {RTCDataChannel} channel
   */
  setupControlChannel(channel) {
    this.controlChannel = channel;

    channel.onopen = () => {
      debugLogger.logStateChange('DC', 'control:open', null, this);
      this.lastPongReceivedAt = Date.now();
      this.isP2PHealthy = true;
      this.startHeartbeat();
      this.checkReadyState();
    };

    channel.onclose = () => {
      debugLogger.logStateChange('DC', 'control:closed', null, this);
      this.stopHeartbeat();
      this.markP2PUnhealthy('control_closed');
      this.emit('statusChange', 'disconnected');
    };

    channel.onerror = (err) => {
      debugLogger.logStateChange('DC', 'control:error', err?.message || err, this);
      this.markP2PUnhealthy('control_error');
      this.emit('error', err);
    };

    channel.onmessage = (event) => {
      this.lastPongReceivedAt = Date.now();
      try {
        const parsed = JSON.parse(event.data);

        // Internal P2P Heartbeat Ping / Pong handling
        if (parsed?.type === '__dc_ping__') {
          try {
            channel.send(JSON.stringify({ type: '__dc_pong__', pingSentAt: parsed.sentAt }));
          } catch {
            // ignore
          }
          return;
        }
        if (parsed?.type === '__dc_pong__') {
          this.lastPongReceivedAt = Date.now();
          if (!this.isP2PHealthy) {
            this.markP2PHealthy();
          }
          return;
        }

        // App-level chat ACK reply over the same DataChannel
        if (parsed?.type === 'chat' && parsed.clientMessageId) {
          try {
            channel.send(JSON.stringify({
              type: 'chat:ack',
              clientMessageId: parsed.clientMessageId,
              ackAt: Date.now()
            }));
          } catch (err) {
            console.warn('Failed to send chat:ack over DataChannel:', err);
          }
        }

        debugLogger.logIncoming(parsed.type || 'control', 'webrtc-dc', this, null, parsed);
        this.emit('controlMessage', parsed);
      } catch (err) {
        console.warn('Received unparseable message on control channel:', err);
      }
    };
  }

  /**
   * Set up the binary file DataChannel for chunks.
   * @param {RTCDataChannel} channel
   */
  setupFileChannel(channel) {
    this.fileChannel = channel;
    this.fileChannel.binaryType = 'arraybuffer';
    this.fileChannel.bufferedAmountLowThreshold = this.bufferedThreshold;

    channel.onopen = () => {
      debugLogger.logStateChange('DC', 'file:open', null, this);
      this.checkReadyState();
    };

    channel.onclose = () => {
      debugLogger.logStateChange('DC', 'file:closed', null, this);
      this.emit('statusChange', 'disconnected');
    };

    channel.onerror = (err) => {
      debugLogger.logStateChange('DC', 'file:error', err?.message || err, this);
      this.emit('error', err);
    };

    channel.onmessage = (event) => {
      this.lastPongReceivedAt = Date.now();
      if (event.data instanceof ArrayBuffer) {
        debugLogger.logIncoming('file:chunk', 'webrtc-dc', this, null, { size: event.data.byteLength });
        this.emit('fileChunk', event.data);
      }
    };
  }

  checkReadyState() {
    const isControlOpen = this.controlChannel && this.controlChannel.readyState === 'open';
    const isFileOpen = this.fileChannel && this.fileChannel.readyState === 'open';
    const isPcConnected = this.pc && this.pc.connectionState === 'connected';

    // Heartbeat check requirement: both channels open and pc.connectionState === 'connected'
    if (isControlOpen && isFileOpen && isPcConnected && this.isP2PHealthy) {
      this.emit('ready');
      this.startStatsPolling();
      this.updateConnectionStats();
    }
  }

  /**
   * Start 3-second control channel ping heartbeat.
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.runHeartbeatCheck();
    }, this.heartbeatIntervalMs);
    if (this.heartbeatTimer?.unref) {
      this.heartbeatTimer.unref();
    }
  }

  /**
   * Stop active heartbeat timer.
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Heartbeat interval check: verifies PC state, control channel state, pong arrival threshold, and transmits ping.
   */
  runHeartbeatCheck() {
    if (!this.pc || ['failed', 'disconnected', 'closed'].includes(this.pc.connectionState)) {
      this.markP2PUnhealthy('pc_state_' + (this.pc ? this.pc.connectionState : 'none'));
      return;
    }

    if (!this.controlChannel || this.controlChannel.readyState !== 'open') {
      this.markP2PUnhealthy('control_channel_not_open');
      return;
    }

    const timeSinceLastPong = Date.now() - this.lastPongReceivedAt;
    if (timeSinceLastPong > this.heartbeatTimeoutMs) {
      this.markP2PUnhealthy(`pong_timeout_${timeSinceLastPong}ms`);
      // Keep sending pings so remote peer can respond and restore health
    }

    try {
      this.controlChannel.send(JSON.stringify({ type: '__dc_ping__', sentAt: Date.now() }));
    } catch (err) {
      this.markP2PUnhealthy('ping_send_error_' + err.message);
    }
  }

  /**
   * Mark P2P connection unhealthy, falling back to WebSocket.
   * @param {string} reason
   */
  markP2PUnhealthy(reason) {
    if (this.isP2PHealthy) {
      this.isP2PHealthy = false;
      debugLogger.logStateChange('WEBRTC', 'p2p_unhealthy', { reason }, this);
      this.emit('healthChange', false);
      this.emit('unhealthy', reason);
    }
  }

  /**
   * Mark P2P connection healthy.
   */
  markP2PHealthy() {
    if (!this.isP2PHealthy) {
      this.isP2PHealthy = true;
      debugLogger.logStateChange('WEBRTC', 'p2p_healthy', null, this);
      this.emit('healthChange', true);
      this.emit('ready');
      this.checkReadyState();
    }
  }

  /**
   * Periodically poll connection stats while connected.
   */
  startStatsPolling() {
    this.stopStatsPolling();
    this.statsTimer = setInterval(() => {
      this.updateConnectionStats();
    }, 3000);
    if (this.statsTimer?.unref) {
      this.statsTimer.unref();
    }
  }

  /**
   * Stop polling connection stats.
   */
  stopStatsPolling() {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  /**
   * Inspect active WebRTC candidate pairs and determine if the connection is direct or relayed.
   * @returns {Promise<object | null>}
   */
  async updateConnectionStats() {
    if (!this.pc || typeof this.pc.getStats !== 'function') return null;

    try {
      const stats = await this.pc.getStats();
      if (!stats) return null;

      let selectedPair = null;

      // 1. Standard WebRTC: find candidate-pair via transport report
      for (const report of stats.values()) {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          selectedPair = stats.get(report.selectedCandidatePairId);
          break;
        }
      }

      // 2. Candidate-pair with selected=true or nominated=true with state=succeeded
      if (!selectedPair) {
        for (const report of stats.values()) {
          if (
            report.type === 'candidate-pair' &&
            (report.selected === true || (report.nominated === true && report.state === 'succeeded'))
          ) {
            selectedPair = report;
            break;
          }
        }
      }

      // 3. Fallback: any succeeded candidate pair
      if (!selectedPair) {
        for (const report of stats.values()) {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            selectedPair = report;
            break;
          }
        }
      }

      if (!selectedPair) return null;

      const localCandidate = stats.get(selectedPair.localCandidateId);
      const remoteCandidate = stats.get(selectedPair.remoteCandidateId);

      const localType = localCandidate?.candidateType || 'unknown';
      const remoteType = remoteCandidate?.candidateType || 'unknown';
      const connectionType = classifyCandidatePair(localType, remoteType);
      const isRelayed = connectionType === 'relay';

      const rtt =
        typeof selectedPair.currentRoundTripTime === 'number'
          ? Math.round(selectedPair.currentRoundTripTime * 1000)
          : typeof selectedPair.roundTripTime === 'number'
          ? Math.round(selectedPair.roundTripTime * 1000)
          : null;

      const info = {
        connectionType, // 'lan' | 'direct' | 'relay'
        isRelayed,
        localCandidateType: localType,
        remoteCandidateType: remoteType,
        protocol: localCandidate?.protocol || remoteCandidate?.protocol || 'udp',
        rtt
      };

      this.connectionType = connectionType;
      this.connectionStats = info;
      this.emit('connectionType', connectionType);
      this.emit('connectionStats', info);

      return info;
    } catch (err) {
      console.warn('Could not read WebRTC connection stats:', err);
      return null;
    }
  }

  /**
   * Initiate WebRTC negotiation as Offerer (Host).
   * Creates data channels and returns offer SDP.
   * @returns {Promise<RTCSessionDescriptionInit>}
   */
  async createOffer() {
    this.initPeerConnection();

    // Create DataChannels on the Offerer side
    const control = this.pc.createDataChannel('control', { ordered: true });
    this.setupControlChannel(control);

    const file = this.pc.createDataChannel('file', { ordered: true });
    this.setupFileChannel(file);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    return offer;
  }

  /**
   * Handle incoming offer and create answer as Answerer (Guest).
   * @param {RTCSessionDescriptionInit} offer
   * @returns {Promise<RTCSessionDescriptionInit>}
   */
  async handleOffer(offer) {
    this.initPeerConnection();

    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    this.isRemoteDescriptionSet = true;
    await this.drainIceCandidateQueue();

    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    return answer;
  }

  /**
   * Handle incoming answer as Offerer.
   * @param {RTCSessionDescriptionInit} answer
   */
  async handleAnswer(answer) {
    if (!this.pc) return;

    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    this.isRemoteDescriptionSet = true;
    await this.drainIceCandidateQueue();
  }

  /**
   * Handle incoming ICE candidate with safe queueing for early arrival.
   * @param {RTCIceCandidateInit} candidate
   */
  async addIceCandidate(candidate) {
    if (!candidate) return;

    if (!this.iceCandidateQueue) {
      this.iceCandidateQueue = [];
    }

    // If PC is not yet created, or remote description is not set yet, queue the candidate!
    if (!this.pc || !this.isRemoteDescriptionSet || !this.pc.remoteDescription) {
      this.iceCandidateQueue.push(candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('Error adding ICE candidate:', err);
    }
  }

  /**
   * Drain queued candidates after remote description is applied.
   */
  async drainIceCandidateQueue() {
    if (!this.pc || !this.isRemoteDescriptionSet || !this.pc.remoteDescription) return;

    while (this.iceCandidateQueue && this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift();
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('Error draining ICE candidate from queue:', err);
      }
    }
  }

  /**
   * Send JSON payload on control channel.
   * @param {object} payload
   */
  sendControl(payload) {
    if (!this.controlChannel || this.controlChannel.readyState !== 'open') {
      throw new Error('WebRTC control channel is not open');
    }
    debugLogger.logOutgoing(payload?.type || 'control', 'webrtc-dc', this, null, payload);
    this.controlChannel.send(JSON.stringify(payload));
  }

  /**
   * Send binary ArrayBuffer on file channel.
   * @param {ArrayBuffer} chunk
   */
  sendFileChunk(chunk) {
    if (!this.fileChannel || this.fileChannel.readyState !== 'open') {
      throw new Error('WebRTC file channel is not open');
    }
    debugLogger.logOutgoing('file:chunk', 'webrtc-dc', this, null, { size: chunk?.byteLength });
    this.fileChannel.send(chunk);
  }

  /**
   * Backpressure helper: wait until bufferedAmount falls below threshold.
   * @returns {Promise<void>}
   */
  waitForBufferedAmountLow() {
    if (!this.fileChannel || this.fileChannel.bufferedAmount <= this.bufferedThreshold) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const onLow = () => {
        this.fileChannel?.removeEventListener('bufferedamountlow', onLow);
        resolve();
      };
      this.fileChannel.addEventListener('bufferedamountlow', onLow);
    });
  }

  /**
   * Wait until all queued bytes in fileChannel have been completely drained (bufferedAmount === 0).
   * @returns {Promise<void>}
   */
  waitForFileChannelDrained() {
    if (!this.fileChannel || this.fileChannel.bufferedAmount === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let timer = null;
      const cleanup = () => {
        if (timer) clearInterval(timer);
        try {
          this.fileChannel?.removeEventListener('bufferedamountlow', onLow);
        } catch {
          // ignore
        }
      };

      const onLow = () => {
        if (!this.fileChannel || this.fileChannel.bufferedAmount === 0) {
          cleanup();
          resolve();
        }
      };

      timer = setInterval(() => {
        if (!this.fileChannel || this.fileChannel.bufferedAmount === 0) {
          cleanup();
          resolve();
        }
      }, 10);

      this.fileChannel.addEventListener('bufferedamountlow', onLow);
    });
  }

  /**
   * Teardown and close all peer connection resources.
   */
  close() {
    this.stopHeartbeat();
    this.isP2PHealthy = false;

    if (this.controlChannel) {
      try {
        this.controlChannel.close();
      } catch {
        // ignore
      }
      this.controlChannel = null;
    }

    if (this.fileChannel) {
      try {
        this.fileChannel.close();
      } catch {
        // ignore
      }
      this.fileChannel = null;
    }

    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        // ignore
      }
      this.pc = null;
    }

    this.stopStatsPolling();
    this.connectionType = 'unknown';
    this.connectionStats = null;
    this.isRemoteDescriptionSet = false;
    this.iceCandidateQueue = [];
    this.connectionState = 'closed';
    this.emit('statusChange', 'closed');
    this.emit('connectionType', 'unknown');
    this.emit('connectionStats', null);
  }
}

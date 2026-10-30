import { sanitizeFileName } from '../utils/fileUtils.js';
import { createSha256Incremental } from '../utils/cryptoUtils.js';
import { debugLogger } from '../utils/debugLogger.js';

export const RELAY_CHUNK_SIZE = 16384; // 16 KiB per chunk on WebSocket relay
export const DC_MAX_CHUNK_SIZE = 65536; // 64 KiB upper bound for WebRTC DataChannel frames
export const DC_MAX_PAYLOAD_LIMIT = 65536 - 8; // 65528 bytes max payload so 8-byte header + payload <= 65536
export const CHUNK_SIZE = 16384; // Default chunk size for backwards compatibility
export const READ_BLOCK_SIZE = 256 * 1024; // 256 KiB read buffer for file.slice()
export const HIGH_WATER_MARK = 4 * 1024 * 1024; // 4 MiB backpressure pause threshold for DataChannel
export const LOW_WATER_MARK = 1 * 1024 * 1024; // 1 MiB backpressure resume threshold for DataChannel
export const WS_HIGH_WATER_MARK = 512 * 1024; // 512 KiB backpressure pause threshold for WebSocket relay
export const WS_LOW_WATER_MARK = 256 * 1024; // 256 KiB backpressure resume threshold for WebSocket relay
export const PROGRESS_EMIT_INTERVAL_MS = 100; // Update progress UI only every ~100 ms
export const MEMORY_TRANSFER_LIMIT = 200 * 1024 * 1024; // 200 MB in-memory buffer threshold
export const isFileSystemAccessSupported =
  typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

/**
 * FileTransferManager orchestrates chunked file sending and receiving
 * over WebRTC data channels with WebSocket fallback, 8-byte framed chunks
 * (uint32 streamId + uint32 chunkIndex), incremental SHA-256 integrity verification,
 * backpressure flow control, handshake fallback, and memory-aware buffering.
 */
export class FileTransferManager {
  /**
   * @param {import('./peerConnection.js').PeerConnectionManager} peerConnection
   * @param {import('./signalingClient.js').SignalingClient} [signalingClient]
   */
  constructor(peerConnection, signalingClient = null) {
    this.peerConnection = peerConnection;
    this.signalingClient = signalingClient;

    /** @type {number} Per-sender monotonic stream ID counter */
    this.nextStreamId = 1;

    /** @type {boolean} Sequential file sending lock */
    this.isSending = false;

    /** @type {Map<string, { transferId: string, streamId: number, file: File, isCancelled: boolean, startTime: number, hasher: any, transport: string, timeoutTimer: any }>} */
    this.activeSends = new Map();

    /** @type {Map<number, {
     *   transferId: string,
     *   streamId: number,
     *   fileName: string,
     *   fileSize: number,
     *   mimeType: string,
     *   totalChunks: number,
     *   receivedBytes: number,
     *   receivedChunkIndices: Set<number>,
     *   chunks: ArrayBuffer[],
     *   blobParts: Blob[],
     *   hasher: any,
     *   startTime: number,
     *   isCancelled: boolean,
     *   isFinished: boolean,
     *   transport: string,
     *   inactivityTimer: any,
     *   completionTimeout: any,
     *   pendingCompletion?: { expectedFileHash: string }
     * }>} */
    this.activeReceives = new Map();

    /** @type {Map<string, number>} Fast mapping from transferId to streamId */
    this.transferToStreamId = new Map();

    /** @type {number} Handshake and inactivity timeouts */
    this.handshakeInitialTimeoutMs = 4000;
    this.handshakeRetryTimeoutMs = 6000;
    this.inactivityTimeoutMs = 20000;

    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();

    // Named bound handler functions for clean listener detachment
    this.onPcControlMessage = (msg) => this.handleControlMessage(msg, 'webrtc-dc');
    this.onPcFileChunk = (chunk) => this.handleIncomingChunk(chunk, 'webrtc-dc');
    this.onScControlMessage = (msg) => this.handleControlMessage(msg, 'websocket');
    this.onScFileChunk = (chunk) => this.handleIncomingChunk(chunk, 'websocket');
    this.onScPeerDisconnected = () => this.handleTransportDisconnect('websocket', 'Transfer interrupted');
    this.onScRoomError = (err) => {
      if (err?.code === 'PEER_UNAVAILABLE') {
        this.handleTransportDisconnect('websocket', 'Transfer interrupted');
      } else if (err?.code === 'PEER_SLOW') {
        // When server drops a binary frame due to PEER_SLOW, fail the active relay transfer
        // immediately as "Transfer interrupted" with Retry rather than letting file continue with a hole.
        for (const sendRecord of Array.from(this.activeSends.values())) {
          if (sendRecord.transport === 'websocket') {
            const errorMsg = 'Transfer interrupted';
            const tid = sendRecord.transferId;
            const sId = sendRecord.streamId;
            this.cancelTransfer(tid, 'TRANSFER_INTERRUPTED');
            this.emit('transferError', {
              transferId: tid,
              streamId: sId,
              fileName: sendRecord.file?.name || 'File',
              code: 'TRANSFER_INTERRUPTED',
              error: errorMsg,
              message: errorMsg,
              direction: 'send',
              retryable: true
            });
          }
        }
      } else if (err?.code === 'RELAY_LIMIT_REACHED') {
        this.handleRelayLimitReached();
      }
    };

    this.setupListeners();
  }

  get currentReceive() {
    const list = Array.from(this.activeReceives.values());
    return list.length > 0 ? list[list.length - 1] : null;
  }

  set currentReceive(val) {
    if (!val) {
      this.cleanupReceive();
    } else {
      const sId = val.streamId || 1;
      val.streamId = sId;
      val.receivedChunkIndices = val.receivedChunkIndices || new Set();
      this.activeReceives.set(sId, val);
      if (val.transferId) {
        this.transferToStreamId.set(val.transferId, sId);
      }
    }
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
          console.error(`Error in FileTransfer event [${event}]:`, err);
        }
      }
    }
  }

  setupListeners() {
    if (this.peerConnection) {
      this.peerConnection.on('controlMessage', this.onPcControlMessage);
      this.peerConnection.on('fileChunk', this.onPcFileChunk);
    }

    if (this.signalingClient) {
      this.signalingClient.on('controlMessage', this.onScControlMessage);
      this.signalingClient.on('fileChunk', this.onScFileChunk);
      this.signalingClient.on('peerDisconnected', this.onScPeerDisconnected);
      this.signalingClient.on('roomError', this.onScRoomError);
    }
  }

  /**
   * Teardown FileTransferManager: unregister all listeners from peerConnection and signalingClient,
   * clear all active timers, cancel active transfers, and clear event subscribers.
   */
  destroy() {
    if (this.peerConnection) {
      this.peerConnection.off('controlMessage', this.onPcControlMessage);
      this.peerConnection.off('fileChunk', this.onPcFileChunk);
    }

    if (this.signalingClient) {
      this.signalingClient.off('controlMessage', this.onScControlMessage);
      this.signalingClient.off('fileChunk', this.onScFileChunk);
      this.signalingClient.off('peerDisconnected', this.onScPeerDisconnected);
      this.signalingClient.off('roomError', this.onScRoomError);
    }

    this.cleanupReceive();

    for (const [transferId, sendRecord] of this.activeSends.entries()) {
      sendRecord.isCancelled = true;
      if (sendRecord.timeoutTimer) {
        clearTimeout(sendRecord.timeoutTimer);
        sendRecord.timeoutTimer = null;
      }
    }
    this.activeSends.clear();
    this.listeners.clear();
  }

  /**
   * Handle unexpected transport drop (e.g. peer disconnected during WebSocket relay).
   * Cancels active transfers on that transport. For receiver, partial data is discarded
   * and a neutral TRANSFER_INTERRUPTED state is emitted rather than a hash mismatch error.
   * @param {'webrtc-dc' | 'websocket'} transport
   * @param {string} [customMessage]
   */
  handleTransportDisconnect(transport, customMessage = null) {
    const errorMsg = customMessage || 'Transfer interrupted';

    // 1. Cancel matching active sends
    for (const [transferId, sendRecord] of this.activeSends.entries()) {
      if (sendRecord.transport === transport) {
        sendRecord.isCancelled = true;
        if (sendRecord.timeoutTimer) {
          clearTimeout(sendRecord.timeoutTimer);
          sendRecord.timeoutTimer = null;
        }
        if (sendRecord.ackWaitTimer) {
          clearTimeout(sendRecord.ackWaitTimer);
          sendRecord.ackWaitTimer = null;
        }
        if (typeof sendRecord.resolveAckWait === 'function') {
          const resolve = sendRecord.resolveAckWait;
          sendRecord.resolveAckWait = null;
          resolve();
        }
        this.activeSends.delete(transferId);
        this.emit('transferError', {
          transferId,
          streamId: sendRecord.streamId,
          error: errorMsg,
          code: 'TRANSFER_INTERRUPTED',
          message: errorMsg,
          direction: 'send'
        });
      }
    }

    // 2. Discard partial receive buffer and emit neutral interrupted state for matching receives
    for (const [streamId, receiveRecord] of this.activeReceives.entries()) {
      if (receiveRecord.transport === transport) {
        const receiveTransferId = receiveRecord.transferId;
        const fileName = receiveRecord.fileName;
        this.cleanupStream(streamId);

        this.emit('transferError', {
          transferId: receiveTransferId,
          streamId,
          fileName,
          code: 'TRANSFER_INTERRUPTED',
          error: errorMsg,
          message: errorMsg,
          direction: 'receive'
        });
      }
    }
  }

  /**
   * Send control payload on the pinned transport if available, falling back gracefully.
   * @param {object} payload
   * @param {'webrtc-dc' | 'websocket'} [transport]
   */
  sendControlOnTransport(payload, transport) {
    if (transport === 'webrtc-dc' && this.peerConnection?.controlChannel?.readyState === 'open') {
      this.peerConnection.sendControl(payload);
    } else if (transport === 'websocket' && this.signalingClient?.isConnected) {
      this.signalingClient.send({
        ...payload,
        version: 1
      });
    } else {
      this.sendControl(payload);
    }
  }

  /**
   * Always send file:cancel on BOTH transports (ignoring any send errors).
   * @param {object} payload
   */
  sendCancelOnBothTransports(payload) {
    try {
      if (this.peerConnection?.controlChannel?.readyState === 'open') {
        this.peerConnection.sendControl(payload);
      }
    } catch {
      // ignore
    }

    try {
      if (this.signalingClient?.isConnected) {
        this.signalingClient.send({
          ...payload,
          version: 1
        });
      }
    } catch {
      // ignore
    }
  }

  /**
   * Send file chunk on the pinned transport.
   * @param {ArrayBuffer} chunk
   * @param {'webrtc-dc' | 'websocket'} [transport]
   */
  sendFileChunkOnTransport(chunk, transport) {
    if (transport === 'webrtc-dc' && this.peerConnection?.fileChannel?.readyState === 'open') {
      this.peerConnection.sendFileChunk(chunk);
    } else if (transport === 'websocket' && this.signalingClient?.isConnected && this.signalingClient.ws?.readyState === 1) {
      debugLogger.logOutgoing('file:chunk', 'websocket', this.peerConnection, this.signalingClient, { size: chunk?.byteLength });
      this.signalingClient.ws.send(chunk);
    } else {
      this.sendFileChunk(chunk);
    }
  }

  /**
   * Check if send queue should pause for backpressure based on high water marks.
   * High water mark is ~4 MiB for WebRTC DataChannel and ~512 KiB for WebSocket relay.
   * @param {'webrtc-dc' | 'websocket'} transport
   * @returns {boolean}
   */
  shouldPauseForBackpressure(transport) {
    if (transport === 'webrtc-dc') {
      const buffered = this.peerConnection?.fileChannel?.bufferedAmount || 0;
      return buffered >= HIGH_WATER_MARK;
    }
    if (transport === 'websocket') {
      const buffered = this.signalingClient?.ws?.bufferedAmount || 0;
      return buffered >= WS_HIGH_WATER_MARK;
    }
    return false;
  }

  /**
   * Wait for buffered amount low on the pinned transport.
   * @param {'webrtc-dc' | 'websocket'} [transport]
   * @returns {Promise<void>}
   */
  waitForBufferedAmountLowOnTransport(transport) {
    if (transport === 'webrtc-dc' && this.peerConnection?.fileChannel?.readyState === 'open') {
      return this.peerConnection.waitForBufferedAmountLow();
    }
    if (!this.signalingClient?.ws || this.signalingClient.ws.bufferedAmount <= WS_LOW_WATER_MARK) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (!this.signalingClient?.ws || this.signalingClient.ws.bufferedAmount <= WS_LOW_WATER_MARK) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });
  }

  /**
   * Wait for all queued bytes to drain on the pinned transport.
   * @param {'webrtc-dc' | 'websocket'} [transport]
   * @returns {Promise<void>}
   */
  waitForFileDrainedOnTransport(transport) {
    if (
      transport === 'webrtc-dc' &&
      this.peerConnection?.fileChannel?.readyState === 'open' &&
      typeof this.peerConnection.waitForFileChannelDrained === 'function'
    ) {
      return this.peerConnection.waitForFileChannelDrained();
    }
    if (!this.signalingClient?.ws || this.signalingClient.ws.bufferedAmount === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (!this.signalingClient?.ws || this.signalingClient.ws.bufferedAmount === 0) {
          clearInterval(interval);
          resolve();
        }
      }, 10);
    });
  }

  /**
   * Universal message dispatcher that uses WebRTC P2P when open, or WebSocket signaling relay fallback.
   * @param {object} payload
   */
  sendControl(payload) {
    if (this.peerConnection?.controlChannel?.readyState === 'open') {
      this.peerConnection.sendControl(payload);
    } else if (this.signalingClient?.isConnected) {
      this.signalingClient.send({
        ...payload,
        version: 1
      });
    } else {
      throw new Error('No peer or signaling connection available to send file message');
    }
  }

  /**
   * Universal chunk dispatcher that uses WebRTC fileChannel or WebSocket binary relay.
   * @param {ArrayBuffer} chunk
   */
  sendFileChunk(chunk) {
    if (this.peerConnection?.fileChannel?.readyState === 'open') {
      this.peerConnection.sendFileChunk(chunk);
    } else if (this.signalingClient?.isConnected && this.signalingClient.ws?.readyState === 1 /* OPEN */) {
      debugLogger.logOutgoing('file:chunk', 'websocket', this.peerConnection, this.signalingClient, { size: chunk?.byteLength });
      this.signalingClient.ws.send(chunk);
    } else {
      throw new Error('No peer or signaling connection available to stream file chunk');
    }
  }

  /**
   * Handle incoming control channel messages for file transfers.
   * @param {any} msg
   * @param {'webrtc-dc' | 'websocket'} [arrivalTransport]
   */
  handleControlMessage(msg, arrivalTransport = null) {
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'file:start':
        this.handleReceiveStart(msg, arrivalTransport);
        break;

      case 'file:ready':
        this.emit(`ready:${msg.transferId}`, msg);
        break;

      case 'file:cancel':
        this.handleRemoteCancel(msg, arrivalTransport);
        break;

      case 'file:complete':
        this.finalizeReceive(msg.transferId, msg.fileHash, msg.streamId);
        break;

      case 'file:ack':
        this.handleFileAck(msg);
        break;

      default:
        break;
    }
  }

  /**
   * Handle incoming file:ack from receiver on WebSocket relay.
   * Updates acknowledged bytes, clears PEER_SLOW pause, and wakes any waiting sender loop.
   * @param {object} msg
   */
  handleFileAck(msg) {
    if (!msg) return;
    const { transferId, streamId, bytesReceived } = msg;
    const sendRecord = this.activeSends.get(transferId) ||
      Array.from(this.activeSends.values()).find((s) => s.streamId === streamId);
    if (!sendRecord) return;

    const acked = Number(bytesReceived) || 0;
    if (acked > (sendRecord.ackedBytes || 0)) {
      sendRecord.ackedBytes = acked;
    }

    // Resume on next ack if paused by PEER_SLOW
    sendRecord.isPeerSlowPaused = false;

    // Reset ack wait timeout
    if (sendRecord.ackWaitTimer) {
      clearTimeout(sendRecord.ackWaitTimer);
      sendRecord.ackWaitTimer = null;
    }

    if (typeof sendRecord.resolveAckWait === 'function') {
      const resolve = sendRecord.resolveAckWait;
      sendRecord.resolveAckWait = null;
      resolve();
    }
  }

  /**
   * Handle RELAY_LIMIT_REACHED error from server.
   * Cancels active WebSocket transfers and emits clear error with user-facing message.
   */
  handleRelayLimitReached() {
    const errorMsg = 'Relay limit reached. Try a direct connection or try again later.';

    for (const [transferId, sendRecord] of this.activeSends.entries()) {
      if (sendRecord.transport === 'websocket') {
        sendRecord.isCancelled = true;
        if (sendRecord.timeoutTimer) {
          clearTimeout(sendRecord.timeoutTimer);
          sendRecord.timeoutTimer = null;
        }
        if (sendRecord.ackWaitTimer) {
          clearTimeout(sendRecord.ackWaitTimer);
          sendRecord.ackWaitTimer = null;
        }
        if (typeof sendRecord.resolveAckWait === 'function') {
          const resolve = sendRecord.resolveAckWait;
          sendRecord.resolveAckWait = null;
          resolve();
        }
        this.activeSends.delete(transferId);
        this.sendCancelOnBothTransports({
          type: 'file:cancel',
          transferId,
          streamId: sendRecord.streamId,
          reason: 'RELAY_LIMIT_REACHED'
        });
        this.emit('transferError', {
          transferId,
          streamId: sendRecord.streamId,
          fileName: sendRecord.file?.name,
          code: 'RELAY_LIMIT_REACHED',
          error: 'Relay limit reached',
          message: errorMsg,
          direction: 'send'
        });
      }
    }

    for (const [streamId, receiveRecord] of this.activeReceives.entries()) {
      if (receiveRecord.transport === 'websocket') {
        const receiveTransferId = receiveRecord.transferId;
        const fileName = receiveRecord.fileName;
        this.cleanupStream(streamId);
        this.emit('transferError', {
          transferId: receiveTransferId,
          streamId,
          fileName,
          code: 'RELAY_LIMIT_REACHED',
          error: 'Relay limit reached',
          message: errorMsg,
          direction: 'receive'
        });
      }
    }
  }

  /**
   * Initiate sending a file with incremental SHA-256 cryptographic verification,
   * 8-byte framed chunks, sequential send enforcement, and handshake fallback.
   * @param {File} file
   * @returns {Promise<string>} transferId
   */
  async sendFile(file) {
    if (this.isSending) {
      throw new Error('A file transfer is already in progress. Sequential sending is enforced.');
    }
    this.isSending = true;

    const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const streamId = (this.nextStreamId++ >>> 0);
    if (this.nextStreamId > 0x7fffffff) this.nextStreamId = 1;

    const safeName = sanitizeFileName(file.name);
    const hasher = createSha256Incremental();

    // Pin transport once for this entire transfer
    const isDcOpen =
      this.peerConnection?.isP2PHealthy &&
      this.peerConnection?.controlChannel?.readyState === 'open' &&
      this.peerConnection?.fileChannel?.readyState === 'open' &&
      this.peerConnection?.pc?.connectionState === 'connected';
    let chosenTransport = isDcOpen ? 'webrtc-dc' : 'websocket';

    // Payload size: min(pc.sctp.maxMessageSize, 65536) - 8 so that header (8 bytes) + payload never exceeds maxMessageSize.
    // If maxMessageSize is unknown, use 16384.
    const localSctpMax = this.peerConnection?.getMaxMessageSize
      ? this.peerConnection.getMaxMessageSize()
      : (this.peerConnection?.pc?.sctp?.maxMessageSize || 16384);
    const dcPayloadSize = Math.max(1024, Math.min(localSctpMax, 65536) - 8);
    const proposedChunkSize = chosenTransport === 'webrtc-dc' ? dcPayloadSize : RELAY_CHUNK_SIZE;
    let negotiatedChunkSize = proposedChunkSize;

    const sendRecord = {
      transferId,
      streamId,
      file,
      isCancelled: false,
      startTime: Date.now(),
      hasher,
      transport: chosenTransport,
      timeoutTimer: null,
      sentBytes: 0,
      ackedBytes: 0,
      isPeerSlowPaused: false,
      ackWaitTimer: null,
      resolveAckWait: null
    };
    this.activeSends.set(transferId, sendRecord);

    try {
      // 1. Setup handshake promise and register listener BEFORE transmitting file:start
      await new Promise((resolve, reject) => {
        let isResolved = false;

        const onReady = (readyMsg) => {
          if (isResolved) return;
          isResolved = true;
          if (sendRecord.timeoutTimer) {
            clearTimeout(sendRecord.timeoutTimer);
            sendRecord.timeoutTimer = null;
          }
          if (readyMsg?.chunkSize) {
            negotiatedChunkSize = Math.min(proposedChunkSize, readyMsg.chunkSize);
          }
          this.off(`ready:${transferId}`, onReady);
          resolve();
        };

        this.on(`ready:${transferId}`, onReady);

        debugLogger.logOutgoing('file:handshake', chosenTransport, this.peerConnection, this.signalingClient, {
          transferId,
          streamId,
          attempt: 1,
          transport: chosenTransport
        });

        this.sendControlOnTransport({
          type: 'file:start',
          transferId,
          streamId,
          fileName: safeName,
          fileSize: file.size,
          mimeType: file.type || 'application/octet-stream',
          chunkSize: proposedChunkSize,
          totalChunks: Math.ceil(file.size / proposedChunkSize),
          transport: chosenTransport
        }, chosenTransport);

        this.emit('transferStarted', {
          transferId,
          streamId,
          fileName: safeName,
          fileSize: file.size,
          direction: 'send'
        });

        // Attempt 1: timeout on initial transport (default 4000ms)
        const initialTimeout = this.handshakeInitialTimeoutMs || 4000;
        sendRecord.timeoutTimer = setTimeout(() => {
          if (isResolved || sendRecord.isCancelled) return;

          // Switch transport
          const otherTransport = chosenTransport === 'webrtc-dc' ? 'websocket' : 'webrtc-dc';
          chosenTransport = otherTransport;
          sendRecord.transport = otherTransport;
          sendRecord.sentBytes = 0;
          sendRecord.ackedBytes = 0;
          sendRecord.isPeerSlowPaused = false;

          const retryChunkSize = chosenTransport === 'webrtc-dc' ? dcPayloadSize : RELAY_CHUNK_SIZE;
          negotiatedChunkSize = retryChunkSize;

          debugLogger.logOutgoing('file:handshake_retry', otherTransport, this.peerConnection, this.signalingClient, {
            transferId,
            streamId,
            attempt: 2,
            transport: otherTransport,
            chunkSize: retryChunkSize,
            totalChunks: Math.ceil(file.size / retryChunkSize)
          });

          try {
            this.sendControlOnTransport({
              type: 'file:start',
              transferId,
              streamId,
              fileName: safeName,
              fileSize: file.size,
              mimeType: file.type || 'application/octet-stream',
              chunkSize: retryChunkSize,
              totalChunks: Math.ceil(file.size / retryChunkSize),
              transport: chosenTransport
            }, chosenTransport);
          } catch {
            // Handshake retry send failure caught gracefully
          }

          // Attempt 2: timeout on fallback transport (default 6000ms)
          const retryTimeout = this.handshakeRetryTimeoutMs || 6000;
          sendRecord.timeoutTimer = setTimeout(() => {
            if (isResolved || sendRecord.isCancelled) return;
            isResolved = true;
            this.off(`ready:${transferId}`, onReady);
            reject(new Error('Receiver handshake timed out on both transports. Peer may have disconnected.'));
          }, retryTimeout);
        }, initialTimeout);
      });

      // 2. Transmit file in larger blocks (~256 KiB), split into chunks without per-chunk awaits
      const targetChunkSize = chosenTransport === 'webrtc-dc' ? negotiatedChunkSize : RELAY_CHUNK_SIZE;
      const totalEstimatedChunks = Math.ceil(file.size / targetChunkSize);

      debugLogger.logOutgoing('file:chunks', chosenTransport, this.peerConnection, this.signalingClient, {
        transferId,
        streamId,
        totalChunks: totalEstimatedChunks,
        chunkSize: targetChunkSize,
        fileSize: file.size
      });

      let fileOffset = 0;
      let chunkIndex = 0;
      const startTime = Date.now();
      let lastProgressEmit = 0;

      while (fileOffset < file.size) {
        if (!sendRecord || sendRecord.isCancelled) {
          this.activeSends.delete(transferId);
          return transferId;
        }

        // Read file in larger blocks (~256 KiB) to minimize disk I/O and async overhead
        const blockSliceSize = Math.min(READ_BLOCK_SIZE, file.size - fileOffset);
        const blockSlice = file.slice(fileOffset, fileOffset + blockSliceSize);
        const blockBuffer = await blockSlice.arrayBuffer();

        // Hash the entire 256 KiB block in one go
        hasher.update(blockBuffer);

        // Split block into chunks and send without awaiting per chunk
        let blockOffset = 0;
        while (blockOffset < blockBuffer.byteLength) {
          if (!sendRecord || sendRecord.isCancelled) {
            this.activeSends.delete(transferId);
            return transferId;
          }

          const currentChunkSize = Math.min(targetChunkSize, blockBuffer.byteLength - blockOffset);
          const payloadSlice = blockBuffer.slice(blockOffset, blockOffset + currentChunkSize);

          // Construct framed chunk with 8-byte header: uint32 streamId + uint32 chunkIndex (big-endian)
          const framed = new Uint8Array(8 + payloadSlice.byteLength);
          const view = new DataView(framed.buffer, framed.byteOffset, 8);
          view.setUint32(0, streamId, false);
          view.setUint32(4, chunkIndex, false);
          framed.set(new Uint8Array(payloadSlice), 8);

          // ACK CREDITS (WebSocket relay transport only):
          // Sender keeps at most 1 MiB "in flight" on WebSocket (sentBytes - ackedBytes).
          // Pauses sending until an ack frees room, or if server sent PEER_SLOW.
          // If no ack arrives for 20 s while waiting, fail as "Transfer interrupted" with Retry button,
          // and send file:cancel on both transports.
          if (chosenTransport === 'websocket') {
            const WS_MAX_IN_FLIGHT = 1024 * 1024; // 1 MiB window
            while (
              ((sendRecord.sentBytes - (sendRecord.ackedBytes || 0) >= WS_MAX_IN_FLIGHT) || sendRecord.isPeerSlowPaused) &&
              !sendRecord.isCancelled
            ) {
              const nowWait = Date.now();
              const elapsedWait = Math.max(0.001, (nowWait - startTime) / 1000);
              this.emit('progress', {
                transferId,
                streamId,
                bytesTransferred: fileOffset,
                totalBytes: file.size,
                percent: Math.min(99, Math.round((fileOffset / file.size) * 100)),
                speed: fileOffset / elapsedWait,
                direction: 'send',
                isWaitingForAck: true,
                statusText: 'Slow receiver, waiting...'
              });

              await new Promise((resolveWait, rejectWait) => {
                sendRecord.resolveAckWait = resolveWait;
                if (!sendRecord.ackWaitTimer) {
                  sendRecord.ackWaitTimer = setTimeout(() => {
                    sendRecord.resolveAckWait = null;
                    const err = new Error('Transfer interrupted');
                    err.code = 'TRANSFER_INTERRUPTED';
                    rejectWait(err);
                  }, this.ackTimeoutMs || 20000);
                }
              });
            }

            if (sendRecord.ackWaitTimer) {
              clearTimeout(sendRecord.ackWaitTimer);
              sendRecord.ackWaitTimer = null;
            }
          }

          if (!sendRecord || sendRecord.isCancelled) {
            this.activeSends.delete(transferId);
            return transferId;
          }

          this.sendFileChunkOnTransport(framed.buffer, chosenTransport);
          sendRecord.sentBytes += currentChunkSize;

          blockOffset += currentChunkSize;
          fileOffset += currentChunkSize;
          chunkIndex++;

          // Throttle progress UI emission to every ~100 ms
          const now = Date.now();
          if (now - lastProgressEmit >= PROGRESS_EMIT_INTERVAL_MS || fileOffset >= file.size) {
            lastProgressEmit = now;
            const elapsedSeconds = Math.max(0.001, (now - startTime) / 1000);
            const speed = fileOffset / elapsedSeconds;
            const percent = Math.min(100, Math.round((fileOffset / file.size) * 100));

            this.emit('progress', {
              transferId,
              streamId,
              bytesTransferred: fileOffset,
              totalBytes: file.size,
              percent,
              speed,
              direction: 'send',
              isWaitingForAck: false,
              statusText: null
            });
          }

          // Backpressure for webrtc-dc:
          // Keep the existing 4 MiB DataChannel behaviour unchanged.
          if (chosenTransport === 'webrtc-dc' && this.shouldPauseForBackpressure('webrtc-dc')) {
            await this.waitForBufferedAmountLowOnTransport('webrtc-dc');
          }
        }
      }

      // 3. Drain all buffered file chunks before sending completion manifest
      await this.waitForFileDrainedOnTransport(chosenTransport);

      // 4. Compute final verified SHA-256 hash
      const fileHash = hasher.digest();

      // 5. Send completion manifest with cryptographic hash on pinned transport
      this.sendControlOnTransport({
        type: 'file:complete',
        transferId,
        streamId,
        fileHash,
        totalBytes: file.size,
        totalChunks: chunkIndex
      }, chosenTransport);

      this.activeSends.delete(transferId);

      const senderUrl = typeof window !== 'undefined' && window.URL ? URL.createObjectURL(file) : null;
      this.emit('transferCompleted', {
        transferId,
        streamId,
        fileName: safeName,
        fileSize: file.size,
        mimeType: file.type || null,
        fileHash,
        verified: true,
        downloadUrl: senderUrl,
        direction: 'send'
      });

      return transferId;
    } catch (err) {
      if (sendRecord?.ackWaitTimer) {
        clearTimeout(sendRecord.ackWaitTimer);
        sendRecord.ackWaitTimer = null;
      }
      this.activeSends.delete(transferId);
      // ALWAYS clean up: send file:cancel on BOTH transports
      this.sendCancelOnBothTransports({
        type: 'file:cancel',
        transferId,
        streamId,
        reason: err.message || 'SEND_FAILED'
      });

      const isInterrupted = err.code === 'TRANSFER_INTERRUPTED' || err.message === 'Transfer interrupted';
      const isRelayLimit = err.code === 'RELAY_LIMIT_REACHED' || err.message === 'Relay limit reached';

      this.emit('transferError', {
        transferId,
        streamId,
        fileName: safeName,
        code: isRelayLimit ? 'RELAY_LIMIT_REACHED' : isInterrupted ? 'TRANSFER_INTERRUPTED' : 'SEND_FAILED',
        error: isRelayLimit ? 'Relay limit reached' : isInterrupted ? 'Transfer interrupted' : err.message,
        message: isRelayLimit
          ? 'Relay limit reached. Try a direct connection or try again later.'
          : isInterrupted
          ? 'Transfer interrupted'
          : (err.message || 'File transmission failed'),
        direction: 'send'
      });
      throw err;
    } finally {
      if (sendRecord?.ackWaitTimer) {
        clearTimeout(sendRecord.ackWaitTimer);
        sendRecord.ackWaitTimer = null;
      }
      this.isSending = false;
    }
  }

  /**
   * Reset 20-second inactivity timer for a receive stream.
   * Discards partial data and emits neutral 'Transfer interrupted' error if inactive for 20s.
   * @param {object} receiveRecord
   */
  resetInactivityTimer(receiveRecord) {
    if (!receiveRecord) return;
    if (receiveRecord.inactivityTimer) {
      clearTimeout(receiveRecord.inactivityTimer);
    }
    const timeout = this.inactivityTimeoutMs || 20000;
    receiveRecord.inactivityTimer = setTimeout(() => {
      const transferId = receiveRecord.transferId;
      const fileName = receiveRecord.fileName;
      const streamId = receiveRecord.streamId;
      this.cleanupStream(streamId);

      this.emit('transferError', {
        transferId,
        streamId,
        fileName,
        code: 'TRANSFER_INTERRUPTED',
        error: 'Transfer interrupted',
        message: 'Transfer interrupted',
        direction: 'receive'
      });
    }, timeout);
  }

  /**
   * Handle incoming file metadata from remote peer.
   * Supports multiple active streams in Map keyed by streamId.
   * Repeated file:start for the same stream/transfer is handled idempotently.
   * @param {any} msg
   * @param {'webrtc-dc' | 'websocket'} [arrivalTransport]
   */
  handleReceiveStart(msg, arrivalTransport = null) {
    const { transferId, streamId, fileName, fileSize, mimeType, totalChunks } = msg;
    const sizeNumber = Number(fileSize);
    const chosenTransport = arrivalTransport || (this.peerConnection?.controlChannel?.readyState === 'open' ? 'webrtc-dc' : 'websocket');

    // 1. Idempotent retry check: if already known, re-send file:ready without creating a second receive
    const existingStreamId = streamId || this.transferToStreamId.get(transferId);
    const existingRecord = existingStreamId ? this.activeReceives.get(existingStreamId) : null;
    if (existingRecord) {
      existingRecord.transport = chosenTransport;
      if (chosenTransport === 'websocket') {
        existingRecord.chunkSize = RELAY_CHUNK_SIZE;
      }
      this.resetInactivityTimer(existingRecord);
      debugLogger.logIncoming('file:start_retry', chosenTransport, this.peerConnection, this.signalingClient, {
        transferId: existingRecord.transferId,
        streamId: existingRecord.streamId,
        arrivalTransport: chosenTransport,
        chunkSize: existingRecord.chunkSize || RELAY_CHUNK_SIZE
      });
      this.sendControlOnTransport({
        type: 'file:ready',
        transferId: existingRecord.transferId,
        streamId: existingRecord.streamId,
        chunkSize: existingRecord.chunkSize || RELAY_CHUNK_SIZE
      }, chosenTransport);
      return;
    }

    // Safeguard: Check memory limit for mobile/in-memory browsers
    if (sizeNumber > MEMORY_TRANSFER_LIMIT && !isFileSystemAccessSupported) {
      this.cancelTransfer(transferId, 'MEMORY_LIMIT_EXCEEDED');
      this.emit('transferError', {
        transferId,
        streamId,
        code: 'MEMORY_LIMIT_EXCEEDED',
        message: `File size exceeds 200 MB limit for this browser without direct disk streaming support.`
      });
      return;
    }

    const receiverSctpMax = this.peerConnection?.getMaxMessageSize
      ? this.peerConnection.getMaxMessageSize()
      : (this.peerConnection?.pc?.sctp?.maxMessageSize || 16384);
    let agreedChunkSize = msg.chunkSize || RELAY_CHUNK_SIZE;
    if (chosenTransport === 'webrtc-dc') {
      const maxAllowedPayload = Math.max(1024, Math.min(receiverSctpMax, 65536) - 8);
      agreedChunkSize = Math.min(agreedChunkSize, maxAllowedPayload);
    } else {
      agreedChunkSize = RELAY_CHUNK_SIZE;
    }

    const receiveRecord = {
      transferId,
      streamId: streamId || 1,
      fileName: sanitizeFileName(fileName),
      fileSize: sizeNumber,
      mimeType: mimeType || 'application/octet-stream',
      totalChunks: Number(totalChunks),
      chunkSize: agreedChunkSize,
      receivedBytes: 0,
      lastAckedBytes: 0,
      receivedChunkIndices: new Set(),
      chunks: [],
      blobParts: [],
      hasher: createSha256Incremental(),
      startTime: Date.now(),
      lastProgressEmit: 0,
      isCancelled: false,
      isFinished: false,
      transport: chosenTransport,
      inactivityTimer: null,
      completionTimeout: null
    };

    this.activeReceives.set(receiveRecord.streamId, receiveRecord);
    this.transferToStreamId.set(transferId, receiveRecord.streamId);

    // Auto-cancel receive if no chunks arrive within 20s
    this.resetInactivityTimer(receiveRecord);

    debugLogger.logIncoming('file:start', chosenTransport, this.peerConnection, this.signalingClient, {
      transferId,
      streamId: receiveRecord.streamId,
      totalChunks: receiveRecord.totalChunks,
      chunkIndexRange: `0..${Math.max(0, receiveRecord.totalChunks - 1)}`,
      fileSize: sizeNumber,
      agreedChunkSize
    });

    this.emit('transferStarted', {
      transferId,
      streamId: receiveRecord.streamId,
      fileName: receiveRecord.fileName,
      fileSize: receiveRecord.fileSize,
      direction: 'receive'
    });

    // Send receiver-ready handshake back to sender on the same transport it arrived on
    this.sendControlOnTransport({
      type: 'file:ready',
      transferId,
      streamId: receiveRecord.streamId,
      chunkSize: agreedChunkSize
    }, chosenTransport);
  }

  /**
   * Handle incoming binary chunk on file channel or websocket relay.
   * Demultiplexes by 8-byte header: uint32 streamId + uint32 chunkIndex.
   * Discards stale chunks for unknown/finished streams, drops duplicates, and checks early byte overflow.
   * @param {ArrayBuffer | ArrayBufferView} chunk
   * @param {'webrtc-dc' | 'websocket'} [arrivalTransport]
   */
  handleIncomingChunk(chunk, arrivalTransport = null) {
    if (!chunk) return;

    let arrayBuffer;
    let byteOffset = 0;
    let byteLength = 0;

    if (chunk instanceof ArrayBuffer) {
      arrayBuffer = chunk;
      byteOffset = 0;
      byteLength = chunk.byteLength;
    } else if (ArrayBuffer.isView(chunk)) {
      arrayBuffer = chunk.buffer;
      byteOffset = chunk.byteOffset;
      byteLength = chunk.byteLength;
    } else {
      return;
    }

    // Minimum 8 bytes for streamId + chunkIndex header
    if (byteLength < 8) return;

    const view = new DataView(arrayBuffer, byteOffset, byteLength);
    const streamId = view.getUint32(0, false);
    const chunkIndex = view.getUint32(4, false);

    const receiveRecord = this.activeReceives.get(streamId);
    // Ignore chunks for unknown/finished/cancelled streams
    if (!receiveRecord || receiveRecord.isCancelled || receiveRecord.isFinished) {
      return;
    }

    // Discard duplicate chunkIndex
    if (receiveRecord.receivedChunkIndices.has(chunkIndex)) {
      return;
    }

    // Sequence gap detection: chunks are transmitted sequentially from index 0.
    // If a chunk is skipped, a frame was dropped in transit (e.g. PEER_SLOW or relay limits).
    // Abort receive immediately with "Transfer interrupted" rather than letting the file continue with a hole.
    if (chunkIndex > receiveRecord.receivedChunkIndices.size) {
      const errorMsg = 'Transfer interrupted';
      const tid = receiveRecord.transferId;
      const fname = receiveRecord.fileName;
      this.cleanupStream(streamId);

      this.sendCancelOnBothTransports({
        type: 'file:cancel',
        transferId: tid,
        streamId,
        reason: 'TRANSFER_INTERRUPTED'
      });

      this.emit('transferError', {
        transferId: tid,
        streamId,
        fileName: fname,
        code: 'TRANSFER_INTERRUPTED',
        error: errorMsg,
        message: errorMsg,
        direction: 'receive',
        retryable: true
      });
      return;
    }

    receiveRecord.receivedChunkIndices.add(chunkIndex);

    // Reset 20-second inactivity timer on valid chunk
    this.resetInactivityTimer(receiveRecord);

    // Extract raw payload (slice after 8-byte header)
    const payload = arrayBuffer.slice(byteOffset + 8, byteOffset + byteLength);

    // Incremental SHA-256 hash update on raw file payload
    receiveRecord.hasher.update(payload);

    receiveRecord.chunks.push(payload);
    receiveRecord.receivedBytes += payload.byteLength;

    // ACK CREDITS (WebSocket relay transport only):
    // The receiver sends file:ack { transferId, streamId, bytesReceived } back on the SAME transport
    // after every 256 KiB received and once at the end.
    if (receiveRecord.transport === 'websocket') {
      const ACK_INTERVAL = 256 * 1024; // 256 KiB
      if (
        receiveRecord.receivedBytes - (receiveRecord.lastAckedBytes || 0) >= ACK_INTERVAL ||
        (receiveRecord.receivedBytes >= receiveRecord.fileSize && (receiveRecord.lastAckedBytes || 0) < receiveRecord.receivedBytes)
      ) {
        receiveRecord.lastAckedBytes = receiveRecord.receivedBytes;
        this.sendControlOnTransport({
          type: 'file:ack',
          transferId: receiveRecord.transferId,
          streamId: receiveRecord.streamId,
          bytesReceived: receiveRecord.receivedBytes
        }, 'websocket');
      }
    }

    // EARLY ERROR: if receivedBytes exceeds fileSize, stop immediately with a clear error
    if (receiveRecord.receivedBytes > receiveRecord.fileSize) {
      const errorMsg = `Received bytes (${receiveRecord.receivedBytes}) exceeded declared file size (${receiveRecord.fileSize})`;
      const tid = receiveRecord.transferId;
      const fname = receiveRecord.fileName;
      this.cleanupStream(streamId);

      this.sendCancelOnBothTransports({
        type: 'file:cancel',
        transferId: tid,
        streamId,
        reason: 'BYTE_COUNT_EXCEEDED'
      });

      this.emit('transferError', {
        transferId: tid,
        streamId,
        fileName: fname,
        code: 'BYTE_COUNT_EXCEEDED',
        error: errorMsg,
        message: errorMsg,
        direction: 'receive'
      });
      return;
    }

    // Memory batching: every 32 chunks (~512 KiB - 2 MiB), roll into a native Blob part to save JS heap
    if (receiveRecord.chunks.length >= 32) {
      receiveRecord.blobParts.push(new Blob(receiveRecord.chunks));
      receiveRecord.chunks = [];
    }

    // Throttle progress UI emission to every ~100 ms
    const now = Date.now();
    if (
      now - (receiveRecord.lastProgressEmit || 0) >= PROGRESS_EMIT_INTERVAL_MS ||
      receiveRecord.receivedBytes >= receiveRecord.fileSize
    ) {
      receiveRecord.lastProgressEmit = now;
      const elapsedSeconds = Math.max(0.001, (now - receiveRecord.startTime) / 1000);
      const speed = receiveRecord.receivedBytes / elapsedSeconds;
      // Cap progress display at 99% until cryptographic verification is completed
      const rawPercent = Math.round((receiveRecord.receivedBytes / receiveRecord.fileSize) * 100);
      const percent = Math.min(99, rawPercent);

      this.emit('progress', {
        transferId: receiveRecord.transferId,
        streamId: receiveRecord.streamId,
        bytesTransferred: receiveRecord.receivedBytes,
        totalBytes: receiveRecord.fileSize,
        percent,
        speed,
        direction: 'receive'
      });
    }

    // If file:complete has already arrived and we just received the final chunk:
    if (
      receiveRecord.pendingCompletion &&
      receiveRecord.receivedBytes >= receiveRecord.fileSize
    ) {
      if (receiveRecord.completionTimeout) {
        clearTimeout(receiveRecord.completionTimeout);
        receiveRecord.completionTimeout = null;
      }
      this.doFinalizeReceive(receiveRecord);
    }
  }

  /**
   * Finalize and cryptographically verify the received file.
   * If completion signal arrives while final chunks are still in transit,
   * waits gracefully for the remaining bytes rather than failing prematurely.
   * @param {string} transferId
   * @param {string} expectedFileHash
   * @param {number} [streamId]
   */
  finalizeReceive(transferId, expectedFileHash, streamId = null) {
    const resolvedStreamId = streamId || this.transferToStreamId.get(transferId);
    const receiveRecord = resolvedStreamId ? this.activeReceives.get(resolvedStreamId) : null;
    if (!receiveRecord) return;

    receiveRecord.pendingCompletion = { expectedFileHash };

    // If all bytes have already arrived, finish immediately
    if (receiveRecord.receivedBytes >= receiveRecord.fileSize) {
      this.doFinalizeReceive(receiveRecord);
    } else {
      // If some chunk is still in flight on fileChannel, wait for it with a 5s timeout
      if (receiveRecord.completionTimeout) {
        clearTimeout(receiveRecord.completionTimeout);
      }
      receiveRecord.completionTimeout = setTimeout(() => {
        if (receiveRecord && receiveRecord.pendingCompletion) {
          this.doFinalizeReceive(receiveRecord);
        }
      }, 5000);
    }
  }

  /**
   * Complete the assembly, byte verification, and SHA-256 check.
   * @param {object} receiveRecord
   */
  doFinalizeReceive(receiveRecord) {
    if (!receiveRecord || receiveRecord.isFinished || receiveRecord.isCancelled) return;

    const {
      streamId,
      transferId,
      fileName,
      fileSize,
      mimeType,
      chunks,
      blobParts,
      hasher,
      receivedBytes,
      pendingCompletion
    } = receiveRecord;

    receiveRecord.isFinished = true;

    // Clear timers
    if (receiveRecord.inactivityTimer) {
      clearTimeout(receiveRecord.inactivityTimer);
      receiveRecord.inactivityTimer = null;
    }
    if (receiveRecord.completionTimeout) {
      clearTimeout(receiveRecord.completionTimeout);
      receiveRecord.completionTimeout = null;
    }

    const expectedFileHash = pendingCompletion?.expectedFileHash;

    // 1. Verify exact byte count
    if (receivedBytes !== fileSize) {
      this.emit('transferError', {
        transferId,
        streamId,
        fileName,
        code: 'TRANSFER_INTERRUPTED',
        message: 'Transfer interrupted',
        error: `Received ${receivedBytes} bytes, expected ${fileSize} bytes.`,
        direction: 'receive',
        retryable: true
      });
      this.cleanupStream(streamId);
      return;
    }

    // 2. Verify cryptographic SHA-256 hash
    const actualHash = hasher.digest();
    if (expectedFileHash && actualHash !== expectedFileHash) {
      this.emit('transferError', {
        transferId,
        streamId,
        fileName,
        code: 'INTEGRITY_MISMATCH',
        message: 'Transfer interrupted',
        error: `Cryptographic SHA-256 verification failed (expected: ${expectedFileHash.slice(0, 8)}..., actual: ${actualHash.slice(0, 8)}...).`,
        direction: 'receive',
        retryable: true
      });
      this.cleanupStream(streamId);
      return;
    }

    // 3. Assemble final Blob from batched parts + remaining chunks
    if (chunks.length > 0) {
      blobParts.push(new Blob(chunks));
    }
    const finalBlob = new Blob(blobParts, { type: mimeType });
    const downloadUrl = typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(finalBlob) : null;

    // Final ACK credit on completion
    if (receiveRecord.transport === 'websocket' && (receiveRecord.lastAckedBytes || 0) < receiveRecord.receivedBytes) {
      receiveRecord.lastAckedBytes = receiveRecord.receivedBytes;
      this.sendControlOnTransport({
        type: 'file:ack',
        transferId: receiveRecord.transferId,
        streamId: receiveRecord.streamId,
        bytesReceived: receiveRecord.receivedBytes
      }, 'websocket');
    }

    // 4. Clean up stream from active receives
    this.cleanupStream(streamId);

    // 5. Emit verified completion (now reaches 100%)
    this.emit('transferCompleted', {
      transferId,
      streamId,
      fileName,
      fileSize,
      mimeType,
      fileHash: actualHash,
      verified: true,
      downloadUrl,
      blob: finalBlob,
      direction: 'receive'
    });
  }

  /**
   * Remove stream, clear its timers, and discard all partial buffers.
   * @param {number} streamId
   */
  cleanupStream(streamId) {
    const record = this.activeReceives.get(streamId);
    if (record) {
      if (record.inactivityTimer) {
        clearTimeout(record.inactivityTimer);
        record.inactivityTimer = null;
      }
      if (record.completionTimeout) {
        clearTimeout(record.completionTimeout);
        record.completionTimeout = null;
      }
      record.chunks = [];
      record.blobParts = [];
      record.isCancelled = true;
      this.transferToStreamId.delete(record.transferId);
      this.activeReceives.delete(streamId);
    }
  }

  /**
   * Clear all active receive streams and discard all partial buffers.
   */
  cleanupReceive() {
    for (const streamId of Array.from(this.activeReceives.keys())) {
      this.cleanupStream(streamId);
    }
    this.activeReceives.clear();
    this.transferToStreamId.clear();
  }

  /**
   * Cancel an active transfer.
   * @param {string} transferId
   * @param {string} [reason='user-cancelled']
   */
  cancelTransfer(transferId, reason = 'user-cancelled') {
    let targetStreamId = null;

    // If sending
    if (this.activeSends.has(transferId)) {
      const sendRecord = this.activeSends.get(transferId);
      if (sendRecord) {
        sendRecord.isCancelled = true;
        targetStreamId = sendRecord.streamId;
        if (sendRecord.timeoutTimer) {
          clearTimeout(sendRecord.timeoutTimer);
          sendRecord.timeoutTimer = null;
        }
      }
      this.activeSends.delete(transferId);
      this.emit(`ready:${transferId}`);
    }

    // If receiving
    const resolvedStreamId = this.transferToStreamId.get(transferId);
    if (resolvedStreamId && this.activeReceives.has(resolvedStreamId)) {
      targetStreamId = targetStreamId || resolvedStreamId;
      this.cleanupStream(resolvedStreamId);
    }

    // Always send file:cancel on BOTH transports (ignore errors)
    this.sendCancelOnBothTransports({
      type: 'file:cancel',
      transferId,
      streamId: targetStreamId,
      reason
    });

    this.emit('transferCancelled', { transferId, streamId: targetStreamId, reason });
  }

  /**
   * Remote peer cancelled transfer.
   * @param {any} msg
   */
  handleRemoteCancel(msg) {
    const { transferId, streamId, reason } = msg;

    if (this.activeSends.has(transferId)) {
      const sendRecord = this.activeSends.get(transferId);
      if (sendRecord) {
        sendRecord.isCancelled = true;
        if (sendRecord.timeoutTimer) {
          clearTimeout(sendRecord.timeoutTimer);
          sendRecord.timeoutTimer = null;
        }
      }
      this.activeSends.delete(transferId);
      this.emit(`ready:${transferId}`);
    }

    const resolvedStreamId = streamId || this.transferToStreamId.get(transferId);
    if (resolvedStreamId && this.activeReceives.has(resolvedStreamId)) {
      const receiveRecord = this.activeReceives.get(resolvedStreamId);
      const fileName = receiveRecord.fileName;
      this.cleanupStream(resolvedStreamId);

      if (reason === 'peer-disconnected' || reason === 'TRANSFER_INTERRUPTED') {
        this.emit('transferError', {
          transferId,
          streamId: resolvedStreamId,
          fileName,
          code: 'TRANSFER_INTERRUPTED',
          error: 'Transfer interrupted',
          message: 'Transfer interrupted',
          direction: 'receive'
        });
        return;
      }
    }

    this.emit('transferCancelled', { transferId, streamId: resolvedStreamId, reason: reason || 'remote-cancelled' });
  }
}

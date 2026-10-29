import { sanitizeFileName } from '../utils/fileUtils.js';
import { createSha256Incremental } from '../utils/cryptoUtils.js';
import { debugLogger } from '../utils/debugLogger.js';

export const CHUNK_SIZE = 16384; // 16 KiB per chunk
export const MEMORY_TRANSFER_LIMIT = 200 * 1024 * 1024; // 200 MB in-memory buffer threshold
export const isFileSystemAccessSupported =
  typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

/**
 * FileTransferManager orchestrates chunked file sending and receiving
 * over WebRTC data channels with incremental SHA-256 integrity verification,
 * backpressure flow control, and memory-aware buffering.
 */
export class FileTransferManager {
  /**
   * @param {import('./peerConnection.js').PeerConnectionManager} peerConnection
   * @param {import('./signalingClient.js').SignalingClient} [signalingClient]
   */
  constructor(peerConnection, signalingClient = null) {
    this.peerConnection = peerConnection;
    this.signalingClient = signalingClient;

    /** @type {Map<string, { file: File, isCancelled: boolean, startTime: number, hasher: any }>} */
    this.activeSends = new Map();

    /** @type {{
     *   transferId: string,
     *   fileName: string,
     *   fileSize: number,
     *   mimeType: string,
     *   totalChunks: number,
     *   receivedBytes: number,
     *   chunks: ArrayBuffer[],
     *   blobParts: Blob[],
     *   hasher: any,
     *   startTime: number,
     *   isCancelled: boolean
     * } | null} */
    this.currentReceive = null;

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
      }
    };

    this.setupListeners();
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

    if (this.currentReceive?.completionTimeout) {
      clearTimeout(this.currentReceive.completionTimeout);
      this.currentReceive.completionTimeout = null;
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
        this.activeSends.delete(transferId);
        this.emit('transferError', {
          transferId,
          error: errorMsg,
          code: 'TRANSFER_INTERRUPTED',
          message: errorMsg,
          direction: 'send'
        });
      }
    }

    // 2. Discard partial receive buffer and emit neutral interrupted state
    if (this.currentReceive && this.currentReceive.transport === transport) {
      const receiveTransferId = this.currentReceive.transferId;
      const fileName = this.currentReceive.fileName;
      this.currentReceive.isCancelled = true;
      if (this.currentReceive.completionTimeout) {
        clearTimeout(this.currentReceive.completionTimeout);
        this.currentReceive.completionTimeout = null;
      }
      this.cleanupReceive();

      this.emit('transferError', {
        transferId: receiveTransferId,
        fileName,
        code: 'TRANSFER_INTERRUPTED',
        error: errorMsg,
        message: errorMsg,
        direction: 'receive'
      });
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
   * Wait for buffered amount low on the pinned transport.
   * @param {'webrtc-dc' | 'websocket'} [transport]
   * @returns {Promise<void>}
   */
  waitForBufferedAmountLowOnTransport(transport) {
    if (transport === 'webrtc-dc' && this.peerConnection?.fileChannel?.readyState === 'open') {
      return this.peerConnection.waitForBufferedAmountLow();
    }
    if (!this.signalingClient?.ws || this.signalingClient.ws.bufferedAmount <= 65536) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (!this.signalingClient?.ws || this.signalingClient.ws.bufferedAmount <= 65536) {
          clearInterval(interval);
          resolve();
        }
      }, 15);
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
   * Unified backpressure handler across WebRTC and WebSocket channels.
   * @returns {Promise<void>}
   */
  waitForBufferedAmountLow() {
    if (this.peerConnection?.fileChannel?.readyState === 'open') {
      return this.peerConnection.waitForBufferedAmountLow();
    }
    if (!this.signalingClient?.ws || this.signalingClient.ws.bufferedAmount <= 65536) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (!this.signalingClient?.ws || this.signalingClient.ws.bufferedAmount <= 65536) {
          clearInterval(interval);
          resolve();
        }
      }, 15);
    });
  }

  /**
   * Unified buffer flush helper across WebRTC and WebSocket channels.
   * @returns {Promise<void>}
   */
  waitForFileChannelDrained() {
    if (
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
        this.emit(`ready:${msg.transferId}`);
        break;

      case 'file:cancel':
        this.handleRemoteCancel(msg, arrivalTransport);
        break;

      case 'file:complete':
        this.finalizeReceive(msg.transferId, msg.fileHash);
        break;

      default:
        break;
    }
  }

  /**
   * Initiate sending a file with incremental SHA-256 cryptographic verification.
   * @param {File} file
   * @returns {Promise<string>} transferId
   */
  async sendFile(file) {
    const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const safeName = sanitizeFileName(file.name);
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const hasher = createSha256Incremental();

    // Pin transport once for this entire transfer
    const isDcOpen =
      this.peerConnection?.isP2PHealthy &&
      this.peerConnection?.controlChannel?.readyState === 'open' &&
      this.peerConnection?.fileChannel?.readyState === 'open' &&
      this.peerConnection?.pc?.connectionState === 'connected';
    const chosenTransport = isDcOpen ? 'webrtc-dc' : 'websocket';

    this.activeSends.set(transferId, {
      file,
      isCancelled: false,
      startTime: Date.now(),
      hasher,
      transport: chosenTransport,
      timeoutTimer: null
    });

    try {
      // 1. Notify receiver of file metadata on pinned transport
      this.sendControlOnTransport({
        type: 'file:start',
        transferId,
        fileName: safeName,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        chunkSize: CHUNK_SIZE,
        totalChunks,
        transport: chosenTransport
      }, chosenTransport);

      this.emit('transferStarted', {
        transferId,
        fileName: safeName,
        fileSize: file.size,
        direction: 'send'
      });

      // 2. Wait for receiver-ready handshake with timeout protection
      await new Promise((resolve, reject) => {
        let timeoutTimer = null;
        const onReady = () => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          this.off(`ready:${transferId}`, onReady);
          resolve();
        };
        timeoutTimer = setTimeout(() => {
          this.off(`ready:${transferId}`, onReady);
          reject(new Error('Receiver handshake timed out. Peer may have disconnected.'));
        }, 10000);
        const sendRecord = this.activeSends.get(transferId);
        if (sendRecord) sendRecord.timeoutTimer = timeoutTimer;
        this.on(`ready:${transferId}`, onReady);
      });

      // 3. Transmit file chunks on pinned transport with backpressure and incremental SHA-256 hashing
      let offset = 0;
      const sendRecord = this.activeSends.get(transferId);
      const startTime = Date.now();

      while (offset < file.size) {
        if (!sendRecord || sendRecord.isCancelled) {
          this.activeSends.delete(transferId);
          return transferId;
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();

        // Update cryptographic hash incrementally (O(1) memory)
        hasher.update(buffer);

        this.sendFileChunkOnTransport(buffer, chosenTransport);
        offset += buffer.byteLength;

        // Calculate speed and progress
        const elapsedSeconds = Math.max(0.001, (Date.now() - startTime) / 1000);
        const speed = offset / elapsedSeconds;
        const percent = Math.min(100, Math.round((offset / file.size) * 100));

        this.emit('progress', {
          transferId,
          bytesTransferred: offset,
          totalBytes: file.size,
          percent,
          speed,
          direction: 'send'
        });

        // Backpressure flow control on pinned transport
        await this.waitForBufferedAmountLowOnTransport(chosenTransport);
      }

      // 4. Drain all buffered file chunks before sending completion manifest
      await this.waitForFileDrainedOnTransport(chosenTransport);

      // 5. Compute final verified SHA-256 hash
      const fileHash = hasher.digest();

      // 6. Send completion manifest with cryptographic hash on pinned transport
      this.sendControlOnTransport({
        type: 'file:complete',
        transferId,
        fileHash,
        totalBytes: file.size,
        totalChunks
      }, chosenTransport);

      this.activeSends.delete(transferId);

      const senderUrl = typeof window !== 'undefined' && window.URL ? URL.createObjectURL(file) : null;
      this.emit('transferCompleted', {
        transferId,
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
      this.activeSends.delete(transferId);
      this.emit('transferError', {
        transferId,
        fileName: safeName,
        code: 'SEND_FAILED',
        message: err.message || 'File transmission failed'
      });
      throw err;
    }
  }

  /**
   * Handle incoming file metadata from remote peer.
   * @param {any} msg
   * @param {'webrtc-dc' | 'websocket'} [arrivalTransport]
   */
  handleReceiveStart(msg, arrivalTransport = null) {
    const { transferId, fileName, fileSize, mimeType, totalChunks } = msg;
    const sizeNumber = Number(fileSize);
    const chosenTransport = arrivalTransport || (this.peerConnection?.controlChannel?.readyState === 'open' ? 'webrtc-dc' : 'websocket');

    // Safeguard: Check memory limit for mobile/in-memory browsers
    if (sizeNumber > MEMORY_TRANSFER_LIMIT && !isFileSystemAccessSupported) {
      this.cancelTransfer(transferId, 'MEMORY_LIMIT_EXCEEDED');
      this.emit('transferError', {
        transferId,
        code: 'MEMORY_LIMIT_EXCEEDED',
        message: `File size exceeds 200 MB limit for this browser without direct disk streaming support.`
      });
      return;
    }

    this.currentReceive = {
      transferId,
      fileName: sanitizeFileName(fileName),
      fileSize: sizeNumber,
      mimeType: mimeType || 'application/octet-stream',
      totalChunks: Number(totalChunks),
      receivedBytes: 0,
      chunks: [],
      blobParts: [],
      hasher: createSha256Incremental(),
      startTime: Date.now(),
      isCancelled: false,
      transport: chosenTransport
    };

    this.emit('transferStarted', {
      transferId,
      fileName: this.currentReceive.fileName,
      fileSize: this.currentReceive.fileSize,
      direction: 'receive'
    });

    // Send receiver-ready handshake back to sender on the same transport it arrived on
    this.sendControlOnTransport({
      type: 'file:ready',
      transferId
    }, chosenTransport);
  }

  /**
   * Handle incoming binary chunk on file channel.
   * @param {ArrayBuffer} chunk
   */
  handleIncomingChunk(chunk) {
    if (!this.currentReceive || this.currentReceive.isCancelled) return;

    // Incremental SHA-256 hash update
    this.currentReceive.hasher.update(chunk);

    this.currentReceive.chunks.push(chunk);
    this.currentReceive.receivedBytes += chunk.byteLength;

    // Memory batching: every 32 chunks (~512 KiB), roll into a native Blob part to save JS heap
    if (this.currentReceive.chunks.length >= 32) {
      this.currentReceive.blobParts.push(new Blob(this.currentReceive.chunks));
      this.currentReceive.chunks = [];
    }

    const elapsedSeconds = Math.max(0.001, (Date.now() - this.currentReceive.startTime) / 1000);
    const speed = this.currentReceive.receivedBytes / elapsedSeconds;
    // Cap progress display at 99% until cryptographic verification is completed
    const rawPercent = Math.round((this.currentReceive.receivedBytes / this.currentReceive.fileSize) * 100);
    const percent = Math.min(99, rawPercent);

    this.emit('progress', {
      transferId: this.currentReceive.transferId,
      bytesTransferred: this.currentReceive.receivedBytes,
      totalBytes: this.currentReceive.fileSize,
      percent,
      speed,
      direction: 'receive'
    });

    // If file:complete has already arrived and we just received the final chunk:
    if (
      this.currentReceive.pendingCompletion &&
      this.currentReceive.receivedBytes >= this.currentReceive.fileSize
    ) {
      if (this.currentReceive.completionTimeout) {
        clearTimeout(this.currentReceive.completionTimeout);
        this.currentReceive.completionTimeout = null;
      }
      this.doFinalizeReceive();
    }
  }

  /**
   * Finalize and cryptographically verify the received file.
   * If completion signal arrives while final chunks are still in transit on the file channel,
   * waits gracefully for the remaining bytes rather than failing prematurely.
   * @param {string} transferId
   * @param {string} expectedFileHash
   */
  finalizeReceive(transferId, expectedFileHash) {
    if (!this.currentReceive || this.currentReceive.transferId !== transferId) return;

    this.currentReceive.pendingCompletion = { expectedFileHash };

    // If all bytes have already arrived, finish immediately
    if (this.currentReceive.receivedBytes >= this.currentReceive.fileSize) {
      this.doFinalizeReceive();
    } else {
      // If some chunk is still in flight on fileChannel, wait for it with a 5s timeout
      if (this.currentReceive.completionTimeout) {
        clearTimeout(this.currentReceive.completionTimeout);
      }
      this.currentReceive.completionTimeout = setTimeout(() => {
        if (this.currentReceive && this.currentReceive.pendingCompletion) {
          this.doFinalizeReceive();
        }
      }, 5000);
    }
  }

  /**
   * Complete the assembly, byte verification, and SHA-256 check.
   */
  doFinalizeReceive() {
    if (!this.currentReceive) return;

    const { fileName, fileSize, mimeType, chunks, blobParts, hasher, receivedBytes, pendingCompletion } =
      this.currentReceive;
    const expectedFileHash = pendingCompletion?.expectedFileHash;
    const transferId = this.currentReceive.transferId;

    // 1. Verify exact byte count
    if (receivedBytes !== fileSize) {
      this.emit('transferError', {
        transferId,
        code: 'BYTE_COUNT_MISMATCH',
        message: `Received ${receivedBytes} bytes, expected ${fileSize} bytes.`
      });
      this.cleanupReceive();
      return;
    }

    // 2. Verify cryptographic SHA-256 hash
    const actualHash = hasher.digest();
    if (expectedFileHash && actualHash !== expectedFileHash) {
      this.emit('transferError', {
        transferId,
        code: 'INTEGRITY_MISMATCH',
        message: `Cryptographic SHA-256 verification failed (expected: ${expectedFileHash.slice(0, 8)}..., actual: ${actualHash.slice(0, 8)}...).`
      });
      this.cleanupReceive();
      return;
    }

    // 3. Assemble final Blob from batched parts + remaining chunks
    if (chunks.length > 0) {
      blobParts.push(new Blob(chunks));
    }
    const finalBlob = new Blob(blobParts, { type: mimeType });
    const downloadUrl = URL.createObjectURL(finalBlob);

    // 4. Emit verified completion (now reaches 100%)
    this.emit('transferCompleted', {
      transferId,
      fileName,
      fileSize,
      mimeType,
      fileHash: actualHash,
      verified: true,
      downloadUrl,
      blob: finalBlob,
      direction: 'receive'
    });

    this.cleanupReceive();
  }

  cleanupReceive() {
    if (this.currentReceive) {
      if (this.currentReceive.completionTimeout) {
        clearTimeout(this.currentReceive.completionTimeout);
      }
      this.currentReceive.chunks = [];
      this.currentReceive.blobParts = [];
      this.currentReceive = null;
    }
  }

  /**
   * Cancel an active transfer.
   * @param {string} transferId
   * @param {string} [reason='user-cancelled']
   */
  cancelTransfer(transferId, reason = 'user-cancelled') {
    let targetTransport = null;

    // If sending
    if (this.activeSends.has(transferId)) {
      const sendRecord = this.activeSends.get(transferId);
      if (sendRecord) {
        sendRecord.isCancelled = true;
        targetTransport = sendRecord.transport;
        if (sendRecord.timeoutTimer) clearTimeout(sendRecord.timeoutTimer);
      }
      this.activeSends.delete(transferId);
    }

    // If receiving
    if (this.currentReceive && this.currentReceive.transferId === transferId) {
      this.currentReceive.isCancelled = true;
      targetTransport = targetTransport || this.currentReceive.transport;
      this.cleanupReceive();
    }

    try {
      this.sendControlOnTransport({
        type: 'file:cancel',
        transferId,
        reason
      }, targetTransport);
    } catch {
      // ignore
    }

    this.emit('transferCancelled', { transferId, reason });
  }

  /**
   * Remote peer cancelled transfer.
   * @param {any} msg
   */
  handleRemoteCancel(msg) {
    const { transferId, reason } = msg;

    if (this.activeSends.has(transferId)) {
      const sendRecord = this.activeSends.get(transferId);
      if (sendRecord) sendRecord.isCancelled = true;
      this.activeSends.delete(transferId);
    }

    if (this.currentReceive && this.currentReceive.transferId === transferId) {
      const fileName = this.currentReceive.fileName;
      this.cleanupReceive();
      if (reason === 'peer-disconnected' || reason === 'TRANSFER_INTERRUPTED') {
        this.emit('transferError', {
          transferId,
          fileName,
          code: 'TRANSFER_INTERRUPTED',
          error: 'Transfer interrupted',
          message: 'Transfer interrupted',
          direction: 'receive'
        });
        return;
      }
    }

    this.emit('transferCancelled', { transferId, reason: reason || 'remote-cancelled' });
  }
}

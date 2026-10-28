import { sanitizeFileName } from '../utils/fileUtils.js';

export const CHUNK_SIZE = 16384; // 16 KiB per chunk

/**
 * FileTransferManager orchestrates chunked file sending and receiving
 * over WebRTC data channels with backpressure control and progress reporting.
 */
export class FileTransferManager {
  /**
   * @param {import('./peerConnection.js').PeerConnectionManager} peerConnection
   */
  constructor(peerConnection) {
    this.peerConnection = peerConnection;

    /** @type {Map<string, { file: File, isCancelled: boolean, startTime: number }>} */
    this.activeSends = new Map();

    /** @type {{
     *   transferId: string,
     *   fileName: string,
     *   fileSize: number,
     *   mimeType: string,
     *   totalChunks: number,
     *   receivedBytes: number,
     *   chunks: ArrayBuffer[],
     *   startTime: number,
     *   isCancelled: boolean
     * } | null} */
    this.currentReceive = null;

    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();

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
    this.peerConnection.on('controlMessage', (msg) => {
      this.handleControlMessage(msg);
    });

    this.peerConnection.on('fileChunk', (chunk) => {
      this.handleIncomingChunk(chunk);
    });
  }

  /**
   * Handle incoming control channel messages for file transfers.
   * @param {any} msg
   */
  handleControlMessage(msg) {
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'file:start':
        this.handleReceiveStart(msg);
        break;

      case 'file:ready':
        this.emit(`ready:${msg.transferId}`);
        break;

      case 'file:cancel':
        this.handleRemoteCancel(msg);
        break;

      case 'file:complete':
        // Sender marked transfer as complete
        this.finalizeReceive(msg.transferId);
        break;

      default:
        break;
    }
  }

  /**
   * Initiate sending a file.
   * @param {File} file
   * @returns {Promise<string>} transferId
   */
  async sendFile(file) {
    const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const safeName = sanitizeFileName(file.name);
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    this.activeSends.set(transferId, {
      file,
      isCancelled: false,
      startTime: Date.now()
    });

    // 1. Notify receiver of file metadata
    this.peerConnection.sendControl({
      type: 'file:start',
      transferId,
      fileName: safeName,
      fileSize: file.size,
      mimeType: file.type || 'application/octet-stream',
      chunkSize: CHUNK_SIZE,
      totalChunks
    });

    this.emit('transferStarted', {
      transferId,
      fileName: safeName,
      fileSize: file.size,
      direction: 'send'
    });

    // 2. Wait for receiver-ready handshake
    await new Promise((resolve) => {
      const onReady = () => {
        this.off(`ready:${transferId}`, onReady);
        resolve();
      };
      this.on(`ready:${transferId}`, onReady);
    });

    // 3. Transmit file chunks with backpressure
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

      this.peerConnection.sendFileChunk(buffer);
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

      // Apply backpressure if buffer is full
      if (this.peerConnection.fileChannel && this.peerConnection.fileChannel.bufferedAmount > this.peerConnection.bufferedThreshold) {
        await this.peerConnection.waitForBufferedAmountLow();
      }
    }

    // 4. Mark complete
    this.peerConnection.sendControl({
      type: 'file:complete',
      transferId
    });

    this.activeSends.delete(transferId);

    this.emit('transferCompleted', {
      transferId,
      fileName: safeName,
      fileSize: file.size,
      direction: 'send'
    });

    return transferId;
  }

  /**
   * Handle incoming file start from remote sender.
   * @param {any} msg
   */
  handleReceiveStart(msg) {
    const { transferId, fileName, fileSize, mimeType, totalChunks } = msg;

    this.currentReceive = {
      transferId,
      fileName: sanitizeFileName(fileName),
      fileSize: Number(fileSize),
      mimeType: mimeType || 'application/octet-stream',
      totalChunks: Number(totalChunks),
      receivedBytes: 0,
      chunks: [],
      startTime: Date.now(),
      isCancelled: false
    };

    this.emit('transferStarted', {
      transferId,
      fileName: this.currentReceive.fileName,
      fileSize: this.currentReceive.fileSize,
      direction: 'receive'
    });

    // Send receiver-ready handshake back to sender
    this.peerConnection.sendControl({
      type: 'file:ready',
      transferId
    });
  }

  /**
   * Handle binary chunk received on file channel.
   * @param {ArrayBuffer} chunk
   */
  handleIncomingChunk(chunk) {
    if (!this.currentReceive || this.currentReceive.isCancelled) return;

    this.currentReceive.chunks.push(chunk);
    this.currentReceive.receivedBytes += chunk.byteLength;

    const elapsedSeconds = Math.max(0.001, (Date.now() - this.currentReceive.startTime) / 1000);
    const speed = this.currentReceive.receivedBytes / elapsedSeconds;
    const percent = Math.min(100, Math.round((this.currentReceive.receivedBytes / this.currentReceive.fileSize) * 100));

    this.emit('progress', {
      transferId: this.currentReceive.transferId,
      bytesTransferred: this.currentReceive.receivedBytes,
      totalBytes: this.currentReceive.fileSize,
      percent,
      speed,
      direction: 'receive'
    });

    // Check if transfer complete by exact byte count
    if (this.currentReceive.receivedBytes >= this.currentReceive.fileSize) {
      this.finalizeReceive(this.currentReceive.transferId);
    }
  }

  /**
   * Finalize and construct Blob upon verified byte count completion.
   * @param {string} transferId
   */
  finalizeReceive(transferId) {
    if (!this.currentReceive || this.currentReceive.transferId !== transferId) return;

    const { fileName, fileSize, mimeType, chunks } = this.currentReceive;
    const blob = new Blob(chunks, { type: mimeType });
    const downloadUrl = URL.createObjectURL(blob);

    this.emit('transferCompleted', {
      transferId,
      fileName,
      fileSize,
      downloadUrl,
      blob,
      direction: 'receive'
    });

    this.currentReceive = null;
  }

  /**
   * Cancel an active transfer.
   * @param {string} transferId
   * @param {string} [reason='user-cancelled']
   */
  cancelTransfer(transferId, reason = 'user-cancelled') {
    // If sending
    if (this.activeSends.has(transferId)) {
      const sendRecord = this.activeSends.get(transferId);
      if (sendRecord) sendRecord.isCancelled = true;
      this.activeSends.delete(transferId);
    }

    // If receiving
    if (this.currentReceive && this.currentReceive.transferId === transferId) {
      this.currentReceive.isCancelled = true;
      this.currentReceive.chunks = []; // Release memory
      this.currentReceive = null;
    }

    try {
      this.peerConnection.sendControl({
        type: 'file:cancel',
        transferId,
        reason
      });
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
      this.currentReceive.chunks = [];
      this.currentReceive = null;
    }

    this.emit('transferCancelled', { transferId, reason: reason || 'remote-cancelled' });
  }
}

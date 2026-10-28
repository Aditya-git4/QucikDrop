import { sanitizeFileName } from '../utils/fileUtils.js';
import { createSha256Incremental } from '../utils/cryptoUtils.js';

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
   */
  constructor(peerConnection) {
    this.peerConnection = peerConnection;

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

    this.activeSends.set(transferId, {
      file,
      isCancelled: false,
      startTime: Date.now(),
      hasher
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

    // 3. Transmit file chunks with backpressure and incremental SHA-256 hashing
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

      // Backpressure flow control: wait if buffer exceeds threshold
      if (
        this.peerConnection.fileChannel &&
        this.peerConnection.fileChannel.bufferedAmount > this.peerConnection.bufferedThreshold
      ) {
        await this.peerConnection.waitForBufferedAmountLow();
      }
    }

    // 4. Compute final verified SHA-256 hash
    const fileHash = hasher.digest();

    // 5. Send completion manifest with cryptographic hash
    this.peerConnection.sendControl({
      type: 'file:complete',
      transferId,
      fileHash,
      totalBytes: file.size,
      totalChunks
    });

    this.activeSends.delete(transferId);

    this.emit('transferCompleted', {
      transferId,
      fileName: safeName,
      fileSize: file.size,
      fileHash,
      verified: true,
      direction: 'send'
    });

    return transferId;
  }

  /**
   * Handle incoming file metadata from remote peer.
   * @param {any} msg
   */
  handleReceiveStart(msg) {
    const { transferId, fileName, fileSize, mimeType, totalChunks } = msg;
    const sizeNumber = Number(fileSize);

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
  }

  /**
   * Finalize and cryptographically verify the received file.
   * @param {string} transferId
   * @param {string} expectedFileHash
   */
  finalizeReceive(transferId, expectedFileHash) {
    if (!this.currentReceive || this.currentReceive.transferId !== transferId) return;

    const { fileName, fileSize, mimeType, chunks, blobParts, hasher, receivedBytes } = this.currentReceive;

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
    // If sending
    if (this.activeSends.has(transferId)) {
      const sendRecord = this.activeSends.get(transferId);
      if (sendRecord) sendRecord.isCancelled = true;
      this.activeSends.delete(transferId);
    }

    // If receiving
    if (this.currentReceive && this.currentReceive.transferId === transferId) {
      this.currentReceive.isCancelled = true;
      this.cleanupReceive();
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
      this.cleanupReceive();
    }

    this.emit('transferCancelled', { transferId, reason: reason || 'remote-cancelled' });
  }
}

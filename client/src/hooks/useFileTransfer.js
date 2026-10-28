import { useState, useEffect, useRef, useCallback } from 'react';
import { FileTransferManager } from '../services/fileTransfer.js';

/**
 * useFileTransfer manages the file queue, transmission progress,
 * and receiving states for WebRTC file transfers.
 * @param {{ peerConnection: import('../services/peerConnection.js').PeerConnectionManager | null }} props
 */
export function useFileTransfer({ peerConnection }) {
  const [transfers, setTransfers] = useState([]);
  const managerRef = useRef(null);
  const sendQueueRef = useRef([]);
  const isSendingRef = useRef(false);

  // Initialize FileTransferManager when peerConnection is ready
  useEffect(() => {
    if (!peerConnection) return;

    const manager = new FileTransferManager(peerConnection);
    managerRef.current = manager;

    const handleTransferStarted = (data) => {
      setTransfers((prev) => {
        const existing = prev.find((t) => t.transferId === data.transferId);
        if (existing) {
          return prev.map((t) =>
            t.transferId === data.transferId ? { ...t, status: 'transferring' } : t
          );
        }
        return [
          ...prev,
          {
            transferId: data.transferId,
            fileName: data.fileName,
            fileSize: data.fileSize,
            direction: data.direction,
            status: 'transferring',
            bytesTransferred: 0,
            percent: 0,
            speed: 0,
            downloadUrl: null
          }
        ];
      });
    };

    const handleProgress = (data) => {
      setTransfers((prev) =>
        prev.map((t) =>
          t.transferId === data.transferId
            ? {
                ...t,
                bytesTransferred: data.bytesTransferred,
                percent: data.percent,
                speed: data.speed,
                status: 'transferring'
              }
            : t
        )
      );
    };

    const handleTransferCompleted = (data) => {
      setTransfers((prev) =>
        prev.map((t) =>
          t.transferId === data.transferId
            ? {
                ...t,
                status: 'completed',
                percent: 100,
                bytesTransferred: data.fileSize,
                downloadUrl: data.downloadUrl || null
              }
            : t
        )
      );
    };

    const handleTransferCancelled = (data) => {
      setTransfers((prev) =>
        prev.map((t) =>
          t.transferId === data.transferId
            ? {
                ...t,
                status: 'cancelled',
                speed: 0
              }
            : t
        )
      );
    };

    manager.on('transferStarted', handleTransferStarted);
    manager.on('progress', handleProgress);
    manager.on('transferCompleted', handleTransferCompleted);
    manager.on('transferCancelled', handleTransferCancelled);

    return () => {
      managerRef.current = null;
    };
  }, [peerConnection]);

  /** Process the next file in the sequential send queue */
  const processSendQueue = useCallback(async () => {
    if (isSendingRef.current || sendQueueRef.current.length === 0 || !managerRef.current) {
      return;
    }

    isSendingRef.current = true;
    const nextFile = sendQueueRef.current.shift();

    try {
      await managerRef.current.sendFile(nextFile);
    } catch (err) {
      console.error('File send error:', err);
    } finally {
      isSendingRef.current = false;
      // Process next item if any
      processSendQueue();
    }
  }, []);

  /** Queue multiple files for sending */
  const queueFiles = useCallback(
    (fileList) => {
      if (!fileList || fileList.length === 0) return;

      const newFiles = Array.from(fileList);
      sendQueueRef.current.push(...newFiles);

      processSendQueue();
    },
    [processSendQueue]
  );

  /** Cancel an active or queued transfer */
  const cancelTransfer = useCallback((transferId) => {
    if (managerRef.current) {
      managerRef.current.cancelTransfer(transferId);
    }
  }, []);

  return {
    transfers,
    queueFiles,
    cancelTransfer
  };
}

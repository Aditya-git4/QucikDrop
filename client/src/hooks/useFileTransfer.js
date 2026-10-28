import { useState, useEffect, useRef, useCallback } from 'react';
import { FileTransferManager } from '../services/fileTransfer.js';

/**
 * useFileTransfer manages the file queue, transmission progress,
 * and receiving states for WebRTC file transfers.
 * @param {{ peerConnection: import('../services/peerConnection.js').PeerConnectionManager | null }} props
 */
export function useFileTransfer({ peerConnection }) {
  const [transfers, setTransfers] = useState([]);
  const [isWakeLockActive, setIsWakeLockActive] = useState(false);
  const managerRef = useRef(null);
  const sendQueueRef = useRef([]);
  const isSendingRef = useRef(false);
  const wakeLockRef = useRef(null);

  // Screen Wake Lock API: Keep phone screen awake during active file transfers
  useEffect(() => {
    const hasActiveTransfers = transfers.some((t) => t.status === 'transferring');

    const requestWakeLock = async () => {
      if (typeof window === 'undefined' || !('wakeLock' in navigator)) return;
      try {
        if (!wakeLockRef.current) {
          const sentinel = await navigator.wakeLock.request('screen');
          wakeLockRef.current = sentinel;
          setIsWakeLockActive(true);

          sentinel.addEventListener('release', () => {
            wakeLockRef.current = null;
            setIsWakeLockActive(false);
          });
        }
      } catch (err) {
        // Wake locks can be denied (e.g. low battery mode or tab minimized)
        console.warn('Screen WakeLock could not be acquired:', err);
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
        } catch {
          // ignore
        }
        wakeLockRef.current = null;
        setIsWakeLockActive(false);
      }
    };

    if (hasActiveTransfers) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && hasActiveTransfers) {
        requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [transfers]);

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
                fileHash: data.fileHash,
                verified: data.verified || false,
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

    const handleTransferError = (data) => {
      setTransfers((prev) => {
        const existing = prev.find((t) => t.transferId === data.transferId);
        if (existing) {
          return prev.map((t) =>
            t.transferId === data.transferId
              ? {
                  ...t,
                  status: 'error',
                  errorMessage: data.message,
                  errorCode: data.code,
                  speed: 0
                }
              : t
          );
        }
        return [
          ...prev,
          {
            transferId: data.transferId,
            fileName: 'Transfer Error',
            fileSize: 0,
            direction: 'receive',
            status: 'error',
            errorMessage: data.message,
            errorCode: data.code,
            bytesTransferred: 0,
            percent: 0,
            speed: 0,
            downloadUrl: null
          }
        ];
      });
    };

    manager.on('transferStarted', handleTransferStarted);
    manager.on('progress', handleProgress);
    manager.on('transferCompleted', handleTransferCompleted);
    manager.on('transferCancelled', handleTransferCancelled);
    manager.on('transferError', handleTransferError);

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
    cancelTransfer,
    isWakeLockActive
  };
}

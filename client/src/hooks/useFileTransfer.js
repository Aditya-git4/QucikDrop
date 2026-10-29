import { useState, useEffect, useRef, useCallback } from 'react';
import { FileTransferManager } from '../services/fileTransfer.js';
import { playSendSound, playSuccessSound, hapticSuccess, hapticError } from '../utils/soundEffects.js';

/**
 * useFileTransfer manages the file queue, transmission progress,
 * and receiving states for WebRTC file transfers with WebSocket signaling relay fallback.
 * @param {{
 *   peerConnection: import('../services/peerConnection.js').PeerConnectionManager | null,
 *   signalingClient?: import('../services/signalingClient.js').SignalingClient | null
 * }} props
 */
export function useFileTransfer({ peerConnection, signalingClient = null }) {
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

  /** Process the next file in the sequential send queue */
  const processSendQueue = useCallback(async () => {
    if (isSendingRef.current || sendQueueRef.current.length === 0 || !managerRef.current) {
      return;
    }

    const pc = managerRef.current.peerConnection;
    const sc = managerRef.current.signalingClient;
    const isP2POpen = pc?.fileChannel?.readyState === 'open';
    const isSignalingOpen = sc?.isConnected;

    if (!isP2POpen && !isSignalingOpen) {
      return;
    }

    isSendingRef.current = true;
    const nextItem = sendQueueRef.current.shift();
    const nextFile = nextItem?.file || nextItem;
    const tempId = nextItem?.tempId;

    try {
      if (tempId) {
        setTransfers((prev) => prev.filter((t) => t.transferId !== tempId));
      }
      await managerRef.current.sendFile(nextFile);
    } catch (err) {
      console.error('File send error:', err);
    } finally {
      isSendingRef.current = false;
      // Process next item if any
      processSendQueue();
    }
  }, []);

  // Initialize FileTransferManager when peerConnection or signalingClient is ready
  useEffect(() => {
    if (!peerConnection && !signalingClient) return;

    const manager = new FileTransferManager(peerConnection, signalingClient);
    managerRef.current = manager;

    const handleTransferStarted = (data) => {
      playSendSound();
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
            mimeType: data.mimeType || null,
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
      playSuccessSound();
      hapticSuccess();
      setTransfers((prev) =>
        prev.map((t) =>
          t.transferId === data.transferId
            ? {
                ...t,
                status: 'completed',
                percent: 100,
                bytesTransferred: data.fileSize,
                mimeType: data.mimeType || t.mimeType,
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
      hapticError();
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

    // Auto-drain send queue when WebRTC P2P DataChannels open
    const handleReady = () => {
      processSendQueue();
    };
    peerConnection?.on('ready', handleReady);

    // Auto-drain send queue when room/signaling is connected
    const handleSignalingReady = () => {
      processSendQueue();
    };
    signalingClient?.on('peerJoined', handleSignalingReady);
    signalingClient?.on('roomJoined', handleSignalingReady);

    // If either channel is already open, immediately attempt to drain any queued files
    if (peerConnection?.fileChannel?.readyState === 'open' || signalingClient?.isConnected) {
      processSendQueue();
    }

    return () => {
      peerConnection?.off('ready', handleReady);
      signalingClient?.off('peerJoined', handleSignalingReady);
      signalingClient?.off('roomJoined', handleSignalingReady);
      managerRef.current = null;
    };
  }, [peerConnection, signalingClient, processSendQueue]);

  /** Queue multiple files for sending (works immediately, auto-beams upon P2P connect) */
  const queueFiles = useCallback(
    (fileList) => {
      if (!fileList || fileList.length === 0) return;

      const newFiles = Array.from(fileList);
      const queueEntries = newFiles.map((file) => ({
        tempId: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file
      }));

      sendQueueRef.current.push(...queueEntries);

      // Add to transfers UI state immediately for instant feedback
      setTransfers((prev) => [
        ...prev,
        ...queueEntries.map(({ tempId, file }) => ({
          transferId: tempId,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || null,
          direction: 'send',
          status: 'queued',
          bytesTransferred: 0,
          percent: 0,
          speed: 0,
          downloadUrl: null
        }))
      ]);

      processSendQueue();
    },
    [processSendQueue]
  );

  /** Cancel an active or queued transfer */
  const cancelTransfer = useCallback((transferId) => {
    sendQueueRef.current = sendQueueRef.current.filter((item) => (item.tempId || item.transferId) !== transferId);
    setTransfers((prev) => prev.filter((t) => t.transferId !== transferId));

    if (managerRef.current) {
      managerRef.current.cancelTransfer(transferId);
    }
  }, []);

  /** Clear completed, cancelled, and errored transfers from the queue */
  const clearCompleted = useCallback(() => {
    setTransfers((prev) => prev.filter((t) => t.status === 'transferring' || t.status === 'queued'));
  }, []);

  return {
    transfers,
    queueFiles,
    cancelTransfer,
    clearCompleted,
    isWakeLockActive
  };
}

import React, { useState } from 'react';
import { TransferProgress } from './TransferProgress.jsx';
import { formatBytes } from '../utils/formatBytes.js';
import { triggerDownload, isImageMime, isVideoMime, isAudioMime } from '../utils/fileUtils.js';
import {
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Archive,
  Code,
  File as GenericFile,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  XCircle,
  Download,
  RotateCw,
  X
} from 'lucide-react';

function getFileIconComponent(fileName = '', mimeType = '') {
  const name = fileName.toLowerCase();
  if (mimeType.startsWith('image/') || /\.(jpe?g|png|gif|webp|svg|bmp)$/i.test(name)) {
    return ImageIcon;
  }
  if (mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) {
    return Music;
  }
  if (mimeType.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(name)) {
    return Film;
  }
  if (/\.(pdf|doc|docx|txt|md|rtf)$/i.test(name)) {
    return FileText;
  }
  if (/\.(zip|tar|gz|7z|rar)$/i.test(name)) {
    return Archive;
  }
  if (/\.(js|jsx|ts|tsx|html|css|json|py|go|rs|c|cpp)$/i.test(name)) {
    return Code;
  }
  return GenericFile;
}

export function TransferItem({ transfer, onCancel, onRetry }) {
  const [showLightbox, setShowLightbox] = useState(false);

  const isSend = transfer.direction === 'send';
  const isCompleted = transfer.status === 'completed';
  const isCancelled = transfer.status === 'cancelled';
  const isInterrupted = transfer.status === 'interrupted' || transfer.errorCode === 'TRANSFER_INTERRUPTED';
  const isRelayLimit = transfer.errorCode === 'RELAY_LIMIT_REACHED' || transfer.errorMessage?.includes('Relay limit reached') || transfer.error?.includes('Relay limit reached');
  const isError = (transfer.status === 'error' || transfer.status === 'failed' || isInterrupted || isRelayLimit) && !isCancelled && !isCompleted;
  const isTransferring = transfer.status === 'transferring';
  const isQueued = transfer.status === 'queued';
  const isWaitingForAck = transfer.isWaitingForAck || transfer.statusText === 'Slow receiver, waiting...';

  const isImage = isCompleted && transfer.downloadUrl && isImageMime(transfer.mimeType, transfer.fileName);
  const isAudio = isCompleted && transfer.downloadUrl && isAudioMime(transfer.mimeType, transfer.fileName);
  const isVideo = isCompleted && transfer.downloadUrl && isVideoMime(transfer.mimeType, transfer.fileName);

  const IconComponent = getFileIconComponent(transfer.fileName, transfer.mimeType || '');

  return (
    <>
      <div
        className="transfer-card"
        style={{
          padding: '16px',
          backgroundColor: 'var(--color-bg-surface-1)',
          border: `1px solid ${
            isInterrupted
              ? 'var(--color-status-relay-border)'
              : isError
              ? 'var(--color-status-error-border)'
              : isCompleted
              ? 'var(--color-status-direct-border)'
              : 'var(--border-subtle)'
          }`,
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          transition: 'border-color var(--duration-fast) ease'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden', flex: 1 }}>
            {/* Thumbnail Preview or File Icon */}
            {isImage ? (
              <button
                type="button"
                onClick={() => setShowLightbox(true)}
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                  border: '1px solid var(--border-medium)',
                  padding: 0,
                  cursor: 'pointer',
                  background: '#000',
                  flexShrink: 0
                }}
                title="Click to preview image full-screen"
                aria-label="Preview image"
              >
                <img
                  src={transfer.downloadUrl}
                  alt={transfer.fileName}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </button>
            ) : (
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-bg-surface-2)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isCompleted ? 'var(--color-status-direct)' : '#6366f1',
                  flexShrink: 0
                }}
              >
                <IconComponent size={20} strokeWidth={1.75} />
              </div>
            )}

            <div style={{ overflow: 'hidden', flex: 1 }}>
              <div
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
                title={transfer.fileName}
              >
                {transfer.fileName}
              </div>

              <div
                style={{
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '6px',
                  marginTop: '2px'
                }}
              >
                <span>{formatBytes(transfer.fileSize)}</span>
                <span style={{ color: 'var(--border-medium)' }}>•</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                  {isSend ? (
                    <>
                      <ArrowUpRight size={12} strokeWidth={2} />
                      <span>Sent</span>
                    </>
                  ) : (
                    <>
                      <ArrowDownLeft size={12} strokeWidth={2} />
                      <span>Received</span>
                    </>
                  )}
                </span>

                {transfer.verified && (
                  <>
                    <span style={{ color: 'var(--border-medium)' }}>•</span>
                    <span style={{ color: 'var(--color-status-direct)', fontWeight: 500 }}>
                      Verified
                    </span>
                  </>
                )}

                {isError && (
                  <div
                    style={{
                      width: '100%',
                      color: (isInterrupted || isRelayLimit) ? 'var(--color-status-relay)' : 'var(--color-status-error)',
                      fontSize: 'var(--font-size-xs)',
                      marginTop: '4px'
                    }}
                  >
                    {isRelayLimit
                      ? 'Relay limit reached. Try a direct connection or try again later.'
                      : isInterrupted
                      ? 'Transfer interrupted'
                      : transfer.errorMessage || transfer.error || 'Connection dropped. Tap Retry to resend.'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Status Chips & Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {isQueued && (
              <>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--color-text-muted)',
                    background: 'var(--color-bg-surface-2)',
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)'
                  }}
                >
                  <Clock size={12} strokeWidth={1.75} />
                  <span>Queued</span>
                </span>
                <button
                  type="button"
                  onClick={() => onCancel(transfer.transferId)}
                  className="btn btn-ghost"
                  style={{ minHeight: '32px', height: '32px', padding: '0 10px', fontSize: 'var(--font-size-xs)' }}
                >
                  Cancel
                </button>
              </>
            )}

            {isCompleted && (
              <>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--color-status-direct)',
                    background: 'var(--color-status-direct-bg)',
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-status-direct-border)'
                  }}
                >
                  <CheckCircle2 size={13} strokeWidth={2} />
                  <span>{transfer.verified ? 'Verified' : 'Done'}</span>
                </span>
                {!isSend && transfer.downloadUrl && (
                  <button
                    type="button"
                    onClick={() => triggerDownload(transfer.downloadUrl, transfer.fileName)}
                    className="btn btn-primary"
                    style={{
                      minHeight: '32px',
                      height: '32px',
                      padding: '0 12px',
                      fontSize: 'var(--font-size-xs)'
                    }}
                  >
                    <Download size={13} strokeWidth={2} />
                    <span>Save</span>
                  </button>
                )}
              </>
            )}

            {isCancelled && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-text-muted)',
                  background: 'var(--color-bg-surface-2)',
                  padding: '3px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)'
                }}
              >
                <XCircle size={13} strokeWidth={1.75} />
                <span>Cancelled</span>
              </span>
            )}

            {isInterrupted && (
              <>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--color-status-relay)',
                    background: 'var(--color-status-relay-bg)',
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-status-relay-border)'
                  }}
                >
                  <AlertTriangle size={13} strokeWidth={2} />
                  <span>Interrupted</span>
                </span>
                {isSend && transfer.file && onRetry && (
                  <button
                    type="button"
                    onClick={() => onRetry(transfer)}
                    className="btn btn-secondary"
                    style={{
                      minHeight: '32px',
                      height: '32px',
                      padding: '0 10px',
                      fontSize: 'var(--font-size-xs)'
                    }}
                  >
                    <RotateCw size={13} strokeWidth={2} />
                    <span>Retry</span>
                  </button>
                )}
              </>
            )}

            {isRelayLimit && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-status-relay, #f59e0b)',
                  background: 'rgba(245, 158, 11, 0.1)',
                  padding: '3px 8px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(245, 158, 11, 0.25)'
                }}
              >
                <AlertCircle size={13} strokeWidth={2} />
                <span>Relay limit reached</span>
              </span>
            )}

            {isError && !isInterrupted && !isRelayLimit && (
              <>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--color-status-error)',
                    background: 'var(--color-status-error-bg)',
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-status-error-border)'
                  }}
                >
                  <AlertCircle size={13} strokeWidth={2} />
                  <span>Failed</span>
                </span>
                {isSend && transfer.file && onRetry && (
                  <button
                    type="button"
                    onClick={() => onRetry(transfer)}
                    className="btn btn-secondary"
                    style={{
                      minHeight: '32px',
                      height: '32px',
                      padding: '0 10px',
                      fontSize: 'var(--font-size-xs)'
                    }}
                  >
                    <RotateCw size={13} strokeWidth={2} />
                    <span>Retry</span>
                  </button>
                )}
              </>
            )}

            {isTransferring && (
              <>
                {isWaitingForAck && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-status-relay, #f59e0b)',
                      background: 'rgba(245, 158, 11, 0.1)',
                      padding: '3px 8px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid rgba(245, 158, 11, 0.25)'
                    }}
                  >
                    <Clock size={12} strokeWidth={1.75} />
                    <span>Slow receiver, waiting...</span>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onCancel(transfer.transferId)}
                  className="btn btn-ghost"
                  style={{
                    minHeight: '32px',
                    height: '32px',
                    padding: '0 10px',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--color-status-error)'
                  }}
                >
                  Cancel
                </button>
              </>
            )}
                  padding: '0 10px',
                  fontSize: 'var(--font-size-xs)',
                  color: 'var(--color-status-error)'
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Inline Audio Player */}
        {isAudio && (
          <div style={{ padding: '4px 0' }}>
            <audio
              controls
              src={transfer.downloadUrl}
              style={{
                width: '100%',
                height: '36px',
                borderRadius: 'var(--radius-full)'
              }}
            />
          </div>
        )}

        {/* Inline Video Player */}
        {isVideo && (
          <div style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', maxHeight: '240px', background: '#000' }}>
            <video
              controls
              playsInline
              src={transfer.downloadUrl}
              style={{ width: '100%', maxHeight: '240px', display: 'block' }}
            />
          </div>
        )}

        {/* Progress Bar when Active */}
        {isTransferring && (
          <TransferProgress
            percent={transfer.percent}
            bytesTransferred={transfer.bytesTransferred}
            totalBytes={transfer.fileSize}
            speed={transfer.speed}
          />
        )}
      </div>

      {/* Full-Screen Lightbox Modal */}
      {showLightbox && (
        <div
          onClick={() => setShowLightbox(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}
          >
            <button
              type="button"
              onClick={() => setShowLightbox(false)}
              className="btn-icon"
              style={{
                position: 'absolute',
                top: '-48px',
                right: '0',
                background: 'rgba(255, 255, 255, 0.15)',
                color: '#fff',
                borderColor: 'transparent'
              }}
              aria-label="Close image preview"
            >
              <X size={20} strokeWidth={2} />
            </button>
            <img
              src={transfer.downloadUrl}
              alt={transfer.fileName}
              style={{
                maxWidth: '100%',
                maxHeight: '80vh',
                borderRadius: 'var(--radius-md)',
                objectFit: 'contain'
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

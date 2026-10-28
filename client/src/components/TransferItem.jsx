import React, { useState } from 'react';
import { TransferProgress } from './TransferProgress.jsx';
import { formatBytes } from '../utils/formatBytes.js';
import { triggerDownload, isImageMime, isVideoMime, isAudioMime } from '../utils/fileUtils.js';

/**
 * Modern iOS glassmorphic file transfer card with inline media previews & lightbox.
 * @param {{
 *   transfer: {
 *     transferId: string,
 *     fileName: string,
 *     fileSize: number,
 *     mimeType?: string,
 *     direction: 'send' | 'receive',
 *     status: 'queued' | 'transferring' | 'completed' | 'cancelled' | 'error',
 *     bytesTransferred: number,
 *     percent: number,
 *     speed: number,
 *     downloadUrl: string | null,
 *     fileHash?: string,
 *     verified?: boolean,
 *     errorMessage?: string
 *   },
 *   onCancel: (id: string) => void
 * }} props
 */
function getFileIcon(fileName = '', mimeType = '', isSend = false) {
  const name = fileName.toLowerCase();
  if (mimeType.startsWith('image/') || /\.(jpe?g|png|gif|webp|svg|bmp)$/i.test(name)) return '🖼️';
  if (mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) return '🎙️';
  if (mimeType.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(name)) return '🎬';
  if (/\.(pdf|doc|docx|txt|md|rtf)$/i.test(name)) return '📄';
  if (/\.(zip|tar|gz|7z|rar)$/i.test(name)) return '📦';
  if (/\.(js|jsx|ts|tsx|html|css|json|py|go|rs|c|cpp)$/i.test(name)) return '💻';
  return isSend ? '📤' : '📥';
}

export function TransferItem({ transfer, onCancel }) {
  const [showLightbox, setShowLightbox] = useState(false);

  const isSend = transfer.direction === 'send';
  const isCompleted = transfer.status === 'completed';
  const isCancelled = transfer.status === 'cancelled';
  const isError = transfer.status === 'error';
  const isTransferring = transfer.status === 'transferring';

  const isImage = isCompleted && transfer.downloadUrl && isImageMime(transfer.mimeType, transfer.fileName);
  const isAudio = isCompleted && transfer.downloadUrl && isAudioMime(transfer.mimeType, transfer.fileName);
  const isVideo = isCompleted && transfer.downloadUrl && isVideoMime(transfer.mimeType, transfer.fileName);

  return (
    <>
      <div
        className="card animate-entrance"
        style={{
          padding: '16px',
          backgroundColor: 'var(--glass-surface-2)',
          border: `1px solid ${
            isError
              ? 'var(--color-danger-border)'
              : isCompleted
              ? 'var(--color-success-border)'
              : 'var(--glass-border)'
          }`,
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxShadow: 'var(--glass-shadow-sm)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
            {/* Thumbnail Preview or Icon */}
            {isImage ? (
              <button
                type="button"
                onClick={() => setShowLightbox(true)}
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                  border: '1px solid rgba(228, 253, 151, 0.4)',
                  padding: 0,
                  cursor: 'pointer',
                  background: '#000',
                  flexShrink: 0,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)'
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
              <span
                style={{
                  fontSize: '1.25rem',
                  width: '42px',
                  height: '42px',
                  borderRadius: 'var(--radius-sm)',
                  background: isCompleted ? 'var(--color-lime-dim)' : 'var(--glass-surface-3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid rgba(228, 253, 151, 0.2)',
                  flexShrink: 0
                }}
              >
                {getFileIcon(transfer.fileName, transfer.mimeType || '', isSend)}
              </span>
            )}

            <div style={{ overflow: 'hidden' }}>
              <div
                style={{
                  fontSize: '0.92rem',
                  fontWeight: 700,
                  color: 'var(--color-text-main)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
                title={transfer.fileName}
              >
                {transfer.fileName}
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)' }}>
                {formatBytes(transfer.fileSize)} • {isSend ? 'Sent to peer' : 'Received from peer'}
                {transfer.fileHash && (
                  <span style={{ marginLeft: '6px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--color-lime)' }}>
                    [SHA-256: {transfer.fileHash.slice(0, 8)}...]
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Status Badge & Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {isCompleted && (
              <>
                <span className="badge badge-connected" style={{ fontSize: '0.74rem' }}>
                  {transfer.verified ? '✓ Verified' : '✓ Done'}
                </span>
                {!isSend && transfer.downloadUrl && (
                  <button
                    type="button"
                    onClick={() => triggerDownload(transfer.downloadUrl, transfer.fileName)}
                    className="btn btn-primary"
                    style={{ minHeight: '34px', padding: '6px 14px', fontSize: '0.8rem' }}
                  >
                    💾 Save
                  </button>
                )}
              </>
            )}

            {isCancelled && (
              <span className="badge badge-error" style={{ fontSize: '0.74rem' }}>
                ✕ Cancelled
              </span>
            )}

            {isError && (
              <span className="badge badge-error" style={{ fontSize: '0.74rem' }}>
                ✕ Failed
              </span>
            )}

            {isTransferring && (
              <button
                type="button"
                onClick={() => onCancel(transfer.transferId)}
                className="btn btn-danger"
                style={{ minHeight: '34px', padding: '6px 12px', fontSize: '0.78rem' }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Inline Audio Player */}
        {isAudio && (
          <div style={{ padding: '6px 0' }}>
            <audio
              controls
              src={transfer.downloadUrl}
              style={{
                width: '100%',
                height: '38px',
                borderRadius: 'var(--radius-full)',
                filter: 'invert(0.9) hue-rotate(85deg)'
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

        {/* Error Details */}
        {isError && transfer.errorMessage && (
          <div
            style={{
              fontSize: '0.8rem',
              color: 'var(--color-danger)',
              backgroundColor: 'var(--color-danger-bg)',
              border: '1px solid var(--color-danger-border)',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)'
            }}
          >
            {transfer.errorMessage}
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

      {/* Full-Screen Glass Lightbox Modal */}
      {showLightbox && (
        <div
          onClick={() => setShowLightbox(false)}
          className="animate-entrance"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(10, 16, 10, 0.88)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
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
              maxWidth: '90vw',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '16px'
            }}
          >
            <img
              src={transfer.downloadUrl}
              alt={transfer.fileName}
              style={{
                maxWidth: '100%',
                maxHeight: '70vh',
                borderRadius: 'var(--radius-lg)',
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(228, 253, 151, 0.25)',
                border: '1px solid var(--glass-border-highlight)',
                objectFit: 'contain'
              }}
            />

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => triggerDownload(transfer.downloadUrl, transfer.fileName)}
              >
                💾 Download {transfer.fileName}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowLightbox(false)}
              >
                ✕ Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

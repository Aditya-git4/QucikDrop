import React from 'react';
import { TransferProgress } from './TransferProgress.jsx';
import { formatBytes } from '../utils/formatBytes.js';
import { triggerDownload } from '../utils/fileUtils.js';

/**
 * Individual file transfer card.
 * @param {{
 *   transfer: {
 *     transferId: string,
 *     fileName: string,
 *     fileSize: number,
 *     direction: 'send' | 'receive',
 *     status: 'queued' | 'transferring' | 'completed' | 'cancelled' | 'error',
 *     bytesTransferred: number,
 *     percent: number,
 *     speed: number,
 *     downloadUrl: string | null
 *   },
 *   onCancel: (id: string) => void
 * }} props
 */
export function TransferItem({ transfer, onCancel }) {
  const isSend = transfer.direction === 'send';
  const isCompleted = transfer.status === 'completed';
  const isCancelled = transfer.status === 'cancelled';
  const isError = transfer.status === 'error';
  const isTransferring = transfer.status === 'transferring';

  return (
    <div
      style={{
        padding: '12px 14px',
        backgroundColor: 'var(--color-surface)',
        border: `1px solid ${isError ? 'var(--color-danger-border)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
          <span style={{ fontSize: '1.25rem' }}>{isSend ? '📤' : '📥'}</span>
          <div style={{ overflow: 'hidden' }}>
            <div
              style={{
                fontSize: '0.9rem',
                fontWeight: 600,
                color: 'var(--color-text-main)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
              title={transfer.fileName}
            >
              {transfer.fileName}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {formatBytes(transfer.fileSize)} • {isSend ? 'Sending to peer' : 'Receiving from peer'}
              {transfer.fileHash && (
                <span style={{ marginLeft: '6px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
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
              <span className="badge badge-connected" style={{ fontSize: '0.75rem' }}>
                {transfer.verified ? '✓ Verified SHA-256' : '✓ Complete'}
              </span>
              {!isSend && transfer.downloadUrl && (
                <button
                  type="button"
                  onClick={() => triggerDownload(transfer.downloadUrl, transfer.fileName)}
                  className="btn btn-primary"
                  style={{ minHeight: '32px', padding: '4px 10px', fontSize: '0.8rem' }}
                >
                  💾 Save
                </button>
              )}
            </>
          )}

          {isCancelled && (
            <span className="badge badge-error" style={{ fontSize: '0.75rem' }}>
              ✕ Cancelled
            </span>
          )}

          {isError && (
            <span className="badge badge-error" style={{ fontSize: '0.75rem' }}>
              ✕ Failed
            </span>
          )}

          {isTransferring && (
            <button
              type="button"
              onClick={() => onCancel(transfer.transferId)}
              className="btn btn-danger"
              style={{ minHeight: '32px', padding: '4px 10px', fontSize: '0.8rem' }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Error Details */}
      {isError && transfer.errorMessage && (
        <div
          style={{
            fontSize: '0.8rem',
            color: 'var(--color-danger)',
            backgroundColor: 'var(--color-danger-bg)',
            padding: '6px 10px',
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
  );
}

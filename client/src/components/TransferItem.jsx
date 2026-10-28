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
  const isTransferring = transfer.status === 'transferring';

  return (
    <div
      style={{
        padding: '12px 14px',
        backgroundColor: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
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
            </div>
          </div>
        </div>

        {/* Status Badge & Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {isCompleted && (
            <>
              <span className="badge badge-connected" style={{ fontSize: '0.75rem' }}>
                ✓ Complete
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

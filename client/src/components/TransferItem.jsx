import React from 'react';
import { TransferProgress } from './TransferProgress.jsx';
import { formatBytes } from '../utils/formatBytes.js';
import { triggerDownload } from '../utils/fileUtils.js';

/**
 * Modern iOS glassmorphic file transfer card.
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
 *     downloadUrl: string | null,
 *     fileHash?: string,
 *     verified?: boolean,
 *     errorMessage?: string
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
      className="card animate-entrance"
      style={{
        padding: '16px',
        backgroundColor: 'rgba(28, 42, 27, 0.45)',
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
          <span
            style={{
              fontSize: '1.25rem',
              width: '36px',
              height: '36px',
              borderRadius: 'var(--radius-sm)',
              background: isCompleted ? 'var(--color-lime-dim)' : 'rgba(20, 30, 19, 0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid rgba(228, 253, 151, 0.2)'
            }}
          >
            {isSend ? '📤' : '📥'}
          </span>

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
              {formatBytes(transfer.fileSize)} • {isSend ? 'Sending to peer' : 'Receiving from peer'}
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
                {transfer.verified ? '✓ Verified SHA-256' : '✓ Complete'}
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
  );
}

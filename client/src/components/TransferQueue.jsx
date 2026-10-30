import React, { useState } from 'react';
import { TransferItem } from './TransferItem.jsx';
import { downloadAllAsZip } from '../utils/fileUtils.js';
import { hapticTap, playSuccessSound } from '../utils/soundEffects.js';
import { Archive, Trash2, Inbox } from 'lucide-react';

/**
 * TransferQueue displays the list of ongoing, queued, and completed file transfers.
 * Includes a 1-click "Download All (.zip)" archive generator for multiple received files.
 * @param {{
 *   transfers: any[],
 *   onCancelTransfer: (id: string) => void,
 *   onClearCompleted?: () => void,
 *   onRetryTransfer?: (transfer: any) => void
 * }} props
 */
export function TransferQueue({
  transfers = [],
  onCancelTransfer,
  onClearCompleted = null,
  onRetryTransfer = null
}) {
  const [isZipping, setIsZipping] = useState(false);
  const [zipPercent, setZipPercent] = useState(0);

  const completedReceived = transfers.filter(
    (t) => t.direction === 'receive' && t.status === 'completed' && t.downloadUrl
  );

  const hasFinishedTransfers = transfers.some(
    (t) => t.status === 'completed' || t.status === 'cancelled' || t.status === 'error'
  );

  const handleDownloadZip = async () => {
    if (completedReceived.length === 0 || isZipping) return;
    hapticTap();
    setIsZipping(true);
    setZipPercent(0);

    try {
      await downloadAllAsZip(
        completedReceived,
        `QuickDrop-Files-${Date.now()}.zip`,
        (percent) => setZipPercent(percent)
      );
      playSuccessSound();
    } catch (err) {
      console.error('Failed to generate ZIP archive:', err);
    } finally {
      setIsZipping(false);
      setZipPercent(0);
    }
  };

  if (transfers.length === 0) {
    return (
      <div
        style={{
          padding: '32px 20px',
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '10px',
          background: 'var(--color-bg-surface-1)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)'
        }}
      >
        <Inbox size={28} strokeWidth={1.5} style={{ opacity: 0.6 }} />
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
          No transfers yet. Drop a file above to begin sending.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3 style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Transfers ({transfers.length})
          </h3>
        </div>

        {/* Action Buttons: ZIP & Clear Finished */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {completedReceived.length >= 2 && (
            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={isZipping}
              className="btn btn-secondary"
              style={{
                padding: '4px 12px',
                fontSize: 'var(--font-size-xs)',
                height: '32px',
                minHeight: '32px'
              }}
              title="Download all received files as a single .zip"
            >
              <Archive size={13} strokeWidth={1.75} />
              <span>{isZipping ? `Archiving (${zipPercent}%)...` : `Save All as ZIP (${completedReceived.length})`}</span>
            </button>
          )}

          {hasFinishedTransfers && onClearCompleted && (
            <button
              type="button"
              onClick={onClearCompleted}
              className="btn btn-ghost"
              style={{
                padding: '4px 10px',
                fontSize: 'var(--font-size-xs)',
                height: '32px',
                minHeight: '32px'
              }}
              title="Clear finished and cancelled transfers"
            >
              <Trash2 size={13} strokeWidth={1.75} />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Transfer Items List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {transfers.map((transfer) => (
          <TransferItem
            key={transfer.transferId}
            transfer={transfer}
            onCancel={onCancelTransfer}
            onRetry={onRetryTransfer}
          />
        ))}
      </div>
    </div>
  );
}

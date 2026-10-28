import React, { useState } from 'react';
import { TransferItem } from './TransferItem.jsx';
import { downloadAllAsZip } from '../utils/fileUtils.js';
import { hapticTap, playSuccessSound } from '../utils/soundEffects.js';

/**
 * TransferQueue displays the list of ongoing, queued, and completed file transfers.
 * Includes a 1-click "Download All (.zip)" archive generator for multiple received files.
 * @param {{
 *   transfers: any[],
 *   onCancelTransfer: (id: string) => void
 * }} props
 */
export function TransferQueue({ transfers, onCancelTransfer }) {
  const [isZipping, setIsZipping] = useState(false);
  const [zipPercent, setZipPercent] = useState(0);

  if (!transfers || transfers.length === 0) return null;

  const completedReceived = transfers.filter(
    (t) => t.direction === 'receive' && t.status === 'completed' && t.downloadUrl
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

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        marginTop: '8px'
      }}
    >
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
          <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
            Transfers ({transfers.length})
          </h3>
          <span
            style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(228, 253, 151, 0.1)',
              color: 'var(--color-lime)',
              border: '1px solid rgba(228, 253, 151, 0.2)'
            }}
          >
            {transfers.filter((t) => t.status === 'transferring').length > 0
              ? '⚡ Active'
              : 'Idle'}
          </span>
        </div>

        {/* 1-Click Download All as ZIP (visible when 2+ received files completed) */}
        {completedReceived.length >= 2 && (
          <button
            type="button"
            onClick={handleDownloadZip}
            disabled={isZipping}
            className="btn btn-secondary animate-entrance"
            style={{
              padding: '5px 12px',
              fontSize: '0.78rem',
              minHeight: '30px',
              background: 'rgba(228, 253, 151, 0.15)',
              borderColor: 'rgba(228, 253, 151, 0.4)',
              color: 'var(--color-lime)'
            }}
            title="Package all received files into a single .zip download"
          >
            {isZipping ? `📦 Zipping ${zipPercent}%...` : `📦 Download All as ZIP (${completedReceived.length})`}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {transfers.map((t) => (
          <TransferItem
            key={t.transferId}
            transfer={t}
            onCancel={onCancelTransfer}
          />
        ))}
      </div>
    </div>
  );
}

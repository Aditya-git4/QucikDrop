import React from 'react';
import { TransferItem } from './TransferItem.jsx';

/**
 * TransferQueue displays the list of ongoing, queued, and completed file transfers.
 * @param {{
 *   transfers: any[],
 *   onCancelTransfer: (id: string) => void
 * }} props
 */
export function TransferQueue({ transfers, onCancelTransfer }) {
  if (!transfers || transfers.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        marginTop: '8px'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
          Transfer Queue ({transfers.length})
        </h3>
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

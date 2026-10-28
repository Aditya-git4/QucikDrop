import React from 'react';
import { formatBytes, formatSpeed } from '../utils/formatBytes.js';

/**
 * Visual progress bar with bytes transferred, percent, and speed.
 * @param {{
 *   percent: number,
 *   bytesTransferred: number,
 *   totalBytes: number,
 *   speed?: number
 * }} props
 */
export function TransferProgress({ percent, bytesTransferred, totalBytes, speed = 0 }) {
  const safePercent = Math.min(100, Math.max(0, percent || 0));

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {/* Progress Track */}
      <div
        style={{
          width: '100%',
          height: '6px',
          backgroundColor: 'var(--color-surface-hover)',
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            width: `${safePercent}%`,
            height: '100%',
            backgroundColor: 'var(--color-primary)',
            borderRadius: 'var(--radius-full)',
            transition: 'width 0.2s ease'
          }}
        />
      </div>

      {/* Progress Stats */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)'
        }}
      >
        <span>
          {formatBytes(bytesTransferred)} / {formatBytes(totalBytes)} ({safePercent}%)
        </span>
        {speed > 0 && <span>{formatSpeed(speed)}</span>}
      </div>
    </div>
  );
}

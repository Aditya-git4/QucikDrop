import React from 'react';
import { formatBytes, formatSpeed } from '../utils/formatBytes.js';

/**
 * Modern iOS glassmorphic progress bar with Lime Sprout glow fill.
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
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {/* iOS Progress Track */}
      <div
        style={{
          width: '100%',
          height: '8px',
          backgroundColor: 'rgba(18, 28, 17, 0.75)',
          border: '1px solid rgba(228, 253, 151, 0.15)',
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden',
          boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.5)'
        }}
      >
        <div
          style={{
            width: `${safePercent}%`,
            height: '100%',
            backgroundColor: 'var(--color-lime)',
            borderRadius: 'var(--radius-full)',
            boxShadow: '0 0 12px rgba(228, 253, 151, 0.65)',
            transition: 'width 0.25s var(--spring-bounce)'
          }}
        />
      </div>

      {/* Progress Stats */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.74rem',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)'
        }}
      >
        <span>
          {formatBytes(bytesTransferred)} / {formatBytes(totalBytes)} ({safePercent}%)
        </span>
        {speed > 0 && <span style={{ color: 'var(--color-lime)', fontWeight: 600 }}>⚡ {formatSpeed(speed)}</span>}
      </div>
    </div>
  );
}

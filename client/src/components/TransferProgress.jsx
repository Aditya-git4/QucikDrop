import React from 'react';
import { formatBytes, formatSpeed } from '../utils/formatBytes.js';

/**
 * Modern iOS glassmorphic progress bar with Lime Sprout glow fill, ETA, and live throughput wave.
 * @param {{
 *   percent: number,
 *   bytesTransferred: number,
 *   totalBytes: number,
 *   speed?: number
 * }} props
 */
export function TransferProgress({ percent, bytesTransferred, totalBytes, speed = 0 }) {
  const safePercent = Math.min(100, Math.max(0, percent || 0));

  const remainingBytes = Math.max(0, totalBytes - bytesTransferred);
  const etaSeconds = speed > 0 && remainingBytes > 0 ? Math.ceil(remainingBytes / speed) : null;

  const formatEta = (sec) => {
    if (sec == null) return null;
    if (sec < 60) return `${sec}s left`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s left`;
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* iOS Progress Track with Breathing Glow */}
      <div
        style={{
          width: '100%',
          height: '8px',
          backgroundColor: 'rgba(18, 28, 17, 0.85)',
          border: '1px solid rgba(228, 253, 151, 0.2)',
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden',
          boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.6)',
          position: 'relative'
        }}
      >
        <div
          style={{
            width: `${safePercent}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #b8e645 0%, var(--color-lime) 100%)',
            borderRadius: 'var(--radius-full)',
            boxShadow: '0 0 14px rgba(228, 253, 151, 0.75)',
            transition: 'width 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        />
      </div>

      {/* Progress Stats, ETA & Throughput */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.74rem',
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-mono)'
        }}
      >
        <span>
          {formatBytes(bytesTransferred)} / {formatBytes(totalBytes)} ({safePercent}%)
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {etaSeconds != null && (
            <span style={{ color: 'var(--color-text-subtle)' }}>
              ⏳ {formatEta(etaSeconds)}
            </span>
          )}
          {speed > 0 && (
            <span
              style={{
                color: 'var(--color-lime)',
                fontWeight: 700,
                background: 'rgba(228, 253, 151, 0.12)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                border: '1px solid rgba(228, 253, 151, 0.25)'
              }}
            >
              ⚡ {formatSpeed(speed)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

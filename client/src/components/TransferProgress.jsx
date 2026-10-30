import React from 'react';
import { formatBytes, formatSpeed } from '../utils/formatBytes.js';
import { Clock, Zap } from 'lucide-react';

/**
 * Modern progress indicator with electric gradient fill, ETA, and live throughput in monospace.
 * Zero emojis, clean styling.
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
    if (sec < 60) return `${sec}s remaining`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s remaining`;
  };

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Progress Track */}
      <div
        style={{
          width: '100%',
          height: '6px',
          backgroundColor: 'var(--color-bg-surface-3)',
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden',
          position: 'relative'
        }}
        role="progressbar"
        aria-valuenow={safePercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          style={{
            width: `${safePercent}%`,
            height: '100%',
            background: 'var(--accent-gradient)',
            borderRadius: 'var(--radius-full)',
            transition: 'width 0.2s var(--ease-apple)'
          }}
        />
      </div>

      {/* Stats & Throughput */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-text-secondary)',
          fontFamily: 'var(--font-mono)'
        }}
      >
        <span>
          {formatBytes(bytesTransferred)} / {formatBytes(totalBytes)} ({safePercent}%)
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {etaSeconds != null && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--color-text-muted)' }}>
              <Clock size={12} strokeWidth={1.75} />
              <span>{formatEta(etaSeconds)}</span>
            </span>
          )}
          {speed > 0 && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                color: '#22d3ee',
                fontWeight: 600,
                background: 'rgba(34, 211, 238, 0.1)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid rgba(34, 211, 238, 0.2)'
              }}
            >
              <Zap size={12} strokeWidth={1.75} />
              <span>{formatSpeed(speed)}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CopyButton } from './CopyButton.jsx';
import { hapticTap } from '../utils/soundEffects.js';
import { isDebugEnabled } from '../utils/debugLogger.js';
import { buildInvitationUrl } from '../utils/roomUtils.js';
import { Share2, Clock, Smartphone, Info } from 'lucide-react';

/**
 * Centered high-contrast QR invite panel for the waiting room state.
 * Includes sharp QR canvas, invitation link with 1-click copy, and clean countdown.
 * Zero emojis, clean styling.
 * @param {{ roomId: string, joinToken: string, roomKey?: string | null, expiresAt: number | null }} props
 */
export function QRCodeDisplay({ roomId, joinToken, roomKey = null, expiresAt }) {
  const canvasRef = useRef(null);
  const [timeLeft, setTimeLeft] = useState('');
  const [percentLeft, setPercentLeft] = useState(100);
  const [initialDuration, setInitialDuration] = useState(null);

  const isDebug = isDebugEnabled();
  const invitationUrl = joinToken
    ? buildInvitationUrl(roomId, joinToken, roomKey, isDebug)
    : '';

  // Render high-contrast QR code
  useEffect(() => {
    if (!canvasRef.current || !invitationUrl) return;

    const qrWidth = typeof window !== 'undefined' && window.innerWidth < 480 ? 200 : 230;

    QRCode.toCanvas(
      canvasRef.current,
      invitationUrl,
      {
        width: qrWidth,
        margin: 1,
        color: {
          dark: '#090a0f',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'M'
      },
      (err) => {
        if (err) console.error('Error rendering QR code:', err);
      }
    );
  }, [invitationUrl]);

  // Expiration countdown with circular percentage tracking
  useEffect(() => {
    if (!expiresAt) return;

    const totalLifetime = initialDuration || (expiresAt - Date.now());
    if (!initialDuration && totalLifetime > 0) {
      setInitialDuration(totalLifetime);
    }

    const updateTimer = () => {
      const remainingMs = Math.max(0, expiresAt - Date.now());
      if (remainingMs <= 0) {
        setTimeLeft('Expired');
        setPercentLeft(0);
        return;
      }
      const totalSec = Math.floor(remainingMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`);

      if (totalLifetime > 0) {
        setPercentLeft(Math.max(0, Math.min(100, (remainingMs / totalLifetime) * 100)));
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, initialDuration]);

  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const handleShare = async () => {
    hapticTap();
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Join QuickDrop Room',
          text: 'Connect with me on QuickDrop for instant file sharing:',
          url: invitationUrl
        });
      } catch {
        // User dismissed
      }
    }
  };

  return (
    <div
      className="qr-invite-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: '24px',
        padding: '36px 20px',
        maxWidth: '520px',
        margin: '0 auto'
      }}
    >
      {/* Status & Countdown Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '4px 12px',
            background: 'rgba(99, 102, 241, 0.1)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            borderRadius: 'var(--radius-full)',
            color: '#6366f1',
            fontSize: 'var(--font-size-xs)',
            fontWeight: 500
          }}
        >
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              backgroundColor: '#6366f1',
              animation: 'pulse 1.8s infinite'
            }}
          />
          <span>Waiting for peer to scan...</span>
        </div>

        {timeLeft && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              background: 'var(--color-bg-surface-2)',
              border: '1px solid var(--border-subtle)',
              padding: '4px 10px',
              borderRadius: 'var(--radius-full)'
            }}
          >
            {/* SVG Circular countdown ring */}
            <svg width="14" height="14" viewBox="0 0 16 16" style={{ transform: 'rotate(-90deg)' }}>
              <circle
                cx="8"
                cy="8"
                r="6.5"
                fill="none"
                stroke="var(--border-medium)"
                strokeWidth="2"
              />
              <circle
                cx="8"
                cy="8"
                r="6.5"
                fill="none"
                stroke="#6366f1"
                strokeWidth="2"
                strokeDasharray="40.84"
                strokeDashoffset={40.84 - (40.84 * percentLeft) / 100}
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
            </svg>
            <span>{timeLeft}</span>
          </div>
        )}
      </div>

      {/* High-Contrast White Rounded QR Frame */}
      <div
        className="qr-canvas-frame"
        style={{
          padding: '16px',
          background: '#ffffff',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.35)',
          display: 'inline-flex'
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', borderRadius: 'var(--radius-sm)' }}
        />
      </div>

      {/* Explanatory Copy & Direct Actions */}
      <div style={{ width: '100%' }}>
        <h3
          style={{
            fontSize: 'var(--font-size-xl)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'var(--color-text-primary)',
            marginBottom: '6px'
          }}
        >
          Scan to connect
        </h3>
        <p
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
            marginBottom: '20px',
            lineHeight: 1.55
          }}
        >
          Scan with your phone's camera, or share this one-time link.
        </p>

        {/* Link Share Row */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            readOnly
            value={invitationUrl}
            className="text-input"
            style={{
              fontSize: 'var(--font-size-xs)',
              fontFamily: 'var(--font-mono)',
              flex: 1,
              height: '42px',
              padding: '0 14px'
            }}
            onFocus={(e) => e.target.select()}
          />
          <CopyButton
            text={invitationUrl}
            label="Copy"
            successLabel="Copied!"
            className="btn-secondary"
          />
          {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ height: '42px', padding: '0 16px', fontSize: 'var(--font-size-sm)' }}
              onClick={handleShare}
              title="Share invitation link"
            >
              <Share2 size={15} strokeWidth={1.75} />
              <span>Share</span>
            </button>
          )}
        </div>

        {/* Localhost Wi-Fi Developer Hint */}
        {isLocalhost && (
          <div
            style={{
              marginTop: '20px',
              padding: '12px 16px',
              backgroundColor: 'var(--color-bg-surface-2)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-secondary)',
              textAlign: 'left',
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start'
            }}
          >
            <Info size={16} strokeWidth={1.75} style={{ color: '#6366f1', flexShrink: 0, marginTop: '2px' }} />
            <div>
              <strong style={{ color: 'var(--color-text-primary)', display: 'block', marginBottom: '2px' }}>
                Testing on phone over Wi-Fi?
              </strong>
              Phones cannot reach <code>localhost</code>. Open this app using your computer's local network IP address (e.g. <code>http://192.168.1.X:5000</code>).
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

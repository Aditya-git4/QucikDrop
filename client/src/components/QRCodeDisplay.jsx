import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CopyButton } from './CopyButton.jsx';
import { buildInvitationUrl } from '../utils/roomUtils.js';

/**
 * High-resolution QR code generator and invitation sharing display.
 * @param {{ roomId: string, joinToken: string, expiresAt: number | null }} props
 */
export function QRCodeDisplay({ roomId, joinToken, expiresAt }) {
  const canvasRef = useRef(null);
  const [timeLeft, setTimeLeft] = useState('');
  const [customOrigin, setCustomOrigin] = useState(() => {
    return typeof window !== 'undefined' ? window.location.origin : '';
  });

  const invitationUrl = joinToken
    ? `${customOrigin}/room/${encodeURIComponent(roomId)}#token=${encodeURIComponent(joinToken)}`
    : '';

  // Render QR Code to canvas
  useEffect(() => {
    if (!canvasRef.current || !invitationUrl) return;

    QRCode.toCanvas(
      canvasRef.current,
      invitationUrl,
      {
        width: 240,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'M'
      },
      (err) => {
        if (err) console.error('Error rendering QR code:', err);
      }
    );
  }, [invitationUrl]);

  // Expiration countdown timer
  useEffect(() => {
    if (!expiresAt) return;

    const updateTimer = () => {
      const remainingMs = Math.max(0, expiresAt - Date.now());
      if (remainingMs <= 0) {
        setTimeLeft('Expired');
        return;
      }
      const totalSec = Math.floor(remainingMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: '16px',
        padding: '16px 0'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span className="badge badge-waiting">
          <span className="pulse-dot" /> Waiting for peer to connect
        </span>
        {timeLeft && (
          <span
            style={{
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)'
            }}
          >
            ⏱ {timeLeft}
          </span>
        )}
      </div>

      {/* QR Code Container */}
      <div
        style={{
          background: '#ffffff',
          padding: '12px',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-md)',
          display: 'inline-flex',
          border: '1px solid var(--color-border)'
        }}
      >
        <canvas ref={canvasRef} style={{ width: '240px', height: '240px', display: 'block' }} />
      </div>

      <div style={{ maxWidth: '420px', width: '100%' }}>
        <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', marginBottom: '12px' }}>
          Scan this QR code with an Android phone or copy the invitation link below.
        </p>

        {/* Copy / Share Link Input Group */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            readOnly
            value={invitationUrl}
            className="text-input"
            style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)', flex: '1 1 200px' }}
            onFocus={(e) => e.target.select()}
          />
          <CopyButton text={invitationUrl} label="Copy Link" successLabel="Copied!" />
          {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ minHeight: '38px', padding: '8px 14px', fontSize: '0.85rem' }}
              onClick={async () => {
                try {
                  await navigator.share({
                    title: 'Join QuickDrop Room',
                    text: 'Connect with me on QuickDrop to transfer text and files peer-to-peer:',
                    url: invitationUrl
                  });
                } catch {
                  // User dismissed share dialog
                }
              }}
            >
              📲 Share
            </button>
          )}
        </div>

        {/* Wi-Fi note for localhost testing */}
        {isLocalhost && (
          <div
            style={{
              marginTop: '14px',
              padding: '10px 12px',
              backgroundColor: 'var(--color-primary-light)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.8rem',
              color: 'var(--color-primary)',
              textAlign: 'left'
            }}
          >
            <strong>💡 Testing on Phone via Wi-Fi:</strong>
            <p style={{ marginTop: '4px' }}>
              Your phone cannot access <code>localhost</code>. Open this page on your PC using your local IP (e.g. <code>http://192.168.x.x:5173</code>) so the generated QR code works directly on your phone!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

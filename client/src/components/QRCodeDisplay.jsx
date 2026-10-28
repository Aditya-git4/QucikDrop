import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CopyButton } from './CopyButton.jsx';

/**
 * Modern iOS glassmorphic QR code generator and invitation sharing display.
 * @param {{ roomId: string, joinToken: string, expiresAt: number | null }} props
 */
export function QRCodeDisplay({ roomId, joinToken, expiresAt }) {
  const canvasRef = useRef(null);
  const [timeLeft, setTimeLeft] = useState('');
  const [customOrigin] = useState(() => {
    return typeof window !== 'undefined' ? window.location.origin : '';
  });

  const invitationUrl = joinToken
    ? `${customOrigin}/room/${encodeURIComponent(roomId)}#token=${encodeURIComponent(joinToken)}`
    : '';

  // Render QR Code to canvas with crisp contrast
  useEffect(() => {
    if (!canvasRef.current || !invitationUrl) return;

    QRCode.toCanvas(
      canvasRef.current,
      invitationUrl,
      {
        width: 220,
        margin: 2,
        color: {
          dark: '#121c11',
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
        gap: '20px',
        padding: '24px 16px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <span className="badge badge-waiting">
          <span className="pulse-dot" /> Waiting for peer to scan...
        </span>
        {timeLeft && (
          <span
            style={{
              fontSize: '0.8rem',
              fontWeight: 700,
              color: 'var(--color-lime)',
              fontFamily: 'var(--font-mono)',
              background: 'var(--color-lime-dim)',
              padding: '4px 10px',
              borderRadius: 'var(--radius-full)',
              border: '1px solid rgba(228, 253, 151, 0.25)'
            }}
          >
            ⏱ {timeLeft}
          </span>
        )}
      </div>

      {/* QR Code Container with Specular Glass Frame */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.96)',
          padding: '16px',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 16px 40px rgba(0, 0, 0, 0.5), 0 0 35px rgba(228, 253, 151, 0.25)',
          display: 'inline-flex',
          border: '4px solid rgba(228, 253, 151, 0.4)'
        }}
      >
        <canvas ref={canvasRef} style={{ width: '220px', height: '220px', display: 'block', borderRadius: 'var(--radius-md)' }} />
      </div>

      <div style={{ maxWidth: '440px', width: '100%' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-text-main)', marginBottom: '6px' }}>
          Scan to Connect
        </h3>
        <p style={{ fontSize: '0.88rem', color: 'var(--color-text-muted)', marginBottom: '16px', lineHeight: 1.5 }}>
          Open your camera on your phone to join this room instantly, or share the private invitation link below.
        </p>

        {/* Copy / Share Link Input Group */}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            readOnly
            value={invitationUrl}
            className="text-input"
            style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', flex: '1 1 200px', minHeight: '42px', padding: '10px 14px' }}
            onFocus={(e) => e.target.select()}
          />
          <CopyButton text={invitationUrl} label="Copy Link" successLabel="Copied!" className="btn-secondary" />
          {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ minHeight: '42px', padding: '8px 16px', fontSize: '0.85rem' }}
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
              marginTop: '16px',
              padding: '12px 16px',
              backgroundColor: 'rgba(228, 253, 151, 0.08)',
              border: '1px solid rgba(228, 253, 151, 0.2)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.8rem',
              color: 'var(--color-text-muted)',
              textAlign: 'left',
              lineHeight: 1.5
            }}
          >
            <strong style={{ color: 'var(--color-lime)' }}>💡 Testing on Phone via Wi-Fi:</strong>
            <p style={{ marginTop: '4px' }}>
              Your phone cannot reach <code>localhost</code>. Open this app on your PC using your local IP (e.g. <code>http://192.168.x.x:5000</code>) so your phone camera opens the correct network address!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

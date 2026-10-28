import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CopyButton } from './CopyButton.jsx';
import { hapticTap } from '../utils/soundEffects.js';

/**
 * Modern VisionOS / Apple AirDrop-style radar QR code invitation display.
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

  // Render QR Code with maximum sharpness
  useEffect(() => {
    if (!canvasRef.current || !invitationUrl) return;

    const qrWidth = typeof window !== 'undefined' && window.innerWidth < 480 ? 180 : 220;

    QRCode.toCanvas(
      canvasRef.current,
      invitationUrl,
      {
        width: qrWidth,
        margin: 1,
        color: {
          dark: '#0e160d',
          light: '#ffffff'
        },
        errorCorrectionLevel: 'M'
      },
      (err) => {
        if (err) console.error('Error rendering QR code:', err);
      }
    );
  }, [invitationUrl]);

  // Expiration countdown
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

  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const handleShare = async () => {
    hapticTap();
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'Join QuickDrop Room',
          text: 'Connect with me on QuickDrop for instant, private peer-to-peer sharing:',
          url: invitationUrl
        });
      } catch {
        // User dismissed
      }
    }
  };

  return (
    <div
      className="qr-display-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: '16px',
        padding: '20px 14px',
        position: 'relative'
      }}
    >
      {/* Top Status & Radar Beacon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <span className="badge badge-waiting">
          <span className="pulse-dot" /> Waiting for peer to scan...
        </span>
        {timeLeft && (
          <span
            style={{
              fontSize: '0.78rem',
              fontWeight: 700,
              color: 'var(--color-lime)',
              fontFamily: 'var(--font-mono)',
              background: 'var(--color-lime-dim)',
              padding: '3px 10px',
              borderRadius: 'var(--radius-full)',
              border: '1px solid rgba(228, 253, 151, 0.25)'
            }}
          >
            ⏱ {timeLeft}
          </span>
        )}
      </div>

      {/* QR Code Frame with Specular Sheen & Floating Depth */}
      <div
        className="qr-canvas-frame"
        style={{
          position: 'relative',
          padding: '12px',
          background: '#ffffff',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 20px 45px rgba(0, 0, 0, 0.6), 0 0 40px rgba(228, 253, 151, 0.22)',
          border: '3px solid rgba(228, 253, 151, 0.45)',
          display: 'inline-flex',
          transition: 'transform 0.3s var(--spring-bounce)'
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', borderRadius: 'var(--radius-md)' }}
        />
      </div>

      {/* Action Area & Explanatory Copy */}
      <div style={{ maxWidth: '440px', width: '100%' }}>
        <h3
          style={{
            fontSize: '1.25rem',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'var(--color-text-main)',
            marginBottom: '6px'
          }}
        >
          Scan to Connect
        </h3>
        <p
          style={{
            fontSize: '0.88rem',
            color: 'var(--color-text-muted)',
            marginBottom: '18px',
            lineHeight: 1.55
          }}
        >
          Point your phone camera at this QR code to join instantly, or share the secure single-use invitation link.
        </p>

        {/* Link Share Row */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            readOnly
            value={invitationUrl}
            className="text-input"
            style={{
              fontSize: '0.82rem',
              fontFamily: 'var(--font-mono)',
              flex: 1,
              minHeight: '42px',
              padding: '8px 14px'
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
              style={{ minHeight: '42px', padding: '0 16px', fontSize: '0.85rem' }}
              onClick={handleShare}
            >
              Share
            </button>
          )}
        </div>

        {/* Wi-Fi Note for Localhost development */}
        {isLocalhost && (
          <div
            style={{
              marginTop: '18px',
              padding: '12px 16px',
              backgroundColor: 'rgba(228, 253, 151, 0.08)',
              border: '1px solid rgba(228, 253, 151, 0.2)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.80rem',
              color: 'var(--color-text-muted)',
              textAlign: 'left',
              lineHeight: 1.5
            }}
          >
            <strong style={{ color: 'var(--color-lime)', display: 'block', marginBottom: '2px' }}>
              💡 Testing on phone over local Wi-Fi?
            </strong>
            Phones cannot connect to <code>localhost</code>. Access this web app via your computer's local Wi-Fi IP address (e.g. <code>http://192.168.1.X:5000</code>).
          </div>
        )}
      </div>
    </div>
  );
}

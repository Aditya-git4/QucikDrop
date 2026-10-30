import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { CopyButton } from './CopyButton.jsx';
import { hapticTap } from '../utils/soundEffects.js';
import { isDebugEnabled } from '../utils/debugLogger.js';
import { buildInvitationUrl } from '../utils/roomUtils.js';
import {
  Share2,
  Clock,
  Smartphone,
  Info,
  Camera,
  QrCode,
  ArrowRight,
  LogOut,
  X,
  KeyRound
} from 'lucide-react';

/**
 * Modern Waiting Room View (before peer joins).
 * Desktop (>= 1024px): Two-column layout
 *   Left = Large high-contrast QR tile with accent ring & scan line animation (+ PIN if required)
 *   Right = 3-step guide, invite link field, countdown ring, close room action
 * Mobile (< 1024px): Stacked single column with QR on top.
 * Localhost note displayed ONLY when hostname is localhost / 127.0.0.1.
 */
export function WaitingRoomView({
  roomId,
  joinToken,
  roomKey = null,
  requirePin = false,
  roomPin = null,
  expiresAt,
  onCloseRoom
}) {
  const canvasRef = useRef(null);
  const [timeLeft, setTimeLeft] = useState('');
  const [percentLeft, setPercentLeft] = useState(100);
  const [initialDuration, setInitialDuration] = useState(null);
  const [dismissLocalhostHint, setDismissLocalhostHint] = useState(false);

  const isDebug = isDebugEnabled();
  const invitationUrl = joinToken
    ? buildInvitationUrl(roomId || '', joinToken, roomKey, isDebug)
    : '';

  const isLocalhost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  // Render high-contrast QR code
  useEffect(() => {
    if (!canvasRef.current || !invitationUrl) return;

    QRCode.toCanvas(
      canvasRef.current,
      invitationUrl,
      {
        width: 240,
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

  // Expiration countdown
  useEffect(() => {
    if (!expiresAt) return;

    const totalDur = expiresAt - Date.now();
    if (totalDur > 0 && !initialDuration) {
      setInitialDuration(totalDur);
    }

    const updateTimer = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        setTimeLeft('Expired');
        setPercentLeft(0);
        return;
      }

      const totalSec = Math.floor(remaining / 1000);
      const minutes = Math.floor(totalSec / 60);
      const seconds = totalSec % 60;
      setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`);

      const dur = initialDuration || totalDur || 600000;
      const pct = Math.max(0, Math.min(100, (remaining / dur) * 100));
      setPercentLeft(pct);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, initialDuration]);

  const handleShare = async () => {
    if (!navigator.share || !invitationUrl) return;
    hapticTap();
    try {
      await navigator.share({
        title: 'Join QuickDrop Room',
        text: 'Join my temporary QuickDrop room to send files directly without an account:',
        url: invitationUrl
      });
    } catch (err) {
      if (err.name !== 'AbortError') console.error('Share error:', err);
    }
  };

  return (
    <div className="waiting-room-layout">
      {/* Left Column: Large QR Tile & Access PIN */}
      <div className="waiting-qr-column">
        <div className="waiting-qr-card">
          <div className="qr-accent-halo" />
          <div className="waiting-qr-frame">
            <canvas ref={canvasRef} width="240" height="240" />
            <div className="qr-scan-line" aria-hidden="true" />
          </div>
          <span className="qr-scan-caption">Scan with your phone's camera</span>
        </div>

        {requirePin && roomPin && (
          <div className="waiting-pin-card">
            <div className="waiting-pin-meta">
              <div className="waiting-pin-tag">
                <KeyRound size={12} strokeWidth={2} />
                <span>Room Access PIN</span>
              </div>
              <span className="waiting-pin-instruction">Guests must enter this code to join</span>
            </div>
            <div className="waiting-pin-row">
              <code className="waiting-pin-code">{roomPin}</code>
              <CopyButton text={roomPin} label="Copy PIN" copiedLabel="Copied!" />
            </div>
          </div>
        )}
      </div>

      {/* Right Column: Step guide, Link & Controls */}
      <div className="waiting-guide-column">
        <div className="waiting-guide-header">
          <div className="guide-title-row">
            <h2 className="guide-heading">Waiting for peer to connect</h2>
            {timeLeft && (
              <div className="expiry-pill" title={`Room expires in ${timeLeft}`}>
                <svg className="expiry-svg-ring" width="16" height="16" viewBox="0 0 20 20">
                  <circle cx="10" cy="10" r="8" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
                  <circle
                    cx="10"
                    cy="10"
                    r="8"
                    fill="none"
                    stroke="var(--color-brand)"
                    strokeWidth="2.5"
                    strokeDasharray={50.26}
                    strokeDashoffset={50.26 * (1 - percentLeft / 100)}
                    strokeLinecap="round"
                    transform="rotate(-90 10 10)"
                    style={{ transition: 'stroke-dashoffset 0.8s linear' }}
                  />
                </svg>
                <span className="expiry-text">{timeLeft}</span>
              </div>
            )}
          </div>
          <p className="guide-subtext">
            Keep this window open. Once the second device scans or opens the link, you will connect instantly.
          </p>
        </div>

        {/* 3-Step Guide */}
        <div className="waiting-stepper">
          <div className="stepper-item">
            <div className="stepper-number">1</div>
            <div className="stepper-text">
              <strong>Open camera</strong>
              <span>Use the camera app on your phone</span>
            </div>
          </div>
          <div className="stepper-item">
            <div className="stepper-number">2</div>
            <div className="stepper-text">
              <strong>Scan QR code</strong>
              <span>Tap the link banner that appears</span>
            </div>
          </div>
          <div className="stepper-item">
            <div className="stepper-number">3</div>
            <div className="stepper-text">
              <strong>Drop to send</strong>
              <span>Send files & text in real-time</span>
            </div>
          </div>
        </div>

        {/* Invite link input row */}
        <div className="waiting-link-card">
          <label className="waiting-link-label">Or share this single-use link</label>
          <div className="waiting-link-row">
            <input
              type="text"
              readOnly
              value={invitationUrl}
              className="input input-mono waiting-link-input"
              aria-label="One-time room link"
            />
            <CopyButton text={invitationUrl} label="Copy link" copiedLabel="Copied!" />
            {typeof navigator !== 'undefined' && Boolean(navigator.share) && (
              <button
                type="button"
                onClick={handleShare}
                className="btn btn-secondary waiting-share-btn"
                aria-label="Share invitation link"
              >
                <Share2 size={14} strokeWidth={1.75} />
                <span>Share</span>
              </button>
            )}
          </div>
        </div>

        {/* Localhost note (ONLY shown on localhost / 127.0.0.1, never in production) */}
        {isLocalhost && !dismissLocalhostHint && (
          <div className="localhost-dev-note">
            <Info size={16} className="dev-note-icon" />
            <div className="dev-note-content">
              <strong>Testing on phone over Wi-Fi?</strong>
              <span>
                Phones cannot reach localhost. Open this app using your local IP (e.g. http://192.168.1.X:5000).
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDismissLocalhostHint(true)}
              className="btn-icon dev-note-close"
              aria-label="Dismiss localhost notice"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Close Room button */}
        <div className="waiting-footer-actions">
          <button
            type="button"
            onClick={onCloseRoom}
            className="btn btn-secondary btn-close-room"
            aria-label="Cancel and close room"
          >
            <LogOut size={14} strokeWidth={1.75} />
            <span>Close room</span>
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { getDeviceDefaultName } from '../utils/roomUtils.js';
import { isValidRoomId, isValidJoinToken } from '../utils/validateInput.js';
import { HeroMascot } from '../components/HeroMascot.jsx';
import {
  Share2,
  RefreshCw,
  ShieldCheck,
  Clock,
  Globe,
  Download,
  ArrowRight,
  Laptop,
  Smartphone,
  CheckCircle2,
  Link2,
  X,
  Sparkles,
  Zap,
  Lock
} from 'lucide-react';

/**
 * Modern product landing page for QuickDrop inspired by high-polish 3D character hero mockups:
 * - Sleek hardware display bezel with camera notch and soft drop shadow
 * - Vibrant saturated canvas (interactively switchable: 'solar' gold rocket or 'cosmic' purple furry mascot)
 * - Bold display typography, clean pill CTAs, inline invite join flow, and device rename
 * - 3-step walkthrough, 6-tile bento grid, privacy architecture breakdown, and zero-JS FAQ
 *
 * @param {{
 *   onCreateRoom: (deviceName: string) => void,
 *   onJoinRoom: (roomId: string, joinToken: string, deviceName: string, roomKey?: string) => void,
 *   isConnecting: boolean,
 *   errorMessage: string | null
 * }} props
 */
export function Home({ onCreateRoom, onJoinRoom, isConnecting, errorMessage }) {
  // Device name management with localStorage persistence
  const [deviceName, setDeviceName] = useState(() => {
    try {
      const saved = localStorage.getItem('quickdrop:deviceName');
      if (saved && saved.trim()) return saved.trim();
    } catch (_) {}
    return getDeviceDefaultName();
  });

  const [isEditingDeviceName, setIsEditingDeviceName] = useState(false);
  const [showJoinFlow, setShowJoinFlow] = useState(false);
  const [pastedLink, setPastedLink] = useState('');
  const [joinHint, setJoinHint] = useState('');
  const [joinError, setJoinError] = useState('');
  const [requirePin, setRequirePin] = useState(false);
  const [customPin, setCustomPin] = useState('');

  // Hero theme switcher: 'solar' (warm gold rocket mascot) or 'cosmic' (lilac purple furry mascot)
  // Supports interactive toggling, localStorage persistence, and ?theme=cosmic|solar URL parameter
  const [heroTheme, setHeroTheme] = useState(() => {
    try {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const urlTheme = params.get('theme')?.toLowerCase();
        if (urlTheme === 'cosmic' || urlTheme === 'solar') return urlTheme;
        const saved = localStorage.getItem('quickdrop:heroTheme');
        if (saved === 'cosmic' || saved === 'solar') return saved;
      }
    } catch (_) {}
    return 'solar';
  });

  const handleSetHeroTheme = (theme) => {
    setHeroTheme(theme);
    try {
      localStorage.setItem('quickdrop:heroTheme', theme);
    } catch (_) {}
  };

  const handleDeviceNameSubmit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const trimmed = deviceName.trim();
    if (trimmed) {
      try {
        localStorage.setItem('quickdrop:deviceName', trimmed);
      } catch (_) {}
    } else {
      setDeviceName(getDeviceDefaultName());
    }
    setIsEditingDeviceName(false);
  };

  const handleStartSharing = () => {
    const trimmed = deviceName.trim() || getDeviceDefaultName();
    try {
      localStorage.setItem('quickdrop:deviceName', trimmed);
    } catch (_) {}
    onCreateRoom(trimmed, requirePin, requirePin ? (customPin.trim() || null) : null);
  };

  /**
   * Parse pasted invite link using URL parsing and hash inspection.
   * If a short code alone is entered, displays the security hint.
   */
  const handlePastedLinkChange = (e) => {
    const input = e.target.value;
    setPastedLink(input);
    setJoinHint('');
    setJoinError('');

    const trimmed = input.trim();
    if (!trimmed) return;

    // Check if user entered only a bare alphanumeric room code
    if (/^[0-9a-f]{6,32}$/i.test(trimmed) && !trimmed.includes('#') && !trimmed.includes('/')) {
      setJoinHint("Use the full invite link or scan the QR code. The code alone isn't enough, for your security.");
    }
  };

  const handleJoinSubmit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setJoinHint('');
    setJoinError('');

    const trimmed = pastedLink.trim();
    if (!trimmed) {
      setJoinError('Please paste an invitation link');
      return;
    }

    if (/^[0-9a-f]{6,32}$/i.test(trimmed) && !trimmed.includes('#') && !trimmed.includes('/')) {
      setJoinHint("Use the full invite link or scan the QR code. The code alone isn't enough, for your security.");
      return;
    }

    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
      const parsedUrl = new URL(trimmed, origin);

      // Path format: /room/:roomId
      const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
      let extractedRoomId = null;
      if (pathParts[0] === 'room' && pathParts[1]) {
        extractedRoomId = pathParts[1].toLowerCase();
      }

      // Hash format: #token=JOIN_TOKEN&k=KEY
      const hash = parsedUrl.hash.replace(/^#/, '');
      const params = new URLSearchParams(hash);
      const extractedToken = params.get('token')?.toLowerCase();
      const extractedKey = params.get('k');

      if (!extractedRoomId || !isValidRoomId(extractedRoomId)) {
        setJoinError('Invalid invitation link. Room ID must be 32 hexadecimal characters.');
        return;
      }

      if (!extractedToken || !isValidJoinToken(extractedToken)) {
        setJoinError('Invalid invitation link. Invitation token must be 48 hexadecimal characters.');
        return;
      }

      const activeName = deviceName.trim() || getDeviceDefaultName();
      onJoinRoom(extractedRoomId, extractedToken, activeName, extractedKey);
    } catch (_) {
      setJoinError('Could not parse the invitation link. Please verify the URL.');
    }
  };

  return (
    <div className="home-container" data-hero-theme={heroTheme} style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ====================================================================
          1. Showcase Display Hero (Hardware Bezel + Vibrant 3D Canvas)
          ==================================================================== */}
      <section className="display-showcase-section" aria-label="QuickDrop Hero Showcase">
        <div className="display-ambient-glow" aria-hidden="true" />

        {/* Sleek Hardware Display Frame with camera notch */}
        <div className="display-monitor-frame">
          {/* Top Notch with camera & LED */}
          <div className="display-camera-notch" aria-hidden="true">
            <span className="camera-lens" />
            <span className="camera-led" />
          </div>

          {/* Vibrant Canvas Screen Interior */}
          <div className="display-screen-interior">
            {/* Top Bar within screen */}
            <div className="display-screen-nav">
              <div className="display-nav-left">
                <span className="display-brand-icon">
                  <Zap size={16} strokeWidth={2.5} />
                </span>
                <span className="display-brand-name">QuickDrop</span>
              </div>

              <div className="display-nav-links">
                <a href="#how-it-works" className="screen-nav-link">How it works</a>
                <a href="#features" className="screen-nav-link">Features</a>
                <a href="#privacy" className="screen-nav-link">Privacy</a>
                <a href="#faq" className="screen-nav-link">FAQ</a>
              </div>

              <div className="display-nav-actions">
                <button
                  type="button"
                  onClick={handleStartSharing}
                  disabled={isConnecting}
                  className="btn-screen-pill"
                >
                  <span>{isConnecting ? 'Starting...' : 'Start sharing'}</span>
                  <ArrowRight size={14} strokeWidth={2} />
                </button>
              </div>
            </div>

            {/* Main Screen Content Grid */}
            <div className="display-screen-content">
              {/* Left Column: Headlines, CTAs, Join Flow */}
              <div className="display-hero-left">
                <div className="hero-pill-badge">
                  <span className="hero-pill-dot" />
                  <span>DIRECT DEVICE-TO-DEVICE · ZERO SERVER STORAGE</span>
                </div>

                <h1 className="display-hero-headline">
                  {heroTheme === 'solar' ? (
                    <>
                      Rocket your <br />
                      <span className="hero-headline-highlight">transfers.</span>
                    </>
                  ) : (
                    <>
                      Drop files. <br />
                      <span className="hero-headline-highlight">Fast & private.</span>
                    </>
                  )}
                </h1>

                <p className="display-hero-subtext">
                  Send files directly between any two devices. No accounts, no file size limits, zero server storage. Just open, scan, and drop.
                </p>

                {/* Primary CTA Area */}
                <div className="hero-cta-group">
                  {!showJoinFlow ? (
                    <>
                      <div className="hero-cta-buttons">
                        <button
                          id="hero-start-sharing-btn"
                          type="button"
                          onClick={handleStartSharing}
                          disabled={isConnecting}
                          className="btn-hero-launch"
                        >
                          <span>{isConnecting ? 'Starting...' : 'Start sharing'}</span>
                          <ArrowRight size={18} strokeWidth={2} />
                        </button>

                        <button
                          type="button"
                          onClick={() => setShowJoinFlow(true)}
                          className="btn-hero-ghost"
                        >
                          <Link2 size={16} strokeWidth={2} />
                          <span>Join with invite link</span>
                        </button>
                      </div>

                      {/* Optional PIN Access Control Toggle */}
                      <div className="hero-pin-toggle-bar">
                        <label className="pin-toggle-checkbox-label">
                          <input
                            type="checkbox"
                            checked={requirePin}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setRequirePin(checked);
                              if (checked && !customPin) {
                                setCustomPin(Math.floor(1000 + Math.random() * 9000).toString());
                              }
                            }}
                            className="pin-checkbox-input"
                          />
                          <span className="pin-toggle-title">Require 4-digit PIN</span>
                        </label>
                        {requirePin && (
                          <div className="hero-pin-field-wrap">
                            <label htmlFor="custom-pin-input" className="sr-only">4-digit Access PIN</label>
                            <input
                              id="custom-pin-input"
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={4}
                              value={customPin}
                              onChange={(e) => setCustomPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                              placeholder="PIN"
                              className="hero-pin-digit-input"
                              aria-label="Room access PIN"
                            />
                            <span className="hero-pin-badge">Access Control</span>
                          </div>
                        )}
                      </div>

                      {/* Device identifier pill */}
                      <div className="hero-device-pill">
                        {isEditingDeviceName ? (
                          <form onSubmit={handleDeviceNameSubmit} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                            <label htmlFor="rename-input" className="sr-only">Device Name</label>
                            <input
                              id="rename-input"
                              type="text"
                              value={deviceName}
                              onChange={(e) => setDeviceName(e.target.value)}
                              maxLength={40}
                              autoFocus
                              className="hero-device-inline-input"
                              placeholder="Device name"
                            />
                            <button type="submit" className="hero-device-save-btn">Save</button>
                          </form>
                        ) : (
                          <>
                            <span className="device-pill-label">Your device:</span>
                            <span className="device-pill-name">{deviceName}</span>
                            <button
                              type="button"
                              onClick={() => setIsEditingDeviceName(true)}
                              className="device-pill-rename"
                            >
                              Rename
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  ) : (
                    /* Inline Join Flow */
                    <div className="screen-join-flow-card">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '0.94rem', fontWeight: 700, color: '#ffffff' }}>
                          Join a room
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setShowJoinFlow(false);
                            setJoinHint('');
                            setJoinError('');
                          }}
                          className="screen-join-close"
                          aria-label="Cancel join flow"
                        >
                          <X size={16} strokeWidth={2} />
                        </button>
                      </div>

                      <form onSubmit={handleJoinSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <label htmlFor="paste-link-input" style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>
                          Paste invite link or scan QR code
                        </label>
                        <input
                          id="paste-link-input"
                          type="text"
                          value={pastedLink}
                          onChange={handlePastedLinkChange}
                          placeholder="https://quickdrop.app/room/abc...#token=xyz..."
                          autoFocus
                          className="screen-join-input"
                        />

                        {joinHint && (
                          <div className="screen-join-hint">
                            {joinHint}
                          </div>
                        )}

                        {joinError && (
                          <div className="screen-join-error">
                            {joinError}
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                          <button
                            type="submit"
                            disabled={isConnecting || !pastedLink.trim()}
                            className="btn-screen-submit"
                          >
                            <span>{isConnecting ? 'Connecting...' : 'Join room'}</span>
                            <ArrowRight size={16} strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowJoinFlow(false)}
                            className="btn-screen-cancel"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </div>

                {/* Trust Highlights */}
                <div className="hero-trust-row">
                  <span className="trust-item"><CheckCircle2 size={14} strokeWidth={2} /> Direct peer-to-peer</span>
                  <span className="trust-item"><CheckCircle2 size={14} strokeWidth={2} /> Zero disk storage</span>
                  <span className="trust-item"><CheckCircle2 size={14} strokeWidth={2} /> Auto-expiring</span>
                </div>
              </div>

              {/* Right Column: 3D Mascot Character */}
              <div className="display-hero-right">
                <HeroMascot theme={heroTheme} />

                {/* Interactive Carousel Switcher Dots */}
                <div className="hero-carousel-bar">
                  <div className="hero-carousel-dots" role="tablist" aria-label="Choose hero theme">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={heroTheme === 'solar'}
                      aria-label="Solar Rocket theme"
                      className={`hero-dot ${heroTheme === 'solar' ? 'active' : ''}`}
                      onClick={() => handleSetHeroTheme('solar')}
                    />
                    <button
                      type="button"
                      role="tab"
                      aria-selected={heroTheme === 'cosmic'}
                      aria-label="Cosmic Yeti theme"
                      className={`hero-dot ${heroTheme === 'cosmic' ? 'active' : ''}`}
                      onClick={() => handleSetHeroTheme('cosmic')}
                    />
                  </div>

                  {/* Switch Theme Button */}
                  <button
                    type="button"
                    className="hero-next-theme-btn"
                    onClick={() => handleSetHeroTheme(heroTheme === 'solar' ? 'cosmic' : 'solar')}
                  >
                    <span>{heroTheme === 'solar' ? 'Cosmic Yeti' : 'Solar Rocket'}</span>
                    <ArrowRight size={13} strokeWidth={2} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          2. How It Works (3 Numbered Steps)
          ==================================================================== */}
      <section id="how-it-works" className="section">
        <div className="section-header">
          <h2 className="section-title">How it works</h2>
          <p className="section-subtitle">
            Three simple steps to move files between devices without installing software or registering accounts.
          </p>
        </div>

        <div className="steps-container">
          <div className="step-item">
            <span className="step-number">01</span>
            <div className="step-icon-wrap">
              <Share2 size={20} strokeWidth={1.75} />
            </div>
            <h3 className="step-item-title">Start a room</h3>
            <p className="step-item-desc">
              Click Start sharing to create an ephemeral room. QuickDrop gives you a private link and a single-use QR code.
            </p>
          </div>

          <div className="step-item">
            <span className="step-number">02</span>
            <div className="step-icon-wrap">
              <Smartphone size={20} strokeWidth={1.75} />
            </div>
            <h3 className="step-item-title">Scan QR or open the link</h3>
            <p className="step-item-desc">
              Scan the QR code with your phone camera or open the link on your second computer. Both devices connect in seconds.
            </p>
          </div>

          <div className="step-item">
            <span className="step-number">03</span>
            <div className="step-icon-wrap">
              <ArrowRight size={20} strokeWidth={1.75} />
            </div>
            <h3 className="step-item-title">Drop files</h3>
            <p className="step-item-desc">
              Drag and drop any files or text. Data streams straight across devices, verified chunk by chunk.
            </p>
          </div>
        </div>
      </section>

      {/* ====================================================================
          3. Bento Grid of 6 Features
          ==================================================================== */}
      <section id="features" className="section" style={{ paddingTop: 0 }}>
        <div className="section-header">
          <h2 className="section-title">Engineered for speed and discretion</h2>
          <p className="section-subtitle">
            Built from scratch to deliver friction-free transfers with honest privacy guarantees.
          </p>
        </div>

        <div className="bento-grid">
          <div className="bento-tile">
            <Share2 className="bento-icon" />
            <h3 className="bento-title">Direct when possible</h3>
            <p className="bento-desc">
              Transfers stream directly device-to-device over your local Wi-Fi or high-speed peer channels whenever possible.
            </p>
          </div>

          <div className="bento-tile">
            <RefreshCw className="bento-icon" />
            <h3 className="bento-title">Automatic relay fallback</h3>
            <p className="bento-desc">
              If strict firewalls or mobile NAT block direct links, transfers switch smoothly to a secure temporary relay.
            </p>
          </div>

          <div className="bento-tile">
            <ShieldCheck className="bento-icon" />
            <h3 className="bento-title">No account</h3>
            <p className="bento-desc">
              No registration, no email verification, and no tracking. You are connected instantly and completely anonymously.
            </p>
          </div>

          <div className="bento-tile">
            <Clock className="bento-icon" />
            <h3 className="bento-title">Rooms expire automatically</h3>
            <p className="bento-desc">
              Rooms self-destruct once either device disconnects or after 10 minutes of inactivity. No trace remains.
            </p>
          </div>

          <div className="bento-tile">
            <Globe className="bento-icon" />
            <h3 className="bento-title">Works in any browser</h3>
            <p className="bento-desc">
              Built on standard web technologies. Works across iOS Safari, Android Chrome, macOS, Windows, and Linux.
            </p>
          </div>

          <div className="bento-tile">
            <Download className="bento-icon" />
            <h3 className="bento-title">Install as an app</h3>
            <p className="bento-desc">
              Add QuickDrop to your home screen or dock as a progressive web app for instant one-tap access.
            </p>
          </div>
        </div>
      </section>

      {/* ====================================================================
          4. Plain Privacy Architecture Section
          ==================================================================== */}
      <section id="privacy" className="section" style={{ paddingTop: 0 }}>
        <div className="privacy-card">
          <div className="privacy-content">
            <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Privacy Architecture
            </span>
            <h2 className="section-title" style={{ fontSize: 'var(--font-size-2xl)' }}>
              Files are never stored on our servers.
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)', lineHeight: 1.6 }}>
              QuickDrop is designed around zero persistence. We do not maintain a file database, cloud storage bucket, or user account directory.
            </p>
          </div>

          <div className="privacy-points">
            <div className="privacy-point">
              <CheckCircle2 className="privacy-point-icon" size={18} strokeWidth={1.75} />
              <div className="privacy-point-text">
                <strong>Direct connections:</strong> When network conditions permit, files travel straight between your devices without passing through our relay.
              </div>
            </div>

            <div className="privacy-point">
              <CheckCircle2 className="privacy-point-icon" size={18} strokeWidth={1.75} />
              <div className="privacy-point-text">
                <strong>Transient relay:</strong> When firewalls prevent a direct link, encrypted packets stream through memory and are immediately forwarded. Nothing is ever written to disk.
              </div>
            </div>

            <div className="privacy-point">
              <CheckCircle2 className="privacy-point-icon" size={18} strokeWidth={1.75} />
              <div className="privacy-point-text">
                <strong>Ephemeral rooms:</strong> Room links evaporate once a transfer concludes or after 10 minutes. There is no historical trail.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================================================================
          5. Frequently Asked Questions (<details>/<summary>)
          ==================================================================== */}
      <section id="faq" className="section" style={{ paddingTop: 0 }}>
        <div className="section-header">
          <h2 className="section-title">Frequently asked questions</h2>
          <p className="section-subtitle">
            Common questions regarding transfers, network behavior, and security.
          </p>
        </div>

        <div className="faq-list">
          <details className="faq-item">
            <summary className="faq-summary">Are my files stored on your servers?</summary>
            <div className="faq-answer">
              No. When devices can connect directly, files transfer peer-to-peer. When a direct link is blocked by strict NAT or firewalls, the transfer uses an ephemeral in-memory server relay. In neither case is any file data saved to a hard drive or database.
            </div>
          </details>

          <details className="faq-item">
            <summary className="faq-summary">Is there a file size limit?</summary>
            <div className="faq-answer">
              There is no artificial file size limit imposed by QuickDrop. You can send gigabytes of photos, videos, or archives as long as both browser tabs remain open until the transfer finishes.
            </div>
          </details>

          <details className="faq-item">
            <summary className="faq-summary">Do both devices need to be on the same Wi-Fi?</summary>
            <div className="faq-answer">
              No. QuickDrop functions across different Wi-Fi networks, mobile cellular data (5G/LTE), and hotspots. If local direct connection is unavailable, QuickDrop automatically falls back to the relay.
            </div>
          </details>

          <details className="faq-item">
            <summary className="faq-summary">Why is an invite link needed instead of just a 4-digit code?</summary>
            <div className="faq-answer">
              QuickDrop uses high-entropy 32-character room codes and 48-character cryptographic invitation tokens. This guarantees that strangers cannot guess your room code or intercept your transfer.
            </div>
          </details>
        </div>
      </section>
    </div>
  );
}

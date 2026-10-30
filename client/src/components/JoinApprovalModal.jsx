import React, { useState, useEffect, useRef } from 'react';
import { Smartphone, Laptop, Clock, Check, X, ShieldAlert } from 'lucide-react';
import { hapticTap } from '../utils/soundEffects.js';

/**
 * Host approval modal displayed when a guest attempts to join the room.
 * Displays device name, self-reported disclaimer, sanitized browser/OS,
 * live 60-second countdown (auto-deny), auto-approve checkbox for the session,
 * and Allow / Deny actions with keyboard shortcuts (Enter to allow, Esc to deny).
 */
export function JoinApprovalModal({
  request, // { requestId, deviceName, userAgent }
  onApprove, // (requestId, autoApprove) => void
  onDeny // (requestId) => void
}) {
  const [autoApprove, setAutoApprove] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(60);
  const allowButtonRef = useRef(null);

  useEffect(() => {
    // Focus Allow button on mount
    allowButtonRef.current?.focus();

    // 60-second live auto-deny countdown
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onDeny(request.requestId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        hapticTap();
        onDeny(request.requestId);
      } else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        hapticTap();
        onApprove(request.requestId, autoApprove);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearInterval(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [request.requestId, autoApprove, onApprove, onDeny]);

  const handleAllow = () => {
    hapticTap();
    onApprove(request.requestId, autoApprove);
  };

  const handleDeny = () => {
    hapticTap();
    onDeny(request.requestId);
  };

  const isMobile = /android|iphone|ipad|mobile/i.test(request.userAgent || '');

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-title"
      aria-describedby="approval-desc"
    >
      <div className="modal-card approval-modal-card">
        <div className="approval-modal-icon-row">
          <div className="approval-device-icon" aria-hidden="true">
            {isMobile ? <Smartphone size={24} strokeWidth={1.75} /> : <Laptop size={24} strokeWidth={1.75} />}
          </div>
          <div
            className="approval-timer-badge"
            title="Auto-denies when timer reaches zero"
            aria-live="polite"
          >
            <Clock size={12} strokeWidth={1.75} />
            <span>{secondsRemaining}s</span>
          </div>
        </div>

        <h3 id="approval-title" className="approval-modal-title">
          {request.deviceName || 'A device'} wants to join
        </h3>

        <div id="approval-desc" className="approval-device-meta">
          <span className="approval-user-agent">{request.userAgent || 'Web browser'}</span>
          <div className="approval-disclaimer">
            <ShieldAlert size={13} strokeWidth={1.75} className="disclaimer-icon" />
            <span>Note: Device names are self-reported. Only allow devices you recognize.</span>
          </div>
        </div>

        <label className="approval-auto-approve-row">
          <input
            type="checkbox"
            checked={autoApprove}
            onChange={(e) => setAutoApprove(e.target.checked)}
            className="approval-checkbox"
          />
          <span className="approval-auto-approve-label">
            Auto-approve for this session
          </span>
        </label>

        <div className="approval-actions-row">
          <button
            type="button"
            onClick={handleDeny}
            className="btn btn-secondary btn-deny-action"
            aria-label="Deny join request (Esc)"
          >
            <X size={15} strokeWidth={2} />
            <span>Deny</span>
          </button>
          <button
            ref={allowButtonRef}
            type="button"
            onClick={handleAllow}
            className="btn btn-primary btn-allow-action"
            aria-label="Allow device to join (Enter)"
          >
            <Check size={15} strokeWidth={2} />
            <span>Allow</span>
          </button>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useRef, useEffect } from 'react';
import { Lock, ArrowRight, AlertCircle, KeyRound } from 'lucide-react';
import { hapticTap } from '../utils/soundEffects.js';

/**
 * PIN Prompt modal displayed to joiner when a room requires access PIN.
 * 4-digit input with numeric keypad on mobile, auto-submits on 4 digits,
 * shows attempts remaining and clear security messaging (access control only).
 */
export function PinPromptModal({
  onSubmitPin,
  onCancel,
  errorMessage,
  attemptsRemaining
}) {
  const [pin, setPin] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (pin.trim().length !== 4) return;
    hapticTap();
    onSubmitPin(pin.trim());
  };

  const handleChange = (e) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 4);
    setPin(val);
    if (val.length === 4) {
      hapticTap();
      onSubmitPin(val);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-modal-title"
      aria-describedby="pin-modal-desc"
    >
      <div className="modal-card pin-modal-card">
        <div className="pin-modal-icon-tile" aria-hidden="true">
          <KeyRound size={28} strokeWidth={1.75} />
        </div>

        <h3 id="pin-modal-title" className="pin-modal-title">
          Enter Room PIN
        </h3>

        <p id="pin-modal-desc" className="pin-modal-subtext">
          The host has protected this room with a 4-digit access PIN. Ask the host for the code.
        </p>

        {errorMessage && (
          <div className="pin-error-banner" role="alert" aria-live="assertive">
            <AlertCircle size={15} strokeWidth={2} />
            <span>
              {errorMessage}
              {typeof attemptsRemaining === 'number' && attemptsRemaining > 0 && (
                <> ({attemptsRemaining} attempt{attemptsRemaining === 1 ? '' : 's'} remaining)</>
              )}
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="pin-form">
          <div className="pin-input-wrap">
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={pin}
              onChange={handleChange}
              placeholder="••••"
              className="input input-mono pin-digit-input"
              aria-label="4-digit access PIN"
              autoComplete="one-time-code"
            />
          </div>

          <div className="pin-modal-actions">
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pin.trim().length !== 4}
              className="btn btn-primary"
            >
              <span>Verify PIN</span>
              <ArrowRight size={15} strokeWidth={2} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

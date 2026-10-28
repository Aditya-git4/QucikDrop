import React, { useState, useRef, useEffect } from 'react';
import { CopyButton } from './CopyButton.jsx';
import { validateMessageText } from '../utils/validateInput.js';
import { hapticTap } from '../utils/soundEffects.js';

/**
 * Modern iOS glassmorphic text sharing interface with iMessage-style bubbles,
 * tactile spring feedback, and ephemeral self-destructing notes.
 * @param {{
 *   messages: Array<{
 *     id: string,
 *     text: string,
 *     senderPeerId: string,
 *     deviceName: string,
 *     sentAt: number,
 *     isMine: boolean
 *   }>,
 *   onSendMessage: (text: string) => void,
 *   disabled?: boolean
 * }} props
 */
export function TextTransfer({ messages, onSendMessage, disabled = false }) {
  const [inputText, setInputText] = useState('');
  const [destructSec, setDestructSec] = useState(0); // 0 = off, 30 = 30s, 60 = 60s
  const [evaporatedIds, setEvaporatedIds] = useState(new Set());
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const maxLength = 4096;

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Periodic check for self-destructing messages
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      messages.forEach((msg) => {
        if (msg.text.startsWith('__EPHEMERAL_')) {
          const match = msg.text.match(/^__EPHEMERAL_(\d+)__(.*)$/s);
          if (match) {
            const ttlMs = parseInt(match[1], 10) * 1000;
            if (now - msg.sentAt >= ttlMs) {
              setEvaporatedIds((prev) => new Set(prev).add(msg.id));
            }
          }
        }
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [messages]);

  const handleSend = () => {
    const { valid } = validateMessageText(inputText, maxLength);
    if (!valid || disabled) return;

    hapticTap();
    let finalPayload = inputText.trim();
    if (destructSec > 0) {
      finalPayload = `__EPHEMERAL_${destructSec}__${finalPayload}`;
    }

    onSendMessage(finalPayload);
    setInputText('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const remainingChars = maxLength - inputText.length;
  const isOverLimit = remainingChars < 0;

  const visibleMessages = messages.filter((m) => !evaporatedIds.has(m.id));

  return (
    <div
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '460px',
        padding: '0',
        overflow: 'hidden',
        background: 'rgba(24, 36, 23, 0.65)',
        boxShadow: 'var(--glass-shadow)'
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--glass-border)',
          background: 'rgba(17, 26, 16, 0.75)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.1rem' }}>💬</span>
          <span style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--color-text-main)' }}>
            P2P Direct Messages
          </span>
          <span
            style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--color-lime-dim)',
              color: 'var(--color-lime)',
              border: '1px solid rgba(228, 253, 151, 0.25)'
            }}
          >
            {visibleMessages.length}
          </span>
        </div>

        {/* Self-Destructing Timer Selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
            ⏱ Auto-Delete:
          </span>
          <div style={{ display: 'flex', gap: '3px' }}>
            {[
              { val: 0, label: 'Off' },
              { val: 30, label: '30s' },
              { val: 60, label: '60s' }
            ].map((opt) => (
              <button
                key={opt.val}
                type="button"
                onClick={() => {
                  hapticTap();
                  setDestructSec(opt.val);
                }}
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  border: destructSec === opt.val ? '1px solid var(--color-lime)' : '1px solid var(--glass-border)',
                  background: destructSec === opt.val ? 'var(--color-lime)' : 'transparent',
                  color: destructSec === opt.val ? 'var(--color-lime-text)' : 'var(--color-text-subtle)',
                  cursor: 'pointer'
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div
        style={{
          flex: 1,
          padding: '18px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px'
        }}
      >
        {visibleMessages.length === 0 ? (
          <div
            style={{
              margin: 'auto',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: '0.9rem',
              maxWidth: '300px',
              padding: '20px'
            }}
          >
            <div style={{ fontSize: '2.5rem', marginBottom: '10px', filter: 'drop-shadow(0 0 12px rgba(228, 253, 151, 0.3))' }}>
              ⚡
            </div>
            <p style={{ fontWeight: 700, color: 'var(--color-text-main)', marginBottom: '4px' }}>
              Direct Chat Ready
            </p>
            <p style={{ fontSize: '0.82rem', lineHeight: 1.5 }}>
              Share links, text snippets, and notes. Optional auto-destruct timers for passwords and keys.
            </p>
          </div>
        ) : (
          visibleMessages.map((msg) => {
            let displayText = msg.text;
            let isEphemeral = false;
            let secondsRemaining = null;

            if (msg.text.startsWith('__EPHEMERAL_')) {
              const match = msg.text.match(/^__EPHEMERAL_(\d+)__(.*)$/s);
              if (match) {
                isEphemeral = true;
                const ttlSec = parseInt(match[1], 10);
                displayText = match[2];
                const elapsedSec = Math.floor((Date.now() - msg.sentAt) / 1000);
                secondsRemaining = Math.max(0, ttlSec - elapsedSec);
              }
            }

            return (
              <div
                key={msg.id}
                className="animate-entrance"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.isMine ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  alignSelf: msg.isMine ? 'flex-end' : 'flex-start'
                }}
              >
                <div
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    color: 'var(--color-text-subtle)',
                    marginBottom: '4px',
                    padding: '0 6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>{msg.isMine ? 'You' : msg.deviceName} • {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {isEphemeral && (
                    <span style={{ color: 'var(--color-warning)', fontWeight: 700 }}>
                      ⏱ {secondsRemaining}s remaining
                    </span>
                  )}
                </div>

                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: msg.isMine ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                    backgroundColor: msg.isMine ? 'var(--color-lime)' : 'rgba(45, 62, 44, 0.65)',
                    color: msg.isMine ? 'var(--color-lime-text)' : 'var(--color-text-main)',
                    border: isEphemeral
                      ? '1px solid var(--color-warning)'
                      : msg.isMine
                      ? '1px solid rgba(228, 253, 151, 0.6)'
                      : '1px solid var(--glass-border)',
                    boxShadow: msg.isMine
                      ? '0 6px 18px -2px rgba(228, 253, 151, 0.35)'
                      : 'var(--glass-shadow-sm)',
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                    position: 'relative',
                    fontSize: '0.94rem',
                    lineHeight: 1.5,
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)'
                  }}
                >
                  {displayText}
                  <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                    <CopyButton
                      text={displayText}
                      label="Copy"
                      successLabel="Copied!"
                      className={msg.isMine ? 'btn-primary' : 'btn-secondary'}
                    />
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Composer */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--glass-border)',
          background: 'rgba(15, 22, 14, 0.85)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled
                ? 'Waiting for peer to connect...'
                : destructSec > 0
                ? `Type self-destructing message (${destructSec}s)...`
                : 'Send message, link, or note...'
            }
            disabled={disabled}
            className="text-input"
            style={{
              resize: 'none',
              minHeight: '44px',
              maxHeight: '120px',
              padding: '10px 14px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(25, 38, 24, 0.6)'
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || !inputText.trim() || isOverLimit}
            className="btn btn-primary"
            style={{ minWidth: '76px', height: '44px', borderRadius: 'var(--radius-full)', padding: '0 18px' }}
          >
            Send
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--color-text-subtle)', padding: '0 4px' }}>
          <span>Enter to send • Shift+Enter for newline</span>
          <span style={{ color: isOverLimit ? 'var(--color-danger)' : 'inherit' }}>
            {inputText.length} / {maxLength}
          </span>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useRef, useEffect } from 'react';
import { CopyButton } from './CopyButton.jsx';
import { validateMessageText } from '../utils/validateInput.js';

/**
 * Modern iOS glassmorphic text sharing interface with iMessage-style bubbles and spring animations.
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
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const maxLength = 4096;

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const { valid } = validateMessageText(inputText, maxLength);
    if (!valid || disabled) return;

    onSendMessage(inputText.trim());
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
          alignItems: 'center'
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
            {messages.length}
          </span>
        </div>

        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span>🔒</span> End-to-End P2P
        </span>
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
        {messages.length === 0 ? (
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
              Share links, text snippets, and notes instantly across devices. Zero server logs.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
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
                  padding: '0 6px'
                }}
              >
                {msg.isMine ? 'You' : msg.deviceName} •{' '}
                {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>

              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: msg.isMine ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                  backgroundColor: msg.isMine ? 'var(--color-lime)' : 'rgba(45, 62, 44, 0.65)',
                  color: msg.isMine ? 'var(--color-lime-text)' : 'var(--color-text-main)',
                  border: msg.isMine ? '1px solid rgba(228, 253, 151, 0.6)' : '1px solid var(--glass-border)',
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
                {msg.text}
                <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                  <CopyButton
                    text={msg.text}
                    label="Copy"
                    successLabel="Copied!"
                    className={msg.isMine ? 'btn-primary' : 'btn-secondary'}
                  />
                </div>
              </div>
            </div>
          ))
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
            placeholder={disabled ? 'Waiting for peer to connect...' : 'Send message or link...'}
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

import React, { useState, useRef, useEffect } from 'react';
import { CopyButton } from './CopyButton.jsx';
import { validateMessageText } from '../utils/validateInput.js';

/**
 * Bidirectional text sharing interface for active rooms.
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
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '420px',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        backgroundColor: 'var(--color-surface)'
      }}
    >
      {/* Messages Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-bg)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-main)' }}>
          Session Messages ({messages.length})
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          🔒 Stored only in current browser tab
        </span>
      </div>

      {/* Messages Scroll Area */}
      <div
        style={{
          flex: 1,
          padding: '16px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        {messages.length === 0 ? (
          <div
            style={{
              margin: 'auto',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: '0.9rem',
              maxWidth: '300px'
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>💬</div>
            <p><strong>Ready to exchange text</strong></p>
            <p style={{ fontSize: '0.8rem', marginTop: '4px' }}>
              Type a message, note, link, or code snippet below to share it instantly with the connected device.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
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
                  fontSize: '0.75rem',
                  color: 'var(--color-text-muted)',
                  marginBottom: '2px',
                  padding: '0 4px'
                }}
              >
                {msg.isMine ? 'You' : msg.deviceName} •{' '}
                {new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>

              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: msg.isMine ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                  backgroundColor: msg.isMine ? 'var(--color-primary)' : 'var(--color-surface-hover)',
                  color: msg.isMine ? 'var(--color-primary-text)' : 'var(--color-text-main)',
                  border: msg.isMine ? 'none' : '1px solid var(--color-border)',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                  position: 'relative',
                  fontSize: '0.95rem'
                }}
              >
                {msg.text}
                <div style={{ marginTop: '6px', display: 'flex', justifyContent: 'flex-end' }}>
                  <CopyButton
                    text={msg.text}
                    label="Copy text"
                    successLabel="Copied!"
                    className="btn-secondary"
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
          borderTop: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-bg)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'Waiting for peer to connect...' : 'Type text to send... (Enter to send)'}
            disabled={disabled}
            className="text-input"
            style={{
              resize: 'none',
              minHeight: '44px',
              maxHeight: '100px',
              padding: '8px 12px'
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled || !inputText.trim() || isOverLimit}
            className="btn btn-primary"
            style={{ minWidth: '80px', height: '44px' }}
          >
            Send
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          <span>Press Enter to send, Shift+Enter for newline</span>
          <span style={{ color: isOverLimit ? 'var(--color-danger)' : 'inherit' }}>
            {inputText.length} / {maxLength}
          </span>
        </div>
      </div>
    </div>
  );
}

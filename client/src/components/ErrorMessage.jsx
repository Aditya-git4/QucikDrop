import React from 'react';

/**
 * Modern iOS glassmorphic error banner.
 * @param {{ message: string | null, code?: string | null, onDismiss?: () => void }} props
 */
export function ErrorMessage({ message, code, onDismiss }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="animate-entrance"
      style={{
        padding: '14px 18px',
        backgroundColor: 'rgba(248, 113, 113, 0.16)',
        border: '1px solid rgba(248, 113, 113, 0.45)',
        borderRadius: 'var(--radius-md)',
        color: '#fca5a5',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '12px',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)'
      }}
    >
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
        <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>⚠️</span>
        <div>
          {code && (
            <div style={{ fontSize: '0.74rem', fontWeight: 800, textTransform: 'uppercase', opacity: 0.9, letterSpacing: '0.04em' }}>
              Error: {code}
            </div>
          )}
          <div style={{ fontSize: '0.9rem', marginTop: code ? '2px' : 0, color: '#fee2e2', fontWeight: 500 }}>
            {message}
          </div>
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            padding: '4px',
            fontSize: '1rem',
            lineHeight: 1,
            opacity: 0.8
          }}
          aria-label="Dismiss error"
        >
          ✕
        </button>
      )}
    </div>
  );
}

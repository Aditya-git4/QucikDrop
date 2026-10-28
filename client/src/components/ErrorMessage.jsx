import React from 'react';

/**
 * Accessible error message display component.
 * @param {{ message: string | null, code?: string | null, onDismiss?: () => void }} props
 */
export function ErrorMessage({ message, code, onDismiss }) {
  if (!message) return null;

  return (
    <div
      role="alert"
      style={{
        padding: '14px 16px',
        backgroundColor: 'var(--color-danger-bg)',
        border: '1px solid var(--color-danger-border)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-danger)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '12px',
        marginBottom: '16px'
      }}
    >
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
        <span style={{ fontSize: '1.2rem', lineHeight: 1 }}>⚠️</span>
        <div>
          {code && (
            <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', opacity: 0.85 }}>
              Error: {code}
            </div>
          )}
          <div style={{ fontSize: '0.9rem', marginTop: code ? '2px' : 0 }}>{message}</div>
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
            lineHeight: 1
          }}
          aria-label="Dismiss error"
        >
          ✕
        </button>
      )}
    </div>
  );
}

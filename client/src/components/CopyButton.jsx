import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

/**
 * CopyButton provides a one-click copy with native Clipboard API and fallback.
 * Uses consistent Lucide icons with no emojis.
 * @param {{ text: string, label?: string, successLabel?: string, className?: string }} props
 */
export function CopyButton({ text, label = 'Copy', successLabel = 'Copied!', className = '' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!text) return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts (e.g. HTTP on local network testing)
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`btn btn-secondary ${className}`}
      aria-label={copied ? successLabel : label}
      title={label}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
    >
      {copied ? (
        <Check size={14} strokeWidth={2} style={{ color: 'var(--color-status-direct)' }} />
      ) : (
        <Copy size={14} strokeWidth={1.75} />
      )}
      <span>{copied ? successLabel : label}</span>
    </button>
  );
}

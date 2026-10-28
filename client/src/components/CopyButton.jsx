import React, { useState } from 'react';

/**
 * CopyButton provides a one-click copy with native Clipboard API and legacy fallback.
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
    >
      <span>{copied ? '✓' : '📋'}</span>
      <span>{copied ? successLabel : label}</span>
    </button>
  );
}

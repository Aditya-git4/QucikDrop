import React, { useState, useRef } from 'react';

/**
 * Drag-and-drop file selection area with accessible button trigger.
 * @param {{
 *   onFilesSelected: (files: FileList) => void,
 *   disabled?: boolean
 * }} props
 */
export function FileDropZone({ onFilesSelected, disabled = false }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    if (disabled) return;
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesSelected(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      onFilesSelected(e.target.files);
      e.target.value = ''; // Reset input so same file can be selected again if needed
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => {
        if (!disabled) fileInputRef.current?.click();
      }}
      style={{
        border: `2px dashed ${
          isDragOver ? 'var(--color-primary)' : 'var(--color-border)'
        }`,
        borderRadius: 'var(--radius-lg)',
        padding: '24px 16px',
        textAlign: 'center',
        backgroundColor: isDragOver
          ? 'var(--color-primary-light)'
          : 'var(--color-surface)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s ease',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
        opacity: disabled ? 0.6 : 1
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault();
          fileInputRef.current?.click();
        }
      }}
      aria-label="File drop zone. Click or drag files to transfer"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
        disabled={disabled}
      />

      <div style={{ fontSize: '2rem', lineHeight: 1 }}>📁</div>
      <div>
        <p style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text-main)' }}>
          {disabled
            ? 'Connect via WebRTC to share files'
            : isDragOver
            ? 'Drop files here to send'
            : 'Click to select or drag files here'}
        </p>
        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '2px' }}>
          Supports multiple files • Direct P2P transfer with zero server storage
        </p>
      </div>
    </div>
  );
}

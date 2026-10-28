import React, { useState, useRef } from 'react';
import { extractFilesFromDataTransfer } from '../utils/fileUtils.js';
import { hapticTap } from '../utils/soundEffects.js';

/**
 * Modern iOS glassmorphic drag-and-drop file selection zone with tactile feedback.
 * Supports individual files and recursive directory / folder drops.
 * @param {{
 *   onFilesSelected: (files: FileList | File[]) => void,
 *   disabled?: boolean
 * }} props
 */
export function FileDropZone({ onFilesSelected, disabled = false }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    if (disabled) return;
    setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;

    hapticTap();
    const files = await extractFilesFromDataTransfer(e.dataTransfer);
    if (files.length > 0) {
      onFilesSelected(files);
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      hapticTap();
      onFilesSelected(e.target.files);
      e.target.value = ''; // Reset input so same file can be selected again
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
          isDragOver ? 'var(--color-lime)' : 'rgba(228, 253, 151, 0.25)'
        }`,
        borderRadius: 'var(--radius-lg)',
        padding: '32px 20px',
        textAlign: 'center',
        background: isDragOver
          ? 'rgba(228, 253, 151, 0.16)'
          : 'rgba(20, 30, 19, 0.55)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: isDragOver ? 'var(--glass-shadow-glow)' : 'var(--glass-shadow-sm)',
        transition: 'all 0.25s var(--spring-bounce)',
        transform: isDragOver ? 'scale(1.02)' : 'scale(1)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none',
        WebkitUserSelect: 'none'
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
      <input
        ref={folderInputRef}
        type="file"
        // @ts-ignore
        webkitdirectory="true"
        multiple
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
        disabled={disabled}
      />

      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: 'var(--radius-md)',
          background: isDragOver ? 'var(--color-lime)' : 'var(--color-lime-dim)',
          color: isDragOver ? 'var(--color-lime-text)' : 'var(--color-lime)',
          border: '1px solid rgba(228, 253, 151, 0.3)',
          boxShadow: isDragOver ? '0 0 24px rgba(228, 253, 151, 0.6)' : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.75rem',
          transition: 'all 0.2s var(--spring-snappy)'
        }}
      >
        {isDragOver ? '📥' : '📁'}
      </div>

      <div>
        <p style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text-main)', marginBottom: '4px' }}>
          {disabled
            ? 'Connect via WebRTC to share files'
            : isDragOver
            ? 'Release to Send Files & Folders'
            : 'Click to Select or Drop Files & Folders'}
        </p>
        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
          Direct peer-to-peer streaming • Drop whole folders or single files
        </p>
      </div>

      {!disabled && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap', justifyContent: 'center' }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="btn btn-primary"
            style={{
              padding: '6px 16px',
              fontSize: '0.82rem',
              minHeight: '34px'
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            Browse Files
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{
              padding: '6px 16px',
              fontSize: '0.82rem',
              minHeight: '34px'
            }}
            onClick={() => folderInputRef.current?.click()}
          >
            📁 Select Folder
          </button>
        </div>
      )}
    </div>
  );
}

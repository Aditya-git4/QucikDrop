import React, { useState, useRef } from 'react';
import { extractFilesFromDataTransfer } from '../utils/fileUtils.js';
import { hapticTap } from '../utils/soundEffects.js';

/**
 * Modern VisionOS / iOS glassmorphic drag-and-drop file selection zone.
 * Supports single files, multi-file drops, recursive folders, and mobile camera quick-shoot.
 * @param {{
 *   onFilesSelected: (files: FileList | File[]) => void,
 *   onPasteClipboard?: (() => void) | null,
 *   disabled?: boolean
 * }} props
 */
export function FileDropZone({
  onFilesSelected,
  onPasteClipboard = null,
  isP2PConnected = false,
  isConnected = false,
  disabled = false
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const cameraInputRef = useRef(null);

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
          isDragOver ? 'var(--color-lime)' : 'rgba(228, 253, 151, 0.24)'
        }`,
        borderRadius: 'var(--radius-lg)',
        padding: '24px 18px',
        textAlign: 'center',
        background: isDragOver
          ? 'rgba(228, 253, 151, 0.15)'
          : 'var(--glass-surface-2)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: isDragOver ? 'var(--glass-shadow-glow)' : 'var(--glass-shadow-sm)',
        transition: 'all 0.25s var(--spring-bounce)',
        transform: isDragOver ? 'scale(1.015)' : 'scale(1)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        opacity: disabled ? 0.6 : 1,
        userSelect: 'none',
        WebkitUserSelect: 'none',
        flex: '1 1 auto',
        minHeight: '200px'
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
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-ignore
        webkitdirectory="true"
        multiple
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
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
            ? 'Room Terminated'
            : isDragOver
            ? 'Release to Send Files & Folders'
            : 'Drop Files or Click to Browse / Snap'}
        </p>
        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: !isP2PConnected ? '6px' : '0' }}>
          Direct peer-to-peer streaming • Drop whole folders, photos, or documents
        </p>
        {!isP2PConnected && !disabled && (
          <span
            style={{
              fontSize: '0.74rem',
              fontWeight: 700,
              padding: '2px 10px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(228, 253, 151, 0.1)',
              color: 'var(--color-lime)',
              border: '1px solid rgba(228, 253, 151, 0.25)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px'
            }}
          >
            <span>⚡</span> {isConnected ? 'Ready — files beam instantly across devices' : 'Waiting for peer to connect...'}
          </span>
        )}
      </div>

      {/* Action Buttons: ALWAYS rendered and accessible */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginTop: '6px',
          flexWrap: 'wrap',
          justifyContent: 'center'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="btn btn-primary"
          style={{
            padding: '6px 14px',
            fontSize: '0.82rem',
            minHeight: '34px'
          }}
          disabled={disabled}
          onClick={() => {
            hapticTap();
            fileInputRef.current?.click();
          }}
        >
          Browse Files
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{
            padding: '6px 14px',
            fontSize: '0.82rem',
            minHeight: '34px'
          }}
          disabled={disabled}
          onClick={() => {
            hapticTap();
            folderInputRef.current?.click();
          }}
        >
          📁 Folder
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{
            padding: '6px 14px',
            fontSize: '0.82rem',
            minHeight: '34px'
          }}
          disabled={disabled}
          onClick={() => {
            hapticTap();
            cameraInputRef.current?.click();
          }}
          title="Snap a photo directly with your camera"
        >
          📷 Camera
        </button>
        {onPasteClipboard && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{
              padding: '6px 14px',
              fontSize: '0.82rem',
              minHeight: '34px',
              borderColor: 'rgba(228, 253, 151, 0.35)',
              color: 'var(--color-lime)'
            }}
            disabled={disabled}
            onClick={() => {
              hapticTap();
              onPasteClipboard();
            }}
            title="Paste image, files, or text from device clipboard"
          >
            📋 Paste
          </button>
        )}
      </div>
    </div>
  );
}

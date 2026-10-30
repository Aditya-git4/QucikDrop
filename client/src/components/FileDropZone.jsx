import React, { useState, useRef } from 'react';
import { extractFilesFromDataTransfer } from '../utils/fileUtils.js';
import { hapticTap } from '../utils/soundEffects.js';
import { UploadCloud, FolderUp, Camera, Clipboard, FileText } from 'lucide-react';

/**
 * Modern drag-and-drop file selection zone with support for multi-file, folders, and camera.
 * Zero emojis, clean styling.
 * @param {{
 *   onFilesSelected: (files: FileList | File[]) => void,
 *   onPasteClipboard?: (() => void) | null,
 *   isP2PConnected?: boolean,
 *   isConnected?: boolean,
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
      e.target.value = '';
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
      className={`file-drop-zone ${isDragOver ? 'is-drag-over' : ''}`}
      style={{
        border: `2px dashed ${
          isDragOver ? '#6366f1' : 'var(--border-medium)'
        }`,
        borderRadius: 'var(--radius-lg)',
        padding: '36px 20px',
        textAlign: 'center',
        background: isDragOver ? 'rgba(99, 102, 241, 0.08)' : 'var(--color-bg-surface-1)',
        boxShadow: isDragOver ? '0 0 24px rgba(99, 102, 241, 0.2)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all var(--duration-normal) var(--ease-apple)',
        transform: isDragOver ? 'scale(1.01)' : 'scale(1)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '14px',
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none',
        WebkitUserSelect: 'none',
        minHeight: '220px'
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
          background: isDragOver ? 'var(--accent-gradient)' : 'var(--color-bg-surface-2)',
          color: isDragOver ? '#ffffff' : '#6366f1',
          border: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all var(--duration-normal) ease'
        }}
      >
        <UploadCloud size={28} strokeWidth={1.75} />
      </div>

      <div>
        <p
          style={{
            fontWeight: 600,
            fontSize: 'var(--font-size-base)',
            color: 'var(--color-text-primary)',
            marginBottom: '4px'
          }}
        >
          {disabled
            ? 'Room Terminated'
            : isDragOver
            ? 'Release to send files'
            : 'Drop files here or click to browse'}
        </p>
        <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', margin: 0 }}>
          Files stream directly between devices • Never stored on a server
        </p>
      </div>

      {/* Action Buttons */}
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
            fontSize: 'var(--font-size-xs)',
            minHeight: '36px',
            height: '36px'
          }}
          disabled={disabled}
          onClick={() => {
            hapticTap();
            fileInputRef.current?.click();
          }}
        >
          <FileText size={14} strokeWidth={1.75} />
          <span>Browse Files</span>
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          style={{
            padding: '6px 14px',
            fontSize: 'var(--font-size-xs)',
            minHeight: '36px',
            height: '36px'
          }}
          disabled={disabled}
          onClick={() => {
            hapticTap();
            folderInputRef.current?.click();
          }}
        >
          <FolderUp size={14} strokeWidth={1.75} />
          <span>Folder</span>
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          style={{
            padding: '6px 14px',
            fontSize: 'var(--font-size-xs)',
            minHeight: '36px',
            height: '36px'
          }}
          disabled={disabled}
          onClick={() => {
            hapticTap();
            cameraInputRef.current?.click();
          }}
          title="Snap a photo directly with your camera"
        >
          <Camera size={14} strokeWidth={1.75} />
          <span>Camera</span>
        </button>

        {onPasteClipboard && (
          <button
            type="button"
            className="btn btn-secondary"
            style={{
              padding: '6px 14px',
              fontSize: 'var(--font-size-xs)',
              minHeight: '36px',
              height: '36px'
            }}
            disabled={disabled}
            onClick={() => {
              hapticTap();
              onPasteClipboard();
            }}
            title="Paste image, files, or text from device clipboard"
          >
            <Clipboard size={14} strokeWidth={1.75} />
            <span>Paste</span>
          </button>
        )}
      </div>
    </div>
  );
}

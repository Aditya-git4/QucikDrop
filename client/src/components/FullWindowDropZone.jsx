import React, { useState, useEffect } from 'react';
import { UploadCloud } from 'lucide-react';

/**
 * Full-window drag & drop overlay.
 * Replaces the bulky static drop zone. Dragging files anywhere over the window
 * activates a high-contrast dimmed backdrop with a dashed gradient border.
 */
export function FullWindowDropZone({ onFilesSelected, disabled = false }) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  useEffect(() => {
    if (disabled) return;

    let dragTargetCounter = 0;

    const handleDragEnter = (e) => {
      if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      dragTargetCounter++;
      if (dragTargetCounter === 1) {
        setIsDraggingOver(true);
      }
    };

    const handleDragLeave = (e) => {
      e.preventDefault();
      dragTargetCounter--;
      if (dragTargetCounter <= 0) {
        dragTargetCounter = 0;
        setIsDraggingOver(false);
      }
    };

    const handleDragOver = (e) => {
      if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };

    const handleDrop = (e) => {
      e.preventDefault();
      dragTargetCounter = 0;
      setIsDraggingOver(false);

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files);
        if (onFilesSelected) {
          onFilesSelected(files);
        }
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [onFilesSelected, disabled]);

  if (!isDraggingOver) return null;

  return (
    <div
      className="full-window-drop-overlay"
      aria-label="Drop files anywhere to send"
      role="region"
    >
      <div className="full-window-drop-box">
        <div className="drop-icon-pulse">
          <UploadCloud size={48} strokeWidth={1.75} />
        </div>
        <h2 className="drop-headline">Drop to send</h2>
        <p className="drop-subtext">Files will stream directly to the connected device</p>
      </div>
    </div>
  );
}

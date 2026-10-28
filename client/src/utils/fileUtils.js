/**
 * Sanitize a filename to prevent path traversal, control character injection, or filesystem issues.
 * Preserves the file extension and limits length to 100 characters.
 * @param {string} rawName
 * @returns {string}
 */
export function sanitizeFileName(rawName) {
  if (typeof rawName !== 'string' || !rawName.trim()) {
    return 'downloaded_file.bin';
  }

  // Remove directory separators and path traversal
  let clean = rawName
    .replace(/[/\\]/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim();

  if (!clean || clean === '.') {
    return 'downloaded_file.bin';
  }

  // Preserve extension while shortening long names
  if (clean.length > 100) {
    const extIndex = clean.lastIndexOf('.');
    if (extIndex > 0 && extIndex > clean.length - 15) {
      const ext = clean.slice(extIndex);
      const base = clean.slice(0, 100 - ext.length);
      clean = `${base}${ext}`;
    } else {
      clean = clean.slice(0, 100);
    }
  }

  return clean;
}

/**
 * Trigger an automatic or manual file download in the browser.
 * @param {Blob | string} fileOrUrl - Blob object or object URL
 * @param {string} fileName
 */
export function triggerDownload(fileOrUrl, fileName) {
  if (typeof window === 'undefined') return;

  const url = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
  const safeName = sanitizeFileName(fileName);

  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // If a Blob was passed, revoke the object URL after 1 minute
  if (typeof fileOrUrl !== 'string') {
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60000);
  }
}

/**
 * Check if a file is an image based on MIME type or extension.
 */
export function isImageMime(mimeType, fileName = '') {
  if (mimeType && mimeType.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|svg|bmp|ico)$/i.test(fileName);
}

/**
 * Check if a file is a video based on MIME type or extension.
 */
export function isVideoMime(mimeType, fileName = '') {
  if (mimeType && mimeType.startsWith('video/')) return true;
  return /\.(mp4|webm|ogg|mov)$/i.test(fileName);
}

/**
 * Check if a file is audio based on MIME type or extension.
 */
export function isAudioMime(mimeType, fileName = '') {
  if (mimeType && mimeType.startsWith('audio/')) return true;
  return /\.(mp3|wav|ogg|aac|m4a|flac)$/i.test(fileName);
}

/**
 * Recursively extract files from a WebKit directory entry or flat file list.
 * Supports dropping whole folders.
 * @param {DataTransfer} dataTransfer
 * @returns {Promise<File[]>}
 */
export async function extractFilesFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return [];

  const items = dataTransfer.items;
  if (!items || items.length === 0) {
    return Array.from(dataTransfer.files || []);
  }

  const filePromises = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item.webkitGetAsEntry === 'function') {
      const entry = item.webkitGetAsEntry();
      if (entry) {
        filePromises.push(traverseEntry(entry, ''));
        continue;
      }
    }

    const file = item.getAsFile?.();
    if (file) {
      filePromises.push(Promise.resolve([file]));
    }
  }

  const results = await Promise.all(filePromises);
  return results.flat();
}

/**
 * Helper to recursively traverse DirectoryEntry and FileEntry.
 */
async function traverseEntry(entry, currentPath) {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((file) => {
        // Tag with relative path if inside a dropped folder
        const relativePath = currentPath ? `${currentPath}/${file.name}` : file.name;
        Object.defineProperty(file, 'relativePath', {
          value: relativePath,
          writable: false
        });
        resolve([file]);
      }, () => resolve([]));
    });
  }

  if (entry.isDirectory) {
    const dirReader = entry.createReader();
    const dirPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    const entries = await readAllEntries(dirReader);
    const nested = await Promise.all(entries.map((child) => traverseEntry(child, dirPath)));
    return nested.flat();
  }

  return [];
}

/**
 * Read all entries in a directory reader (handles batching in Chrome).
 */
function readAllEntries(dirReader) {
  const allEntries = [];

  function readBatch(resolve) {
    dirReader.readEntries((entries) => {
      if (entries.length === 0) {
        resolve(allEntries);
      } else {
        allEntries.push(...entries);
        readBatch(resolve);
      }
    }, () => resolve(allEntries));
  }

  return new Promise((resolve) => readBatch(resolve));
}

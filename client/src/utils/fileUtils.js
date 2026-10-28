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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, formatSpeed } from '../../../client/src/utils/formatBytes.js';
import { sanitizeFileName } from '../../../client/src/utils/fileUtils.js';

describe('clientUtils', () => {
  describe('formatBytes', () => {
    it('formats bytes correctly across standard unit scales', () => {
      assert.equal(formatBytes(0), '0 B');
      assert.equal(formatBytes(500), '500 B');
      assert.equal(formatBytes(1024), '1 KB');
      assert.equal(formatBytes(1536), '1.5 KB');
      assert.equal(formatBytes(1048576), '1 MB');
      assert.equal(formatBytes(1073741824), '1 GB');
    });

    it('formats speeds correctly', () => {
      assert.equal(formatSpeed(0), '0 KB/s');
      assert.equal(formatSpeed(1048576), '1 MB/s');
    });
  });

  describe('sanitizeFileName', () => {
    it('strips directory traversal and path separators', () => {
      assert.equal(sanitizeFileName('../../../etc/passwd'), '._._._etc_passwd');
      assert.equal(sanitizeFileName('C:\\Windows\\System32\\file.txt'), 'C:_Windows_System32_file.txt');
      assert.equal(sanitizeFileName('folder/subfolder/document.pdf'), 'folder_subfolder_document.pdf');
    });

    it('strips control characters and falls back on empty name', () => {
      assert.equal(sanitizeFileName('test\x00file\x1F.txt'), 'testfile.txt');
      assert.equal(sanitizeFileName(''), 'downloaded_file.bin');
      assert.equal(sanitizeFileName('   '), 'downloaded_file.bin');
      assert.equal(sanitizeFileName(null), 'downloaded_file.bin');
    });

    it('preserves file extension while shortening overlong names', () => {
      const longName = 'a'.repeat(120) + '.pdf';
      const clean = sanitizeFileName(longName);
      assert.ok(clean.endsWith('.pdf'));
      assert.ok(clean.length <= 100);
    });
  });
});

/**
 * QuickDrop End-to-End Relay Encryption Module
 * Implements WebCrypto-based zero-knowledge encryption for the WebSocket relay fallback.
 * Uses WebCrypto API only. No external dependencies.
 */

// 1. Base64url encoding / decoding helpers
export function bytesToBase64Url(bytes) {
  const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < uint8.length; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function base64UrlToBytes(str) {
  if (typeof str !== 'string') {
    throw new Error('base64UrlToBytes requires a string input');
  }
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  else if (pad === 1) throw new Error('Illegal base64url string');

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generate a random 256-bit room key encoded as base64url.
 * @returns {string} 43-character base64url string
 */
export function generateRoomKey() {
  const bytes = new Uint8Array(32);
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error('WebCrypto getRandomValues is unavailable');
  }
  cryptoObj.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/**
 * Validate whether a string is a valid 256-bit (32-byte) base64url key.
 * @param {any} key
 * @returns {boolean}
 */
export function isValidRoomKey(key) {
  if (typeof key !== 'string' || !key) return false;
  try {
    const bytes = base64UrlToBytes(key);
    return bytes.length === 32;
  } catch {
    return false;
  }
}

/**
 * Check whether WebCrypto subtle operations are available in the current context.
 * Returns false on insecure contexts (HTTP non-localhost) where crypto.subtle is disabled.
 * @returns {boolean}
 */
export function isSecureCryptoAvailable() {
  if (typeof crypto === 'undefined' && typeof globalThis.crypto === 'undefined') {
    return false;
  }
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
  if (!cryptoObj || !cryptoObj.subtle) {
    return false;
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return false;
  }
  return true;
}

// 2. HKDF Key Schedule and In-Memory CryptoKey Cache
// WeakMap keyed by master CryptoKey to cache derived AES-GCM CryptoKeys
const derivedKeyCache = new WeakMap();
const masterKeyCache = new Map(); // rawKeyString -> CryptoKey

/**
 * Import raw room key as an HKDF master key.
 * @param {string | Uint8Array} rawKey
 * @returns {Promise<CryptoKey>}
 */
export async function getHkdfMasterKey(rawKey) {
  const keyStr = typeof rawKey === 'string' ? rawKey : bytesToBase64Url(rawKey);
  if (masterKeyCache.has(keyStr)) {
    return masterKeyCache.get(keyStr);
  }

  const cryptoObj = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
  const rawBytes = typeof rawKey === 'string' ? base64UrlToBytes(rawKey) : rawKey;
  if (rawBytes.length !== 32) {
    throw new Error(`Invalid room key length: expected 32 bytes, got ${rawBytes.length}`);
  }

  const hkdfKey = await cryptoObj.subtle.importKey(
    'raw',
    rawBytes,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );

  masterKeyCache.set(keyStr, hkdfKey);
  return hkdfKey;
}

/**
 * Derive per-purpose AES-256-GCM key from room key.
 * Info schedule: "quickdrop/v1/" + direction + "/" + purpose
 * @param {string | Uint8Array} rawKey
 * @param {'owner->joiner' | 'joiner->owner'} direction
 * @param {string} purpose e.g. transferId, 'text', 'meta'
 * @returns {Promise<CryptoKey>}
 */
export async function deriveAesGcmKey(rawKey, direction, purpose) {
  const masterKey = await getHkdfMasterKey(rawKey);

  let keyMap = derivedKeyCache.get(masterKey);
  if (!keyMap) {
    keyMap = new Map();
    derivedKeyCache.set(masterKey, keyMap);
  }

  const cacheKey = `${direction}:${purpose}`;
  if (keyMap.has(cacheKey)) {
    return keyMap.get(cacheKey);
  }

  const cryptoObj = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
  const infoString = `quickdrop/v1/${direction}/${purpose}`;
  const infoBytes = new TextEncoder().encode(infoString);

  const aesGcmKey = await cryptoObj.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: infoBytes
    },
    masterKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  keyMap.set(cacheKey, aesGcmKey);
  return aesGcmKey;
}

// 3. Text Message Encryption / Decryption over Relay
/**
 * Encrypt plaintext text message for WebSocket relay transport.
 * @param {string} text Plaintext message
 * @param {string} roomKey 256-bit room key
 * @param {boolean} isSenderOwner Whether sender is the room owner
 * @returns {Promise<string>} Base64url encoded envelope (12-byte IV + ciphertext + 16-byte tag)
 */
export async function encryptRelayText(text, roomKey, isSenderOwner) {
  if (!isSecureCryptoAvailable()) {
    throw new Error('End-to-end encrypted relay requires a secure context (HTTPS).');
  }
  if (!isValidRoomKey(roomKey)) {
    throw new Error('Secure relay unavailable, ask for the full invite link');
  }

  const direction = isSenderOwner ? 'owner->joiner' : 'joiner->owner';
  const aesKey = await deriveAesGcmKey(roomKey, direction, 'text');

  const cryptoObj = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
  const iv = new Uint8Array(12);
  cryptoObj.getRandomValues(iv);

  const plaintextBytes = new TextEncoder().encode(text);
  const ciphertextBuffer = await cryptoObj.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plaintextBytes
  );

  const envelope = new Uint8Array(12 + ciphertextBuffer.byteLength);
  envelope.set(iv, 0);
  envelope.set(new Uint8Array(ciphertextBuffer), 12);

  return bytesToBase64Url(envelope);
}

/**
 * Decrypt text message received over WebSocket relay.
 * @param {string} envelopeStr Base64url encoded envelope
 * @param {string} roomKey 256-bit room key
 * @param {boolean} isReceiverOwner Whether receiver is the room owner
 * @returns {Promise<string>} Plaintext message
 */
export async function decryptRelayText(envelopeStr, roomKey, isReceiverOwner) {
  if (!isSecureCryptoAvailable()) {
    throw new Error('End-to-end encrypted relay requires a secure context (HTTPS).');
  }
  if (!isValidRoomKey(roomKey)) {
    throw new Error('Secure relay unavailable, ask for the full invite link');
  }

  const envelopeBytes = base64UrlToBytes(envelopeStr);
  if (envelopeBytes.byteLength < 28) {
    // 12 bytes IV + at least 16 bytes auth tag
    throw new Error('Message corrupted or tampered with');
  }

  const iv = envelopeBytes.subarray(0, 12);
  const ciphertextWithTag = envelopeBytes.subarray(12);

  // The sender used the opposite direction
  const direction = isReceiverOwner ? 'joiner->owner' : 'owner->joiner';
  const aesKey = await deriveAesGcmKey(roomKey, direction, 'text');

  const cryptoObj = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
  try {
    const decryptedBuffer = await cryptoObj.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      ciphertextWithTag
    );
    return new TextDecoder().decode(decryptedBuffer);
  } catch (err) {
    throw new Error('Message corrupted or tampered with');
  }
}

// 4. File Metadata Encryption / Decryption over Relay (file:start & file:complete)
/**
 * Encrypt file metadata JSON for WebSocket relay transport.
 * @param {object} metadata
 * @param {string} roomKey
 * @param {boolean} isSenderOwner
 * @param {string} transferId
 * @returns {Promise<string>} Base64url envelope
 */
export async function encryptRelayMetadata(metadata, roomKey, isSenderOwner, transferId) {
  if (!isSecureCryptoAvailable()) {
    throw new Error('End-to-end encrypted relay requires a secure context (HTTPS).');
  }
  if (!isValidRoomKey(roomKey)) {
    throw new Error('Secure relay unavailable, ask for the full invite link');
  }

  const direction = isSenderOwner ? 'owner->joiner' : 'joiner->owner';
  const aesKey = await deriveAesGcmKey(roomKey, direction, transferId);

  const cryptoObj = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
  const iv = new Uint8Array(12);
  cryptoObj.getRandomValues(iv);

  const jsonStr = JSON.stringify({ ...metadata, enc: true });
  const plaintextBytes = new TextEncoder().encode(jsonStr);

  const ciphertextBuffer = await cryptoObj.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plaintextBytes
  );

  const envelope = new Uint8Array(12 + ciphertextBuffer.byteLength);
  envelope.set(iv, 0);
  envelope.set(new Uint8Array(ciphertextBuffer), 12);

  return bytesToBase64Url(envelope);
}

/**
 * Decrypt file metadata JSON received over WebSocket relay.
 * @param {string} envelopeStr
 * @param {string} roomKey
 * @param {boolean} isReceiverOwner
 * @param {string} transferId
 * @returns {Promise<object>}
 */
export async function decryptRelayMetadata(envelopeStr, roomKey, isReceiverOwner, transferId) {
  if (!isSecureCryptoAvailable()) {
    throw new Error('End-to-end encrypted relay requires a secure context (HTTPS).');
  }
  if (!isValidRoomKey(roomKey)) {
    throw new Error('Secure relay unavailable, ask for the full invite link');
  }

  const envelopeBytes = base64UrlToBytes(envelopeStr);
  if (envelopeBytes.byteLength < 28) {
    throw new Error('Transfer corrupted or tampered with');
  }

  const iv = envelopeBytes.subarray(0, 12);
  const ciphertextWithTag = envelopeBytes.subarray(12);

  const direction = isReceiverOwner ? 'joiner->owner' : 'owner->joiner';
  const aesKey = await deriveAesGcmKey(roomKey, direction, transferId);

  const cryptoObj = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
  try {
    const decryptedBuffer = await cryptoObj.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      ciphertextWithTag
    );
    const jsonStr = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(jsonStr);
  } catch (err) {
    throw new Error('Transfer corrupted or tampered with');
  }
}

// 5. Binary Chunk Encryption / Decryption over Relay
/**
 * Create a random 8-byte prefix for chunk nonces agreed in file:start.
 * @returns {Uint8Array}
 */
export function createTransferNoncePrefix() {
  const prefix = new Uint8Array(8);
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
  cryptoObj.getRandomValues(prefix);
  return prefix;
}

/**
 * Construct 12-byte Nonce from 8-byte prefix + 4-byte chunkIndex (big-endian).
 * @param {Uint8Array} noncePrefix 8-byte prefix
 * @param {number} chunkIndex 32-bit unsigned integer
 * @returns {Uint8Array} 12-byte Nonce
 */
export function buildChunkNonce(noncePrefix, chunkIndex) {
  const nonce = new Uint8Array(12);
  nonce.set(noncePrefix, 0);
  const view = new DataView(nonce.buffer, nonce.byteOffset + 8, 4);
  view.setUint32(0, chunkIndex, false); // big-endian
  return nonce;
}

/**
 * Encrypt a single binary chunk for WebSocket relay transport.
 * Header: 8 bytes (streamId uint32 BE + chunkIndex uint32 BE), used as AAD.
 * Nonce: 12 bytes (8-byte prefix + 4-byte chunkIndex BE).
 * Total framed size = 8 (header) + payload.length + 16 (GCM tag) = 16408 bytes for 16384B payload.
 *
 * @param {ArrayBuffer | Uint8Array} payload Plaintext chunk data
 * @param {number} streamId
 * @param {number} chunkIndex
 * @param {Uint8Array} noncePrefix
 * @param {string} roomKey
 * @param {boolean} isSenderOwner
 * @param {string} transferId
 * @returns {Promise<Uint8Array>} 8-byte header + ciphertext (including 16-byte tag)
 */
export async function encryptRelayChunk(payload, streamId, chunkIndex, noncePrefix, roomKey, isSenderOwner, transferId) {
  const direction = isSenderOwner ? 'owner->joiner' : 'joiner->owner';
  const aesKey = await deriveAesGcmKey(roomKey, direction, transferId);

  // 1. 8-byte header (streamId + chunkIndex)
  const header = new Uint8Array(8);
  const headerView = new DataView(header.buffer, header.byteOffset, 8);
  headerView.setUint32(0, streamId, false);
  headerView.setUint32(4, chunkIndex, false);

  // 2. 12-byte nonce (8-byte prefix + 4-byte chunkIndex)
  const nonce = buildChunkNonce(noncePrefix, chunkIndex);

  // 3. AES-GCM encryption with header as Additional Authenticated Data (AAD)
  const cryptoObj = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
  const rawPayload = payload instanceof Uint8Array ? payload : new Uint8Array(payload);

  const ciphertextBuffer = await cryptoObj.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
      additionalData: header
    },
    aesKey,
    rawPayload
  );

  // 4. Framed chunk: 8-byte header in plaintext + ciphertext (payload + 16B tag)
  const framed = new Uint8Array(8 + ciphertextBuffer.byteLength);
  framed.set(header, 0);
  framed.set(new Uint8Array(ciphertextBuffer), 8);

  return framed;
}

/**
 * Decrypt a single framed binary chunk received over WebSocket relay.
 * @param {ArrayBuffer | Uint8Array} framedBuffer 8-byte header + ciphertext
 * @param {Uint8Array} noncePrefix 8-byte prefix from file:start
 * @param {string} roomKey 256-bit room key
 * @param {boolean} isReceiverOwner Whether receiver is the room owner
 * @param {string} transferId
 * @returns {Promise<{ streamId: number, chunkIndex: number, payload: Uint8Array }>}
 */
export async function decryptRelayChunk(framedBuffer, noncePrefix, roomKey, isReceiverOwner, transferId) {
  const framed = framedBuffer instanceof Uint8Array
    ? framedBuffer
    : new Uint8Array(framedBuffer);

  if (framed.byteLength < 24) {
    // 8 bytes header + at least 16 bytes tag
    throw new Error('Transfer corrupted or tampered with');
  }

  const header = framed.subarray(0, 8);
  const headerView = new DataView(framed.buffer, framed.byteOffset, 8);
  const streamId = headerView.getUint32(0, false);
  const chunkIndex = headerView.getUint32(4, false);

  const nonce = buildChunkNonce(noncePrefix, chunkIndex);
  const ciphertextWithTag = framed.subarray(8);

  const direction = isReceiverOwner ? 'joiner->owner' : 'owner->joiner';
  const aesKey = await deriveAesGcmKey(roomKey, direction, transferId);

  const cryptoObj = typeof crypto !== 'undefined' ? crypto : globalThis.crypto;
  try {
    const decryptedBuffer = await cryptoObj.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        additionalData: header
      },
      aesKey,
      ciphertextWithTag
    );
    return {
      streamId,
      chunkIndex,
      payload: new Uint8Array(decryptedBuffer)
    };
  } catch (err) {
    throw new Error('Transfer corrupted or tampered with');
  }
}

/**
 * Batch encrypt multiple chunks concurrently to maximize WebCrypto hardware acceleration.
 * @param {Array<ArrayBuffer | Uint8Array>} chunkPayloads
 * @param {number} startChunkIndex
 * @param {number} streamId
 * @param {Uint8Array} noncePrefix
 * @param {string} roomKey
 * @param {boolean} isSenderOwner
 * @param {string} transferId
 * @returns {Promise<Uint8Array[]>}
 */
export async function batchEncryptChunks(chunkPayloads, startChunkIndex, streamId, noncePrefix, roomKey, isSenderOwner, transferId) {
  return Promise.all(
    chunkPayloads.map((payload, i) =>
      encryptRelayChunk(
        payload,
        streamId,
        startChunkIndex + i,
        noncePrefix,
        roomKey,
        isSenderOwner,
        transferId
      )
    )
  );
}

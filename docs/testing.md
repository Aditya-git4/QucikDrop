# QuickDrop Testing Guide

QuickDrop uses automated unit and integration tests powered by Node.js built-in `node:test` runner and assertions, as well as clear manual verification procedures for cross-device testing.

---

## 1. Automated Test Suite

Run the full automated test suite with:

```bash
npm test
```

### Coverage Overview:
- **Unit: `tokenUtils.test.js`**:
  - Validates cryptographically random 32-char hex room IDs and 48-char hex join tokens.
  - Verifies deterministic SHA-256 hashing.
  - Tests constant-time `timingSafeEqual` comparison against valid, mismatched, and empty tokens.
  - Verifies device name sanitization (length limits, control character stripping).
- **Unit: `originValidation.test.js`**:
  - Verifies exact origin matching in production.
  - Verifies blocking of untrusted domains.
  - Verifies permitting private LAN IPs in development.
- **Unit: `rateLimiter.test.js`**:
  - Tests sliding-window request counting, quota enforcement, and per-key isolation.
- **Unit: `roomManager.test.js`**:
  - Verifies room creation, owner assignment, and expiration metadata.
  - Tests successful join with raw token.
  - Verifies token single-use enforcement (`TOKEN_USED`).
  - Verifies 2-device strict limit (`ROOM_FULL`).
  - Tests rejection of invalid tokens (`INVALID_TOKEN`).
  - Verifies room expiration after TTL (`ROOM_EXPIRED`).
  - Tests authorization on room closure (only owner can close).
  - Verifies socket disconnect handling and room cleanup.
- **Integration: `signalingServer.test.js`**:
  - End-to-end WebSocket connection over ephemeral HTTP server.
  - Full room creation, guest joining, and `peer:joined` notification.
  - Bidirectional text relay with server-stamped sender identities and acknowledgment.
  - Room closure notification broadcast.
  - Graceful rejection of malformed JSON without crashing.
  - Rejection of invalid protocol versions.
- **Integration: `healthAndStatic.test.js`**:
  - Verifies `/health` JSON status and uptime metrics.
  - Verifies static serving of frontend `index.html`.
  - Verifies SPA fallback routing on `/room/:roomId`.
  - Verifies serving of PWA `manifest.json` and `sw.js`.
- **Unit: `iceServers.test.js` (Milestone 6)**:
  - Verifies dynamic STUN & TURN parsing.
  - Verifies RFC 5766 Coturn HMAC-SHA1 ephemeral credential generation and secrecy.
  - Verifies static TURN credential formatting.
- **Unit: `connectionStats.test.js` (Milestone 6)**:
  - Verifies candidate pair classification for `relay`, `lan`, and reflexive `direct` connections.
- **Unit: `cryptoUtils.test.js` (Milestone 3)**:
  - Verifies pure JS incremental SHA-256 against NIST vectors and Node `crypto`.
- **Unit: `fileTransferProtocol.test.js` (Milestone 2 & 3)**:
  - Verifies 16 KiB chunk count calculation, backpressure buffer safety, bit corruption detection, and memory threshold guards.
- **Unit: `securityHardening.test.js` (Milestone 4)**:
  - Verifies hard room lifetime limit, generation collision guards, binary rejection, and rate limiter isolation.

---

## 2. Manual Cross-Device Testing (PC & Android)

To test Milestone 1 between a Windows computer and an Android phone:

### Step 1: Start the unified server
In your terminal on the Windows PC:

```bash
npm run build
npm start
```

### Step 2: Determine your PC's Local Network IP
Open PowerShell on your Windows PC and run:
```powershell
ipconfig
```
Look for your **IPv4 Address** under your Wi-Fi or Ethernet adapter (for example: `192.168.1.15`).

### Step 3: Open QuickDrop on PC
Open Chrome or Edge on your PC and navigate to:
```
http://192.168.1.15:5000
```
*(Replace `192.168.1.15` with your actual local IP)*.
1. Enter your device name: "Windows PC".
2. Click **Create Room**.
3. You will see a large, high-resolution QR code and an expiration countdown.

### Step 4: Connect on Android Phone
1. Ensure your Android phone is connected to the **same Wi-Fi network**.
2. Open the Camera app on your Android phone (or Chrome browser).
3. Point the camera at the QR code on your PC screen and tap the link that appears.
4. The phone browser opens directly to `http://192.168.1.15:5000/room/<roomId>#token=<token>`.
5. The phone connects automatically.
6. Observe:
   - On your PC: The QR code is replaced by the Connected room status, showing "Peer: Android Phone".
   - On your Phone: The room displays "Connected", showing "Host: Windows PC".

### Step 5: Verify WebRTC P2P Direct Connection
1. Once both devices join, observe the status badge updating to `⚡ P2P Direct`.
2. This indicates that native WebRTC peer connections and RTCDataChannels (`control` and `file`) are open.

### Step 6: Test P2P Direct Text Sharing
1. On your PC, type a message (e.g. `Hello P2P from PC!`) and hit Enter.
2. The message is transmitted **directly peer-to-peer** via WebRTC DataChannel (the signaling server never relays or sees the payload).
3. Verify that it appears instantly on the Android phone.
4. On the phone, reply with a text message and verify it appears on the PC.

### Step 7: Test Bidirectional File Transfer
1. **PC to Phone**:
   - Drag and drop a file (image, PDF, audio, or document) into the drop zone on your PC (or click to browse).
   - The file is chunked into 16 KiB slices and transferred with backpressure control.
   - Observe the live progress bar and speed display on both devices.
   - On your Android phone, observe the file appear under the Transfer Queue. When complete, tap **Save** to download the file.
2. **Phone to PC**:
   - Tap the drop zone on your Android phone to select a photo or document.
   - Observe the progress bar on both screens.
   - When complete, click **Save** on your PC to download and open the file.
3. **Transfer Cancellation**:
   - Start a transfer and tap **Cancel**.
   - Verify that the sender stops transmitting, the receiver discards partial chunks, and the status updates to `Cancelled`.

### Step 8: Test Room Closure
1. On your PC, click **Close Room** and confirm.
2. Verify that both the PC and the phone cleanly close the WebRTC peer connection and show "Room Ended".

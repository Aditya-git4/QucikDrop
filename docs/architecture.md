# QuickDrop Architecture

## Overview
QuickDrop is a temporary, privacy-conscious peer-to-peer text and file sharing application. It is designed to exchange data directly between devices with zero permanent server-side storage.

```
+-------------------------------------------------------------+
|                      QuickDrop System                        |
+-------------------------------------------------------------+
        |                                             |
        v                                             v
+------------------+                       +-------------------+
| Device A (Host)  |                       | Device B (Guest)  |
| - Browser UI     |                       | - Android Chrome  |
| - QR Display     |<=====================>| - Joined via QR   |
+------------------+   Temporary Session   +-------------------+
        |               Text Relay (M1)               |
        |              WebRTC P2P (M2+)               |
        \                      |                      /
         \                     v                     /
          \          +--------------------+         /
           \========>|  Signaling Server  |<=======/
                     | - Room Management  |
                     | - Single-use token |
                     | - In-memory state  |
                     +--------------------+
```

---

## 1. System Components

### Frontend (React + Vite)
- **Role**: Client application running in standard modern web browsers (Desktop Chrome/Firefox/Edge, Android Chrome).
- **Responsibilities**:
  - Room creation and join flows.
  - High-resolution QR code rendering with the `qrcode` library.
  - Invitation link handling: Join tokens are kept strictly in the URL fragment (`#token=...`) and stripped from the address bar upon load.
  - Establishing native WebRTC `RTCPeerConnection` and managing DataChannels (`control` and `file`).
  - Bi-directional P2P text messaging directly over WebRTC DataChannel (zero server relay).
  - Chunked file transfer (16 KiB binary slices) with `bufferedAmountLow` backpressure and progress reporting.
  - Displaying real-time device identity, room status, transfer progress, and expiry countdown.

### Backend (Node.js, Express, `ws`)
- **Role**: Ephemeral signaling and room coordination server.
- **Responsibilities**:
  - Ephemeral in-memory room management (`Map<roomId, Room>`).
  - Cryptographically secure room ID and join token generation (`node:crypto`).
  - Enforcing strict 2-device room limits (1 Host, 1 Guest).
  - Validating single-use tokens using constant-time hashing (`timingSafeEqual`).
  - WebSocket signaling on `/ws` with origin validation, JSON schema validation, and rate limiting.
  - Relaying WebRTC signaling payloads (`rtc:offer`, `rtc:answer`, `rtc:ice-candidate`) exclusively between authenticated room peers.
  - Strict policy: **The signaling server never receives, stores, or relays file payloads**.
  - Automated room expiration timers and idempotent teardown.
  - HTTP health check at `/health` and static serving of the built frontend.

---

## 2. WebRTC Peer-to-Peer Connection & DataChannels

```
[Host / Offerer]                                  [Guest / Answerer]
       |                                                   |
       | 1. Peer joined (Signaling)                        |
       |-------------------------------------------------->|
       | 2. Create Offer & DataChannels ('control', 'file')|
       |--- rtc:offer (via WebSocket signaling) ---------->|
       |                                                   | 3. Set Remote Description
       |                                                   |    Create Answer
       |<-- rtc:answer (via WebSocket signaling) ----------|
       | 4. Set Remote Description                         |
       |<-- rtc:ice-candidate (exchanged via signaling) -->|
       |                                                   |
       |============= WebRTC P2P DataChannels =============|
       |   ['control']: Text Chat & File Metadata          |
       |   ['file']: 16 KiB Binary Chunk Slices            |
       |===================================================|
```

### DataChannel Specifications:
- **`control` channel**:
  - Ordered, reliable JSON messaging.
  - Used for real-time text chat (zero server transit).
  - File handshake control: `file:start`, `file:ready`, `file:cancel`, `file:complete`.
- **`file` channel**:
  - Ordered, reliable binary channel (`binaryType: 'arraybuffer'`).
  - 16 KiB chunk slices (`16384` bytes).
  - Backpressure: Monitor `fileChannel.bufferedAmount` against threshold (64 KiB); throttles reading loop using `bufferedamountlow` event listener.
  - Receiver validates exact byte counts and reconstructs `Blob` upon completion.

---

## 2. Room Lifecycle

```
[Idle] 
  │
  ├─ Host sends `room:create` ───> Server generates Room ID & Token
  │
[Waiting]
  │  (Host displays QR code; countdown timer active)
  │
  ├─ Guest connects with token ──> Server validates & consumes token
  │
[Connected]
  │  (Bidirectional text exchange; 2 members active)
  │
  ├── Owner clicks 'Close' ───────> `room:closed` broadcast to both
  ├── Either peer disconnects ────> `peer:left` & teardown
  └── Expiry timer fires ─────────> `room:expired` broadcast
  │
[Terminated]
  │  (Sockets closed, timers cleared, room removed from memory)
```

---

## 3. Server Storage Policy
- **No Database**: All room states are transient and held strictly in memory.
- **No File Storage**: The server never receives, stores, or inspects file data. In Milestone 1, only text messages are relayed. In Milestone 2+, file transfers flow directly over WebRTC DataChannels.
- **No Permanent Text Logs**: Text messages relayed during the session are never written to disk, database, or server stdout logs.
- **Server Restart**: If the server restarts, all temporary rooms are automatically invalidated. Clients gracefully handle disconnection and prompt the user to start a new room.

---

## 4. Large-File Reliability & Integrity Architecture (Milestone 3)

### 4.1 Incremental Cryptographic Verification (SHA-256)
- File integrity is cryptographically guaranteed using NIST-compliant SHA-256 hashing.
- Both sender and receiver utilize an incremental hasher (`createSha256Incremental`) that updates state block-by-block ($O(1)$ memory).
- At no point is an entire large file loaded into a single contiguous ArrayBuffer for hashing.
- Senders transmit the final SHA-256 digest in `file:complete`. Receivers compute the digest on received chunks, verify equality, and flag the transfer with `✓ Verified SHA-256`. Transfers with corrupted chunks or byte count discrepancies are immediately rejected.

### 4.2 Backpressure & Bounded Sending
- Files are sliced on demand using `File.slice(offset, offset + 16384)`.
- Transmission loop queries `RTCDataChannel.bufferedAmount`.
- When `bufferedAmount > 65536` (64 KiB), transmission pauses and awaits the native `bufferedamountlow` event before reading the next slice.

### 4.3 Memory Optimization & Destination Streaming
- **Memory Batching**: Received chunks are compacted into native `Blob` parts every 32 slices (512 KiB). Native blobs reside outside of the V8 JavaScript heap, preventing heap exhaustion.
- **In-Memory Threshold Limit**: Browsers without direct disk streaming (e.g. mobile Chrome) enforce a safe `MEMORY_TRANSFER_LIMIT` of 200 MB to prevent mobile OS tab terminations.
- **Streaming Destination**: Where supported (e.g. desktop Chrome via File System Access API), files can stream directly to disk destinations.

---

## 5. Security Hardening & Dead Connection Reaping (Milestone 4)
- **Hard Maximum Room Lifetime (`maxRoomLifetimeMs`)**: Enforces a strict 1-hour cap on room duration, preventing indefinitely active sessions.
- **Generational Identifiers**: Atomic generation counters prevent stale cleanup timers from invalidating newer room instances.
- **Zombie Socket Reaping**: Server issues active 30-second ping/pong heartbeats. Sockets failing to reply within the grace period are terminated, freeing resources from disconnected or backgrounded mobile devices.
- **Exponential Reconnection**: Clients reconnect with bounded exponential backoff (1s, 2s, 4s; max 3 attempts) without aggressive hammering.

---

## 6. Single-Origin Cloud Deployment (Milestone 5)
- **Unified Service**: Single Node.js Express process serves the compiled React frontend, handles `/health`, and hosts the `/ws` WebSocket endpoint.
- **Automatic Same-Origin Host Validation**: Handshake validates `Origin` against the incoming `Host` header (`requestHost`), enabling zero-config deployment to Render Free Web Service (`https://<service>.onrender.com`) without hardcoded URLs.
- **Render Blueprint (`render.yaml`)**: Declarative infrastructure-as-code configuration for 1-click cloud provisioning.

---

## 7. TURN Relay & PWA Integration (Milestones 6 & 7)
- **Authenticated Ephemeral TURN (`iceServers.js`)**: Dynamically signs short-lived HMAC-SHA1 tokens (RFC 5766 / Coturn) for authenticated peers, preventing unauthorized bandwidth consumption and keeping the root `TURN_SECRET` strictly on the server.
- **Real-Time Connection Type Detection**: Inspects active WebRTC candidate pairs (`stats` API / `selectedCandidatePair`) to surface whether the session is operating via `⚡ P2P Direct (LAN)`, `⚡ P2P Direct (STUN)`, or `🔄 Relayed (TURN)` with live round-trip latency.
- **Screen Wake Lock API**: Holds a screen wake lock (`navigator.wakeLock`) during in-progress file transfers so mobile screens do not time out and terminate the WebRTC connection.
- **Web Share API**: Native OS sharing dialog on mobile (`navigator.share`) for 1-tap invitation link distribution.
- **Progressive Web App**: Offline shell caching via `sw.js` and `manifest.json` enabling home-screen installability on Android, iOS, and desktop.

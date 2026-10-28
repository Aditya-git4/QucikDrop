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

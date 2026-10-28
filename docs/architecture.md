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
  - Bi-directional text messaging within the active session.
  - Displaying real-time device identity, room status, and expiry countdown.

### Backend (Node.js, Express, `ws`)
- **Role**: Ephemeral signaling and room coordination server.
- **Responsibilities**:
  - Ephemeral in-memory room management (`Map<roomId, Room>`).
  - Cryptographically secure room ID and join token generation (`node:crypto`).
  - Enforcing strict 2-device room limits (1 Host, 1 Guest).
  - Validating single-use tokens using constant-time hashing (`timingSafeEqual`).
  - WebSocket signaling on `/ws` with origin validation, JSON schema validation, and rate limiting.
  - Automated room expiration timers and idempotent teardown.
  - HTTP health check at `/health` and static serving of the built frontend.

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

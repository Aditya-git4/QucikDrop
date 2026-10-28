# ⚡ QuickDrop — Temporary Peer-to-Peer Sharing

QuickDrop is a temporary, privacy-conscious peer-to-peer web application that enables users to transfer text and files directly between devices (such as a PC and an Android phone) using ephemeral QR-code rooms with zero permanent server file storage.

---

## 🚀 Milestone 1, 2 & 3 Features (Implemented)
- **Zero Server File Storage**: Direct peer-to-peer data channels. The signaling server **never** receives or relays file payloads.
- **Large-File Reliability & Integrity (Milestone 3)**:
  - **Incremental SHA-256 Verification**: Both sender and receiver compute SHA-256 digests chunk-by-chunk ($O(1)$ memory).
  - **Bit-Exact Integrity Guarantee**: Receiver verifies the cryptographic hash against the sender's manifest before completion. Corrupted chunks or truncated files are rejected with `INTEGRITY_MISMATCH`.
  - **Verified Progress**: Progress bar reaches 100% only after cryptographic verification passes.
  - **Memory Optimization**: Batches 16 KiB chunks into native `Blob` parts every 512 KiB to prevent JS heap exhaustion.
  - **Memory Safeguards**: Enforces `MEMORY_TRANSFER_LIMIT` (200 MB) on mobile/in-memory browsers lacking direct disk streaming.
- **Native WebRTC P2P**:
  - `RTCPeerConnection` with Google public STUN servers.
  - SDP offer & answer exchange via WebSocket signaling.
  - ICE candidate signaling with automatic queueing for candidates arriving before remote description.
- **Dual RTCDataChannels**:
  - `control` channel: Direct peer-to-peer text chat and file transfer control protocol (`file:start`, `file:ready`, `file:cancel`, `file:complete`).
  - `file` channel: 16 KiB binary slices (`ArrayBuffer`) with backpressure monitoring (`bufferedAmountLowThreshold`).
- **File Transfer Queue**:
  - Drag-and-drop file zone on desktop and file picker on mobile.
  - Multiple-file queue processed reliably.
  - Real-time progress bars, percentage, and estimated transfer speed.
  - Transfer cancellation on sender and receiver with automatic buffer release.
  - Exact byte count verification before reconstructing `Blob` and generating safe download URLs.
  - Filename sanitization to prevent path traversal.
- **Cryptographic Room Security**:
  - 128-bit random Room IDs.
  - 192-bit cryptographic join tokens, stored on the server as SHA-256 hashes.
  - Constant-time token verification (`crypto.timingSafeEqual`).
  - Strict single-use token semantics.
  - URL fragment-based token transmission (`#token=...`), stripped from the address bar on load to prevent leakages.
- **Strict 2-Device Limit**: Exactly 1 host and 1 guest per room. 3rd-device attempts are rejected with `ROOM_FULL`.
- **Instant QR Code Generation**: Scan with an Android phone or mobile browser to connect in seconds.
- **Automatic Expiration & Teardown**: Configurable idle TTL (10 minutes) with automatic room cleanup and notification.
- **Owner Closure**: Room owner can close the room at any time; disconnection of either peer closes the room immediately.
- **Abuse Prevention**: Sliding-window rate limiting on room creation, joins, messaging, and RTC signals.
- **Origin Validation**: Strict CORS/origin validation in production, with LAN support in development.
- **Unified Architecture**: Single Express service capable of serving the built React frontend, handling `/health`, and hosting the `/ws` WebSocket endpoint.

---

## 🛠️ Technology Stack
- **Frontend**: React 18, Vite 6, standard CSS tokens (dark mode aware), `qrcode` library.
- **Backend**: Node.js 24, Express, `ws` (native WebSocket library), `node:crypto`.
- **Testing**: Node.js built-in `node:test` runner and assertions (no external test framework dependencies).
- **Workspace**: npm workspaces (`client`, `server`).

---

## 📂 Project Structure

```
quickdrop/
├── client/                      # React + Vite frontend
│   ├── public/                  # Public assets
│   ├── src/
│   │   ├── components/          # Reusable UI components
│   │   │   ├── ConnectionBanner.jsx
│   │   │   ├── CopyButton.jsx
│   │   │   ├── DeviceStatus.jsx
│   │   │   ├── ErrorMessage.jsx
│   │   │   ├── FileDropZone.jsx  # Drag & drop and file selection
│   │   │   ├── QRCodeDisplay.jsx
│   │   │   ├── TextTransfer.jsx  # P2P direct text exchange
│   │   │   ├── TransferItem.jsx  # File transfer card with Save/Cancel
│   │   │   ├── TransferProgress.jsx # Progress bar with speed & bytes
│   │   │   └── TransferQueue.jsx # Multi-file transfer queue
│   │   ├── hooks/
│   │   │   ├── useFileTransfer.js # File queue & progress state
│   │   │   ├── useSignaling.js   # Signaling lifecycle
│   │   │   └── useWebRTC.js      # Native RTCPeerConnection & DataChannels
│   │   ├── pages/
│   │   │   ├── Home.jsx         # Landing & room creation page
│   │   │   └── Room.jsx         # Active room & P2P sharing page
│   │   ├── services/
│   │   │   ├── fileTransfer.js   # 16 KiB chunking, backpressure & assembly
│   │   │   ├── peerConnection.js # WebRTC connection & candidate queueing
│   │   │   └── signalingClient.js # WebSocket client service
│   │   ├── utils/
│   │   │   ├── cryptoUtils.js   # Pure JS incremental SHA-256 hasher (NIST bit-exact)
│   │   │   ├── fileUtils.js     # Filename sanitization & download trigger
│   │   │   ├── formatBytes.js   # Byte and speed formatting
│   │   │   ├── roomUtils.js     # URL parsing & device detection
│   │   │   └── validateInput.js # Input sanitization & validation
│   │   ├── App.jsx              # Main application shell
│   │   ├── index.css            # Design tokens & styles
│   │   └── main.jsx             # React entry point
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── server/                      # Node.js + Express + ws signaling backend
│   ├── src/
│   │   ├── config/
│   │   │   └── config.js        # Environment & limits configuration
│   │   ├── rooms/
│   │   │   ├── roomCleanup.js   # Cleanup utilities
│   │   │   └── roomManager.js   # In-memory room state management
│   │   ├── security/
│   │   │   ├── originValidation.js # Origin allowlist validation
│   │   │   ├── rateLimiter.js   # Sliding-window rate limiting
│   │   │   └── tokenUtils.js    # Crypto token generation & hashing
│   │   ├── websocket/
│   │   │   ├── messageHandler.js # WebSocket message routing
│   │   │   ├── messageSchemas.js # Schema validation & error codes
│   │   │   └── signalingServer.js # WebSocket server setup & heartbeats
│   │   └── index.js             # Express app & static serving entry point
│   ├── tests/
│   │   ├── unit/
│   │   │   ├── originValidation.test.js
│   │   │   ├── rateLimiter.test.js
│   │   │   ├── roomManager.test.js
│   │   │   └── tokenUtils.test.js
│   │   └── integration/
│   │       ├── healthAndStatic.test.js
│   │       └── signalingServer.test.js
│   └── package.json
├── docs/                        # Specifications and guides
│   ├── architecture.md
│   ├── protocol.md
│   ├── security.md
│   ├── testing.md
│   └── deployment.md
├── .env.example
├── .gitignore
├── package.json                 # npm workspaces root
└── README.md
```

---

## 📋 Prerequisites
- **Node.js**: v20+ (v24.15+ recommended)
- **npm**: v10+

---

## ⚡ Getting Started (Local Development)

### 1. Install Dependencies
From the repository root:
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
copy .env.example .env
```

### 3. Run Development Servers
To run both the backend server and Vite client concurrently:
```bash
npm run dev
```
- Frontend dev server: `http://localhost:5173`
- Backend API & WebSocket: `http://localhost:5000` (WebSocket at `ws://localhost:5000/ws`)

---

## 🧪 Running Tests
Run the comprehensive unit and integration test suite:
```bash
npm test
```
All tests run natively using Node.js's built-in `node:test` runner.

---

## 📦 Production Build & Run
To compile the frontend and run the single unified production service:

```bash
# 1. Build the React frontend into client/dist
npm run build

# 2. Start the unified production server
npm start
```
The application will be served at `http://localhost:5000`, with static assets, the `/ws` WebSocket endpoint, and `/health` running on the same port.

---

## 📱 Cross-Device Testing (PC + Android Phone)
To test between a computer and phone on the same Wi-Fi network:

1. Build and run the server:
   ```bash
   npm run build
   npm start
   ```
2. Find your PC's local IP address (e.g. `192.168.1.15` via `ipconfig`).
3. Open `http://192.168.1.15:5000` in Chrome on your PC.
4. Click **Create Room**.
5. Scan the displayed QR code with your Android phone's camera.
6. The phone will open the room and connect instantly.
7. Exchange messages between the devices in real time.

---

## ⚙️ Environment Variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `5000` | Port for Express & WebSocket server |
| `HOST` | `0.0.0.0` | Host binding interface |
| `NODE_ENV` | `development` | Set to `production` when deployed |
| `ROOM_TTL_MS` | `600000` | Idle expiration time in ms (10 min) |
| `MAX_ROOM_LIFETIME_MS` | `3600000` | Maximum room duration in ms (1 hour) |
| `ALLOWED_ORIGINS` | `http://localhost:5173,...` | Comma-separated allowed origins |
| `MAX_WS_MESSAGE_BYTES`| `16384` | Max WebSocket payload size (16 KiB) |
| `MAX_TEXT_LENGTH` | `4096` | Max characters per text message |
| `MAX_ROOMS` | `100` | Max concurrent active rooms |

---

## ⚠️ Current Limitations (Milestone 1 Scope)
- **Text Only**: Milestone 1 implements bidirectional text sharing via WebSocket signaling. WebRTC peer-to-peer data channels and file transfer will be implemented in Milestone 2.
- **In-Memory State**: Server restarts invalidate active rooms.
- **Two Devices Only**: Reconnecting or adding a third device is intentionally rejected. If a connection drops, a new room must be created.

# QuickDrop Security & Threat Model

QuickDrop is designed with a defense-in-depth security model to ensure that even when deployed publicly, unauthorized users cannot snoop on rooms, manipulate identities, or exhaust server resources.

---

## 1. Threat Model & Mitigations

### 1.1 Unauthorized Room Snooping / Joining
- **Threat**: An attacker guesses or enumerates room IDs to eavesdrop on shared data.
- **Mitigation**:
  - Room IDs are 128-bit cryptographically secure random hexadecimal strings (`crypto.randomBytes(16)`), making enumeration computationally impossible.
  - A room ID alone **does not grant access**. Joining requires a separate 192-bit cryptographic join token (`crypto.randomBytes(24)`).
  - Join tokens are never stored directly on the server; only their SHA-256 hashes are retained in memory.
  - Token validation uses `crypto.timingSafeEqual` to eliminate timing side-channel attacks.
  - Join tokens are **strictly single-use**. Once the guest joins, the token cannot be reused by any third party.

### 1.2 Fragment-Based Token Protection
- **Threat**: Secrets in URL query strings leak via web server access logs, browser history, or HTTP `Referer` headers.
- **Mitigation**:
  - Invitation links store the join token in the URL fragment (`#token=...`).
  - Fragments are strictly client-side and are **never** transmitted in HTTP request paths to the server.
  - The React frontend immediately parses the token from `window.location.hash` and strips it from the visible browser address bar via `history.replaceState()`.
  - Tokens are never stored in persistent browser storage (`localStorage` or `indexedDB`).

### 1.3 Strict Membership & Identity Spoofing
- **Threat**: A client claims to be the room owner or claims to send messages on behalf of another user.
- **Mitigation**:
  - The server tracks authenticated socket bindings in a secure `WeakMap`.
  - Peer IDs are server-assigned upon connection; client-selected identities are rejected.
  - Every relayed text message has its `senderPeerId` and `deviceName` attached by the server. The client cannot spoof the sender.
  - Rooms are strictly limited to two devices. Any third device attempting to join is immediately rejected with `ROOM_FULL`.

### 1.4 Rate Limiting & Denial of Service
- **Threat**: Malicious bots flood the server with room creation, joins, or huge messages.
- **Mitigation**:
  - WebSocket payload size is strictly capped at 16 KiB (`MAX_WS_MESSAGE_BYTES`).
  - Text messages are capped at 4,096 characters (`MAX_TEXT_LENGTH`).
  - Sliding-window in-memory rate limiting:
    - Room creation: 10 per minute per IP.
    - Room joining: 15 per minute per IP.
    - Text messages: 60 per minute per socket.
  - Maximum concurrent active rooms is enforced by `MAX_ROOMS`.

### 1.5 Cross-Site WebSocket Hijacking (CSWSH)
- **Threat**: Malicious websites open WebSocket connections to the QuickDrop backend.
- **Mitigation**:
  - In production, origin verification strictly requires matches from `ALLOWED_ORIGINS`.
  - In development, local loopback and private RFC 1918 subnets (`192.168.x.x`, `10.x.x.x`) are allowed to facilitate same-network mobile testing.

### 1.6 WebRTC Signaling Authorization & Zero File Payload Isolation
- **Threat**: Malicious actors inject unauthorized SDP or ICE signals into foreign rooms or send binary file payloads to the server.
- **Mitigation**:
  - WebRTC signaling (`rtc:offer`, `rtc:answer`, `rtc:ice-candidate`) requires the sender to be an active, verified member of a `connected` room.
  - Senders can only target the verified peer in their own room. Cross-room signaling is strictly rejected.
  - The signaling server rejects all binary messages immediately. File chunks never touch the Express or WebSocket server.
  - Dedicated rate limiting on WebRTC signals (`rateLimitMaxRtc = 120/min`).

### 1.7 Dynamic Idle TTL vs. Hard Maximum Lifetime
- **Threat**: Inactive rooms linger in memory, or high activity keeps a temporary room alive indefinitely.
- **Mitigation**:
  - **Dynamic Idle TTL** (`ROOM_TTL_MS`, default 10 minutes): Extends on genuine user activity (text/files), but protocol heartbeats (ping/pong) are explicitly excluded from extending this timer.
  - **Hard Maximum Lifetime** (`MAX_ROOM_LIFETIME_MS`, default 1 hour): Absolute ceiling on room existence regardless of ongoing activity.
  - **Generation Guards**: Expiration timers check `roomGeneration` before deleting, ensuring stale timers never destroy newly created rooms sharing an ID.

### 1.8 Dead Connection Reaping & Bounded Client Retries
- **Threat**: Half-open zombie connections consume socket slots, or disconnected clients flood the server with rapid reconnection attempts.
- **Mitigation**:
  - Server sends WebSocket ping frames every 30 seconds. Clients failing to respond with pong are terminated (`ws.terminate()`).
  - Client implements bounded reconnection with exponential backoff (1s, 2s, 4s, capped at 3 attempts). No aggressive tight reconnect loops.

### 1.9 End-to-End Cryptographic File Integrity
- **Threat**: Corrupted or tampered packets in transit lead to compromised files.
- **Mitigation**:
  - Pure JavaScript incremental SHA-256 hashing verifies every chunk slice.
  - Progress advances to 100% only after cryptographic hash verification succeeds.
  - Files failing hash comparison or byte count checks are immediately destroyed and never presented to the user.

### 1.10 Ephemeral TURN Credential Isolation
- **Threat**: Root TURN credentials or API secrets leak to the client browser, allowing malicious actors to exploit relay bandwidth.
- **Mitigation**:
  - The server utilizes RFC 5766 / Coturn HMAC-SHA1 ephemeral credential signing (`generateEphemeralCredentials`) or Cloudflare Realtime TURN ephemeral credential generation.
  - Root `TURN_KEY_ID` and `TURN_API_TOKEN` never leave the server environment and are strictly excluded from all client responses, error messages, and log lines.
  - Clients receive only short-lived credentials (1 hour TTL, cached 45 minutes) delivered exclusively over authenticated signaling messages (`room:created`, `room:joined`, `room:rejoined`).

### 1.11 Host Approval & Optional 4-Digit PIN Access Control
- **Threat**: An intercepted QR code or leaked invite link allows an unauthorized person to join a private room.
- **Mitigation**:
  - **Explicit Host Approval**: By default, joining peers enter a `pending` state. The room host receives a prompt with the guest's device name and sanitized user-agent summary to explicitly "Allow" or "Deny".
  - **Auto-Deny & 3-Strike Rule**: Join requests auto-deny after 60 seconds of host inactivity. After 3 denied or invalid attempts, the room closes permanently with reason `too_many_attempts`.
  - **Optional 4-Digit Access PIN**: Hosts can require a 4-digit numeric PIN.
  - **Async PBKDF2 Hashing**: The PIN is hashed using `crypto.pbkdf2` with SHA-256, a cryptographically random 16-byte salt (`generatePinSalt`), and 100,000 iterations.
  - **Non-Blocking Benchmark**: The async implementation runs in the worker pool (~22–24 ms per hash on modern hardware, well under the ~150 ms target), preventing event loop blocking.
  - **Constant-Time Verification**: Comparison is strictly performed using `crypto.timingSafeEqual` over the derived key buffer to prevent timing attacks.
  - **5-Strike PIN Lockout**: 5 incorrect PIN attempts permanently destroy the room.
  - **Plaintext PIN Isolation**: Plaintext PINs and salts are never sent to the joiner or stored in server logs.

### 1.12 Reverse Proxy IP Trust & Spoof Prevention
- **Threat**: A client connects through a reverse proxy (e.g. Render) with a spoofed `X-Forwarded-For` header to bypass rate limits or per-IP relay quotas.
- **Mitigation**:
  - Server configures Express `trust proxy = 1` and matches this for WebSocket upgrade requests.
  - With exactly 1 trusted proxy hop, the trusted reverse proxy appends the real remote client IP at the **end** of `X-Forwarded-For`.
  - IP extraction strictly takes `parts[parts.length - 1]`, preventing clients from spoofing earlier entries.
  - IPv6-mapped IPv4 addresses (`::ffff:`) are automatically normalised to standard IPv4.
  - When `X-Forwarded-For` is absent (local dev/direct connection), the server falls back safely to `req.socket.remoteAddress`.
  - Telemetry logging uses `maskIp(ip)` to mask the last octet (e.g. `203.0.113.xxx`), preserving privacy and compliance.

### 1.13 End-to-End Encrypted Relay Fallback
- **Threat**: In situations where P2P connections fail and data routes through the WebSocket relay, the server could inspect messages or file contents.
- **Mitigation**:
  - The room creator generates a 256-bit room key client-side using WebCrypto (`crypto.getRandomValues`).
  - The key is appended to the URL fragment (`#token=...&k=<base64url key>`) and is **never** sent to the signaling server.
  - All text and file data relayed across the server is end-to-end encrypted with AES-256-GCM using keys derived via HKDF-SHA-256 with direction- and transfer-specific info strings.
  - If a joiner joins without a key (manual entry), relay fallback is disabled to prevent silent fallback to plaintext.

---

## 2. Privacy & Data Retention
- No database is used.
- All room state exists only in memory and is scrubbed immediately when the room is closed, when either member disconnects, or when the expiration timer elapses.
- Text messages are relayed directly between active sockets and are never saved to disk or persistent storage.
- Raw join tokens are excluded from server stdout/stderr logs.

---

## 3. Threat Model Review: Join Authorization & Host Control
- **Analysis**: Unpredictable 128-bit Room IDs and 192-bit single-use join tokens protect against guessing or link replay attacks.
- **Shoulder Surfing / Interception Consideration**: If a physical bystander scans the QR code or intercepts an invitation link, single-use token semantics guarantee that whoever connects first takes the slot.
- **Mitigation**: Device names are reported to the host immediately on connection. The host can close the room with one click (`Close Room`) if an unrecognized device appears. Furthermore, `requireJoinApproval` can be enabled to mandate explicit host approval before admitting guests.
- **Pre-Public Launch Requirements**:
  1. Enforce HTTPS/WSS in deployment with HSTS.
  2. Maintain exact production domain in `ALLOWED_ORIGINS`.
  3. Keep dependency audit clean with regular security patches.

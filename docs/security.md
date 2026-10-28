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

---

## 2. Privacy & Data Retention
- No database is used.
- All room state exists only in memory and is scrubbed immediately when the room is closed, when either member disconnects, or when the expiration timer elapses.
- Text messages are relayed directly between active sockets and are never saved to disk or persistent storage.
- Raw join tokens are excluded from server stdout/stderr logs.

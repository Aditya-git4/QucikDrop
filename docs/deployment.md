# QuickDrop Deployment Guide

QuickDrop is designed to deploy as a unified single-service application on platforms such as **Render Free Web Service**, **Railway**, or any standard Node.js cloud hosting.

---

## 1. Hosting Architecture
In production, a single Node.js process:
- Serves the compiled React frontend static files (`client/dist`).
- Provides client-side SPA routing fallback on `/room/*`.
- Exposes the `/health` endpoint for uptime monitoring and zero-downtime health checks.
- Runs the WebSocket signaling server on path `/ws`.
- Operates over HTTPS and WSS automatically on the deployed origin.

---

## 2. Render Web Service Configuration

When setting up a new Web Service on Render:

| Setting | Value |
| :--- | :--- |
| **Environment** | Node |
| **Branch** | `main` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm start` |
| **Plan** | Free |

### Environment Variables
Configure these under **Environment Variables** in Render:

| Variable | Value | Description |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables strict origin validation & optimizations |
| `ALLOWED_ORIGINS` | `https://your-service-name.onrender.com` | Your Render production HTTPS domain |
| `ROOM_TTL_MS` | `600000` | Room idle TTL (10 minutes) |
| `MAX_ROOM_LIFETIME_MS` | `3600000` | Hard cap on room duration (1 hour) |
| `PORT` | *(Provided by Render automatically)* | Port assigned by the hosting environment |
| `STUN_URLS` | *(Optional)* | Custom STUN servers (defaults to Google STUN) |
| `TURN_KEY_ID` | *(Recommended)* | Cloudflare Realtime TURN Key ID |
| `TURN_API_TOKEN` | *(Recommended)* | Cloudflare Realtime TURN API Token |
| `TURN_URLS` | *(Optional)* | Legacy custom TURN relay URLs |
| `TURN_SECRET` | *(Optional)* | Shared secret for Coturn/RFC 5766 ephemeral HMAC-SHA1 tokens |
| `TURN_USERNAME` | *(Optional)* | Static TURN username (if not using ephemeral secrets) |
| `TURN_CREDENTIAL` | *(Optional)* | Static TURN credential/password |

---

## 3. Cloudflare Realtime TURN Integration (Recommended)

QuickDrop natively supports [Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/) (formerly Calls TURN) for reliable WebRTC NAT traversal across cellular mobile networks and restrictive enterprise firewalls.

When configured:
- Traffic between devices on symmetric NATs (e.g., phone on 5G vs PC on home Wi-Fi) is routed through Cloudflare's global edge network via WebRTC DataChannels with DTLS end-to-end encryption.
- Direct P2P is always attempted first via STUN; Cloudflare TURN is used if direct traversal fails, completely avoiding fallback to the server WebSocket relay.

### Setup Instructions
1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Navigate to **Realtime** (or **Calls**) > **TURN**.
3. Create a **TURN Key**. You will receive:
   - A **Key ID** (e.g., `018f...`)
   - An **API Token**
4. In your deployment environment (e.g., Render, Railway, Docker), set the environment variables:
   ```env
   TURN_KEY_ID=your_turn_key_id
   TURN_API_TOKEN=your_turn_api_token
   ```

### Security & Operational Characteristics
- **Server-Side Credential Minting**: Your backend calls Cloudflare's authenticated endpoint `POST https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate-ice-servers` requesting short-lived ephemeral credentials (1-hour TTL).
- **Zero Secret Leakage**: The master `TURN_API_TOKEN` is never sent to the browser and never logged in server traces.
- **Background Caching**: Ephemeral credentials are soft-cached in server memory for 45 minutes and refreshed proactively in the background with a 5-second timeout and exponential backoff.
- **Fail-Safe Resilience**: If Cloudflare's API is unreachable, QuickDrop logs a warning and gracefully falls back to STUN-only operation. Room creation is **never** blocked.
- **Multi-Port & TLS Coverage**: All Cloudflare URL variants are merged into the ICE configuration: UDP (ports 3478, 443), TCP (ports 3478, 80), and TURNS/TLS (ports 5349, 443) for maximum firewall penetration.
- **Health Monitoring**: The `/health` HTTP endpoint reports the live TURN state under the `turn` field (`"configured"`, `"not_configured"`, or `"degraded"`).

---

## 4. Render Free Tier Considerations
1. **Service Sleep**: Render Free tier spins down services after 15 minutes of inactivity. Initial page loads after sleep can take ~30-50 seconds to wake up.
2. **In-Memory State**: Because QuickDrop uses an ephemeral, privacy-first in-memory architecture without a database, any cold restart or redeploy cleanly flushes active rooms. The client detects this and prompts users to start a new room.

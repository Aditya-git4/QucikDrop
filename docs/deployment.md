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
| `TURN_URLS` | *(Optional)* | Comma-separated TURN relay URLs for NAT traversal |
| `TURN_SECRET` | *(Optional)* | Shared secret for Coturn/RFC 5766 ephemeral HMAC-SHA1 tokens |
| `TURN_USERNAME` | *(Optional)* | Static TURN username (if not using ephemeral secrets) |
| `TURN_CREDENTIAL` | *(Optional)* | Static TURN credential/password |

---

## 3. Render Free Tier Considerations
1. **Service Sleep**: Render Free tier spins down services after 15 minutes of inactivity. Initial page loads after sleep can take ~30-50 seconds to wake up.
2. **In-Memory State**: Because QuickDrop uses an ephemeral, privacy-first in-memory architecture without a database, any cold restart or redeploy cleanly flushes active rooms. The client detects this and prompts users to start a new room.

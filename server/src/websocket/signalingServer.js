import { WebSocketServer } from 'ws';
import { config } from '../config/config.js';
import { isOriginAllowed } from '../security/originValidation.js';
import { getClientIp, maskIp } from '../security/ipUtils.js';
import { sanitizeUserAgent } from '../security/tokenUtils.js';
import { handleIncomingMessage, sendJson } from './messageHandler.js';

// Re-export getClientIp for backward compatibility
export { getClientIp };

/**
 * Initialize WebSocket signaling server attached to an HTTP server.
 * @param {import('http').Server} httpServer
 * @param {import('../rooms/roomManager.js').RoomManager} roomManager
 * @returns {WebSocketServer}
 */
export function createSignalingServer(httpServer, roomManager) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: config.maxWsBinaryBytes,
    // Validate origin before accepting WebSocket upgrade
    verifyClient: (info, callback) => {
      const origin = info.origin || info.req.headers.origin;
      const host = info.req.headers.host;
      const allowed = isOriginAllowed(origin, undefined, undefined, host);
      if (!allowed) {
        callback(false, 403, 'Forbidden Origin');
        return;
      }
      callback(true);
    }
  });

  // Keep-alive heartbeat interval (every 25s with terminate on missed pong)
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) {
        // Socket did not respond to last ping -> terminate immediately to trigger grace period
        return ws.terminate();
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    });
  }, 25000);

  if (heartbeatInterval.unref) {
    heartbeatInterval.unref();
  }

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.userAgent = req.headers['user-agent'] || '';
    const clientIp = getClientIp(req);
    ws.clientIp = clientIp;

    // Diagnostic connection log with masked IP
    const masked = maskIp(clientIp);
    const uaSummary = sanitizeUserAgent(ws.userAgent);
    console.log(`[WS-CONN] clientIp=${masked} userAgent="${uaSummary}"`);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Enforce strict FIFO message processing per socket using a promise queue.
    // Rapidly arriving messages on the same socket will execute sequentially,
    // preventing async race conditions.
    ws._msgQueue = Promise.resolve();
    ws.on('message', (rawData, isBinary) => {
      ws._msgQueue = ws._msgQueue
        .then(() => handleIncomingMessage(roomManager, ws, rawData, isBinary, clientIp))
        .catch((err) => {
          console.error('Error in websocket message pipeline:', err.message);
        });
    });

    ws.on('close', () => {
      const result = roomManager.handleSocketDisconnect(ws);
      if (result && result.status === 'grace_period' && result.remainingPeer && result.remainingPeer.ws) {
        // Notify other peer that peer disconnected without tearing down the room
        sendJson(result.remainingPeer.ws, {
          type: 'peer:disconnected',
          version: 1,
          peerId: result.disconnectedPeerId
        });
      } else if (result && result.status === 'pending_canceled' && result.ownerWs) {
        sendJson(result.ownerWs, {
          type: 'peer:join-canceled',
          version: 1,
          requestId: result.requestId
        });
      }
    });

    ws.on('error', (err) => {
      // Avoid unhandled socket errors crashing server
      console.error('WebSocket connection error:', err.message);
    });
  });

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}

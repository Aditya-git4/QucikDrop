import { WebSocketServer } from 'ws';
import { isOriginAllowed } from '../security/originValidation.js';
import { handleIncomingMessage, sendJson } from './messageHandler.js';

/**
 * Extract client IP from upgrade request, taking into account trusted headers only when needed.
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
export function getClientIp(req) {
  // Use remoteAddress as standard
  return req.socket?.remoteAddress || '127.0.0.1';
}

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
    // Validate origin before accepting WebSocket upgrade
    verifyClient: (info, callback) => {
      const origin = info.origin || info.req.headers.origin;
      const allowed = isOriginAllowed(origin);
      if (!allowed) {
        callback(false, 403, 'Forbidden Origin');
        return;
      }
      callback(true);
    }
  });

  // Keep-alive heartbeat interval (every 30s)
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) {
        // Socket did not respond to last ping
        return ws.terminate();
      }
      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    });
  }, 30000);

  if (heartbeatInterval.unref) {
    heartbeatInterval.unref();
  }

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    const clientIp = getClientIp(req);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (rawData, isBinary) => {
      handleIncomingMessage(roomManager, ws, rawData, isBinary, clientIp);
    });

    ws.on('close', () => {
      const result = roomManager.handleSocketDisconnect(ws);
      if (result && result.remainingPeer && result.remainingPeer.ws) {
        // In MVP: notify remaining peer that other peer left and room closed
        sendJson(result.remainingPeer.ws, {
          type: 'peer:left',
          version: 1,
          peerId: result.disconnectedPeerId,
          reason: 'disconnected'
        });
        sendJson(result.remainingPeer.ws, {
          type: 'room:closed',
          version: 1,
          reason: 'peer_disconnected'
        });
        try {
          result.remainingPeer.ws.close(1000, 'Peer disconnected');
        } catch {
          // ignore
        }
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

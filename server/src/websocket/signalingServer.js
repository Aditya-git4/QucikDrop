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
    const clientIp = getClientIp(req);

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (rawData, isBinary) => {
      handleIncomingMessage(roomManager, ws, rawData, isBinary, clientIp);
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

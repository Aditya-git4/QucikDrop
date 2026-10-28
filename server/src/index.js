import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import { config } from './config/config.js';
import { RoomManager } from './rooms/roomManager.js';
import { createSignalingServer } from './websocket/signalingServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();
export const roomManager = new RoomManager();

// Basic security middleware headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// JSON body parsing for API endpoints (if any)
app.use(express.json({ limit: '10kb' }));

// Health check endpoint (Section 3 & 13)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    activeRooms: roomManager.rooms.size,
    timestamp: Date.now()
  });
});

// Serve frontend in production (or if client/dist exists)
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));

  // SPA fallback for /room/:roomId routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/ws') || req.path.startsWith('/health')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

export const server = http.createServer(app);
export const wss = createSignalingServer(server, roomManager);

// Graceful shutdown handling
let isShuttingDown = false;
export function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}. Shutting down gracefully...`);

  // Teardown in-memory rooms
  roomManager.dispose();

  // Close WebSocket connections
  wss.close(() => {
    // Close HTTP server
    server.close(() => {
      console.log('QuickDrop server stopped.');
      process.exit(0);
    });
  });

  // Force exit after 5 seconds if not closed
  setTimeout(() => {
    console.error('Forcefully stopping server.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Only start listening if executed directly (not imported as a module in tests)
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun && process.env.NODE_ENV !== 'test') {
  server.listen(config.port, config.host, () => {
    console.log(`QuickDrop server listening on http://${config.host}:${config.port}`);
    console.log(`WebSocket endpoint available at ws://${config.host}:${config.port}/ws`);
    console.log(`Environment: ${config.nodeEnv}`);
  });
}

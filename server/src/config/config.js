import dotenv from 'dotenv';
dotenv.config();

function parseAllowedOrigins(originsString) {
  if (!originsString) {
    return [
      'http://localhost:5173',
      'http://localhost:5000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:5000'
    ];
  }
  return originsString.split(',').map(s => s.trim()).filter(Boolean);
}

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // Room lifecycle
  roomTtlMs: parseInt(process.env.ROOM_TTL_MS || '600000', 10), // 10 minutes default
  maxRoomLifetimeMs: parseInt(process.env.MAX_ROOM_LIFETIME_MS || '3600000', 10), // 1 hour max
  roomReconnectGraceMs: parseInt(process.env.ROOM_RECONNECT_GRACE_MS || '60000', 10), // 60 seconds grace period
  maxRooms: parseInt(process.env.MAX_ROOMS || '100', 10),

  // Message & payload limits
  maxWsMessageBytes: parseInt(process.env.MAX_WS_MESSAGE_BYTES || '16384', 10), // 16 KiB
  maxTextLength: parseInt(process.env.MAX_TEXT_LENGTH || '4096', 10), // 4096 chars

  // Security & origins
  allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),

  // Rate limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMaxRoomCreates: parseInt(process.env.RATE_LIMIT_MAX_ROOM_CREATES || '10', 10),
  rateLimitMaxJoins: parseInt(process.env.RATE_LIMIT_MAX_JOINS || '15', 10),
  rateLimitMaxMessages: parseInt(process.env.RATE_LIMIT_MAX_MESSAGES || '60', 10),
  rateLimitMaxRtc: parseInt(process.env.RATE_LIMIT_MAX_RTC || '120', 10),

  // Security controls
  requireJoinApproval: process.env.REQUIRE_JOIN_APPROVAL === 'true',
};

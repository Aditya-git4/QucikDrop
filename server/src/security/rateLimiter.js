/**
 * In-memory sliding-window rate limiter.
 * Tracks timestamps of requests per (key + action) to prevent abuse.
 */
export class RateLimiter {
  constructor(cleanupIntervalMs = 60000) {
    /** @type {Map<string, number[]>} */
    this.hits = new Map();

    // Periodically clean up expired entries
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref(); // Don't hold Node process open in tests
    }
  }

  /**
   * Check if an action is allowed for a given key.
   * Records the timestamp if allowed.
   * @param {string} key - e.g. client IP or peer ID
   * @param {string} action - e.g. 'room_create', 'room_join', 'message'
   * @param {number} maxRequests - maximum allowed requests within window
   * @param {number} windowMs - time window in milliseconds
   * @returns {boolean} true if request is within limits, false if rate limited
   */
  isAllowed(key, action, maxRequests, windowMs) {
    const bucketKey = `${action}:${key}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = this.hits.get(bucketKey);
    if (!timestamps) {
      timestamps = [];
      this.hits.set(bucketKey, timestamps);
    }

    // Filter out timestamps outside the active window
    const recent = timestamps.filter(t => t > windowStart);

    if (recent.length >= maxRequests) {
      this.hits.set(bucketKey, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(bucketKey, recent);
    return true;
  }

  /**
   * Purge empty or stale buckets from memory.
   */
  cleanup() {
    const now = Date.now();
    for (const [bucketKey, timestamps] of this.hits.entries()) {
      // Find the maximum timestamp in this bucket
      const latest = timestamps[timestamps.length - 1];
      if (!latest || now - latest > 120000) {
        this.hits.delete(bucketKey);
      }
    }
  }

  /**
   * Clear all rate limiting state and stop timers.
   */
  dispose() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.hits.clear();
  }
}

export const defaultRateLimiter = new RateLimiter();

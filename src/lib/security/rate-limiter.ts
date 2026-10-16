interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

// Purge expired entries periodically
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryStore.entries()) {
      if (now > entry.resetAt) {
        memoryStore.delete(key);
      }
    }
  }, 30000).unref?.();
}

export interface RateLimitOptions {
  windowMs?: number; // e.g. 10000 (10 seconds)
  maxRequests?: number; // e.g. 25 requests per window
}

/**
 * In-memory sliding window rate limiter
 * Protects telemetry endpoints against excessive request frequency or denial of service
 */
export function checkRateLimit(
  identifier: string,
  options: RateLimitOptions = {}
): { allowed: boolean; remaining: number; resetInMs: number } {
  const windowMs = options.windowMs ?? 10000;
  const maxRequests = options.maxRequests ?? 25; // allows 2.5 req/sec (ESP32 reports at ~1 req/sec)

  const now = Date.now();
  const entry = memoryStore.get(identifier);

  if (!entry || now > entry.resetAt) {
    memoryStore.set(identifier, {
      count: 1,
      resetAt: now + windowMs,
    });
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetInMs: windowMs,
    };
  }

  if (entry.count >= maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetInMs: Math.max(0, entry.resetAt - now),
    };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetInMs: Math.max(0, entry.resetAt - now),
  };
}

export function resetRateLimitStore(): void {
  memoryStore.clear();
}

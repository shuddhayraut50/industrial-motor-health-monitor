import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, resetRateLimitStore } from '../../src/lib/security/rate-limiter';

describe('Sliding-window Rate Limiter', () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it('allows requests within threshold', () => {
    const res1 = checkRateLimit('dev-001', { maxRequests: 3, windowMs: 1000 });
    expect(res1.allowed).toBe(true);
    expect(res1.remaining).toBe(2);

    const res2 = checkRateLimit('dev-001', { maxRequests: 3, windowMs: 1000 });
    expect(res2.allowed).toBe(true);
    expect(res2.remaining).toBe(1);

    const res3 = checkRateLimit('dev-001', { maxRequests: 3, windowMs: 1000 });
    expect(res3.allowed).toBe(true);
    expect(res3.remaining).toBe(0);
  });

  it('blocks requests exceeding threshold', () => {
    const opts = { maxRequests: 2, windowMs: 1000 };
    checkRateLimit('dev-002', opts);
    checkRateLimit('dev-002', opts);

    const blocked = checkRateLimit('dev-002', opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetInMs).toBeGreaterThan(0);
  });

  it('tracks distinct devices independently', () => {
    const opts = { maxRequests: 2, windowMs: 1000 };
    checkRateLimit('dev-A', opts);
    checkRateLimit('dev-A', opts);

    expect(checkRateLimit('dev-A', opts).allowed).toBe(false);
    expect(checkRateLimit('dev-B', opts).allowed).toBe(true);
  });
});

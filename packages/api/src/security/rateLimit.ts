import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Per-IP token-bucket rate limiting for the public demo (no dependency).
 *
 * Buckets are keyed by client IP (req.ip, which honours `trust proxy`, so behind
 * the demo's Caddy it is the real visitor address) and by tier:
 *   - stream:   /api/stream/proxy/* — HLS segments arrive in bursts, so the
 *               bucket is large, but sustained abuse is capped.
 *   - playback: /api/playback/* — each GET opens a media-server session.
 *   - api:      everything else.
 * Over the limit → 429 with Retry-After. Idle buckets are swept periodically.
 */

export interface Tier {
  /** Bucket size (burst). */
  capacity: number;
  /** Tokens added per second (sustained rate). */
  refillPerSec: number;
}

export const DEMO_TIERS: Record<'stream' | 'playback' | 'api', Tier> = {
  stream: { capacity: 600, refillPerSec: 20 },
  playback: { capacity: 20, refillPerSec: 0.5 },
  api: { capacity: 240, refillPerSec: 4 },
};

export function tierFor(path: string): keyof typeof DEMO_TIERS {
  const p = path.toLowerCase();
  if (p.startsWith('/api/stream/proxy')) return 'stream';
  if (p.startsWith('/api/playback')) return 'playback';
  return 'api';
}

interface Bucket {
  tokens: number;
  updatedMs: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private tiers: Record<string, Tier>, private now: () => number = Date.now) {}

  /** Take one token; returns 0 when allowed, else seconds until one is available. */
  take(key: string, tier: string): number {
    const t = this.tiers[tier];
    const now = this.now();
    const id = `${tier}|${key}`;
    const b = this.buckets.get(id) ?? { tokens: t.capacity, updatedMs: now };
    b.tokens = Math.min(t.capacity, b.tokens + ((now - b.updatedMs) / 1000) * t.refillPerSec);
    b.updatedMs = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      this.buckets.set(id, b);
      return 0;
    }
    this.buckets.set(id, b);
    return Math.ceil((1 - b.tokens) / t.refillPerSec);
  }

  /** Drop buckets that have refilled completely (idle visitors). */
  sweep(): void {
    const now = this.now();
    for (const [id, b] of this.buckets) {
      const tier = this.tiers[id.slice(0, id.indexOf('|'))];
      if (b.tokens + ((now - b.updatedMs) / 1000) * tier.refillPerSec >= tier.capacity) this.buckets.delete(id);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

const limiter = new RateLimiter(DEMO_TIERS);
setInterval(() => limiter.sweep(), 60_000).unref();

export const demoRateLimit: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const wait = limiter.take(req.ip || 'unknown', tierFor(req.path));
  if (wait === 0) return next();
  res.setHeader('Retry-After', String(wait));
  res.status(429).json({ success: false, error: 'Too many requests' });
};

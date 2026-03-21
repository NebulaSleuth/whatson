import NodeCache from 'node-cache';
import { DEFAULT_CACHE_TTL } from '@whatson/shared';

export const cache = new NodeCache({
  stdTTL: DEFAULT_CACHE_TTL / 1000, // node-cache uses seconds
  checkperiod: 60,
  useClones: false,
});

export function getCached<T>(key: string): T | undefined {
  return cache.get<T>(key);
}

export function setCached<T>(key: string, value: T, ttlSeconds?: number): void {
  if (ttlSeconds) {
    cache.set(key, value, ttlSeconds);
  } else {
    cache.set(key, value);
  }
}

export function invalidateCache(key: string): void {
  cache.del(key);
}

export function invalidateAll(): void {
  cache.flushAll();
}

import axios from 'axios';
import type { MediaServerKind } from './types.js';

/**
 * Per-server circuit breaker for library servers.
 *
 * When a Plex/Jellyfin/Emby server stops answering (VM firewall flipped to
 * Public, IP changed, host down), every home/library request used to wait out
 * the full axios timeout — 15–30s per call, several calls per home load. Now
 * the first unreachable-server error marks the server down,
 * getConfiguredAdapters() skips it, and a background probe brings it back as
 * soon as it answers again. The home screen just loses that server's shelves
 * instead of stalling.
 */

const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

interface ServerState {
  failures: number;
  retryAt: number;
  probing: boolean;
  lastError: string;
}

const down = new Map<MediaServerKind, ServerState>();

const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED', 'ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT',
  'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN',
]);

/** True for "couldn't reach the server" failures, as opposed to an HTTP error response */
export function isUnreachableError(err: unknown): boolean {
  return axios.isAxiosError(err) && !err.response && UNREACHABLE_CODES.has(err.code ?? '');
}

export function markServerDown(kind: MediaServerKind, reason: string): void {
  const prev = down.get(kind);
  const failures = (prev?.failures ?? 0) + 1;
  const cooldown = Math.min(BASE_COOLDOWN_MS * 2 ** (failures - 1), MAX_COOLDOWN_MS);
  down.set(kind, { failures, retryAt: Date.now() + cooldown, probing: false, lastError: reason });
  if (!prev) console.warn(`[Availability] ${kind} unreachable (${reason}) — skipping it until it answers again`);
}

export function markServerUp(kind: MediaServerKind): void {
  if (down.delete(kind)) console.log(`[Availability] ${kind} reachable again`);
}

/**
 * False while the server is marked down. Once its cooldown expires, kicks a
 * single background probe and keeps returning false until the probe succeeds,
 * so no user-facing request pays the timeout.
 */
export function isServerAvailable(kind: MediaServerKind, probe: () => Promise<boolean>): boolean {
  const state = down.get(kind);
  if (!state) return true;
  if (!state.probing && Date.now() >= state.retryAt) {
    state.probing = true;
    probe()
      .then((ok) => (ok ? markServerUp(kind) : markServerDown(kind, 'probe failed')))
      .catch((e) => markServerDown(kind, (e as Error).message));
  }
  return false;
}

/** Last error for a server currently marked down, or null if it's up */
export function getServerDownReason(kind: MediaServerKind): string | null {
  return down.get(kind)?.lastError ?? null;
}

/**
 * Axios response interceptor pair that feeds the breaker: any HTTP response
 * (even 4xx/5xx) proves the server is reachable; a connection-level failure
 * marks it down.
 */
export function trackAvailability(kind: MediaServerKind) {
  return [
    (res: any) => {
      markServerUp(kind);
      return res;
    },
    (err: unknown) => {
      if (isUnreachableError(err)) markServerDown(kind, (err as any).code);
      else if (axios.isAxiosError(err) && err.response) markServerUp(kind);
      return Promise.reject(err);
    },
  ] as const;
}

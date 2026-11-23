import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '../config.js';

/**
 * Read-only public demo (WHATSON_DEMO=1).
 *
 * The demo runs with no admin password so the apps connect without pairing,
 * which on its own would make every visitor an owner (apiAuth open mode,
 * requireOwner passes). This guard is the hard boundary instead: mounted ahead
 * of every /api router and /setup, it decides from method + path alone, so a
 * route added later is refused by default rather than accidentally exposed.
 *
 *   - Admin areas are closed for every method (including GET): service config
 *     and tokens, logs, debug, queue, updates, remote access, the download
 *     monitor, Sonarr/Radarr add, Plex cast/PIN, and all of /auth except the
 *     two status endpoints the apps read at boot.
 *   - Reads (GET/HEAD/OPTIONS) elsewhere pass.
 *   - The only write that passes is selecting a profile (needed to browse).
 *   - Playback progress/stop are answered with success and dropped, so the
 *     player works but no visitor changes resume points for everyone else.
 *   - Every other write is refused with 403 { demo: true }.
 *
 * Mount at '/api' (paths below are relative to it); `demoSetupGuard` covers
 * '/setup'. Both are no-ops unless config.demo is set.
 */

const CLOSED_PREFIXES = [
  '/config',
  '/logs',
  '/debug',
  '/queue',
  '/update',
  '/remote',
  '/download-monitor',
  '/sonarr',
  '/radarr',
  '/plex',
];

/** The only /auth reads an app needs at boot. Everything else under /auth is closed. */
const AUTH_READS = new Set(['/auth/providers', '/auth/admin-status']);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Writes that are acknowledged but never reach the media server. */
const DISCARDED_WRITES = new Set(['POST /playback/progress', 'POST /playback/stop']);

/** Writes that are genuinely allowed. */
const ALLOWED_WRITES: Array<[string, RegExp]> = [
  ['POST', /^\/whatson-users\/[^/]+\/select$/],
];

export type DemoDecision = 'allow' | 'discard' | 'deny';

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Pure decision function — exported for tests. `path` is relative to /api. */
export function demoDecision(method: string, rawPath: string): DemoDecision {
  const m = method.toUpperCase();
  // Normalise: collapse duplicate slashes and drop a trailing slash so
  // '/config/' or '//config' can't slip past the prefix checks.
  const path = (rawPath.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1') || '/').toLowerCase();

  if (CLOSED_PREFIXES.some((p) => underPrefix(path, p))) return 'deny';
  if (underPrefix(path, '/auth') && !(READ_METHODS.has(m) && AUTH_READS.has(path))) return 'deny';

  if (READ_METHODS.has(m)) return 'allow';
  if (DISCARDED_WRITES.has(`${m} ${path}`)) return 'discard';
  if (ALLOWED_WRITES.some(([wm, rx]) => wm === m && rx.test(path))) return 'allow';
  return 'deny';
}

const DENY_BODY = { success: false, demo: true, error: 'Read-only demo' };

export const demoGuard: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if (!config.demo) return next();
  const decision = demoDecision(req.method, req.path);
  if (decision === 'allow') return next();
  if (decision === 'discard') {
    res.json({ success: true });
    return;
  }
  res.status(403).json(DENY_BODY);
};

/** /setup (the admin UI) is closed entirely in demo mode. */
export const demoSetupGuard: RequestHandler = (_req: Request, res: Response, next: NextFunction) => {
  if (!config.demo) return next();
  res.status(403).json(DENY_BODY);
};

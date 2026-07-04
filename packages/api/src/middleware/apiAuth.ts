import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '../config.js';
import { verifyAuthKey } from '../services/pairing.js';
import { verifySessionCookie } from '../services/session.js';
import type { Surface } from '../server/surface.js';

/**
 * Per-device API auth, parameterised by network surface.
 *
 *  - LAN surface: gated on the admin password. No admin password → open mode
 *    (older-release behaviour, any LAN client works). Admin password set →
 *    every /api/* request needs a valid session cookie OR auth key, except the
 *    public allowlist.
 *  - Remote surface: auth is MANDATORY — never open mode, regardless of the
 *    admin password. (The remote listener also refuses to start without an
 *    admin password; this is belt-and-suspenders.) The public allowlist is
 *    narrower: the LAN 6-digit pair flow and admin-session endpoints are NOT
 *    public on the internet-facing surface — remote onboarding is the grant /
 *    device-code flow (M7). See docs/remote-access finding H2.
 *
 * On a successful key match the paired device (incl. its role) is attached as
 * `req.whatsonDevice`; a valid admin session sets `req.isAdminSession`. These
 * feed requireOwner (admin routes) and userContext (profile binding).
 *
 * Allowlist endpoints match on path SUFFIX since this runs after the `/api`
 * prefix is stripped.
 */

// Public on every surface — liveness + the client's provider-capability probe.
const PUBLIC_PATHS_COMMON = new Set<string>(['/health', '/auth/providers']);

// Public on the LAN surface only — admin-session flow, the 6-digit pair flow,
// and the update poller. None of these should be unauthenticated on the
// internet-facing remote surface.
const PUBLIC_PATHS_LAN_ONLY = new Set<string>([
  '/auth/login',
  '/auth/logout',
  '/auth/setup-admin',
  '/auth/admin-status',
  '/auth/pair/start',
  '/auth/pair/poll',
  '/update/status',
  '/update/check',
]);

/**
 * Path prefixes that are public. Same idea as the sets above but matches any
 * path starting with the prefix — used for endpoints that have dynamic
 * segments AND carry their own access token.
 *
 * `/live/hls/`: the URL embeds a hard-to-guess sessionId UUID that IS the
 * access token. HLS players (ExoPlayer in particular) don't forward query
 * strings from the playlist to the relative segment URLs, so we can't rely on
 * `?auth=KEY` for segment fetches. Same pattern Plex uses for its HLS sessions.
 */
const PUBLIC_PATH_PREFIXES: string[] = ['/live/hls/'];

function isPublic(path: string, surface: Surface): boolean {
  if (PUBLIC_PATHS_COMMON.has(path)) return true;
  if (surface === 'lan' && PUBLIC_PATHS_LAN_ONLY.has(path)) return true;
  return PUBLIC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Build the auth middleware for a surface. `apiAuth('lan')` preserves today's
 * opt-in behaviour; `apiAuth('remote')` is always-on.
 */
export function apiAuth(surface: Surface): RequestHandler {
  return async function apiAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
    // LAN open mode: no admin password → passthrough (unchanged behaviour).
    // The remote surface never enters open mode.
    if (surface === 'lan' && !config.auth.adminPasswordHash) {
      next();
      return;
    }

    if (isPublic(req.path, surface)) {
      next();
      return;
    }

    // Admin sessions (cookie from POST /api/auth/login) bypass the device-key
    // check — the /setup page calls /api/config/save, /api/auth/devices, etc.
    if (verifySessionCookie(req.headers.cookie)) {
      req.isAdminSession = true;
      next();
      return;
    }

    const headerVal = req.headers['x-whatson-auth'];
    let presented = Array.isArray(headerVal) ? headerVal[0] : headerVal;

    // Fallback: accept the key via the `auth` query parameter. Roku's Poster
    // node and (HLS) Video node fetch URLs through Roku's internal loaders,
    // which don't let us attach custom headers. Same key, different place.
    if (!presented) {
      const q = req.query.auth;
      presented = Array.isArray(q) ? String(q[0]) : typeof q === 'string' ? q : undefined;
    }

    if (!presented) {
      res
        .status(401)
        .json({ success: false, error: 'Authentication required. Sign in to /setup or pair this device.' });
      return;
    }
    const device = await verifyAuthKey(presented);
    if (!device) {
      res.status(401).json({ success: false, error: 'Invalid auth key. Re-pair this device via /setup.' });
      return;
    }
    // Stash the device (incl. role) for requireOwner + userContext binding.
    req.whatsonDevice = device;
    req.whatsonDeviceId = device.id;
    next();
  };
}

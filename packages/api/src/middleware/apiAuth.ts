import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { verifyAuthKey } from '../services/pairing.js';
import { verifySessionCookie } from '../services/session.js';

/**
 * Per-device API auth, gated on the admin password being set.
 *
 *  - No admin password configured → open mode. Backend behaves like
 *    older releases (any LAN client works without an auth key).
 *  - Admin password set → every /api/* request needs EITHER a valid
 *    session cookie (admin browsing /setup) OR a valid auth key
 *    (paired device), except the allowlist below: health checks and
 *    the auth flow itself need to work for unpaired clients to onboard.
 *
 * Allowlist endpoints are matched on path SUFFIX since this runs
 * after the `/api` prefix is stripped.
 */
const PUBLIC_PATHS = new Set<string>([
  '/health',
  '/auth/login',
  '/auth/logout',
  '/auth/setup-admin',
  '/auth/admin-status',
  '/auth/pair/start',
  '/auth/pair/poll',
  '/auth/providers',
  '/update/status',
  '/update/check',
]);

export async function apiAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!config.auth.adminPasswordHash) {
    next();
    return;
  }

  // Strip query strings; allow the prefix matching for endpoints like
  // /update/status (we don't want to allowlist /update/* wholesale).
  const path = req.path;
  if (PUBLIC_PATHS.has(path)) {
    next();
    return;
  }

  // Admin sessions (cookie set by POST /api/auth/login) bypass the
  // device-key check — the /setup page needs to call /api/config/save,
  // /api/auth/devices, etc. without holding a paired auth key.
  if (verifySessionCookie(req.headers.cookie)) {
    next();
    return;
  }

  const headerVal = req.headers['x-whatson-auth'];
  let presented = Array.isArray(headerVal) ? headerVal[0] : headerVal;

  // Fallback: accept the key via the `auth` query parameter. Roku's
  // Poster node and (HLS) Video node fetch URLs through Roku's
  // internal loaders, which don't let us attach custom headers.
  // Including the key in the URL is the only way those requests can
  // authenticate. Same key, just in a different place — verifyAuthKey
  // hashes it the same way.
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
  // Stash on the request so handlers can log which device made a call.
  (req as Request & { whatsonDeviceId?: string }).whatsonDeviceId = device.id;
  next();
}

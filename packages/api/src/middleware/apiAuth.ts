import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { verifyAuthKey } from '../services/pairing.js';

/**
 * Per-device API auth via the `X-Whatson-Auth` header.
 *
 * Enforcement is gated on the admin password being set:
 *  - No admin password configured → open mode. Backend behaves like
 *    older releases (any LAN client works without an auth key).
 *  - Admin password set → every /api/* request needs a valid auth
 *    key, except the allowlist below: health checks and the auth
 *    flow itself need to work for unpaired clients to onboard.
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

  const headerVal = req.headers['x-whatson-auth'];
  const presented = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (!presented) {
    res.status(401).json({ success: false, error: 'Missing X-Whatson-Auth header. Pair this device via /setup.' });
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

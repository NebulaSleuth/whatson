import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '../config.js';
import type { Surface } from '../server/surface.js';

/**
 * Guard admin-only routers (doc 01 Item 3). Passes when:
 *   - auth is not active on this surface (LAN with no admin password → today's
 *     open behaviour, so existing installs are unaffected), OR
 *   - the request carries a valid admin session, OR
 *   - the authenticating device is an owner.
 * Guest devices — and, in enforced mode, anything without owner/session — 403.
 *
 * apiAuth runs first, so an enforced-mode request reaching requireOwner has
 * already been authenticated (session or valid device key); this only refines
 * that to owner level. It's belt-and-suspenders alongside the two-listener
 * split (admin routers aren't mounted on the remote surface at all).
 */
export function requireOwner(surface: Surface): RequestHandler {
  return function requireOwnerMiddleware(req: Request, res: Response, next: NextFunction): void {
    const authActive = surface === 'remote' || !!config.auth.adminPasswordHash;
    if (!authActive) {
      next();
      return;
    }
    if (req.isAdminSession || req.whatsonDevice?.role === 'owner') {
      next();
      return;
    }
    res.status(403).json({ success: false, error: 'Owner privileges required.' });
  };
}

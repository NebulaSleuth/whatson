import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { verifySessionCookie } from '../services/session.js';

/**
 * Gate the /setup admin UI write endpoints (config save, pair complete,
 * device revoke, etc.) behind the admin password session cookie.
 *
 * If no admin password is set in .env, security is "off" — these
 * endpoints stay open so initial setup can run without anyone being
 * locked out. Once `ADMIN_PASSWORD_HASH` is populated, the cookie
 * check kicks in.
 */
export function sessionAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.auth.adminPasswordHash) {
    next();
    return;
  }
  const cookie = req.headers.cookie;
  if (!verifySessionCookie(cookie)) {
    res.status(401).json({ success: false, error: 'Admin login required' });
    return;
  }
  next();
}

import type { Request, Response, NextFunction } from 'express';
import { getUserToken } from '../services/users.js';
import { setRequestUserId } from '../services/tracked.js';

// Extend Express Request to carry user context
declare global {
  namespace Express {
    interface Request {
      plexUserToken?: string;
      plexUserId?: string;
    }
  }
}

/**
 * Middleware that extracts the X-Plex-User header and sets up
 * per-user context for Plex API calls and tracked item storage.
 */
export function userContext(req: Request, _res: Response, next: NextFunction): void {
  const userIdHeader = req.headers['x-plex-user'];
  const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;

  if (userId) {
    req.plexUserId = userId;

    // Set per-user tracked items storage
    setRequestUserId(userId);

    // Look up per-user Plex token
    const token = getUserToken(parseInt(userId, 10));
    if (token) {
      req.plexUserToken = token;
    }

    // Clean up tracked items scope after request
    _res.on('finish', () => setRequestUserId(null));
  }

  next();
}

/** Helper to get user token from request */
export function getReqUserToken(req: Request): string | undefined {
  return req.plexUserToken;
}

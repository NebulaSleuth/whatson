import type { Request, Response, NextFunction } from 'express';
import { getUserToken } from '../services/users.js';
import { setRequestUserId } from '../services/tracked.js';
import { getDiscoveredConnections } from '../services/plex.js';

// Extend Express Request to carry user context
declare global {
  namespace Express {
    interface Request {
      plexUserToken?: string;
      plexUserId?: string;
      plexConnectionType?: 'local' | 'remote';
    }
  }
}

/**
 * Middleware that extracts the X-Plex-User header and sets up
 * per-user context for Plex API calls and tracked item storage.
 * Also handles X-Plex-Connection header for remote clients.
 */
export function userContext(req: Request, _res: Response, next: NextFunction): void {
  const userIdHeader = req.headers['x-plex-user'];
  const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;

  if (userId) {
    req.plexUserId = userId;
    setRequestUserId(userId);

    const token = getUserToken(parseInt(userId, 10));
    if (token) {
      req.plexUserToken = token;
    }

    _res.on('finish', () => setRequestUserId(null));
  }

  // Handle connection type — remote clients get remote Plex URLs
  const connHeader = req.headers['x-plex-connection'];
  const connType = (Array.isArray(connHeader) ? connHeader[0] : connHeader) as 'local' | 'remote' | undefined;
  req.plexConnectionType = connType === 'remote' ? 'remote' : 'local';

  next();
}

/** Helper to get user token from request */
export function getReqUserToken(req: Request): string | undefined {
  return req.plexUserToken;
}

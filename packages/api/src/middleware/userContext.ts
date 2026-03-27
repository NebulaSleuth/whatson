import type { Request, Response, NextFunction } from 'express';
import { getUserToken } from '../services/users.js';
import { setRequestToken } from '../services/plex.js';
import { setRequestUserId } from '../services/tracked.js';

/**
 * Middleware that extracts the X-Plex-User header and sets up
 * per-user context for Plex API calls and tracked item storage.
 */
export function userContext(req: Request, _res: Response, next: NextFunction): void {
  const userIdHeader = req.headers['x-plex-user'];
  const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;

  if (userId) {
    // Set per-user tracked items storage
    setRequestUserId(userId);

    // Set per-user Plex token if available
    const token = getUserToken(parseInt(userId, 10));
    if (token) {
      setRequestToken(token);
    }
  } else {
    // No user specified — use defaults
    setRequestUserId(null);
    setRequestToken(null);
  }

  // Clean up after request completes
  _res.on('finish', () => {
    setRequestUserId(null);
    setRequestToken(null);
  });

  next();
}

import type { Request, Response, NextFunction } from 'express';
import { getUserToken } from '../services/users.js';
import { setRequestUserId } from '../services/tracked.js';
import { setActiveUserScope } from '../services/adapters/registry.js';
import * as wo from '../services/whatsonUsers.js';

/**
 * Per-request user context.
 *
 * Two modes:
 *
 * 1. Whats On Users feature ON. Client sends `X-Whatson-User: wo-xxx`.
 *    Middleware looks up the WO user, attaches it to req, derives the
 *    Plex token from `user.plexUserId` (via the existing per-user
 *    token cache), and scopes tracked.ts storage under the WO id.
 *    The Jellyfin/Emby IDs travel on req for downstream adapters.
 *
 * 2. Legacy mode (default). Client sends `X-Plex-User: <plexId>`.
 *    Behaviour is unchanged — Plex per-user token + per-Plex-user
 *    tracked dir. Jellyfin/Emby use the configured admin session.
 */
declare global {
  namespace Express {
    interface Request {
      plexUserToken?: string;
      plexUserId?: string;
      plexConnectionType?: 'local' | 'remote';
      whatsonUser?: {
        id: string;
        name: string;
        plexUserId: number | null;
        jellyfinUserId: string | null;
        embyUserId: string | null;
      };
    }
  }
}

export function userContext(req: Request, res: Response, next: NextFunction): void {
  const woIdHeader = req.headers['x-whatson-user'];
  const woId = Array.isArray(woIdHeader) ? woIdHeader[0] : woIdHeader;
  if (woId && wo.isEnabled()) {
    const user = wo.findById(woId);
    if (user) {
      req.whatsonUser = {
        id: user.id,
        name: user.name,
        plexUserId: user.plexUserId,
        jellyfinUserId: user.jellyfinUserId,
        embyUserId: user.embyUserId,
      };
      // Per-user watched state lives under the WO id, not the Plex id.
      // Same code path the legacy mode uses — tracked.ts just needs a
      // stable string id.
      setRequestUserId(user.id);
      // Aggregator + routes that iterate getConfiguredAdapters() will
      // now see only the adapters this WO user is mapped to.
      setActiveUserScope({
        plexUserId: user.plexUserId,
        jellyfinUserId: user.jellyfinUserId,
        embyUserId: user.embyUserId,
      });
      // Populate Plex per-user token if the mapping exists. The token
      // was warmed by POST /whatson-users/:id/select; if the cache is
      // cold (e.g. backend restart since selection), Plex calls will
      // transparently fall back to the admin token. selectUser() will
      // re-warm on the next /select call.
      if (user.plexUserId !== null) {
        req.plexUserId = String(user.plexUserId);
        const token = getUserToken(user.plexUserId);
        if (token) req.plexUserToken = token;
      }
      res.on('finish', () => {
        setRequestUserId(null);
        setActiveUserScope(null);
      });
      // Connection type still meaningful for Plex remote-relay picks.
      const connHeader = req.headers['x-plex-connection'];
      const connType = (Array.isArray(connHeader) ? connHeader[0] : connHeader) as 'local' | 'remote' | undefined;
      req.plexConnectionType = connType === 'remote' ? 'remote' : 'local';
      next();
      return;
    }
  }

  // Legacy mode — X-Plex-User header, today's behaviour.
  const userIdHeader = req.headers['x-plex-user'];
  const userId = Array.isArray(userIdHeader) ? userIdHeader[0] : userIdHeader;

  if (userId) {
    req.plexUserId = userId;
    setRequestUserId(userId);

    const token = getUserToken(parseInt(userId, 10));
    if (token) {
      req.plexUserToken = token;
    }

    res.on('finish', () => setRequestUserId(null));
  }

  const connHeader = req.headers['x-plex-connection'];
  const connType = (Array.isArray(connHeader) ? connHeader[0] : connHeader) as 'local' | 'remote' | undefined;
  req.plexConnectionType = connType === 'remote' ? 'remote' : 'local';

  next();
}

/** Helper to get user token from request */
export function getReqUserToken(req: Request): string | undefined {
  return req.plexUserToken;
}

import type { Request, Response, NextFunction } from 'express';
import { getUserToken, seedUserToken } from '../services/users.js';
import { setRequestUserId } from '../services/tracked.js';
import { setActiveUserScope } from '../services/adapters/registry.js';
import * as wo from '../services/whatsonUsers.js';
import { config } from '../config.js';
import type { PairedDevice } from '../services/pairing.js';

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
      /** Paired device that authenticated this request (set by apiAuth). */
      whatsonDevice?: PairedDevice;
      /** Id of that device, for logging. */
      whatsonDeviceId?: string;
      /** True when a valid admin session cookie authenticated the request. */
      isAdminSession?: boolean;
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

  // Unified user model: a device (owner or guest) is not bound to a Whats On user.
  // Which user you watch as comes from the shared "Who's Watching?" picker via
  // X-Whatson-User, and PIN-protected users are gated by a session token below.
  if (woId && wo.isEnabled()) {
    const user = wo.findById(woId);
    if (user) {
      // PIN gate (unified user model). A PIN-protected user requires a valid
      // per-user session token (minted at /select) — otherwise X-Whatson-User is
      // client-asserted with no proof, which matters under the fully-shared
      // picker. Soft by default (log); WHATSON_STRICT_PIN → hard 401.
      if (user.pinHash) {
        const sh = req.headers['x-whatson-session'];
        const sess = Array.isArray(sh) ? sh[0] : sh;
        if (!wo.verifySessionToken(sess, user.id)) {
          if (config.auth.strictPin) {
            res.status(401).json({ success: false, error: 'This profile requires its PIN.' });
            return;
          }
          console.warn(`[userContext] PIN-protected WO user ${user.id} accessed without a valid session token (soft mode)`);
        }
      }
      // Mapped subsystem ids (read through accessors — storage is nested now).
      const pid = wo.plexUserIdOf(user);
      const jid = wo.jellyfinUserIdOf(user);
      const eid = wo.embyUserIdOf(user);
      req.whatsonUser = {
        id: user.id,
        name: user.name,
        plexUserId: pid,
        jellyfinUserId: jid,
        embyUserId: eid,
      };
      // Per-user watched state lives under the WO id, not the Plex id.
      // Same code path the legacy mode uses — tracked.ts just needs a
      // stable string id.
      setRequestUserId(user.id);
      // Aggregator + routes that iterate getConfiguredAdapters() see only the
      // subsystems this user is mapped to. Unmapped = no content (unified user
      // model §11 #1 — the old "inherit default" mode is retired).
      setActiveUserScope({ plexUserId: pid, jellyfinUserId: jid, embyUserId: eid });
      // Populate the Plex per-user token. The cache is in-memory only, so after
      // every backend restart the first request for a given WO user will miss it
      // — seed from the stored (encrypted) per-user token so the very first
      // request after restart still gets the right per-user identity.
      if (pid !== null) {
        req.plexUserId = String(pid);
        let token = getUserToken(pid);
        const stored = wo.plexTokenOf(user);
        if (!token && stored) {
          seedUserToken(pid, stored);
          token = stored;
        }
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

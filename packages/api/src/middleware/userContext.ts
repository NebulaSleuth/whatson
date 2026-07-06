import type { Request, Response, NextFunction } from 'express';
import { getUserToken, seedUserToken } from '../services/users.js';
import { setRequestUserId } from '../services/tracked.js';
import { setActiveUserScope } from '../services/adapters/registry.js';
import * as wo from '../services/whatsonUsers.js';
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
  let woId = Array.isArray(woIdHeader) ? woIdHeader[0] : woIdHeader;

  // Profile binding (doc 01 Item 4 + M7 guest modes). A guest device's access to
  // WO profiles depends on how it was invited — X-Whatson-User is otherwise
  // client-asserted with no proof. Owners (and open-mode LAN requests with no
  // device) are unrestricted, so this is a no-op for existing installs.
  const device = req.whatsonDevice;
  if (device?.role === 'guest') {
    const binding = device.guestBinding ?? 'locked';
    if (binding === 'open') {
      // Open-mode guest (M7): not confined. They pick which WO user to watch as
      // each session, like the household — leave the client-asserted woId (which
      // may be absent until they pick). No profile lock.
    } else {
      // 'locked' / 'locked-new': confined to the single bound profile.
      const bound = device.boundWoProfileId;
      if (!bound) {
        // A confined guest with no bound profile can't act as anyone yet. A
        // 'locked-new' guest is allowed to reach ONLY the create-profile
        // endpoint (to make its viewer, then it's bound); everything else 403s.
        const path = (req.originalUrl || req.path || '').split('?')[0];
        const isCreateProfile =
          binding === 'locked-new' && path.endsWith('/whatson-users/guest-profile');
        if (!isCreateProfile) {
          res.status(403).json({ success: false, error: 'This device is not bound to a profile.' });
          return;
        }
        // Fall through with no woId — the create endpoint reads req.whatsonDevice.
      } else {
        if (woId && woId !== bound) {
          res.status(403).json({ success: false, error: 'This device may not act as that profile.' });
          return;
        }
        woId = bound; // default a guest to its bound profile when none is requested
      }
    }
  }

  if (woId && wo.isEnabled()) {
    const user = wo.findById(woId);
    if (user) {
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
      // adapters this WO user is mapped to. A user with NO service mappings
      // inherits the server's default content — scope null = every configured
      // adapter — while still getting its own watched state (keyed above).
      const hasAnyMapping = pid !== null || jid !== null || eid !== null;
      setActiveUserScope(hasAnyMapping ? { plexUserId: pid, jellyfinUserId: jid, embyUserId: eid } : null);
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

import * as wo from './whatsonUsers.js';
import * as plexUsers from './users.js';
import * as su from './subsystemUsers.js';
import { config } from '../config.js';

/**
 * Unified user model — always-on bootstrap. Whats On Users is always on (there is
 * no separate identity layer), so a configured server must always have at least
 * one user. When there are zero, create a default `admin` user mapped to the
 * server's own identities — the Plex account owner (its Home admin user + token)
 * and the Jellyfin/Emby admin — so the owner keeps full access and the same
 * content they saw before, just now as a Whats On user.
 *
 * Runs once at startup, before requests. Best-effort: if no subsystem identity
 * can be resolved we create nothing and the app falls back to legacy Plex mode
 * (`isEnabled()` is false while there are zero users) rather than an empty picker.
 */
export async function ensureDefaultAdmin(): Promise<void> {
  if (wo.listAll().length > 0) return;

  let name = 'Owner';
  let plexUserId: number | null = null;
  let plexUserToken: string | null = null;
  let jellyfinUserId: string | null = null;
  let embyUserId: string | null = null;

  if (config.plex.token) {
    try {
      const users = await plexUsers.listUsers();
      const owner = users.find((u) => u.admin) ?? users[0];
      if (owner) {
        plexUserId = owner.id;
        name = owner.title || name;
        plexUserToken = plexUsers.getAdminToken() || null;
      }
    } catch (e) {
      console.warn('[bootstrap] could not resolve Plex owner:', (e as Error).message);
    }
  }

  for (const kind of ['jellyfin', 'emby'] as const) {
    if (!su.isConfigured(kind)) continue;
    try {
      const s = await su.adminSession(kind);
      if (kind === 'jellyfin') jellyfinUserId = s.userId || null;
      else embyUserId = s.userId || null;
    } catch (e) {
      console.warn(`[bootstrap] could not resolve ${kind} admin:`, (e as Error).message);
    }
  }

  if (plexUserId === null && !jellyfinUserId && !embyUserId) {
    console.log('[bootstrap] no media-server identity to map — leaving Whats On Users off (legacy mode) until a user is created.');
    return;
  }

  const admin = wo.create({
    name,
    avatar: 'default',
    role: 'admin',
    plexUserId,
    plexUserToken,
    jellyfinUserId,
    embyUserId,
  });
  console.log(`[bootstrap] created default admin Whats On user "${admin.name}" (${admin.id}).`);
}

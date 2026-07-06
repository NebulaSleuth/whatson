import { Router } from 'express';
import * as wo from '../services/whatsonUsers.js';
import * as plexUsers from '../services/users.js';
import { listAvatars, getAvatar, getAvatarPng } from '../services/avatars.js';
import { bindDeviceProfile } from '../services/pairing.js';
import * as su from '../services/subsystemUsers.js';
import { jellyfinAdapter } from '../services/adapters/jellyfin.js';
import { embyAdapter } from '../services/adapters/emby.js';
import * as jellyfin from '../services/jellyfin.js';
import * as emby from '../services/emby.js';

export const whatsonUsersRouter = Router();

whatsonUsersRouter.get('/whatson-users/config', (_req, res) => {
  res.json({ success: true, data: { enabled: wo.isEnabled(), guestMode: wo.getGuestMode() } });
});

whatsonUsersRouter.post('/whatson-users/config', (req, res) => {
  const { enabled, guestMode } = req.body || {};
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ success: false, error: 'enabled must be a boolean' });
      return;
    }
    wo.setEnabled(enabled);
  }
  if (guestMode !== undefined) {
    if (guestMode !== 'open' && guestMode !== 'closed') {
      res.status(400).json({ success: false, error: "guestMode must be 'open' or 'closed'" });
      return;
    }
    wo.setGuestMode(guestMode);
  }
  res.json({ success: true, data: { enabled: wo.isEnabled(), guestMode: wo.getGuestMode() } });
});

whatsonUsersRouter.get('/whatson-users/avatars', (_req, res) => {
  res.json({ success: true, data: listAvatars() });
});

whatsonUsersRouter.get('/whatson-users/avatars/:file', (req, res) => {
  const svgMatch = /^([a-z0-9-]+)\.svg$/i.exec(req.params.file);
  if (svgMatch) {
    const a = getAvatar(svgMatch[1]);
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(a.svg);
    return;
  }
  const pngMatch = /^([a-z0-9-]+)\.png$/i.exec(req.params.file);
  if (pngMatch) {
    const buf = getAvatarPng(pngMatch[1]);
    if (!buf) { res.status(404).end(); return; }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buf);
    return;
  }
  res.status(400).end();
});

whatsonUsersRouter.get('/whatson-users', (_req, res) => {
  const users = wo.listAll().map(wo.toPublic);
  res.json({ success: true, data: users });
});

/**
 * Guest self-service viewer creation (M7 Phase 4b). A guest device whose invite
 * said "new viewer" (binding 'locked-new') or an open-mode guest adding a viewer
 * creates a Whats On user here — name + avatar only, no service mapping, so it
 * inherits the server's default content with its own watched state (userContext
 * treats an unmapped WO user as "inherit default"). For a 'locked-new' device we
 * then bind the device to the new viewer so it's confined to it going forward.
 *
 * Guest-reachable: userContext allowlists this exact path for a bound-less
 * 'locked-new' guest; owners use the admin create route instead.
 */
whatsonUsersRouter.post('/whatson-users/guest-profile', async (req, res) => {
  const device = req.whatsonDevice;
  if (!device || device.role !== 'guest') {
    res.status(403).json({ success: false, error: 'Only a guest device can create its own viewer.' });
    return;
  }
  if (!wo.isEnabled()) {
    res.status(400).json({ success: false, error: 'Whats On Users is not enabled on this server.' });
    return;
  }
  const name = String(req.body?.name ?? '').trim();
  if (!name) {
    res.status(400).json({ success: false, error: 'A name is required.' });
    return;
  }
  // Fall back to the default avatar if the key isn't in the catalog.
  const requested = String(req.body?.avatar ?? '').trim();
  const avatar = getAvatar(requested).key;

  const user = wo.create({ name, avatar });
  // A 'locked-new' guest gets locked to the viewer it just made; an 'open' guest
  // stays free to pick any viewer (this one now among them).
  if (device.guestBinding === 'locked-new') {
    await bindDeviceProfile(device.id, user.id);
  }
  res.json({ success: true, data: wo.toPublic(user) });
});

/**
 * Derive a server-specific Plex token for a Home user. Returns the
 * token on success, or throws with a user-friendly message. Called
 * synchronously by the create/update routes when the admin provides
 * a plexPin (or selects a Plex Home user that doesn't require one).
 */
async function derivePlexToken(plexUserId: number, plexPin: string | undefined): Promise<string> {
  try {
    return await plexUsers.selectUser(plexUserId, plexPin);
  } catch (e) {
    const msg = (e as Error).message || '';
    if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
      throw new Error('Incorrect Plex PIN for that Home user.');
    }
    throw new Error('Failed to derive Plex token: ' + msg);
  }
}

whatsonUsersRouter.post('/whatson-users', async (req, res) => {
  try {
    const body = req.body || {};
    const plexPin: string | undefined = body.plexPin;
    delete body.plexPin;
    const name = String(body.name ?? '').trim();
    // If a Plex mapping was supplied, derive the per-user token now so
    // we don't depend on the in-memory cache (which is empty after every
    // backend restart). If derivation fails — wrong PIN, Plex not
    // configured — surface the error before the user is persisted.
    if (body.plexUserId != null) {
      body.plexUserToken = await derivePlexToken(Number(body.plexUserId), plexPin);
    } else {
      body.plexUserToken = null;
    }

    // PROVISION new Jellyfin/Emby users when requested (jellyfinCreate/embyCreate),
    // with the chosen library set. Managed users are created with a generated
    // password and an encrypted token; the person never needs that password.
    const libs = (body.libraries as { jellyfin?: string[]; emby?: string[] }) || {};
    const explicit: Record<string, { userId: string; token: string; managed: boolean }> = {};
    for (const kind of ['jellyfin', 'emby'] as const) {
      const wantCreate = kind === 'jellyfin' ? body.jellyfinCreate : body.embyCreate;
      if (!wantCreate) continue;
      if (!su.isConfigured(kind)) throw new Error(`${kind} is not configured on this server.`);
      if (!name) throw new Error('A name is required to create a subsystem user.');
      const prov = await su.provisionUser(kind, name, libs[kind] ?? null);
      explicit[kind] = { userId: prov.userId, token: prov.encToken, managed: true };
      // Don't also treat any supplied flat id as a map-existing for this subsystem.
      if (kind === 'jellyfin') delete body.jellyfinUserId;
      else delete body.embyUserId;
    }
    if (Object.keys(explicit).length) body.mappings = explicit;
    delete body.jellyfinCreate;
    delete body.embyCreate;

    const created = wo.create(body);
    res.json({ success: true, data: wo.toPublic(created) });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

whatsonUsersRouter.patch('/whatson-users/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const plexPin: string | undefined = body.plexPin;
    delete body.plexPin;
    // Token derivation policy on PATCH:
    //   - Mapping unchanged + no PIN supplied → leave plexUserToken alone
    //     (avoids forcing the admin to re-enter a PIN just to rename).
    //   - Mapping changed to null → clear token.
    //   - Mapping changed to a different user → derive fresh token.
    //   - Same mapping but admin supplied a new PIN → refresh token.
    const existing = wo.findById(req.params.id);
    const existingPid = existing ? wo.plexUserIdOf(existing) : null;
    if (existing && body.plexUserId !== undefined) {
      const newId = body.plexUserId === null ? null : Number(body.plexUserId);
      const mappingChanged = newId !== existingPid;
      if (newId === null) {
        body.plexUserToken = null;
      } else if (mappingChanged) {
        body.plexUserToken = await derivePlexToken(newId, plexPin);
      } else if (plexPin) {
        // Same mapping, refreshing PIN.
        body.plexUserToken = await derivePlexToken(newId, plexPin);
      } else {
        // Same mapping, no PIN. Don't touch the stored token.
        delete body.plexUserToken;
      }
    } else if (existing && plexPin && existingPid != null) {
      body.plexUserToken = await derivePlexToken(existingPid, plexPin);
    }
    const updated = wo.update(req.params.id, body);
    if (!updated) { res.status(404).json({ success: false, error: 'user not found' }); return; }
    res.json({ success: true, data: wo.toPublic(updated) });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

whatsonUsersRouter.delete('/whatson-users/:id', async (req, res) => {
  const user = wo.findById(req.params.id);
  if (!user) { res.status(404).json({ success: false, error: 'user not found' }); return; }
  // Delete the subsystem users Whats On CREATED (managed) so we don't orphan
  // them; never touch mapped-existing users (managed=false) or Plex Home users.
  for (const kind of ['jellyfin', 'emby'] as const) {
    const m = user.mappings[kind];
    if (m?.managed && su.isConfigured(kind)) {
      try {
        const s = await su.adminSession(kind);
        await su.deleteUser(s, m.userId);
      } catch (e) {
        console.warn(`[wo] could not delete managed ${kind} user ${m.userId}:`, (e as Error).message);
      }
    }
  }
  wo.remove(req.params.id);
  res.json({ success: true });
});

whatsonUsersRouter.post('/whatson-users/:id/select', async (req, res) => {
  const user = wo.findById(req.params.id);
  if (!user) { res.status(404).json({ success: false, error: 'user not found' }); return; }
  if (!wo.verifyPin(user, req.body?.pin)) {
    res.status(401).json({ success: false, error: 'Incorrect PIN' });
    return;
  }
  // Seed the in-memory Plex per-user token cache so subsequent /api/*
  // calls with X-Whatson-User=<id> resolve instantly. Prefer the stored
  // token (set at mapping time and persists across backend restarts);
  // fall back to a fresh switch only for non-PIN-protected users.
  const pid = wo.plexUserIdOf(user);
  if (pid !== null) {
    const stored = wo.plexTokenOf(user);
    if (stored) {
      plexUsers.seedUserToken(pid, stored);
    } else {
      try { await plexUsers.selectUser(pid); }
      catch (e) { console.warn('[wo] plex token warm-up failed:', (e as Error).message); }
    }
  }
  // Mint a per-user session token proving the PIN was entered this session. The
  // client sends it back as X-Whatson-Session so PIN-protected users can't be
  // acted-as by merely asserting X-Whatson-User (userContext verifies it).
  res.json({ success: true, data: { ...wo.toPublic(user), sessionToken: wo.mintSessionToken(user.id) } });
});

whatsonUsersRouter.get('/whatson-users/source/plex', async (_req, res) => {
  try {
    const list = await plexUsers.listUsers();
    res.json({
      success: true,
      data: list.map((u) => ({
        id: u.id,
        title: u.title,
        thumb: u.thumb,
        admin: u.admin,
        // Whether this Home user has a PIN. Drives whether the admin
        // UI prompts for a Plex PIN when mapping.
        hasPassword: u.hasPassword,
      })),
    });
  } catch (e) {
    res.json({ success: true, data: [], error: (e as Error).message });
  }
});

whatsonUsersRouter.get('/whatson-users/source/jellyfin', async (_req, res) => {
  if (!jellyfinAdapter.isConfigured()) { res.json({ success: true, data: [] }); return; }
  try {
    const list = await jellyfin.listAllServerUsers();
    res.json({ success: true, data: list });
  } catch (e) {
    res.json({ success: true, data: [], error: (e as Error).message });
  }
});

whatsonUsersRouter.get('/whatson-users/source/emby', async (_req, res) => {
  if (!embyAdapter.isConfigured()) { res.json({ success: true, data: [] }); return; }
  try {
    const list = await emby.listAllServerUsers();
    res.json({ success: true, data: list });
  } catch (e) {
    res.json({ success: true, data: [], error: (e as Error).message });
  }
});

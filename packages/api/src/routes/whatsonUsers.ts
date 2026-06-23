import { Router } from 'express';
import * as wo from '../services/whatsonUsers.js';
import * as plexUsers from '../services/users.js';
import { listAvatars, getAvatar } from '../services/avatars.js';
import { jellyfinAdapter } from '../services/adapters/jellyfin.js';
import { embyAdapter } from '../services/adapters/emby.js';
import * as jellyfin from '../services/jellyfin.js';
import * as emby from '../services/emby.js';

export const whatsonUsersRouter = Router();

whatsonUsersRouter.get('/whatson-users/config', (_req, res) => {
  res.json({ success: true, data: { enabled: wo.isEnabled() } });
});

whatsonUsersRouter.post('/whatson-users/config', (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ success: false, error: 'enabled must be a boolean' });
    return;
  }
  wo.setEnabled(enabled);
  res.json({ success: true, data: { enabled } });
});

whatsonUsersRouter.get('/whatson-users/avatars', (_req, res) => {
  res.json({ success: true, data: listAvatars() });
});

whatsonUsersRouter.get('/whatson-users/avatars/:file', (req, res) => {
  const m = /^([a-z0-9-]+)\.svg$/i.exec(req.params.file);
  if (!m) { res.status(400).end(); return; }
  const a = getAvatar(m[1]);
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(a.svg);
});

whatsonUsersRouter.get('/whatson-users', (_req, res) => {
  const users = wo.listAll().map(wo.toPublic);
  res.json({ success: true, data: users });
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
    // If a Plex mapping was supplied, derive the per-user token now so
    // we don't depend on the in-memory cache (which is empty after every
    // backend restart). If derivation fails — wrong PIN, Plex not
    // configured — surface the error before the user is persisted.
    if (body.plexUserId != null) {
      body.plexUserToken = await derivePlexToken(Number(body.plexUserId), plexPin);
    } else {
      body.plexUserToken = null;
    }
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
    if (existing && body.plexUserId !== undefined) {
      const newId = body.plexUserId === null ? null : Number(body.plexUserId);
      const mappingChanged = newId !== existing.plexUserId;
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
    } else if (existing && plexPin && existing.plexUserId != null) {
      body.plexUserToken = await derivePlexToken(existing.plexUserId, plexPin);
    }
    const updated = wo.update(req.params.id, body);
    if (!updated) { res.status(404).json({ success: false, error: 'user not found' }); return; }
    res.json({ success: true, data: wo.toPublic(updated) });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

whatsonUsersRouter.delete('/whatson-users/:id', (req, res) => {
  const ok = wo.remove(req.params.id);
  if (!ok) { res.status(404).json({ success: false, error: 'user not found' }); return; }
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
  if (user.plexUserId !== null) {
    if (user.plexUserToken) {
      plexUsers.seedUserToken(user.plexUserId, user.plexUserToken);
    } else {
      try { await plexUsers.selectUser(user.plexUserId); }
      catch (e) { console.warn('[wo] plex token warm-up failed:', (e as Error).message); }
    }
  }
  res.json({ success: true, data: wo.toPublic(user) });
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

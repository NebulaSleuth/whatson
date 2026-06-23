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

whatsonUsersRouter.post('/whatson-users', (req, res) => {
  try {
    const created = wo.create(req.body || {});
    res.json({ success: true, data: wo.toPublic(created) });
  } catch (e) {
    res.status(400).json({ success: false, error: (e as Error).message });
  }
});

whatsonUsersRouter.patch('/whatson-users/:id', (req, res) => {
  try {
    const updated = wo.update(req.params.id, req.body || {});
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
  if (user.plexUserId !== null) {
    try { await plexUsers.selectUser(user.plexUserId); }
    catch (e) { console.warn('[wo] plex token warm-up failed:', (e as Error).message); }
  }
  res.json({ success: true, data: wo.toPublic(user) });
});

whatsonUsersRouter.get('/whatson-users/source/plex', async (_req, res) => {
  try {
    const list = await plexUsers.listUsers();
    res.json({
      success: true,
      data: list.map((u) => ({ id: u.id, title: u.title, thumb: u.thumb, admin: u.admin })),
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

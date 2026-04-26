import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { ApiResponse } from '@whatson/shared';
import { config, saveConfigToEnv, reloadConfig } from '../config.js';
import { issueSessionCookie, clearSessionCookie } from '../services/session.js';
import { sessionAuth } from '../middleware/sessionAuth.js';
import {
  startPair,
  pollPair,
  completePair,
  getPendingPair,
  listPairedDevices,
  revokeDevice,
} from '../services/pairing.js';

export const authRouter = Router();

// ── Provider status (existing — kept) ────────────────────────────

authRouter.get('/auth/providers', (_req, res) => {
  const data = {
    plex: Boolean(config.plex.token),
    jellyfin: Boolean(config.jellyfin.url && config.jellyfin.username),
    emby: Boolean(config.emby.url && config.emby.username),
    sonarr: Boolean(config.sonarr.url && config.sonarr.apiKey),
    radarr: Boolean(config.radarr.url && config.radarr.apiKey),
  };
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

// ── Admin password / session ─────────────────────────────────────

/**
 * Tell the /setup UI which screen to render. Open during first run
 * so the UI can decide between "create admin password" vs "login".
 */
authRouter.get('/auth/admin-status', (_req, res) => {
  res.json({
    success: true,
    data: {
      hasAdminPassword: Boolean(config.auth.adminPasswordHash),
    },
  });
});

/**
 * First-run admin setup. Only allowed when no admin password is set
 * yet — otherwise rejected so an attacker can't overwrite an existing
 * password without proving they know it.
 */
authRouter.post('/auth/setup-admin', async (req, res) => {
  if (config.auth.adminPasswordHash) {
    res.status(403).json({ success: false, error: 'Admin password already set. Log in to change it.' });
    return;
  }
  const password = String(req.body?.password || '');
  if (password.length < 8) {
    res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  saveConfigToEnv({ ADMIN_PASSWORD_HASH: hash });
  reloadConfig();
  res.set('Set-Cookie', issueSessionCookie());
  res.json({ success: true, data: { ok: true } });
});

authRouter.post('/auth/login', async (req, res) => {
  if (!config.auth.adminPasswordHash) {
    res.status(400).json({ success: false, error: 'No admin password set. Use /auth/setup-admin first.' });
    return;
  }
  const password = String(req.body?.password || '');
  if (!password) {
    res.status(400).json({ success: false, error: 'Password required.' });
    return;
  }
  const ok = await bcrypt.compare(password, config.auth.adminPasswordHash);
  if (!ok) {
    res.status(401).json({ success: false, error: 'Wrong password.' });
    return;
  }
  res.set('Set-Cookie', issueSessionCookie());
  res.json({ success: true, data: { ok: true } });
});

authRouter.post('/auth/logout', (_req, res) => {
  res.set('Set-Cookie', clearSessionCookie());
  res.json({ success: true, data: { ok: true } });
});

/**
 * Change the admin password. Session-protected (handler runs
 * post-sessionAuth which is wired below). Verifying the old password
 * one more time prevents same-origin CSRF that could rewrite it.
 */
authRouter.post('/auth/change-password', sessionAuth, async (req, res) => {
  const oldPassword = String(req.body?.oldPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 8) {
    res.status(400).json({ success: false, error: 'New password must be at least 8 characters.' });
    return;
  }
  const ok = await bcrypt.compare(oldPassword, config.auth.adminPasswordHash);
  if (!ok) {
    res.status(401).json({ success: false, error: 'Old password incorrect.' });
    return;
  }
  const hash = await bcrypt.hash(newPassword, 10);
  saveConfigToEnv({ ADMIN_PASSWORD_HASH: hash });
  reloadConfig();
  res.json({ success: true, data: { ok: true } });
});

// ── Pairing ───────────────────────────────────────────────────────

/**
 * Client (Roku, mobile, tvOS) calls this on first run to begin
 * pairing. Open endpoint — anyone who can reach the server URL can
 * request a code, but the code is useless without the admin who has
 * the password. Replaces any existing pending code (one at a time).
 */
authRouter.post('/auth/pair/start', (req, res) => {
  const deviceLabel = typeof req.body?.deviceLabel === 'string' ? req.body.deviceLabel : '';
  const { code, expiresAt } = startPair(deviceLabel);
  res.json({ success: true, data: { code, expiresAt } });
});

/**
 * Client polls this every second or so. Returns 'pending' until the
 * admin enters the code in /setup. Then returns the auth key ONCE
 * (the slot is cleared after delivery so a leak doesn't help an
 * attacker).
 */
authRouter.get('/auth/pair/poll', (req, res) => {
  const code = String(req.query.code || '');
  const result = pollPair(code);
  if (result.status === 'pending') {
    res.json({ success: true, data: { status: 'pending' } });
    return;
  }
  if (result.status === 'completed' && result.key) {
    res.json({ success: true, data: { status: 'completed', key: result.key } });
    return;
  }
  res.status(410).json({ success: false, error: 'Pair code expired or invalid.', data: { status: 'expired' } });
});

/**
 * Admin completes pairing from /setup by entering the code shown on
 * the client. Session-protected. Returns 200 on success and the
 * client's next poll will pick up the auth key.
 */
authRouter.post('/auth/pair/complete', sessionAuth, async (req, res) => {
  const code = String(req.body?.code || '');
  const label = typeof req.body?.label === 'string' ? req.body.label : '';
  const result = await completePair(code, label);
  if (!result.ok) {
    res.status(400).json({ success: false, error: result.reason || 'Pair failed.' });
    return;
  }
  res.json({ success: true, data: { ok: true, deviceId: result.deviceId } });
});

/**
 * Admin view of the current pending pair (so the UI can show that
 * a code is active and how long it has left). Session-protected.
 */
authRouter.get('/auth/pair/pending', sessionAuth, (_req, res) => {
  const pending = getPendingPair();
  res.json({ success: true, data: pending });
});

// ── Paired-device management ──────────────────────────────────────

authRouter.get('/auth/devices', sessionAuth, async (_req, res) => {
  const devices = await listPairedDevices();
  res.json({ success: true, data: devices });
});

authRouter.delete('/auth/devices/:id', sessionAuth, async (req, res) => {
  const id = String(req.params.id || '');
  const removed = await revokeDevice(id);
  res.json({ success: true, data: { removed } });
});

import { Router } from 'express';
import * as store from '../store.js';
import { config } from '../config.js';
import { humanCode, randomToken } from '../crypto.js';
import { requireAccount } from '../middleware.js';
import { issueGrant, type IssuedGrant } from '../grants.js';
import type { DeviceRole } from '../types.js';

/**
 * Device-code linking (RFC 8628 — the plex.tv/link pattern) for TVs where
 * typing is painful (doc 02 §4.4). App shows a short user code; the owner
 * approves it on a phone/laptop; the app polls for the resulting grant.
 *
 * M3 scaffold: in-memory pending map (device codes are short-lived). M7 adds
 * persistence, hard rate limiting on poll/approve, and the app UIs.
 */
export const deviceCodeRouter = Router();

interface Pending {
  userCode: string;
  serverId: string | null;
  expiresAt: number;
  status: 'pending' | 'approved' | 'denied';
  result: IssuedGrant | null;
}

const pending = new Map<string, Pending>(); // deviceCode -> state
const DEVICE_CODE_TTL_MS = 15 * 60 * 1000;
const POLL_INTERVAL_S = 5;

function sweep(): void {
  const now = Date.now();
  for (const [code, p] of pending) if (p.expiresAt < now) pending.delete(code);
}

deviceCodeRouter.post('/device-code', (req, res) => {
  sweep();
  const deviceCode = randomToken(24);
  const userCode = humanCode();
  pending.set(deviceCode, {
    userCode,
    serverId: String(req.body?.serverId ?? '') || null,
    expiresAt: Date.now() + DEVICE_CODE_TTL_MS,
    status: 'pending',
    result: null,
  });
  res.status(201).json({
    deviceCode,
    userCode,
    verificationUri: `https://${config.cloudDomain}/link`,
    interval: POLL_INTERVAL_S,
    expiresIn: DEVICE_CODE_TTL_MS / 1000,
  });
});

deviceCodeRouter.post('/device-code/approve', requireAccount, (req, res) => {
  sweep();
  const userCode = String(req.body?.userCode ?? '').trim().toUpperCase();
  const entry = [...pending.values()].find((p) => p.userCode === userCode && p.status === 'pending');
  if (!entry) {
    res.status(404).json({ error: 'unknown or expired code' });
    return;
  }
  const serverId = String(req.body?.serverId ?? entry.serverId ?? '');
  const server = store.getServer(serverId);
  if (!server || server.ownerAccountId !== req.accountId) {
    res.status(404).json({ error: 'server not found' });
    return;
  }
  const role: DeviceRole = req.body?.role === 'guest' ? 'guest' : 'owner';
  const boundWoProfileId = role === 'guest' ? String(req.body?.boundWoProfileId ?? '') || null : null;
  entry.result = issueGrant(server, req.accountId!, role, boundWoProfileId);
  entry.status = 'approved';
  res.json({ ok: true });
});

deviceCodeRouter.post('/device-code/poll', (req, res) => {
  sweep();
  const deviceCode = String(req.body?.deviceCode ?? '');
  const entry = pending.get(deviceCode);
  if (!entry) {
    res.status(400).json({ error: 'expired_or_unknown' });
    return;
  }
  if (entry.status === 'pending') {
    res.json({ status: 'pending' });
    return;
  }
  if (entry.status === 'approved' && entry.result) {
    pending.delete(deviceCode); // one-shot delivery
    res.json({ status: 'approved', ...entry.result });
    return;
  }
  res.json({ status: 'denied' });
});

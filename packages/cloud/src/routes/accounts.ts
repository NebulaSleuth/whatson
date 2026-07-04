import { Router } from 'express';
import bcrypt from 'bcryptjs';
import * as store from '../store.js';
import { signSession } from '../crypto.js';
import { requireAccount } from '../middleware.js';

/**
 * Cloud accounts — one per backend owner (doc 02 §4.2). Email + password for
 * v1 (OPEN DECISION doc 02 §10: could federate Plex OAuth later). This is the
 * ONLY identity layer the cloud knows about; it never sees Whats On profiles.
 */
export const accountsRouter = Router();

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

accountsRouter.post('/accounts', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'valid email required' });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: 'password must be at least 8 characters' });
    return;
  }
  if (store.findAccountByEmail(email)) {
    res.status(409).json({ error: 'account already exists' });
    return;
  }
  const account = store.createAccount(email, bcrypt.hashSync(password, 10));
  res.status(201).json({ token: signSession(account.id), accountId: account.id });
});

accountsRouter.post('/accounts/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const account = store.findAccountByEmail(email);
  // Constant-ish response whether or not the email exists.
  const ok = account ? bcrypt.compareSync(password, account.passwordHash) : false;
  if (!account || !ok) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }
  res.json({ token: signSession(account.id), accountId: account.id });
});

accountsRouter.get('/accounts/me', requireAccount, (req, res) => {
  const account = store.findAccountById(req.accountId!);
  if (!account) {
    res.status(404).json({ error: 'account not found' });
    return;
  }
  const servers = store.findServersByOwner(account.id).map((s) => ({
    serverId: s.id,
    label: s.label,
    enabled: s.enabled,
    lastHeartbeatAt: s.lastHeartbeatAt,
  }));
  res.json({ accountId: account.id, email: account.email, servers });
});

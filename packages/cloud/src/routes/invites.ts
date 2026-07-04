import { Router } from 'express';
import * as store from '../store.js';
import { randomToken } from '../crypto.js';
import { requireAccount } from '../middleware.js';
import { issueGrant } from '../grants.js';

/**
 * Guest invites (doc 02 §4.3). Owner mints a token (optionally bound to a WO
 * profile); the guest redeems it in-app to receive a signed grant + candidates.
 *
 * M3 scaffold: the happy path works end to end. Full M7 hardening — invite
 * management UI, auto-vs-pre-create profile decision (doc 02 §10), and tighter
 * rate limiting — is layered on later.
 */
export const invitesRouter = Router();

invitesRouter.post('/invites', requireAccount, (req, res) => {
  const serverId = String(req.body?.serverId ?? '');
  const server = store.getServer(serverId);
  if (!server || server.ownerAccountId !== req.accountId) {
    res.status(404).json({ error: 'server not found' });
    return;
  }
  const hours = Math.min(Math.max(Number(req.body?.expiresInHours ?? 72), 1), 720);
  const invite = store.createInvite({
    token: randomToken(24),
    serverId,
    boundWoProfileId: String(req.body?.boundWoProfileId ?? '') || null,
    label: String(req.body?.label ?? '') || null,
    role: 'guest',
    expiresAt: Date.now() + hours * 3600_000,
  });
  res.status(201).json({ token: invite.token, expiresAt: invite.expiresAt });
});

invitesRouter.post('/invites/redeem', (req, res) => {
  const token = String(req.body?.token ?? '');
  const invite = store.getInvite(token);
  if (!invite || invite.expiresAt < Date.now()) {
    res.status(400).json({ error: 'invalid or expired invite' });
    return;
  }
  if (invite.redeemedAt) {
    res.status(409).json({ error: 'invite already redeemed' });
    return;
  }
  const server = store.getServer(invite.serverId);
  if (!server || !server.enabled || server.revokedAt !== null) {
    res.status(404).json({ error: 'server unavailable' });
    return;
  }
  // A guest gets a lightweight cloud identity scoped to this one server.
  const guestAccountId = `guest_${randomToken(8)}`;
  store.markInviteRedeemed(token, guestAccountId);
  res.json(issueGrant(server, guestAccountId, 'guest', invite.boundWoProfileId));
});

import { Router } from 'express';
import * as store from '../store.js';
import { requireAccount } from '../middleware.js';

/**
 * Guest invites — accept side (doc 02 §4.3, M7). The owner mints an invite from
 * /setup (server-signed: POST /servers/:id/invites). The guest then:
 *   1. GET /invites/:token  — public lookup to render the accept page.
 *   2. creates/logs-in to their OWN cloud account (accountsRouter).
 *   3. POST /invites/redeem — binds their account to the server as a guest
 *      (a GuestMembership). NO grant is issued here — the guest's DEVICES
 *      onboard separately via the device-code flow, which now honors guest
 *      memberships so they can self-approve without the owner.
 */
export const invitesRouter = Router();

/** Public: describe an invite so the accept page can render (no secrets). */
invitesRouter.get('/invites/:token', (req, res) => {
  const invite = store.getInvite(String(req.params.token));
  if (!invite || invite.expiresAt < Date.now()) {
    res.status(404).json({ error: 'invalid or expired invite' });
    return;
  }
  const server = store.getServer(invite.serverId);
  if (!server || !server.enabled || server.revokedAt !== null) {
    res.status(404).json({ error: 'server unavailable' });
    return;
  }
  res.json({
    serverLabel: server.label || 'a Whats On server',
    email: invite.email,
    redeemed: invite.redeemedAt !== null,
    expiresAt: invite.expiresAt,
  });
});

/** Redeem with the guest's own account session → create a standing membership. */
invitesRouter.post('/invites/redeem', requireAccount, (req, res) => {
  const invite = store.getInvite(String(req.body?.token ?? ''));
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

  // Idempotent-ish: if this account already has a membership here, reuse it.
  const existing = store.findMembership(req.accountId!, server.id);
  const membership =
    existing ??
    store.createMembership({
      accountId: req.accountId!,
      serverId: server.id,
      role: invite.role,
    });

  store.markInviteRedeemed(invite.token, req.accountId!);
  res.json({
    serverId: server.id,
    serverLabel: server.label || 'a Whats On server',
    membershipId: membership.id,
    // Next step: onboard a device via the device-code flow; identity is picked
    // from the backend's shared "Who's Watching?" picker.
    next: 'device-code',
  });
});

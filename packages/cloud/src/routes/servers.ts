import { Router, type Request } from 'express';
import * as store from '../store.js';
import {
  serverIdFromPubKey,
  verifyServerSignature,
  cloudPublicKeyPem,
  humanCode,
  verifySession,
} from '../crypto.js';
import { config } from '../config.js';
import { requireAccount, bearer } from '../middleware.js';
import { probeServer } from '../probe.js';
import { upsertTxt, deleteTxt } from '../dns.js';
import { candidatesFor, issueGrant } from '../grants.js';
import { randomToken } from '../crypto.js';
import { sendInviteEmail } from '../mailer.js';
import { mailEnabled } from '../config.js';
import type { ServerRecord, DeviceRole } from '../types.js';

/**
 * Server registry, claim, candidates, and grant issuance (doc 02 §2, §4, §5).
 *
 * A backend proves it holds its keypair by signing register / claim-code
 * requests with its private key; the cloud verifies against the public key it
 * derives the serverId from. Ownership is bound when a signed-in account
 * redeems the LAN-shown claim code.
 */
export const serversRouter = Router();

const CLAIM_TTL_MS = 10 * 60 * 1000;

function serverIsResolvable(server: ServerRecord | null): server is ServerRecord {
  return !!server && server.enabled && server.revokedAt === null;
}

// ── Backend: register + request a claim code ────────────────────────────────

serversRouter.post('/servers/register', (req, res) => {
  const pubKey = String(req.body?.pubKey ?? '');
  const sig = String(req.body?.sig ?? '');
  if (!pubKey || !sig) {
    res.status(400).json({ error: 'pubKey and sig required' });
    return;
  }
  let serverId: string;
  try {
    serverId = serverIdFromPubKey(pubKey);
  } catch {
    res.status(400).json({ error: 'invalid pubKey' });
    return;
  }
  if (!verifyServerSignature(pubKey, `register:${serverId}`, sig)) {
    res.status(401).json({ error: 'signature does not match pubKey' });
    return;
  }
  const existing = store.getServer(serverId);
  const record: ServerRecord = existing ?? {
    id: serverId,
    pubKey,
    ownerAccountId: null,
    label: null,
    enabled: true,
    revokedAt: null,
    lastHeartbeatAt: null,
    observedWanIp: null,
    candidates: [],
    ipv6Url: null,
    upnpMapped: false,
    appVersion: null,
  };
  store.upsertServer(record);
  // hostname is what the backend requests a cert for + what apps connect to.
  res.json({ serverId, cloudPublicKey: cloudPublicKeyPem(), hostname: `${serverId}.s.${config.cloudDomain}` });
});

serversRouter.post('/servers/:id/claim-code', (req, res) => {
  const server = store.getServer(String(req.params.id));
  if (!server) {
    res.status(404).json({ error: 'server not registered' });
    return;
  }
  if (server.ownerAccountId) {
    res.status(409).json({ error: 'server already claimed' });
    return;
  }
  const sig = String(req.body?.sig ?? '');
  if (!verifyServerSignature(server.pubKey, `claim-code:${server.id}`, sig)) {
    res.status(401).json({ error: 'signature required' });
    return;
  }
  const code = humanCode();
  const entry = store.putClaimCode(code, server.id, CLAIM_TTL_MS);
  res.json({ code: entry.code, expiresAt: entry.expiresAt });
});

// ── ACME DNS-01: backend asks the cloud to publish its challenge TXT ─────────
// The backend drives its own cert order and holds its own key (H1); it only
// needs the zone owner (the cloud) to publish `_acme-challenge.<serverId>`.
// Proven by the server signing the exact token it wants published.

serversRouter.post('/servers/:id/acme-challenge', async (req, res) => {
  const server = store.getServer(String(req.params.id));
  if (!server) {
    res.status(404).json({ error: 'server not registered' });
    return;
  }
  const token = String(req.body?.token ?? '');
  const sig = String(req.body?.sig ?? '');
  if (!token || !verifyServerSignature(server.pubKey, `acme-challenge:${server.id}:${token}`, sig)) {
    res.status(401).json({ error: 'signature required' });
    return;
  }
  const ok = await upsertTxt(`_acme-challenge.${server.id}`, token);
  res.status(ok ? 200 : 502).json({ ok });
});

serversRouter.post('/servers/:id/acme-challenge/clear', async (req, res) => {
  const server = store.getServer(String(req.params.id));
  if (!server) {
    res.status(404).json({ error: 'server not registered' });
    return;
  }
  const sig = String(req.body?.sig ?? '');
  if (!verifyServerSignature(server.pubKey, `acme-challenge-clear:${server.id}`, sig)) {
    res.status(401).json({ error: 'signature required' });
    return;
  }
  const ok = await deleteTxt(`_acme-challenge.${server.id}`);
  res.status(ok ? 200 : 502).json({ ok });
});

// ── Owner: claim a server by entering its LAN-shown code ────────────────────

serversRouter.post('/servers/claim', requireAccount, (req, res) => {
  const code = String(req.body?.code ?? '').trim().toUpperCase();
  const entry = store.consumeClaimCode(code);
  if (!entry) {
    res.status(400).json({ error: 'invalid or expired claim code' });
    return;
  }
  const server = store.getServer(entry.serverId);
  if (!server) {
    res.status(404).json({ error: 'server not found' });
    return;
  }
  if (server.ownerAccountId && server.ownerAccountId !== req.accountId) {
    res.status(409).json({ error: 'server already claimed' });
    return;
  }
  server.ownerAccountId = req.accountId!;
  server.label = server.label ?? (String(req.body?.label ?? '') || null);
  store.upsertServer(server);
  res.json({ serverId: server.id, label: server.label });
});

// ── Candidates: owner session OR a device grant's cloud token ───────────────

function authorizedForServer(req: Request, serverId: string): boolean {
  const token = bearer(req);
  if (!token) return false;
  const accountId = verifySession(token);
  if (accountId) {
    const server = store.getServer(serverId);
    return !!server && server.ownerAccountId === accountId;
  }
  const grant = store.getGrantByCloudToken(token);
  return !!grant && grant.serverId === serverId;
}

serversRouter.get('/servers/:id/candidates', (req, res) => {
  if (!authorizedForServer(req, String(req.params.id))) {
    res.status(401).json({ error: 'not authorized for this server' });
    return;
  }
  const server = store.getServer(String(req.params.id));
  if (!serverIsResolvable(server)) {
    res.status(404).json({ error: 'server unavailable' });
    return;
  }
  res.json(candidatesFor(server));
});

// ── Backend (/setup): mint a guest invite, server-signed (M7) ───────────────
// The backend holds the server keypair, so it can create invites for its own
// server without the owner's cloud password — it signs `invite:<serverId>:<email>`.
// Returns the accept URL always (link-first); emails it too when Mailgun is on.

serversRouter.post('/servers/:id/invites', async (req, res) => {
  const server = store.getServer(String(req.params.id));
  if (!server) {
    res.status(404).json({ error: 'server not registered' });
    return;
  }
  if (!server.ownerAccountId) {
    res.status(409).json({ error: 'server not yet claimed by an owner' });
    return;
  }
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const sig = String(req.body?.sig ?? '');
  if (!verifyServerSignature(server.pubKey, `invite:${server.id}:${email}`, sig)) {
    res.status(401).json({ error: 'signature required' });
    return;
  }

  const hours = Math.min(Math.max(Number(req.body?.expiresInHours ?? 168), 1), 720);
  const invite = store.createInvite({
    token: randomToken(24),
    serverId: server.id,
    email: email || null,
    label: String(req.body?.label ?? '') || null,
    role: 'guest',
    // Opaque backend provisioning spec pointer (libraries etc.); cloud stores it blindly.
    provisioningRef: String(req.body?.provisioningRef ?? '') || null,
    expiresAt: Date.now() + hours * 3600_000,
  });

  const url = `${config.webUiBase}/invite?token=${invite.token}`;
  let emailed = false;
  if (email && mailEnabled()) {
    const r = await sendInviteEmail({ to: email, serverLabel: server.label || 'your server', inviteUrl: url });
    emailed = r.sent;
    if (!r.sent) console.warn(`[cloud] invite email to ${email} not sent: ${r.error}`);
  }
  res.status(201).json({ token: invite.token, url, expiresAt: invite.expiresAt, emailed });
});

// ── Owner: mint a grant for one of their own devices ────────────────────────

serversRouter.post('/servers/:id/grant', requireAccount, (req, res) => {
  const server = store.getServer(String(req.params.id));
  if (!server || server.ownerAccountId !== req.accountId) {
    res.status(404).json({ error: 'server not found' });
    return;
  }
  const role: DeviceRole = req.body?.role === 'guest' ? 'guest' : 'owner';
  res.json(issueGrant(server, req.accountId!, role));
});

// ── Owner: reachability diagnostics + enable/disable ────────────────────────

serversRouter.get('/servers/:id/reachability', requireAccount, async (req, res) => {
  const server = store.getServer(String(req.params.id));
  if (!server || server.ownerAccountId !== req.accountId) {
    res.status(404).json({ error: 'server not found' });
    return;
  }
  res.json(await probeServer(server));
});

serversRouter.patch('/servers/:id', requireAccount, (req, res) => {
  const server = store.getServer(String(req.params.id));
  if (!server || server.ownerAccountId !== req.accountId) {
    res.status(404).json({ error: 'server not found' });
    return;
  }
  if (typeof req.body?.enabled === 'boolean') {
    server.enabled = req.body.enabled;
    server.revokedAt = req.body.enabled ? null : new Date().toISOString();
  }
  if (typeof req.body?.label === 'string') server.label = req.body.label;
  store.upsertServer(server);
  res.json({ serverId: server.id, enabled: server.enabled, label: server.label });
});

import { Router, type Request } from 'express';
import * as store from '../store.js';
import {
  serverIdFromPubKey,
  verifyServerSignature,
  cloudPublicKeyPem,
  humanCode,
  verifySession,
} from '../crypto.js';
import { requireAccount, bearer } from '../middleware.js';
import { probeServer } from '../probe.js';
import { candidatesFor, issueGrant } from '../grants.js';
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
  res.json({ serverId, cloudPublicKey: cloudPublicKeyPem() });
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

// ── Owner: mint a grant for one of their own devices (invite flow is M7) ────

serversRouter.post('/servers/:id/grant', requireAccount, (req, res) => {
  const server = store.getServer(String(req.params.id));
  if (!server || server.ownerAccountId !== req.accountId) {
    res.status(404).json({ error: 'server not found' });
    return;
  }
  const role: DeviceRole = req.body?.role === 'guest' ? 'guest' : 'owner';
  const boundWoProfileId = role === 'guest' ? (String(req.body?.boundWoProfileId ?? '') || null) : null;
  res.json(issueGrant(server, req.accountId!, role, boundWoProfileId));
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

import { Router } from 'express';
import { DEFAULT_CLOUD_URL } from '@whatson/shared';
import { config, saveConfigToEnv, reloadConfig } from '../config.js';
import { getServerId } from '../services/cloud/identity.js';
import {
  getCloudStatus,
  requestClaimCode,
  createInvite,
  startCloudRegistration,
  stopCloudRegistration,
  type InviteBinding,
} from '../services/cloud/registration.js';
import * as wo from '../services/whatsonUsers.js';
import { startRemoteListener, stopRemoteListener } from '../server/remoteListener.js';
import { certDaysRemaining } from '../services/cloud/acme.js';
import { startCertManager, stopCertManager, isObtainingCert } from '../services/cloud/certManager.js';

/**
 * Remote Access control (docs/remote-access/) for the /setup owner UI. Turns
 * the env-var-only remote/cloud config into one-click enable/disable, and
 * surfaces the cloud claim code the owner enters in their cloud account.
 *
 * LAN-surface + owner-gated only (see server/surface.ts) — never mounted on the
 * internet-facing remote listener.
 */
export const remoteRouter = Router();

function statusPayload() {
  return {
    enabled: config.remote.enabled,
    serverId: getServerId(),
    cloudUrl: config.cloud.url || null,
    remotePort: config.remote.port,
    adminPasswordSet: Boolean(config.auth.adminPasswordHash),
    cloud: getCloudStatus(),
    cert: { daysRemaining: certDaysRemaining(), obtaining: isObtainingCert() },
  };
}

remoteRouter.get('/remote/status', (_req, res) => {
  res.json({ success: true, data: statusPayload() });
});

/**
 * Enable remote access: pin the cloud key, flip REMOTE_ACCESS on, then start the
 * remote listener + cloud registration live (no restart). Requires an admin
 * password first — the internet-facing surface refuses to run open.
 */
remoteRouter.post('/remote/enable', async (req, res) => {
  if (!config.auth.adminPasswordHash) {
    res.status(400).json({
      success: false,
      error: 'Set an admin password first — the remote surface requires it and refuses to run open.',
    });
    return;
  }

  const cloudUrl = String(req.body?.cloudUrl || config.cloud.url || DEFAULT_CLOUD_URL)
    .trim()
    .replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(cloudUrl)) {
    res.status(400).json({ success: false, error: 'Cloud URL must start with http:// or https://.' });
    return;
  }

  // Remote listen port (owner forwards it 1:1). Default 3002; validate range.
  const portNum = Number(req.body?.remotePort);
  const remotePort =
    Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535 ? portNum : config.remote.port;

  // Fetch + pin the cloud's Ed25519 public key so grants are verified offline
  // against exactly this key (docs/remote-access H1). No PEM pasting by the user.
  let pem: string;
  try {
    const keyRes = await fetch(`${cloudUrl}/api/cloud-key`);
    if (!keyRes.ok) {
      res.status(502).json({ success: false, error: `Could not reach the cloud (HTTP ${keyRes.status}).` });
      return;
    }
    pem = (await keyRes.text()).trim();
    if (!pem.includes('BEGIN PUBLIC KEY')) {
      res.status(502).json({ success: false, error: 'Cloud did not return a valid public key.' });
      return;
    }
  } catch (err) {
    res.status(502).json({ success: false, error: `Could not reach the cloud: ${(err as Error).message}` });
    return;
  }

  // Persist as single-line env values (config.ts restores the PEM newlines).
  saveConfigToEnv({
    REMOTE_ACCESS: 'true',
    REMOTE_PORT: String(remotePort),
    CLOUD_URL: cloudUrl,
    CLOUD_PUBLIC_KEY: pem.replace(/\r?\n/g, '\\n'),
  });
  reloadConfig();

  const listener = startRemoteListener();
  if (!listener.started) {
    res.status(500).json({ success: false, error: `Remote listener failed to start: ${listener.reason}` });
    return;
  }
  startCloudRegistration();
  // Obtain the per-server TLS cert in the background (~30s), then the cert
  // manager restarts the listener as HTTPS. The panel polls cert state.
  startCertManager();

  res.json({ success: true, data: statusPayload() });
});

/** Disable remote access: stop registration + the listener, flip the flag off. */
remoteRouter.post('/remote/disable', (_req, res) => {
  saveConfigToEnv({ REMOTE_ACCESS: 'false' });
  reloadConfig();
  stopCertManager();
  stopCloudRegistration();
  stopRemoteListener();
  res.json({ success: true, data: statusPayload() });
});

/**
 * Fetch a one-time cloud claim code to link this server to a cloud account.
 * Returns { claimed: true } if the cloud already has an owner for this server.
 */
remoteRouter.post('/remote/claim-code', async (_req, res) => {
  if (!config.remote.enabled || !config.cloud.url) {
    res.status(400).json({ success: false, error: 'Enable remote access first.' });
    return;
  }
  const result = await requestClaimCode();
  if ('error' in result) {
    res.status(502).json({ success: false, error: result.error });
    return;
  }
  // The account site lives on the apex; the control plane is on `cloud.<apex>`.
  // Hand the panel a deep link so "Link to my account" can auto-fill the code.
  const accountUrl = (config.cloud.url || '').replace(/\/\/cloud\./i, '//') + '/account';
  res.json({ success: true, data: { ...result, accountUrl } });
});

/**
 * Mint a guest invite (M7). The /setup UI collects an email + (in closed mode)
 * which Whats On user the guest is bound to, or "new user". The binding is
 * validated against the current guest mode + the WO users on this server; the
 * cloud call is server-signed inside createInvite().
 */
remoteRouter.post('/remote/invite', async (req, res) => {
  if (!config.remote.enabled || !config.cloud.url) {
    res.status(400).json({ success: false, error: 'Enable remote access first.' });
    return;
  }
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ success: false, error: 'A valid email address is required.' });
    return;
  }

  const mode = wo.getGuestMode();
  let binding: InviteBinding;
  let boundWoProfileId: string | null = null;
  let newUserName: string | null = null;

  if (mode === 'open') {
    // Open mode: the guest picks (or creates) their user in the app each session.
    binding = 'open';
  } else {
    // Closed mode: bind to a chosen existing user, or have the guest create one.
    const wantNew = req.body?.newUser === true || String(req.body?.boundWoProfileId ?? '') === '__new__';
    if (wantNew) {
      binding = 'locked-new';
      newUserName = String(req.body?.newUserName ?? '').trim() || null;
    } else {
      binding = 'locked';
      boundWoProfileId = String(req.body?.boundWoProfileId ?? '').trim() || null;
      if (!boundWoProfileId) {
        res.status(400).json({ success: false, error: 'Choose a viewer profile, or select "New viewer".' });
        return;
      }
      if (!wo.findById(boundWoProfileId)) {
        res.status(400).json({ success: false, error: 'That viewer profile no longer exists.' });
        return;
      }
    }
  }

  const result = await createInvite({
    email,
    binding,
    boundWoProfileId,
    newUserName,
    label: String(req.body?.label ?? '') || null,
    expiresInHours: Number(req.body?.expiresInHours) || undefined,
  });
  if ('error' in result) {
    res.status(502).json({ success: false, error: result.error });
    return;
  }
  res.json({ success: true, data: { ...result, mode, binding } });
});

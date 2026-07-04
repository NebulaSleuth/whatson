import { config } from './config.js';
import * as store from './store.js';
import { signGrant, randomToken, cloudPublicKeyPem } from './crypto.js';
import type { ServerRecord, GrantPayload, DeviceRole, ServerCandidates } from './types.js';

/** Candidate list for an app, with the app-visible TTL. */
export function candidatesFor(server: ServerRecord): ServerCandidates {
  return {
    serverId: server.id,
    candidates: server.candidates,
    serverCertFingerprint: null, // populated once the cert flow lands (M8)
    ttl: config.candidateTtl,
  };
}

export interface IssuedGrant {
  grant: string;
  cloudToken: string;
  candidates: ServerCandidates;
  cloudPublicKey: string;
}

/**
 * Mint a signed grant + its persisted DeviceGrant (with an app-facing cloud
 * refresh token). Single source of truth for grant creation — owner-device,
 * invite redeem, and device-code all funnel through here so the Ed25519 /
 * jti / TTL rules can't drift between flows.
 */
export function issueGrant(
  server: ServerRecord,
  accountId: string,
  role: DeviceRole,
  boundWoProfileId: string | null,
): IssuedGrant {
  const now = Math.floor(Date.now() / 1000);
  const payload: GrantPayload = {
    v: 1,
    serverId: server.id,
    accountId,
    role,
    boundWoProfileId: role === 'guest' ? boundWoProfileId : null,
    jti: randomToken(16),
    iat: now,
    exp: now + config.grantTtl,
  };
  const grant = store.createGrant({
    serverId: server.id,
    accountId,
    role,
    boundWoProfileId: payload.boundWoProfileId,
    cloudToken: randomToken(32),
  });
  return {
    grant: signGrant(payload),
    cloudToken: grant.cloudToken,
    candidates: candidatesFor(server),
    cloudPublicKey: cloudPublicKeyPem(),
  };
}

import { createPublicKey, verify as edVerify, type KeyObject } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../config.js';
import { dataDir } from './paths.js';
import type { GrantPayload } from './types.js';

/**
 * Verify cloud-signed grants against the PINNED cloud public key, offline
 * (doc 02 §5). The grant is a raw Ed25519 detached signature — NOT a JWT — so
 * there is no `alg` to confuse (finding C1); verification only ever uses
 * Ed25519 + the pinned key.
 *
 * The pinned key comes from (in order): the key learned + persisted at claim
 * time, then the configured `CLOUD_PUBLIC_KEY`. It must never be trusted from
 * an unauthenticated channel (finding M5).
 */

let pinned: KeyObject | null = null;

function pinnedPath(): string {
  return join(dataDir(), 'cloud-public-key.pem');
}

export function getPinnedCloudKey(): KeyObject | null {
  if (pinned) return pinned;
  try {
    if (existsSync(pinnedPath())) {
      pinned = createPublicKey(readFileSync(pinnedPath(), 'utf-8'));
      return pinned;
    }
  } catch {
    /* fall through to config */
  }
  if (config.cloud.publicKey) {
    try {
      pinned = createPublicKey(config.cloud.publicKey);
      return pinned;
    } catch {
      return null;
    }
  }
  return null;
}

/** Persist the cloud public key learned during the claim exchange (§4.2). */
export function persistCloudKey(pem: string): void {
  writeFileSync(pinnedPath(), pem, { mode: 0o600 });
  pinned = createPublicKey(pem);
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Verify signature + envelope of a grant token. Returns the payload when the
 * signature is valid and unexpired; the caller still checks `serverId` matches
 * this server and that `jti` hasn't been redeemed.
 */
export function verifyGrant(token: string): GrantPayload | null {
  const key = getPinnedCloudKey();
  if (!key) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    if (!edVerify(null, Buffer.from(body, 'utf-8'), key, b64urlDecode(sig))) return null;
    const payload = JSON.parse(b64urlDecode(body).toString('utf-8')) as GrantPayload;
    if (payload.v !== 1) return null;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

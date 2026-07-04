import {
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  createPublicKey,
  createPrivateKey,
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
  type KeyObject,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import type { GrantPayload } from './types.js';

// ── base64url helpers ──────────────────────────────────────────────────────

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// ── Cloud signing keypair (Ed25519) ────────────────────────────────────────
// Generated once and persisted. The PUBLIC key is pinned into the app build so
// the backend can verify cloud-signed grants offline (doc 02 §5); it is NOT
// trusted on-the-wire (finding M5 — no TOFU over plain WSS).

let cloudPriv: KeyObject | null = null;
let cloudPub: KeyObject | null = null;

function keyPath(): string {
  mkdirSync(config.dataDir, { recursive: true });
  return join(config.dataDir, 'cloud-ed25519.pem');
}

export function initCloudKey(): void {
  const path = keyPath();
  if (existsSync(path)) {
    cloudPriv = createPrivateKey(readFileSync(path, 'utf-8'));
    cloudPub = createPublicKey(cloudPriv);
    return;
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, { mode: 0o600 });
  cloudPriv = privateKey;
  cloudPub = publicKey;
  console.log('[cloud] generated new Ed25519 signing key');
}

/** PEM the backend/app pins to verify grants. Serve read-only for setup docs. */
export function cloudPublicKeyPem(): string {
  if (!cloudPub) initCloudKey();
  return cloudPub!.export({ type: 'spki', format: 'pem' }) as string;
}

// ── Signed grants (raw Ed25519 detached signature; NOT a JWT) ───────────────
// Token = base64url(JSON payload) + "." + base64url(signature). There is no
// `alg` header anywhere, so the JWT algorithm-confusion class (finding C1) is
// structurally impossible: verification only ever uses Ed25519 + the cloud key.

function signDetached(message: string): string {
  if (!cloudPriv) initCloudKey();
  return b64url(edSign(null, Buffer.from(message, 'utf-8'), cloudPriv!));
}

export function signGrant(payload: GrantPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf-8'));
  return `${body}.${signDetached(body)}`;
}

/** Verify against THIS cloud's key (used in tests/self-checks; the backend
 *  runs the equivalent check against its pinned copy of the public key). */
export function verifyGrant(token: string): GrantPayload | null {
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!cloudPub) initCloudKey();
  let ok = false;
  try {
    ok = edVerify(null, Buffer.from(body, 'utf-8'), cloudPub!, b64urlDecode(sig));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString('utf-8')) as GrantPayload;
    if (payload.v !== 1) return null;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Account session tokens (same detached-signature scheme, typed) ──────────

interface SessionClaims {
  typ: 'session';
  accountId: string;
  exp: number;
}

export function signSession(accountId: string): string {
  const claims: SessionClaims = {
    typ: 'session',
    accountId,
    exp: Math.floor(Date.now() / 1000) + config.sessionTtl,
  };
  const body = b64url(Buffer.from(JSON.stringify(claims), 'utf-8'));
  return `${body}.${signDetached(body)}`;
}

export function verifySession(token: string | undefined): string | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  if (!cloudPub) initCloudKey();
  try {
    if (!edVerify(null, Buffer.from(body, 'utf-8'), cloudPub!, b64urlDecode(token.slice(dot + 1)))) return null;
    const claims = JSON.parse(b64urlDecode(body).toString('utf-8')) as SessionClaims;
    if (claims.typ !== 'session' || claims.exp * 1000 < Date.now()) return null;
    return claims.accountId;
  } catch {
    return null;
  }
}

// ── Ids, tokens, codes ──────────────────────────────────────────────────────

/** serverId = truncated SHA-256 of the server public key (a valid DNS label). */
export function serverIdFromPubKey(pubKeyPem: string): string {
  const normalized = createPublicKey(pubKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(normalized).digest('hex').slice(0, 40);
}

/** High-entropy opaque token (grants' cloud refresh token, invite tokens). */
export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes));
}

/**
 * Human-typeable code for claim / device-code flows. Longer + higher-entropy
 * than the LAN 6-digit pair code, since these endpoints are internet-reachable
 * (doc 02 §4.4). ~40 bits, Crockford-ish alphabet (no ambiguous chars).
 */
export function humanCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-';
    out += alphabet[randomInt(0, alphabet.length)];
  }
  return out;
}

/**
 * Verify a signature a backend made with its OWN private key (proving it holds
 * the key behind `pubKeyPem`) over `message`. Used for server register / claim
 * requests so the cloud never binds a server the caller can't prove it owns.
 */
export function verifyServerSignature(pubKeyPem: string, message: string, sigB64url: string): boolean {
  try {
    return edVerify(null, Buffer.from(message, 'utf-8'), createPublicKey(pubKeyPem), b64urlDecode(sigB64url));
  } catch {
    return false;
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Symmetric secret store (unified user model, Phase B). Encrypts subsystem
 * credentials (Jellyfin/Emby access tokens + passwords, per-user Plex tokens) at
 * rest with AES-256-GCM, so `whatsonUsers.json` no longer holds plaintext tokens
 * (today's `plexUserToken` is plaintext — this hardens it).
 *
 * Reversible by design: the backend must decrypt to act AS a user against the
 * subsystem. The master key stays on the LAN backend and never reaches the cloud.
 *
 * Master key resolution (first hit wins):
 *   1. WHATSON_SECRET_KEY env — 32 bytes, base64 or hex.
 *   2. A generated key file `<DATA_DIR>/whatson-secret.key` (0600), created once.
 */

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');
const KEY_FILE = join(DATA_DIR, 'whatson-secret.key');
const PREFIX = 'wog1:'; // Whats On GCM v1 — marks + versions our blobs.

let key: Buffer | null = null;

function decodeKey(s: string): Buffer {
  for (const enc of ['base64', 'hex'] as const) {
    try {
      const b = Buffer.from(s, enc);
      if (b.length === 32) return b;
    } catch {
      /* try next */
    }
  }
  return Buffer.alloc(0);
}

function loadKey(): Buffer {
  if (key) return key;
  const env = process.env.WHATSON_SECRET_KEY;
  if (env) {
    const b = decodeKey(env.trim());
    if (b.length === 32) return (key = b);
    console.warn('[secrets] WHATSON_SECRET_KEY is set but not a 32-byte base64/hex key — ignoring.');
  }
  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    /* best effort */
  }
  if (existsSync(KEY_FILE)) {
    const b = decodeKey(readFileSync(KEY_FILE, 'utf-8').trim());
    if (b.length === 32) return (key = b);
    console.warn('[secrets] key file is corrupt — regenerating (existing secrets will not decrypt).');
  }
  const fresh = randomBytes(32);
  writeFileSync(KEY_FILE, fresh.toString('base64'), { mode: 0o600 });
  console.log('[secrets] generated new master key at', KEY_FILE);
  return (key = fresh);
}

/** Encrypt a UTF-8 string → a compact, self-describing blob (`wog1:<base64>`). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Decrypt a blob from `encryptSecret`. Returns null on tamper / wrong key / bad input. */
export function decryptSecret(blob: string | null | undefined): string | null {
  if (!blob || !blob.startsWith(PREFIX)) return null;
  try {
    const raw = Buffer.from(blob.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', loadKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** True if a value is already an encrypted blob — for idempotent migrations. */
export function isEncrypted(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.startsWith(PREFIX);
}

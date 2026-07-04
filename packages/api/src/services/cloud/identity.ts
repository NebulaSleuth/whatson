import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  createHash,
  sign as edSign,
  type KeyObject,
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from './paths.js';

/**
 * The backend's own Ed25519 identity (doc 02 §3). Generated once on first use
 * and persisted; `serverId` is the truncated SHA-256 of the SPKI public key —
 * derived identically to the cloud's `serverIdFromPubKey` so both agree.
 */

let priv: KeyObject | null = null;
let pub: KeyObject | null = null;

function keyPath(): string {
  return join(dataDir(), 'cloud-server-key.pem');
}

function ensure(): void {
  if (priv && pub) return;
  const path = keyPath();
  if (existsSync(path)) {
    priv = createPrivateKey(readFileSync(path, 'utf-8'));
    pub = createPublicKey(priv);
    return;
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, { mode: 0o600 });
  priv = privateKey;
  pub = publicKey;
  console.log('[cloud] generated new server identity key');
}

export function getPublicKeyPem(): string {
  ensure();
  return pub!.export({ type: 'spki', format: 'pem' }) as string;
}

export function getServerId(): string {
  ensure();
  const der = pub!.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 40);
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Sign a message with the server key (proves key possession to the cloud). */
export function signMessage(message: string): string {
  ensure();
  return b64url(edSign(null, Buffer.from(message, 'utf-8'), priv!));
}

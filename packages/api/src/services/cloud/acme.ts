import acme from 'acme-client';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../config.js';
import { getServerId, getPublicKeyPem, signMessage } from './identity.js';
import { dataDir } from './paths.js';

/**
 * Per-server TLS certificate via ACME DNS-01 (M8/8b). The backend runs the ACME
 * order and generates its OWN cert keypair — the private key never leaves this
 * machine (H1). For the DNS-01 challenge it can't touch the cloud's zone, so it
 * asks the cloud (which owns `s.whatsontv.net`) to publish
 * `_acme-challenge.<serverId>`, proving intent by signing the exact value.
 *
 * Result: a publicly-trusted cert for `<serverId>.s.whatsontv.net` that every
 * platform accepts, so remote streaming can be plain HTTPS (no plaintext).
 */

const ACCOUNT_KEY = () => join(dataDir(), 'acme-account.key');
const CERT_PEM = () => join(dataDir(), 'server-cert.pem');
const CERT_KEY = () => join(dataDir(), 'server-cert.key');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CertBundle {
  cert: string;
  key: string;
}

/** Load the persisted cert bundle, or null if we haven't obtained one yet. */
export function loadCertificate(): CertBundle | null {
  try {
    if (existsSync(CERT_PEM()) && existsSync(CERT_KEY())) {
      return { cert: readFileSync(CERT_PEM(), 'utf-8'), key: readFileSync(CERT_KEY(), 'utf-8') };
    }
  } catch {}
  return null;
}

/** Days until the persisted cert expires, or null if none / unreadable. */
export function certDaysRemaining(): number | null {
  const bundle = loadCertificate();
  if (!bundle) return null;
  try {
    const info = acme.crypto.readCertificateInfo(bundle.cert);
    const ms = info.notAfter.getTime() - Date.now();
    return Math.floor(ms / 86_400_000);
  } catch {
    return null;
  }
}

/** Register with the cloud (idempotent) and learn our cert hostname. */
async function fetchHostname(): Promise<string> {
  const serverId = getServerId();
  const res = await fetch(`${config.cloud.url}/api/servers/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pubKey: getPublicKeyPem(), sig: signMessage(`register:${serverId}`) }),
  });
  if (!res.ok) throw new Error(`register failed: HTTP ${res.status}`);
  const body = (await res.json()) as { hostname?: string };
  if (!body.hostname) throw new Error('cloud did not return a hostname');
  return body.hostname;
}

async function publishChallenge(value: string): Promise<void> {
  const serverId = getServerId();
  const res = await fetch(`${config.cloud.url}/api/servers/${serverId}/acme-challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: value, sig: signMessage(`acme-challenge:${serverId}:${value}`) }),
  });
  if (!res.ok) throw new Error(`cloud acme-challenge publish failed: HTTP ${res.status}`);
}

async function clearChallenge(): Promise<void> {
  const serverId = getServerId();
  await fetch(`${config.cloud.url}/api/servers/${serverId}/acme-challenge/clear`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sig: signMessage(`acme-challenge-clear:${serverId}`) }),
  }).catch(() => {});
}

export interface ObtainOpts {
  /** Use Let's Encrypt staging (untrusted, no rate limits) for testing. */
  staging?: boolean;
  /** Contact email for expiry notices (optional). */
  email?: string;
  /** Seconds to wait after publishing the TXT before ACME validates. */
  propagationDelaySec?: number;
}

/**
 * Obtain (or renew) the per-server certificate and persist it. Returns the
 * bundle so the caller can (re)start the HTTPS remote listener with it.
 */
export async function obtainCertificate(opts: ObtainOpts = {}): Promise<CertBundle> {
  if (!config.cloud.url) throw new Error('CLOUD_URL not configured');
  const hostname = await fetchHostname();

  // Persist the ACME account key so we reuse the same account across renewals.
  let accountKey: Buffer;
  if (existsSync(ACCOUNT_KEY())) {
    accountKey = readFileSync(ACCOUNT_KEY());
  } else {
    accountKey = await acme.crypto.createPrivateKey();
    writeFileSync(ACCOUNT_KEY(), accountKey, { mode: 0o600 });
  }

  const client = new acme.Client({
    directoryUrl: opts.staging
      ? acme.directory.letsencrypt.staging
      : acme.directory.letsencrypt.production,
    accountKey,
  });

  // Fresh cert keypair each issuance — the private key stays on this box.
  const [certKey, csr] = await acme.crypto.createCsr({ commonName: hostname });

  const delayMs = (opts.propagationDelaySec ?? 8) * 1000;
  const cert = await client.auto({
    csr,
    email: opts.email,
    termsOfServiceAgreed: true,
    challengePriority: ['dns-01'],
    challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
      if (challenge.type !== 'dns-01') throw new Error(`unsupported challenge ${challenge.type}`);
      // For dns-01, acme-client passes the exact value to publish in the TXT.
      await publishChallenge(keyAuthorization);
      await sleep(delayMs); // let the record propagate before validation
    },
    challengeRemoveFn: async () => {
      await clearChallenge();
    },
  });

  const bundle: CertBundle = { cert: cert.toString(), key: certKey.toString() };
  writeFileSync(CERT_KEY(), bundle.key, { mode: 0o600 });
  writeFileSync(CERT_PEM(), bundle.cert);
  console.log(`[acme] obtained certificate for ${hostname} (${opts.staging ? 'staging' : 'production'})`);
  return bundle;
}

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import * as crypto from 'crypto';

/**
 * Manages the device-pairing flow: short code generation, polling,
 * and the persisted list of paired devices (the auth keys clients
 * present via `X-Whatson-Auth`).
 *
 * Threat model assumptions:
 *  - Codes are short (6 digits) so users can type them on a TV.
 *  - At most ONE pending code at a time, globally. Simplifies the
 *    flow (no per-device tracking) and limits brute-force surface.
 *  - Codes expire after 10 minutes.
 *  - Auth keys are 32 random bytes (256 bits), hex-encoded. Stored
 *    only as SHA-256 hashes — even if paired-devices.json leaks, the
 *    keys themselves can't be recovered.
 *  - Failed pair-poll attempts after expiry / completion: 410 Gone,
 *    so guessing valid codes only works inside the 10-minute window.
 */

const CODE_TTL_MS = 10 * 60 * 1000;

type PairingState =
  | { status: 'pending'; code: string; expiresAt: number; deviceLabel: string | null }
  | { status: 'completed'; code: string; expiresAt: number; key: string; deviceLabel: string | null }
  | { status: 'expired'; code: string };

let activePair: PairingState | null = null;

function dataDir(): string {
  // Mirror the artwork-cache resolution logic so paired-devices.json
  // lands somewhere persistent across upgrades.
  const candidates: string[] = [];
  if (process.env.WHATSON_DATA_DIR) candidates.push(process.env.WHATSON_DATA_DIR);
  if (process.platform === 'win32') candidates.push('C:\\ProgramData\\WhatsOn\\data');
  candidates.push(join(process.cwd(), 'data'));
  candidates.push(join(process.cwd(), 'packages', 'api', 'data'));
  for (const dir of candidates) {
    try {
      mkdirSync(dir, { recursive: true });
      return dir;
    } catch {}
  }
  return '';
}

const PAIRED_FILE = (() => {
  const d = dataDir();
  return d ? join(d, 'paired-devices.json') : '';
})();

interface PairedDevice {
  /** Stable opaque id, used for revoke. */
  id: string;
  /** SHA-256 hex of the auth key. */
  keyHash: string;
  /** Human-readable label set when the device paired. */
  label: string;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp of last seen X-Whatson-Auth match. */
  lastSeenAt: string | null;
}

let paired: PairedDevice[] | null = null;

async function loadPaired(): Promise<PairedDevice[]> {
  if (paired !== null) return paired;
  if (!PAIRED_FILE) {
    paired = [];
    return paired;
  }
  try {
    const raw = await fs.readFile(PAIRED_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    paired = Array.isArray(parsed) ? parsed : [];
  } catch {
    paired = [];
  }
  return paired;
}

async function savePaired(): Promise<void> {
  if (!PAIRED_FILE || paired === null) return;
  const dir = dirname(PAIRED_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await fs.writeFile(PAIRED_FILE, JSON.stringify(paired, null, 2), 'utf-8');
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function genCode(): string {
  // 6-digit numeric. crypto.randomInt is uniform over the full range.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function genKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ── Pairing flow ──

/**
 * Begin a new pair attempt. Replaces any existing pending code (only
 * one active at a time). The returned code is what the user types
 * into /setup to complete pairing.
 */
export function startPair(deviceLabel?: string): { code: string; expiresAt: number } {
  expireIfDone();
  const code = genCode();
  const expiresAt = Date.now() + CODE_TTL_MS;
  activePair = {
    status: 'pending',
    code,
    expiresAt,
    deviceLabel: deviceLabel || null,
  };
  return { code, expiresAt };
}

/**
 * Called by the unauthenticated client polling for completion. Returns:
 *  - { status: 'pending' } while waiting for admin to enter the code
 *  - { status: 'completed', key } when admin has finished pairing —
 *    the key is delivered ONCE and the slot is then cleared
 *  - { status: 'expired' } if the TTL passed or the wrong code was
 *    polled. Indistinguishable to the caller, on purpose.
 */
export function pollPair(code: string): { status: 'pending' | 'completed' | 'expired'; key?: string } {
  expireIfDone();
  if (!activePair) return { status: 'expired' };
  if (activePair.code !== code) return { status: 'expired' };
  if (activePair.status === 'pending') return { status: 'pending' };
  if (activePair.status === 'completed') {
    const key = activePair.key;
    activePair = null;  // one-shot delivery
    return { status: 'completed', key };
  }
  return { status: 'expired' };
}

/**
 * Called by the authenticated admin from /setup. Validates the code,
 * generates a fresh auth key, persists the device record (storing
 * only the hash), and stages the key for the client's next poll.
 */
export async function completePair(code: string, label: string): Promise<{ ok: boolean; deviceId?: string; reason?: string }> {
  expireIfDone();
  if (!activePair || activePair.status !== 'pending') {
    return { ok: false, reason: 'no-active-pair' };
  }
  if (activePair.code !== code) {
    return { ok: false, reason: 'wrong-code' };
  }

  const key = genKey();
  const id = crypto.randomBytes(8).toString('hex');
  const list = await loadPaired();
  list.push({
    id,
    keyHash: hashKey(key),
    label: label || activePair.deviceLabel || 'Unnamed device',
    createdAt: new Date().toISOString(),
    lastSeenAt: null,
  });
  await savePaired();

  activePair = {
    ...activePair,
    status: 'completed',
    key,
  };
  return { ok: true, deviceId: id };
}

export function getPendingPair(): { code: string; expiresAt: number; deviceLabel: string | null } | null {
  expireIfDone();
  if (!activePair || activePair.status !== 'pending') return null;
  return { code: activePair.code, expiresAt: activePair.expiresAt, deviceLabel: activePair.deviceLabel };
}

function expireIfDone(): void {
  if (!activePair) return;
  if (activePair.status === 'expired') {
    activePair = null;
    return;
  }
  if (activePair.expiresAt < Date.now()) {
    activePair = null;
  }
}

// ── Auth-key validation (called from API middleware) ──

/**
 * Validate a presented auth key against the paired-devices list.
 * Bumps `lastSeenAt` opportunistically so the admin UI can flag
 * stale devices. Returns the device record on match, null otherwise.
 */
export async function verifyAuthKey(key: string): Promise<PairedDevice | null> {
  if (!key) return null;
  const list = await loadPaired();
  const target = hashKey(key);
  const match = list.find((d) => d.keyHash === target);
  if (!match) return null;
  match.lastSeenAt = new Date().toISOString();
  // Fire-and-forget save; don't make every request wait on disk.
  savePaired().catch(() => {});
  return match;
}

export async function listPairedDevices(): Promise<Array<Omit<PairedDevice, 'keyHash'>>> {
  const list = await loadPaired();
  return list.map(({ keyHash: _kh, ...rest }) => rest);
}

export async function revokeDevice(id: string): Promise<boolean> {
  const list = await loadPaired();
  const before = list.length;
  paired = list.filter((d) => d.id !== id);
  await savePaired();
  return paired.length < before;
}

export async function hasPairedDevices(): Promise<boolean> {
  const list = await loadPaired();
  return list.length > 0;
}

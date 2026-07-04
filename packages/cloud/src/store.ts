import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import type { Account, ServerRecord, Invite, DeviceGrant, ClaimCode, Candidate } from './types.js';

/**
 * Minimal persistence for the control plane.
 *
 * This is a JSON-file implementation — deliberately swappable. In production
 * (doc 02 §4) this becomes Azure Table Storage or Postgres; every access goes
 * through this module so that swap is a one-file change. Nothing here stores
 * media, watch state, service tokens, or PINs.
 */

interface Db {
  accounts: Account[];
  servers: ServerRecord[];
  invites: Invite[];
  grants: DeviceGrant[];
  claimCodes: ClaimCode[];
}

const EMPTY: Db = { accounts: [], servers: [], invites: [], grants: [], claimCodes: [] };

let db: Db | null = null;

function file(): string {
  mkdirSync(config.dataDir, { recursive: true });
  return join(config.dataDir, 'cloud-db.json');
}

function load(): Db {
  if (db) return db;
  try {
    if (existsSync(file())) {
      const parsed = JSON.parse(readFileSync(file(), 'utf-8')) as Partial<Db>;
      db = { ...EMPTY, ...parsed };
    } else {
      db = { ...EMPTY };
    }
  } catch {
    db = { ...EMPTY };
  }
  return db;
}

function persist(): void {
  if (!db) return;
  writeFileSync(file(), JSON.stringify(db, null, 2), 'utf-8');
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}

function pruneExpired(): void {
  const d = load();
  const now = Date.now();
  const before = d.claimCodes.length + d.invites.length;
  d.claimCodes = d.claimCodes.filter((c) => c.expiresAt > now);
  // Keep redeemed invites for audit; drop only unredeemed-and-expired.
  d.invites = d.invites.filter((i) => i.redeemedAt !== null || i.expiresAt > now);
  if (d.claimCodes.length + d.invites.length !== before) persist();
}

// ── Accounts ────────────────────────────────────────────────────────────────

export function createAccount(email: string, passwordHash: string): Account {
  const d = load();
  const account: Account = { id: id('acct'), email: email.toLowerCase(), passwordHash, createdAt: new Date().toISOString() };
  d.accounts.push(account);
  persist();
  return account;
}

export function findAccountByEmail(email: string): Account | null {
  return load().accounts.find((a) => a.email === email.toLowerCase()) ?? null;
}

export function findAccountById(accountId: string): Account | null {
  return load().accounts.find((a) => a.id === accountId) ?? null;
}

// ── Servers ─────────────────────────────────────────────────────────────────

export function getServer(serverId: string): ServerRecord | null {
  return load().servers.find((s) => s.id === serverId) ?? null;
}

export function upsertServer(record: ServerRecord): ServerRecord {
  const d = load();
  const idx = d.servers.findIndex((s) => s.id === record.id);
  if (idx >= 0) d.servers[idx] = record;
  else d.servers.push(record);
  persist();
  return record;
}

export function findServersByOwner(accountId: string): ServerRecord[] {
  return load().servers.filter((s) => s.ownerAccountId === accountId);
}

export function updateServerHeartbeat(
  serverId: string,
  patch: Partial<Pick<ServerRecord, 'candidates' | 'observedWanIp' | 'ipv6Url' | 'upnpMapped' | 'appVersion'>>,
): ServerRecord | null {
  const d = load();
  const s = d.servers.find((x) => x.id === serverId);
  if (!s) return null;
  Object.assign(s, patch, { lastHeartbeatAt: new Date().toISOString() });
  persist();
  return s;
}

// ── Claim codes ──────────────────────────────────────────────────────────────

export function putClaimCode(code: string, serverId: string, ttlMs: number): ClaimCode {
  const d = load();
  // One active claim per server.
  d.claimCodes = d.claimCodes.filter((c) => c.serverId !== serverId);
  const entry: ClaimCode = { code, serverId, expiresAt: Date.now() + ttlMs };
  d.claimCodes.push(entry);
  persist();
  return entry;
}

export function consumeClaimCode(code: string): ClaimCode | null {
  pruneExpired();
  const d = load();
  const idx = d.claimCodes.findIndex((c) => c.code === code);
  if (idx < 0) return null;
  const [entry] = d.claimCodes.splice(idx, 1);
  persist();
  return entry;
}

// ── Invites (M7 groundwork) ──────────────────────────────────────────────────

export function createInvite(input: Omit<Invite, 'token' | 'redeemedByAccountId' | 'redeemedAt'> & { token: string }): Invite {
  const d = load();
  const invite: Invite = { ...input, redeemedByAccountId: null, redeemedAt: null };
  d.invites.push(invite);
  persist();
  return invite;
}

export function getInvite(token: string): Invite | null {
  pruneExpired();
  return load().invites.find((i) => i.token === token) ?? null;
}

export function markInviteRedeemed(token: string, accountId: string): void {
  const d = load();
  const invite = d.invites.find((i) => i.token === token);
  if (invite) {
    invite.redeemedByAccountId = accountId;
    invite.redeemedAt = new Date().toISOString();
    persist();
  }
}

// ── Device grants ─────────────────────────────────────────────────────────────

export function createGrant(input: Omit<DeviceGrant, 'id' | 'createdAt' | 'revokedAt'>): DeviceGrant {
  const d = load();
  const grant: DeviceGrant = { ...input, id: id('grant'), createdAt: new Date().toISOString(), revokedAt: null };
  d.grants.push(grant);
  persist();
  return grant;
}

export function getGrantByCloudToken(cloudToken: string): DeviceGrant | null {
  const g = load().grants.find((x) => x.cloudToken === cloudToken) ?? null;
  return g && g.revokedAt === null ? g : null;
}

export function revokeGrant(grantId: string): boolean {
  const d = load();
  const g = d.grants.find((x) => x.id === grantId);
  if (!g || g.revokedAt) return false;
  g.revokedAt = new Date().toISOString();
  persist();
  return true;
}

export type { Candidate };

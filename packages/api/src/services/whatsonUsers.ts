/**
 * Whats On Users — a backend-managed user layer that unifies the
 * Plex / Jellyfin / Emby login experience.
 *
 * The admin creates one or more Whats On users in /setup. Each maps to
 * an optional Plex Home user, Jellyfin user, and Emby user. When the
 * feature is enabled, clients show this user list (instead of a Plex
 * Home picker or per-service login flow) and send the selected user id
 * back via the `X-Whatson-User` header. The middleware resolves that
 * into the right per-service user for adapter calls.
 *
 * Feature is off by default — when disabled, the app behaves exactly as
 * it did before. Data lives in `data/whatsonUsers.json`.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

export interface WhatsOnUser {
  id: string;
  name: string;
  /** Key into the built-in avatar catalog (see avatars.ts). */
  avatar: string;
  /** SHA-256 of the user's PIN, or null if no PIN is set. */
  pinHash: string | null;
  /** Plex Home user id (numeric). null = this user has no Plex content. */
  plexUserId: number | null;
  /**
   * Server-specific Plex token for the mapped Plex Home user, derived
   * once at mapping time. Required for PIN-protected Home users
   * (otherwise the runtime token cache can't switch into them without
   * the PIN). Not the user's PIN — that's used once to fetch this and
   * then discarded.
   */
  plexUserToken: string | null;
  /** Jellyfin user GUID. null = no Jellyfin content. */
  jellyfinUserId: string | null;
  /** Emby user GUID. null = no Emby content. */
  embyUserId: string | null;
}

interface WhatsOnUsersFile {
  enabled: boolean;
  users: WhatsOnUser[];
}

const EMPTY: WhatsOnUsersFile = { enabled: false, users: [] };

function file(): string {
  return join(DATA_DIR, 'whatsonUsers.json');
}

function ensureDir(): void {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function load(): WhatsOnUsersFile {
  try {
    if (!existsSync(file())) return { ...EMPTY };
    const parsed = JSON.parse(readFileSync(file(), 'utf-8')) as WhatsOnUsersFile;
    return {
      enabled: parsed.enabled === true,
      users: Array.isArray(parsed.users) ? parsed.users : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

function save(state: WhatsOnUsersFile): void {
  ensureDir();
  writeFileSync(file(), JSON.stringify(state, null, 2), 'utf-8');
}

function newId(): string {
  return 'wo-' + randomBytes(4).toString('hex');
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

// ── Feature flag ──

export function isEnabled(): boolean {
  return load().enabled;
}

export function setEnabled(enabled: boolean): void {
  const state = load();
  state.enabled = enabled;
  save(state);
}

// ── User CRUD ──

export function listAll(): WhatsOnUser[] {
  return load().users;
}

export function findById(id: string): WhatsOnUser | null {
  return load().users.find((u) => u.id === id) || null;
}

export interface CreateUserInput {
  name: string;
  avatar: string;
  pin?: string | null;
  plexUserId?: number | null;
  plexUserToken?: string | null;
  jellyfinUserId?: string | null;
  embyUserId?: string | null;
}

export function create(input: CreateUserInput): WhatsOnUser {
  const name = (input.name || '').trim();
  if (!name) throw new Error('name is required');
  const state = load();
  const user: WhatsOnUser = {
    id: newId(),
    name,
    avatar: input.avatar || 'default',
    pinHash: input.pin ? sha256(input.pin) : null,
    plexUserId: input.plexUserId ?? null,
    plexUserToken: input.plexUserToken ?? null,
    jellyfinUserId: input.jellyfinUserId ?? null,
    embyUserId: input.embyUserId ?? null,
  };
  state.users.push(user);
  save(state);
  return user;
}

export interface UpdateUserInput {
  name?: string;
  avatar?: string;
  /** null clears the PIN, undefined leaves it unchanged, string sets a new one. */
  pin?: string | null;
  plexUserId?: number | null;
  plexUserToken?: string | null;
  jellyfinUserId?: string | null;
  embyUserId?: string | null;
}

export function update(id: string, input: UpdateUserInput): WhatsOnUser | null {
  const state = load();
  const idx = state.users.findIndex((u) => u.id === id);
  if (idx < 0) return null;
  const u = state.users[idx];
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) throw new Error('name cannot be empty');
    u.name = n;
  }
  if (input.avatar !== undefined) u.avatar = input.avatar;
  if (input.pin !== undefined) u.pinHash = input.pin === null ? null : sha256(input.pin);
  if (input.plexUserId !== undefined) {
    // Clearing or remapping the Plex user invalidates any stored
    // per-user token. The route layer will derive a fresh one if
    // a new mapping (and PIN, if required) was supplied.
    if (input.plexUserId !== u.plexUserId) u.plexUserToken = null;
    u.plexUserId = input.plexUserId;
  }
  if (input.plexUserToken !== undefined) u.plexUserToken = input.plexUserToken;
  if (input.jellyfinUserId !== undefined) u.jellyfinUserId = input.jellyfinUserId;
  if (input.embyUserId !== undefined) u.embyUserId = input.embyUserId;
  state.users[idx] = u;
  save(state);
  return u;
}

export function remove(id: string): boolean {
  const state = load();
  const before = state.users.length;
  state.users = state.users.filter((u) => u.id !== id);
  if (state.users.length === before) return false;
  save(state);
  return true;
}

// ── PIN verification ──

/** Returns true if no PIN is set, or the provided pin matches. */
export function verifyPin(user: WhatsOnUser, pin: string | undefined | null): boolean {
  if (!user.pinHash) return true;
  if (!pin) return false;
  return sha256(pin) === user.pinHash;
}

/**
 * Public-safe projection of a user — strips the PIN hash and the
 * derived Plex token. Adds `hasPin` so clients can render PIN-entry
 * UI, and `hasPlexToken` so the admin UI can show whether a
 * PIN-protected Plex Home user has been resolved.
 */
export function toPublic(user: WhatsOnUser): Omit<WhatsOnUser, 'pinHash' | 'plexUserToken'> & {
  hasPin: boolean;
  hasPlexToken: boolean;
} {
  const { pinHash, plexUserToken, ...rest } = user;
  return {
    ...rest,
    hasPin: pinHash != null,
    hasPlexToken: plexUserToken != null,
  };
}

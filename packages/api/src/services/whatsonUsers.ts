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
import bcrypt from 'bcryptjs';
import { encryptSecret, decryptSecret, isEncrypted } from './secrets.js';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

/** Privilege level of a Whats On user (unified user model). */
export type UserRole = 'admin' | 'member';

/**
 * A Whats On user's identity on one subsystem. `userId` is the subsystem's user
 * id (Jellyfin/Emby GUID, or Plex Home user id as a string). `token`, when held,
 * is a per-user access token stored ENCRYPTED at rest (secrets.ts). `managed` is
 * true when Whats On created this subsystem user (and so may delete it) — false
 * when mapped to a pre-existing one (never delete on our say-so).
 */
export interface SubsystemMapping {
  userId: string;
  token: string | null;
  managed: boolean;
}

export interface WhatsOnUser {
  id: string;
  name: string;
  /** Key into the built-in avatar catalog (see avatars.ts). */
  avatar: string;
  /** admin manages users/config; member is an ordinary viewer. */
  role: UserRole;
  /**
   * bcrypt hash of the user's PIN, or null if no PIN is set. Legacy records
   * may hold an unsalted SHA-256 hex hash; these are upgraded to bcrypt
   * transparently on the next successful verify (see verifyPin).
   */
  pinHash: string | null;
  /** Per-subsystem identity. Absent = this user has no content on that subsystem. */
  mappings: {
    plex?: SubsystemMapping;
    jellyfin?: SubsystemMapping;
    emby?: SubsystemMapping;
  };
  /**
   * Per-subsystem allowed library ids. Absent/empty for a subsystem = all its
   * libraries (no restriction). Enforced server-side where possible (Phase C).
   */
  libraries?: {
    plex?: string[];
    jellyfin?: string[];
    emby?: string[];
  };
}

// ── Typed accessors — the rest of the app reads mappings through these so it
//    never has to know the storage shape (and Plex tokens decrypt transparently).

export function plexUserIdOf(u: WhatsOnUser): number | null {
  const raw = u.mappings.plex?.userId;
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}
export function plexTokenOf(u: WhatsOnUser): string | null {
  const t = u.mappings.plex?.token;
  return t ? decryptSecret(t) : null;
}
export function jellyfinUserIdOf(u: WhatsOnUser): string | null {
  return u.mappings.jellyfin?.userId ?? null;
}
export function embyUserIdOf(u: WhatsOnUser): string | null {
  return u.mappings.emby?.userId ?? null;
}

// ── Per-user session tokens (PIN proof) ──
// Minted at /select once the PIN is verified; presented on later requests so
// `X-Whatson-User` isn't merely client-asserted for PIN-protected users. AES-GCM
// (secrets.ts) makes the token tamper-proof + stateless (survives restarts).

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function mintSessionToken(woUserId: string): string {
  return encryptSecret(JSON.stringify({ u: woUserId, exp: Date.now() + SESSION_TTL_MS }));
}

export function verifySessionToken(token: string | undefined | null, woUserId: string): boolean {
  if (!token) return false;
  const raw = decryptSecret(token);
  if (!raw) return false;
  try {
    const p = JSON.parse(raw) as { u?: string; exp?: number };
    return p.u === woUserId && typeof p.exp === 'number' && p.exp > Date.now();
  } catch {
    return false;
  }
}

/**
 * Guest access mode (M7 remote invites):
 *  - `closed` — each invite is tied to a specific Whats On user the admin
 *    picks (or a new one the guest creates); the guest is locked to it.
 *  - `open` — an invited guest isn't locked; on each app open they pick which
 *    Whats On user to watch as (and may create a new one), like the household.
 */
export type GuestMode = 'open' | 'closed';

interface WhatsOnUsersFile {
  enabled: boolean;
  guestMode?: GuestMode;
  users: WhatsOnUser[];
}

const EMPTY: WhatsOnUsersFile = { enabled: false, guestMode: 'closed', users: [] };

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
    const state: WhatsOnUsersFile = {
      enabled: parsed.enabled === true,
      guestMode: parsed.guestMode === 'open' ? 'open' : 'closed',
      users: Array.isArray(parsed.users) ? parsed.users : [],
    };
    // Modernize old records in place (flat fields → nested mappings, add role,
    // encrypt Plex tokens). Idempotent — persists once, then no-ops.
    if (migrate(state)) save(state);
    return state;
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Migrate a loaded file to the unified-user-model shape. Returns true if it
 * changed anything (so the caller persists). Idempotent + non-destructive.
 */
function migrate(state: WhatsOnUsersFile): boolean {
  let changed = false;
  for (const u of state.users) {
    const anyU = u as unknown as Record<string, unknown>;
    // Build nested mappings from the old flat fields, once.
    if (anyU.mappings === undefined) {
      const m: WhatsOnUser['mappings'] = {};
      const plexId = anyU.plexUserId;
      if (plexId !== undefined && plexId !== null) {
        const tok = anyU.plexUserToken;
        m.plex = {
          userId: String(plexId),
          token: typeof tok === 'string' && tok ? encryptSecret(tok) : null,
          managed: false,
        };
      }
      if (typeof anyU.jellyfinUserId === 'string' && anyU.jellyfinUserId)
        m.jellyfin = { userId: anyU.jellyfinUserId, token: null, managed: false };
      if (typeof anyU.embyUserId === 'string' && anyU.embyUserId)
        m.emby = { userId: anyU.embyUserId, token: null, managed: false };
      u.mappings = m;
      changed = true;
    }
    // Drop the retired flat fields.
    for (const k of ['plexUserId', 'plexUserToken', 'jellyfinUserId', 'embyUserId']) {
      if (k in anyU) {
        delete anyU[k];
        changed = true;
      }
    }
    // Encrypt any Plex token that is still plaintext (belt-and-suspenders).
    if (u.mappings?.plex?.token && !isEncrypted(u.mappings.plex.token)) {
      u.mappings.plex.token = encryptSecret(u.mappings.plex.token);
      changed = true;
    }
    // Default role.
    if (u.role !== 'admin' && u.role !== 'member') {
      u.role = 'member';
      changed = true;
    }
  }
  // Someone must be able to manage — first user becomes admin if none is.
  if (state.users.length && !state.users.some((u) => u.role === 'admin')) {
    state.users[0].role = 'admin';
    changed = true;
  }
  return changed;
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

/** A stored hash is a legacy unsalted SHA-256 if it's exactly 64 hex chars. */
function isLegacySha256(hash: string): boolean {
  return /^[a-f0-9]{64}$/i.test(hash);
}

/** Hash a PIN with bcrypt (per-hash salt is automatic). */
function hashPin(pin: string): string {
  return bcrypt.hashSync(pin, 10);
}

// ── Feature flag ──

/**
 * Whats On Users is **always on** in the unified user model — the app has no
 * separate identity layer. In practice that means "on whenever a user exists":
 * `ensureDefaultAdmin()` auto-creates one at startup, so a configured server is
 * always on. The only "off" state is a fresh box with zero users before the
 * bootstrap runs (or if it couldn't map any subsystem) — there we fall back to
 * legacy Plex mode rather than showing an empty picker. The stored `enabled`
 * flag is retired (kept in the file for back-compat; no longer consulted).
 */
export function isEnabled(): boolean {
  return load().users.length > 0;
}

/** @deprecated The enable toggle is retired (always-on). Kept as a no-op writer. */
export function setEnabled(enabled: boolean): void {
  const state = load();
  state.enabled = enabled;
  save(state);
}

export function getGuestMode(): GuestMode {
  return load().guestMode === 'open' ? 'open' : 'closed';
}

export function setGuestMode(mode: GuestMode): void {
  const state = load();
  state.guestMode = mode === 'open' ? 'open' : 'closed';
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
  role?: UserRole;
  plexUserId?: number | null;
  plexUserToken?: string | null;
  jellyfinUserId?: string | null;
  embyUserId?: string | null;
  libraries?: WhatsOnUser['libraries'];
  /**
   * Explicit per-subsystem mappings — used for PROVISIONED (managed) users where
   * the caller already holds the subsystem userId + an already-ENCRYPTED token
   * (see subsystemUsers.provisionUser). Overrides the flat map-existing field for
   * that subsystem.
   */
  mappings?: Partial<WhatsOnUser['mappings']>;
}

export function create(input: CreateUserInput): WhatsOnUser {
  const name = (input.name || '').trim();
  if (!name) throw new Error('name is required');
  const state = load();
  const mappings: WhatsOnUser['mappings'] = {};
  if (input.plexUserId != null) {
    mappings.plex = {
      userId: String(input.plexUserId),
      token: input.plexUserToken ? encryptSecret(input.plexUserToken) : null,
      managed: false,
    };
  }
  if (input.jellyfinUserId) mappings.jellyfin = { userId: input.jellyfinUserId, token: null, managed: false };
  if (input.embyUserId) mappings.emby = { userId: input.embyUserId, token: null, managed: false };
  // Explicit mappings (provisioned/managed users) win over the flat fields.
  if (input.mappings?.plex) mappings.plex = input.mappings.plex;
  if (input.mappings?.jellyfin) mappings.jellyfin = input.mappings.jellyfin;
  if (input.mappings?.emby) mappings.emby = input.mappings.emby;
  const user: WhatsOnUser = {
    id: newId(),
    name,
    avatar: input.avatar || 'default',
    role: input.role === 'admin' ? 'admin' : 'member',
    pinHash: input.pin ? hashPin(input.pin) : null,
    mappings,
    libraries: input.libraries ?? {},
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
  role?: UserRole;
  plexUserId?: number | null;
  plexUserToken?: string | null;
  jellyfinUserId?: string | null;
  embyUserId?: string | null;
  libraries?: WhatsOnUser['libraries'];
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
  if (input.role !== undefined) u.role = input.role === 'admin' ? 'admin' : 'member';
  if (input.pin !== undefined) u.pinHash = input.pin === null ? null : hashPin(input.pin);
  if (input.plexUserId !== undefined) {
    if (input.plexUserId === null) {
      delete u.mappings.plex;
    } else {
      const cur = u.mappings.plex;
      // Remapping to a different Plex Home user invalidates the stored token;
      // the route layer derives a fresh one.
      const remapped = !cur || cur.userId !== String(input.plexUserId);
      u.mappings.plex = {
        userId: String(input.plexUserId),
        token: remapped ? null : cur!.token,
        managed: cur?.managed ?? false,
      };
    }
  }
  if (input.plexUserToken !== undefined && u.mappings.plex) {
    u.mappings.plex.token = input.plexUserToken ? encryptSecret(input.plexUserToken) : null;
  }
  if (input.jellyfinUserId !== undefined) {
    if (!input.jellyfinUserId) delete u.mappings.jellyfin;
    else u.mappings.jellyfin = { userId: input.jellyfinUserId, token: u.mappings.jellyfin?.token ?? null, managed: u.mappings.jellyfin?.managed ?? false };
  }
  if (input.embyUserId !== undefined) {
    if (!input.embyUserId) delete u.mappings.emby;
    else u.mappings.emby = { userId: input.embyUserId, token: u.mappings.emby?.token ?? null, managed: u.mappings.emby?.managed ?? false };
  }
  if (input.libraries !== undefined) u.libraries = input.libraries;
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

/**
 * Returns true if no PIN is set, or the provided pin matches.
 *
 * Legacy SHA-256 hashes still verify, and on a successful match are
 * transparently rehashed with bcrypt and persisted, so the unsalted hash is
 * upgraded in place the first time the user enters their PIN.
 */
export function verifyPin(user: WhatsOnUser, pin: string | undefined | null): boolean {
  if (!user.pinHash) return true;
  if (!pin) return false;

  if (isLegacySha256(user.pinHash)) {
    if (sha256(pin) !== user.pinHash) return false;
    // Transparent upgrade: rehash with bcrypt and write back.
    try {
      const state = load();
      const stored = state.users.find((u) => u.id === user.id);
      if (stored && stored.pinHash && isLegacySha256(stored.pinHash)) {
        stored.pinHash = hashPin(pin);
        save(state);
      }
    } catch {
      /* upgrade is best-effort; verification already succeeded */
    }
    return true;
  }

  try {
    return bcrypt.compareSync(pin, user.pinHash);
  } catch {
    return false;
  }
}

/**
 * Public-safe projection of a user — strips the PIN hash and the
 * derived Plex token. Adds `hasPin` so clients can render PIN-entry
 * UI, and `hasPlexToken` so the admin UI can show whether a
 * PIN-protected Plex Home user has been resolved.
 */
export interface PublicWhatsOnUser {
  id: string;
  name: string;
  avatar: string;
  role: UserRole;
  hasPin: boolean;
  hasPlexToken: boolean;
  /** Back-compat flat mapping ids (derived) — the admin UI + mobile read these. */
  plexUserId: number | null;
  jellyfinUserId: string | null;
  embyUserId: string | null;
  libraries: NonNullable<WhatsOnUser['libraries']>;
}

export function toPublic(user: WhatsOnUser): PublicWhatsOnUser {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    role: user.role,
    hasPin: user.pinHash != null,
    hasPlexToken: user.mappings.plex?.token != null,
    plexUserId: plexUserIdOf(user),
    jellyfinUserId: jellyfinUserIdOf(user),
    embyUserId: embyUserIdOf(user),
    libraries: user.libraries ?? {},
  };
}

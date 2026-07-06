import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { encryptSecret } from './secrets.js';

/**
 * Subsystem user *management* (unified user model, Phase B). Net-new: the content
 * adapters only READ + `listUsers()`; this module CREATES, library-scopes, and
 * deletes users on Jellyfin/Emby — the auto-provisioning half of Model A.
 *
 * Jellyfin and Emby share the same admin API (Emby is Jellyfin's ancestor), so a
 * single parameterised implementation covers both. Plex is deliberately excluded:
 * Plex user management is plex.tv Home-user territory (admin-mapped, capped,
 * Plex-Pass-gated) and lives in `users.ts`, not here.
 *
 * Auth: we authenticate as the configured admin (JELLYFIN_/EMBY_ USERNAME +
 * PASSWORD) to get an admin token, then create/policy/delete with it.
 */

export type ManagedKind = 'jellyfin' | 'emby';

const AUTH_HDR =
  'MediaBrowser Client="WhatsOn", Device="WhatsOn Server", DeviceId="whatson-backend", Version="1.0"';

function cfg(kind: ManagedKind): { url: string; username: string; password: string } {
  return kind === 'jellyfin' ? config.jellyfin : config.emby;
}

export interface AdminSession {
  kind: ManagedKind;
  base: string;
  token: string;
}
export interface SubUser {
  id: string;
  name: string;
}
export interface SubLibrary {
  id: string;
  name: string;
}

async function req(
  base: string,
  path: string,
  method: string,
  token: string | undefined,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: AUTH_HDR,
    'X-Emby-Authorization': AUTH_HDR,
  };
  if (token) {
    headers['X-Emby-Token'] = token;
    headers['X-MediaBrowser-Token'] = token;
  }
  const res = await fetch(base.replace(/\/+$/, '') + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json };
}

/** Generate a strong random subsystem password. */
export function randomPassword(): string {
  return randomBytes(18).toString('base64url');
}

/** Authenticate as the configured admin for this subsystem. */
export async function adminSession(kind: ManagedKind): Promise<AdminSession> {
  const c = cfg(kind);
  if (!c.url) throw new Error(`${kind} is not configured (no URL).`);
  const { status, json } = await req(c.url, '/Users/AuthenticateByName', 'POST', undefined, {
    Username: c.username,
    Pw: c.password,
  });
  if (status !== 200 || !json?.AccessToken) {
    throw new Error(`${kind} admin authentication failed (HTTP ${status}).`);
  }
  return { kind, base: c.url, token: json.AccessToken };
}

export async function listUsers(s: AdminSession): Promise<SubUser[]> {
  const { json } = await req(s.base, '/Users', 'GET', s.token);
  return Array.isArray(json) ? json.map((u: any) => ({ id: u.Id, name: u.Name })) : [];
}

export async function listLibraries(s: AdminSession): Promise<SubLibrary[]> {
  const { json } = await req(s.base, '/Library/MediaFolders', 'GET', s.token);
  const items = json?.Items;
  return Array.isArray(items) ? items.map((l: any) => ({ id: l.Id, name: l.Name })) : [];
}

export async function createUser(s: AdminSession, name: string): Promise<SubUser> {
  const { status, json } = await req(s.base, '/Users/New', 'POST', s.token, { Name: name });
  if (!(status === 200 || status === 204) || !json?.Id) {
    throw new Error(`${s.kind}: create user failed (HTTP ${status}).`);
  }
  return { id: json.Id, name: json.Name ?? name };
}

export async function setPassword(s: AdminSession, userId: string, newPw: string): Promise<void> {
  const { status } = await req(s.base, `/Users/${userId}/Password`, 'POST', s.token, {
    CurrentPw: '',
    NewPw: newPw,
  });
  if (!(status === 200 || status === 204)) throw new Error(`${s.kind}: set password failed (HTTP ${status}).`);
}

/** Restrict a user to `libIds`, or pass null to grant all libraries. */
export async function setLibraries(s: AdminSession, userId: string, libIds: string[] | null): Promise<void> {
  const { json: user } = await req(s.base, `/Users/${userId}`, 'GET', s.token);
  const pol = (user?.Policy ?? {}) as Record<string, unknown>;
  if (libIds === null) {
    pol.EnableAllFolders = true;
    pol.EnabledFolders = [];
  } else {
    pol.EnableAllFolders = false;
    pol.EnabledFolders = libIds;
  }
  const { status } = await req(s.base, `/Users/${userId}/Policy`, 'POST', s.token, pol);
  if (!(status === 200 || status === 204)) throw new Error(`${s.kind}: set libraries failed (HTTP ${status}).`);
}

export async function deleteUser(s: AdminSession, userId: string): Promise<void> {
  const { status } = await req(s.base, `/Users/${userId}`, 'DELETE', s.token);
  if (!(status === 200 || status === 204)) throw new Error(`${s.kind}: delete user failed (HTTP ${status}).`);
}

/** Authenticate AS a (created) user to obtain their own access token. */
export async function userAccessToken(kind: ManagedKind, username: string, password: string): Promise<string> {
  const c = cfg(kind);
  const { status, json } = await req(c.url, '/Users/AuthenticateByName', 'POST', undefined, {
    Username: username,
    Pw: password,
  });
  if (status !== 200 || !json?.AccessToken) throw new Error(`${kind}: user token auth failed (HTTP ${status}).`);
  return json.AccessToken;
}

export interface ProvisionResult {
  userId: string;
  /** Encrypted (secrets.ts) access token for the new user. */
  encToken: string;
  /** Plaintext generated password — the caller may show it once or discard it. */
  password: string;
}

/**
 * High-level: create a managed subsystem user with a generated password and the
 * given libraries (null = all), then return its id + an ENCRYPTED access token.
 * The person never needs the password unless they want native-app access.
 */
export async function provisionUser(
  kind: ManagedKind,
  name: string,
  libIds: string[] | null,
): Promise<ProvisionResult> {
  const s = await adminSession(kind);
  const u = await createUser(s, name);
  const password = randomPassword();
  await setPassword(s, u.id, password);
  await setLibraries(s, u.id, libIds);
  const token = await userAccessToken(kind, name, password);
  return { userId: u.id, encToken: encryptSecret(token), password };
}

/** Map an EXISTING subsystem user by id — verifies it exists; no credential change. */
export async function mapExistingUser(kind: ManagedKind, userId: string): Promise<SubUser> {
  const s = await adminSession(kind);
  const { status, json } = await req(s.base, `/Users/${userId}`, 'GET', s.token);
  if (status !== 200 || !json?.Id) throw new Error(`${kind}: user ${userId} not found.`);
  return { id: json.Id, name: json.Name };
}

export function isConfigured(kind: ManagedKind): boolean {
  return !!cfg(kind).url;
}

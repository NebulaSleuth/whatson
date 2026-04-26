import * as crypto from 'crypto';
import { config, saveConfigToEnv } from '../config.js';

/**
 * Lightweight HMAC-signed cookie sessions for the /setup admin UI.
 *
 * Stateless — the cookie itself carries the session payload + an
 * HMAC. No store, no extra deps, survives backend restarts as long
 * as the session secret in `.env` doesn't change.
 *
 * The secret is auto-generated on first startup if `WHATSON_SESSION_SECRET`
 * is empty in `.env`, persisted back to `.env` so reboots don't
 * invalidate every existing session.
 */

const COOKIE_NAME = 'whatson_admin';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

interface SessionPayload {
  /** Session expiry, ms since epoch. */
  exp: number;
  /** Random nonce — invalidates all sessions when secret rotates. */
  nonce: string;
}

let cachedSecret: string | null = null;

function ensureSecret(): string {
  if (cachedSecret) return cachedSecret;
  const fromEnv = config.auth.sessionSecret;
  if (fromEnv) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  // First-run: generate, persist to .env, cache.
  const generated = crypto.randomBytes(32).toString('hex');
  cachedSecret = generated;
  try {
    saveConfigToEnv({ WHATSON_SESSION_SECRET: generated });
    console.log('[session] generated and persisted WHATSON_SESSION_SECRET');
  } catch (err) {
    console.warn('[session] failed to persist session secret:', (err as Error).message);
  }
  return generated;
}

function sign(payload: string): string {
  const secret = ensureSecret();
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueSessionCookie(): string {
  const payload: SessionPayload = {
    exp: Date.now() + SESSION_TTL_MS,
    nonce: crypto.randomBytes(8).toString('hex'),
  };
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf-8').toString('base64url');
  const sig = sign(body);
  const value = `${body}.${sig}`;
  // httpOnly + Lax + 7-day Max-Age. No Secure flag — backend serves
  // HTTP on the LAN; users running behind a TLS reverse proxy can
  // override at proxy level.
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

export function verifySessionCookie(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false;
  const cookies = cookieHeader.split(';').map((c) => c.trim());
  const target = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!target) return false;
  const value = target.slice(COOKIE_NAME.length + 1);
  const dot = value.lastIndexOf('.');
  if (dot < 0) return false;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(body);
  // Constant-time compare to avoid leaking signature info via timing.
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    const json = Buffer.from(body, 'base64url').toString('utf-8');
    const payload = JSON.parse(json) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

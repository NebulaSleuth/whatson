/**
 * HTTP-surface guards: CORS allowlist + Host-header (anti-DNS-rebind) check.
 *
 * See docs/remote-access/01-security-hardening.md Item 6. The bare `cors()`
 * call reflected any origin, and nothing validated the Host header — so a
 * malicious web page could rebind its own hostname to the user's LAN IP and
 * script requests against the open backend. CORS only stops the browser from
 * *reading* the response; the Host-header check is what actually rejects the
 * rebound request.
 *
 * Both are deliberately conservative: native apps (Roku, React Native) send no
 * Origin and reach the backend by IP, so they're unaffected. The normal LAN
 * access pattern (browser → http://192.168.x.y:3001) uses an IP-literal Host,
 * which is allowed. Only public-domain Origins/Hosts are rejected — those are
 * the rebind/credential-scripting vectors — with env allowlists for anyone
 * running a custom hostname.
 */
import net from 'node:net';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { isBlockedIp } from './urlGuard.js';

function parseList(env: string | undefined): string[] {
  return (env || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const extraOrigins = new Set(parseList(process.env.WHATSON_ALLOWED_ORIGINS));
const extraHosts = new Set(parseList(process.env.WHATSON_ALLOWED_HOSTS));
// Opt-in for now: a strict Host check would 403 anyone reaching their backend
// by a non-IP hostname (Tailscale MagicDNS, custom local DNS), which on the
// auto-updating fleet would lock them out of the whole app. Enable with
// WHATSON_HOST_CHECK=1. In M1 this becomes default-on for the IP-only LAN
// surface, with the remote listener allowlisting the cloud hostname.
const hostCheckEnabled = /^(1|true|yes)$/i.test(process.env.WHATSON_HOST_CHECK || '');

/** localhost / *.local / any private-or-loopback IP literal. */
function isLocalHostname(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.local')) return true;
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  return net.isIP(bare) !== 0 && isBlockedIp(bare);
}

function isAllowedOrigin(origin: string): boolean {
  if (extraOrigins.has(origin.toLowerCase())) return true;
  try {
    return isLocalHostname(new URL(origin).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * CORS: allow same-origin/native (no Origin), localhost/LAN origins, and any
 * env-configured origin. Unknown public origins get no CORS headers, so the
 * browser blocks cross-origin reads. `credentials: true` is safe because the
 * origin is not reflected for unlisted sites.
 */
export const corsMiddleware = cors({
  origin(origin, cb) {
    if (!origin) {
      cb(null, true); // native app / same-origin / curl — not subject to CORS
      return;
    }
    cb(null, isAllowedOrigin(origin));
  },
  credentials: true,
});

/**
 * Reject requests whose Host header is a public domain name — the DNS-rebinding
 * signature. IP-literal, localhost, *.local, and env-allowlisted hosts pass.
 * Opt-in via WHATSON_HOST_CHECK=1; add custom hostnames to WHATSON_ALLOWED_HOSTS.
 */
export function hostGuard(req: Request, res: Response, next: NextFunction): void {
  if (!hostCheckEnabled) {
    next();
    return;
  }
  const raw = (req.headers.host || '').toLowerCase();
  if (!raw) {
    next();
    return;
  }
  // Strip a trailing :port (also correct for bracketed IPv6 like [::1]:3001).
  const host = raw.replace(/:\d+$/, '');
  if (extraHosts.has(host) || isLocalHostname(host)) {
    next();
    return;
  }
  console.warn(`[security] rejected request with unexpected Host header: ${raw}`);
  res.status(403).send('Forbidden');
}

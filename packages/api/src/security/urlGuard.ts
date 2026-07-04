/**
 * SSRF guard for server-side fetches of caller-influenced URLs.
 *
 * The artwork proxy (and, later, the remote stream proxy — doc 01 Item 8)
 * fetch a URL the client supplies. Without a guard, `?url=http://169.254.169.254/…`
 * or `?url=http://192.168.1.1/…` turns the backend into an open proxy into the
 * home LAN, localhost, and cloud-metadata endpoints.
 *
 * Design (see docs/remote-access/04-implementation-plan.md, M0 / Item 1):
 *
 *  - The proxy legitimately serves artwork from *arbitrary public CDNs*
 *    (TMDB, TVDB, TVmaze, Silicondust — see utils.ts). A strict positive
 *    origin whitelist would break real posters, so the primary control is a
 *    network one: reject any destination that resolves to a private / reserved
 *    / loopback / link-local IP.
 *  - The configured media servers (Plex, Jellyfin, Emby, HDHomeRun) usually
 *    live on the LAN (private IPs), so those specific *hosts* are exempted.
 *  - Enforcement happens twice: a pre-flight resolve (fast, clean 400) and a
 *    connection-time `lookup` hook on the HTTP/HTTPS agents. The latter is what
 *    defeats DNS-rebinding / TOCTOU and re-validates every redirect hop, since
 *    a whitelisted host that 302s to 169.254.169.254 would otherwise slip past
 *    a one-shot pre-flight check.
 */
import net from 'node:net';
import dns from 'node:dns';
import type { LookupFunction } from 'node:net';
import { config } from '../config.js';
import { getServerUrl } from '../services/plex.js';

/** Thrown when a fetch target is rejected pre-flight. Handlers map it to 400. */
export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

// Private / reserved / loopback / link-local ranges we refuse to fetch from
// unless the target host is a configured media server (see mediaServerHosts).
const blocked = new net.BlockList();
// IPv4
blocked.addSubnet('0.0.0.0', 8, 'ipv4'); // "this" network
blocked.addSubnet('10.0.0.0', 8, 'ipv4'); // RFC1918
blocked.addSubnet('100.64.0.0', 10, 'ipv4'); // CGNAT shared
blocked.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
blocked.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local (incl. cloud metadata)
blocked.addSubnet('172.16.0.0', 12, 'ipv4'); // RFC1918
blocked.addSubnet('192.0.0.0', 24, 'ipv4'); // IETF protocol assignments
blocked.addSubnet('192.168.0.0', 16, 'ipv4'); // RFC1918
blocked.addSubnet('198.18.0.0', 15, 'ipv4'); // benchmarking
blocked.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
blocked.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved
// IPv6
blocked.addAddress('::1', 'ipv6'); // loopback
blocked.addAddress('::', 'ipv6'); // unspecified
blocked.addSubnet('fc00::', 7, 'ipv6'); // unique local
blocked.addSubnet('fe80::', 10, 'ipv6'); // link-local
blocked.addSubnet('ff00::', 8, 'ipv6'); // multicast

/** True if `ip` is a private/reserved address we must not fetch from. */
export function isBlockedIp(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) return blocked.check(ip, 'ipv4');
  if (fam === 6) {
    // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4 address.
    const mapped = ip.match(/:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped && net.isIP(mapped[1]) === 4) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(ip, 'ipv6');
  }
  return true; // not an IP literal — callers resolve hostnames first
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Plex is often auto-discovered (no configured URL), so resolve its current
// server URL and memoise the host briefly to keep artwork fetches cheap.
let plexHostCache: { host: string | null; at: number } = { host: null, at: 0 };
async function resolvePlexHost(): Promise<string | null> {
  const now = Date.now();
  if (plexHostCache.host && now - plexHostCache.at < 300_000) return plexHostCache.host;
  try {
    const url = config.plex.url || (await getServerUrl());
    const host = hostOf(url || undefined);
    if (host) plexHostCache = { host, at: now };
  } catch {
    /* keep last known host */
  }
  return plexHostCache.host;
}

/**
 * Hosts allowed to resolve to private IPs — the configured media servers,
 * which normally live on the LAN. Everything else must resolve to a public IP.
 */
export async function mediaServerHosts(): Promise<Set<string>> {
  const hosts = new Set<string>();
  const add = (h: string | null) => {
    if (h) hosts.add(h);
  };
  add(hostOf(config.plex.url));
  add(hostOf(config.jellyfin.url));
  add(hostOf(config.emby.url));
  add(hostOf(config.hdhomerun.url));
  add(await resolvePlexHost());
  return hosts;
}

/**
 * A `lookup` implementation for http/https Agents that rejects any resolved
 * address in a blocked range unless the host is an allowed media server.
 * Runs at connection time, so it also covers redirect hops and DNS rebinding.
 */
export function guardedLookup(allowHosts: Set<string>): LookupFunction {
  return function lookup(hostname: string, options: any, callback: any): void {
    const cb = (typeof options === 'function' ? options : callback) as (
      err: Error | null,
      address?: unknown,
      family?: number,
    ) => void;
    const opts = (typeof options === 'function' ? {} : options) || {};
    dns.lookup(hostname, { ...opts, all: true } as dns.LookupAllOptions, (err, addresses) => {
      if (err) {
        cb(err);
        return;
      }
      const allowPrivate = allowHosts.has(hostname.toLowerCase());
      for (const a of addresses) {
        if (!allowPrivate && isBlockedIp(a.address)) {
          cb(new SsrfError(`blocked SSRF target: ${hostname} -> ${a.address}`));
          return;
        }
      }
      if (opts.all) {
        cb(null, addresses as unknown, undefined);
      } else {
        cb(null, addresses[0].address, addresses[0].family);
      }
    });
  } as LookupFunction;
}

/**
 * Pre-flight validation of a caller-supplied fetch URL. Returns the parsed URL
 * when allowed; throws SsrfError (→ HTTP 400) when the scheme is unsupported or
 * the host resolves into a blocked range. Media-server hosts bypass the IP
 * check (they legitimately live on the LAN).
 */
export async function assertFetchAllowed(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfError('invalid url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfError(`unsupported scheme: ${parsed.protocol}`);
  }
  const host = parsed.hostname.toLowerCase();
  const allow = await mediaServerHosts();
  if (allow.has(host)) return parsed; // configured media server — may be LAN-private

  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new SsrfError(`dns resolution failed: ${host}`);
  }
  for (const a of addresses) {
    if (isBlockedIp(a.address)) {
      throw new SsrfError(`blocked SSRF target: ${host} -> ${a.address}`);
    }
  }
  return parsed;
}

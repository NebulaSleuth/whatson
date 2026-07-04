import type { ServerRecord } from './types.js';

/**
 * Reachability probe (doc 02 §4.5). The cloud connects to a server's claimed
 * WAN / IPv6 candidate from OUTSIDE and cross-checks against what the backend
 * self-reports. The signature "backend thinks the port is mapped, but the
 * outside probe fails" is the CGNAT tell, surfaced in /setup so the user isn't
 * left debugging a port-forward that can never work.
 */

export async function probeUrl(baseUrl: string, timeoutMs = 4000): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(new URL('/api/health', baseUrl), { signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface ReachabilityReport {
  serverId: string;
  ipv4Reachable: boolean;
  ipv6Reachable: boolean;
  upnpMapped: boolean;
  /** Backend believes it's mapped but the external IPv4 probe fails → CGNAT. */
  cgnatSuspected: boolean;
}

export async function probeServer(server: ServerRecord): Promise<ReachabilityReport> {
  const wan = server.candidates.find((c) => c.kind === 'wan');
  const ipv6 = server.candidates.find((c) => c.kind === 'ipv6');

  const [ipv4Reachable, ipv6Reachable] = await Promise.all([
    wan ? probeUrl(wan.url) : Promise.resolve(false),
    ipv6 ? probeUrl(ipv6.url) : Promise.resolve(false),
  ]);

  return {
    serverId: server.id,
    ipv4Reachable,
    ipv6Reachable,
    upnpMapped: server.upnpMapped,
    cgnatSuspected: server.upnpMapped && !ipv4Reachable,
  };
}

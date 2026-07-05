import https from 'node:https';
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

/**
 * External reachability probe for the WAN **IPv4** HTTPS path (M8/8c). Connects
 * to the observed IPv4 explicitly — NOT the hostname — because the hostname also
 * has an AAAA record, and the cloud's egress may prefer IPv6 (which the owner
 * hasn't necessarily pinholed), giving a false negative. `servername` is set to
 * the hostname so the per-server cert still validates by name.
 *
 * Returns true only if the port answers, the cert validates, AND the health
 * body echoes the EXPECTED serverId — so a stranger on that IP:port can't be
 * mistaken for the real server.
 */
export function probeWanReachable(
  ipv4: string,
  host: string,
  port: number,
  expectedServerId: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const req = https.request(
      { host: ipv4, port, path: '/api/health', method: 'GET', servername: host, timeout: timeoutMs },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish(false);
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          if (data.length < 10_000) data += c;
        });
        res.on('end', () => {
          try {
            const b = JSON.parse(data) as { serverId?: string; data?: { serverId?: string } };
            finish((b?.data?.serverId ?? b?.serverId ?? null) === expectedServerId);
          } catch {
            finish(false);
          }
        });
      },
    );
    req.on('error', (e) => {
      console.warn(`[probe] ${ipv4}:${port} error: ${(e as NodeJS.ErrnoException).code ?? e.message}`);
      finish(false);
    });
    req.on('timeout', () => {
      console.warn(`[probe] ${ipv4}:${port} timeout after ${timeoutMs}ms`);
      req.destroy();
      finish(false);
    });
    req.end();
  });
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

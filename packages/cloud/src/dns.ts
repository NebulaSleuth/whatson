import { config } from './config.js';

/**
 * Azure DNS publishing (M8). Writes per-server A/AAAA records into the
 * `s.whatsontv.net` zone so apps reach a backend by a cert-matching hostname
 * (`<serverId>.s.whatsontv.net`) instead of a bare IP — the IPv4-primary /
 * IPv6-secondary data path decided in docs/remote-access/STATUS.md.
 *
 * Auth is the App Service **managed identity** (DNS Zone Contributor, scoped to
 * the one zone) via the local MSI token endpoint — no secrets, no SDK. Dormant
 * unless subscription + RG are configured AND an MSI is present, so it's a no-op
 * in local dev.
 */

const MGMT_RESOURCE = 'https://management.azure.com/';
let tokenCache: { token: string; expMs: number } | null = null;
// serverId -> last IP written per type, so we skip redundant PUTs each heartbeat.
const lastWritten = new Map<string, string>();

export function dnsPublishingEnabled(): boolean {
  return Boolean(
    config.dns.subscriptionId &&
      config.dns.resourceGroup &&
      process.env.IDENTITY_ENDPOINT &&
      process.env.IDENTITY_HEADER,
  );
}

async function getMgmtToken(): Promise<string | null> {
  if (tokenCache && tokenCache.expMs > Date.now() + 60_000) return tokenCache.token;
  const endpoint = process.env.IDENTITY_ENDPOINT;
  const header = process.env.IDENTITY_HEADER;
  if (!endpoint || !header) return null;
  try {
    const url = `${endpoint}?resource=${encodeURIComponent(MGMT_RESOURCE)}&api-version=2019-08-01`;
    const res = await fetch(url, { headers: { 'X-IDENTITY-HEADER': header } });
    if (!res.ok) {
      console.warn(`[dns] MSI token fetch failed: HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { access_token?: string; expires_on?: string };
    if (!body.access_token) return null;
    const expMs = body.expires_on ? parseInt(body.expires_on, 10) * 1000 : Date.now() + 3_600_000;
    tokenCache = { token: body.access_token, expMs };
    return body.access_token;
  } catch (err) {
    console.warn(`[dns] MSI token error: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Upsert one A or AAAA record `<name>.<zone>` -> `ip`. Idempotent + change-gated:
 * repeat calls with an unchanged IP are a no-op (no API call), so heartbeats
 * every 45s don't hammer ARM. Returns true if the record is (already) in place.
 */
export async function upsertRecord(name: string, type: 'A' | 'AAAA', ip: string): Promise<boolean> {
  if (!dnsPublishingEnabled()) return false;
  const cacheKey = `${type}:${name}`;
  if (lastWritten.get(cacheKey) === ip) return true;

  const token = await getMgmtToken();
  if (!token) return false;

  const { subscriptionId, resourceGroup, zone, ttl } = config.dns;
  const recordField = type === 'A' ? 'ARecords' : 'AAAARecords';
  const ipField = type === 'A' ? 'ipv4Address' : 'ipv6Address';
  const url =
    `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.Network/dnszones/${zone}/${type}/${encodeURIComponent(name)}?api-version=2018-05-01`;
  const payload = { properties: { TTL: ttl, [recordField]: [{ [ipField]: ip }] } };

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn(`[dns] upsert ${type} ${name} failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
      return false;
    }
    lastWritten.set(cacheKey, ip);
    console.log(`[dns] ${type} ${name}.${zone} -> ${ip}`);
    return true;
  } catch (err) {
    console.warn(`[dns] upsert ${type} ${name} error: ${(err as Error).message}`);
    return false;
  }
}

/** Extract the bare IPv6 address from an `https://[addr]:port` URL, or null. */
export function ipv6FromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/\[([0-9a-fA-F:]+)\]/.exec(url);
  return m ? m[1] : null;
}

/**
 * Publish DNS for a heartbeating server: A -> observed WAN IPv4, AAAA -> reported
 * global IPv6 (if any). Fire-and-forget from the heartbeat handler; errors are
 * logged, never thrown.
 */
export async function publishServerDns(serverId: string, wanIp: string | null, ipv6Url: string | null): Promise<void> {
  if (!dnsPublishingEnabled()) return;
  // The observed WAN IP is IPv4 (WSS socket remote addr); guard anyway.
  if (wanIp && !wanIp.includes(':')) await upsertRecord(serverId, 'A', wanIp);
  const v6 = ipv6FromUrl(ipv6Url);
  if (v6) await upsertRecord(serverId, 'AAAA', v6);
}

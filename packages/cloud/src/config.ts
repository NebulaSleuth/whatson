import { join } from 'node:path';

/**
 * Cloud control-plane config. Plain env reads — this service has no dotenv
 * search dance (unlike the backend); set env directly or via the host.
 */
export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  /**
   * Base cloud domain. Per-server hostnames are `<serverId>.s.<cloudDomain>`
   * (the Plex `plex.direct` pattern), so the DNS-01 cert zone is
   * `s.<cloudDomain>`. We consolidated onto the branding domain rather than a
   * separate `.direct`: the marketing site lives on the apex/`www`, while the
   * per-server machinery lives on the `s.` subdomain — one domain, no conflict.
   */
  cloudDomain: process.env.CLOUD_DOMAIN || 'whatsontv.net',
  dataDir: process.env.CLOUD_DATA_DIR || join(process.cwd(), 'data'),
  /**
   * Azure DNS publishing (M8). When a server heartbeats, the cloud writes an
   * A/AAAA record `<serverId>.<zone>` → the server's WAN IP so apps reach it by
   * a cert-matching hostname. Enabled only when subscription + RG are set AND an
   * MSI is present (App Service) — dormant locally. Zone defaults to `s.<domain>`.
   */
  dns: {
    subscriptionId: process.env.CLOUD_DNS_SUBSCRIPTION_ID || '',
    resourceGroup: process.env.CLOUD_DNS_RESOURCE_GROUP || '',
    zone: process.env.CLOUD_DNS_ZONE || `s.${process.env.CLOUD_DOMAIN || 'whatsontv.net'}`,
    ttl: parseInt(process.env.CLOUD_DNS_TTL || '60', 10),
  },
  /** TTL (seconds) for the candidate list handed to apps. */
  candidateTtl: parseInt(process.env.CANDIDATE_TTL || '300', 10),
  /** Signed-grant lifetime (seconds) — short; a grant is redeemed once. */
  grantTtl: parseInt(process.env.GRANT_TTL || '600', 10),
  /** Account session-token lifetime (seconds). */
  sessionTtl: parseInt(process.env.SESSION_TTL || '2592000', 10),
} as const;

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
   * `s.<cloudDomain>`. Branding lives on a separate domain (whatsontv.net).
   */
  cloudDomain: process.env.CLOUD_DOMAIN || 'whatson.direct',
  dataDir: process.env.CLOUD_DATA_DIR || join(process.cwd(), 'data'),
  /** TTL (seconds) for the candidate list handed to apps. */
  candidateTtl: parseInt(process.env.CANDIDATE_TTL || '300', 10),
  /** Signed-grant lifetime (seconds) — short; a grant is redeemed once. */
  grantTtl: parseInt(process.env.GRANT_TTL || '600', 10),
  /** Account session-token lifetime (seconds). */
  sessionTtl: parseInt(process.env.SESSION_TTL || '2592000', 10),
} as const;

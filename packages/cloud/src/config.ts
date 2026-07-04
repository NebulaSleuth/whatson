import { join } from 'node:path';

/**
 * Cloud control-plane config. Plain env reads — this service has no dotenv
 * search dance (unlike the backend); set env directly or via the host.
 */
export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  /**
   * Public DNS zone for per-server hostnames (<serverId>.s.<cloudDomain>).
   * OPEN DECISION (doc 02 §10): pick the real zone before the cert flow (M8).
   */
  cloudDomain: process.env.CLOUD_DOMAIN || 's.whatson.example',
  dataDir: process.env.CLOUD_DATA_DIR || join(process.cwd(), 'data'),
  /** TTL (seconds) for the candidate list handed to apps. */
  candidateTtl: parseInt(process.env.CANDIDATE_TTL || '300', 10),
  /** Signed-grant lifetime (seconds) — short; a grant is redeemed once. */
  grantTtl: parseInt(process.env.GRANT_TTL || '600', 10),
  /** Account session-token lifetime (seconds). */
  sessionTtl: parseInt(process.env.SESSION_TTL || '2592000', 10),
} as const;

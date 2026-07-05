import { Router } from 'express';
import { config } from '../config.js';
import { getServerId } from '../services/cloud/identity.js';
import { lanUrls, getCloudHostname } from '../services/cloud/registration.js';
import { loadCertificate } from '../services/cloud/acme.js';

/**
 * Connection candidates for THIS server (M7 owner self-access). Returns the LAN
 * URLs (same-network) plus the WAN hostname (internet) so a client that pairs on
 * the LAN can cache them and reach the server from anywhere later — the client's
 * racer picks whichever answers. Owner devices already hold auth keys that work
 * on the remote listener, so no cloud account is needed for self-access; the
 * cloud device-code / account flow (M7 full) is for guests.
 *
 * Consumer surface (both listeners), so it inherits apiAuth — a paired device
 * fetches its own server's addresses. The WAN candidate is advertised only when
 * remote access is on, the cloud hostname is known, and a TLS cert is held.
 */
export const candidatesRouter = Router();

interface CandidateOut {
  kind: 'lan' | 'wan' | 'ipv6';
  url: string;
  priority: number;
}

candidatesRouter.get('/candidates', (_req, res) => {
  const serverId = getServerId();
  const candidates: CandidateOut[] = [];
  for (const url of lanUrls()) candidates.push({ kind: 'lan', url, priority: 0 });
  const hostname = getCloudHostname();
  if (config.remote.enabled && hostname && loadCertificate()) {
    candidates.push({ kind: 'wan', url: `https://${hostname}:${config.remote.port}`, priority: 2 });
  }
  res.json({ success: true, data: { serverId, candidates } });
});

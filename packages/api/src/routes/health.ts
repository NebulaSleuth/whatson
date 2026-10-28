import { Router } from 'express';
import * as sonarr from '../services/sonarr.js';
import * as radarr from '../services/radarr.js';
import { config } from '../config.js';
import { getServerId } from '../services/cloud/identity.js';
import { getAdapter } from '../services/adapters/registry.js';

export const healthRouter = Router();

type ServiceState = 'connected' | 'error' | 'not_configured' | 'checking';
type ServiceName = 'plex' | 'jellyfin' | 'emby' | 'sonarr' | 'radarr';

// Clients race /api/health with a ~2s timeout to pick a LAN vs remote
// connection, so it must answer fast. Service checks used to run inline —
// an unreachable Plex made health take 20s+ and clients fell back to a slower
// path. Now checks run in the background and health returns the last result.
const STATUS_TTL_MS = 30_000;
const FIRST_CHECK_WAIT_MS = 500;

let lastStatus: { at: number; services: Record<ServiceName, ServiceState> } | null = null;
let refreshInFlight: Promise<void> | null = null;

function checks(): Record<ServiceName, (() => Promise<boolean>) | null> {
  const adapter = (kind: 'plex' | 'jellyfin' | 'emby') => {
    const a = getAdapter(kind);
    return a && a.isConfigured() ? () => a.testConnection() : null;
  };
  return {
    plex: adapter('plex'),
    jellyfin: adapter('jellyfin'),
    emby: adapter('emby'),
    sonarr: config.sonarr.url ? () => sonarr.testConnection() : null,
    radarr: config.radarr.url ? () => radarr.testConnection() : null,
  };
}

function refreshStatus(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const entries = await Promise.all(
        Object.entries(checks()).map(async ([name, check]) => {
          if (!check) return [name, 'not_configured'] as const;
          const ok = await check().catch(() => false);
          return [name, ok ? 'connected' : 'error'] as const;
        }),
      );
      lastStatus = {
        at: Date.now(),
        services: Object.fromEntries(entries) as Record<ServiceName, ServiceState>,
      };
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function getServiceStatus(): Promise<Record<ServiceName, ServiceState>> {
  const stale = !lastStatus || Date.now() - lastStatus.at > STATUS_TTL_MS;
  if (stale) {
    const alreadyRunning = refreshInFlight !== null;
    const refresh = refreshStatus();
    if (!lastStatus && !alreadyRunning) {
      // First call after boot: give the checks a moment, but never block long
      await Promise.race([refresh, new Promise((r) => setTimeout(r, FIRST_CHECK_WAIT_MS))]);
    }
  }
  if (lastStatus) return lastStatus.services;
  const pending = Object.fromEntries(
    Object.entries(checks()).map(([name, check]) => [name, check ? 'checking' : 'not_configured']),
  );
  return pending as Record<ServiceName, ServiceState>;
}

healthRouter.get('/health', async (_req, res) => {
  const services = await getServiceStatus();

  res.json({
    success: true,
    data: {
      api: true,
      // Stable server identity so the client's candidate racer can confirm it
      // reached the RIGHT backend (not a stranger's device on a foreign LAN).
      // Only present when remote access is on — a LAN-only server has no cloud
      // identity, and doesn't need one (M5 / P0 identity check).
      ...(config.remote.enabled ? { serverId: getServerId() } : {}),
      services,
    },
  });
});

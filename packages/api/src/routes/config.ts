import { Router } from 'express';
import { config } from '../config.js';
import * as plex from '../services/plex.js';
import * as plexPlayback from '../services/plexPlayback.js';
import * as sonarr from '../services/sonarr.js';
import * as radarr from '../services/radarr.js';
import { getCached, setCached } from '../cache.js';
import type { ApiResponse } from '@whatson/shared';

export const configRouter = Router();

/** Get full server configuration (masked secrets) */
configRouter.get('/config', async (_req, res) => {
  const data = {
    plex: {
      url: config.plex.url || '(auto-discover)',
      token: config.plex.token ? '••••' + config.plex.token.slice(-4) : '',
      configured: Boolean(config.plex.token),
    },
    sonarr: {
      url: config.sonarr.url,
      apiKey: config.sonarr.apiKey ? '••••' + config.sonarr.apiKey.slice(-4) : '',
      configured: Boolean(config.sonarr.url && config.sonarr.apiKey),
    },
    radarr: {
      url: config.radarr.url,
      apiKey: config.radarr.apiKey ? '••••' + config.radarr.apiKey.slice(-4) : '',
      configured: Boolean(config.radarr.url && config.radarr.apiKey),
    },
    epg: {
      provider: config.epg.provider,
      country: config.epg.country,
      tmdbApiKey: config.epg.tmdbApiKey ? '••••' + config.epg.tmdbApiKey.slice(-4) : '',
    },
  };

  res.json({ success: true, data });
});

configRouter.get('/config/status', async (_req, res) => {
  const configured = {
    plex: Boolean(config.plex.token),
    sonarr: Boolean(config.sonarr.url && config.sonarr.apiKey),
    radarr: Boolean(config.radarr.url && config.radarr.apiKey),
    epg: Boolean(config.epg.provider),
  };

  const response: ApiResponse<typeof configured> = { success: true, data: configured };
  res.json(response);
});

configRouter.post('/config/test', async (req, res) => {
  const { service, url, token, apiKey } = req.body;

  if (!service || !url) {
    res.status(400).json({ success: false, error: 'service and url are required' });
    return;
  }

  let connected = false;

  try {
    if (service === 'plex') {
      const origUrl = config.plex.url;
      const origToken = config.plex.token;
      config.plex.url = url;
      config.plex.token = token || config.plex.token;
      plex.resetClient();
      connected = await plex.testConnection();
      config.plex.url = origUrl;
      config.plex.token = origToken;
      plex.resetClient();
    } else if (service === 'sonarr') {
      const origUrl = config.sonarr.url;
      const origKey = config.sonarr.apiKey;
      config.sonarr.url = url;
      config.sonarr.apiKey = apiKey || config.sonarr.apiKey;
      sonarr.resetClient();
      connected = await sonarr.testConnection();
      config.sonarr.url = origUrl;
      config.sonarr.apiKey = origKey;
      sonarr.resetClient();
    } else if (service === 'radarr') {
      const origUrl = config.radarr.url;
      const origKey = config.radarr.apiKey;
      config.radarr.url = url;
      config.radarr.apiKey = apiKey || config.radarr.apiKey;
      radarr.resetClient();
      connected = await radarr.testConnection();
      config.radarr.url = origUrl;
      config.radarr.apiKey = origKey;
      radarr.resetClient();
    }
  } catch {
    connected = false;
  }

  const response: ApiResponse<{ connected: boolean }> = {
    success: true,
    data: { connected },
  };
  res.json(response);
});

/** Get Plex deep link for playback */
configRouter.get('/plex/play/:ratingKey', async (req, res) => {
  try {
    const ratingKey = req.params.ratingKey;

    // Cache the machine identifier
    // Ensure server is discovered
    const resolvedServerUrl = await plex.getServerUrl();

    let machineId = getCached<string>('plex:machineId');
    if (!machineId) {
      machineId = await plex.getMachineIdentifier() || undefined;
      if (machineId) setCached('plex:machineId', machineId, 3600);
    }

    if (!machineId) {
      res.status(500).json({ success: false, error: 'Could not get Plex server machine identifier' });
      return;
    }

    const metadataKey = `/library/metadata/${ratingKey}`;

    res.json({
      success: true,
      data: {
        // Native app deep link
        appLink: `plex://play/?metadataKey=${encodeURIComponent(metadataKey)}&server=${machineId}`,
        // Web/universal link that opens the app on mobile
        webLink: `https://app.plex.tv/desktop#!/server/${machineId}/details?key=${encodeURIComponent(metadataKey)}`,
        // Direct server play link
        serverLink: resolvedServerUrl
          ? `${resolvedServerUrl}/web/index.html#!/server/${machineId}/details?key=${encodeURIComponent(metadataKey)}&context=autoplay`
          : null,
        machineId,
        ratingKey,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Get available Plex players/clients */
configRouter.get('/plex/clients', async (_req, res) => {
  try {
    const [localClients, remoteClients] = await Promise.all([
      plexPlayback.getClients(),
      plexPlayback.getResources(),
    ]);

    // Deduplicate by machineIdentifier
    const seen = new Set<string>();
    const clients = [...localClients, ...remoteClients].filter((c) => {
      if (seen.has(c.machineIdentifier)) return false;
      seen.add(c.machineIdentifier);
      return true;
    });

    res.json({ success: true, data: clients });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Tell a Plex client to play a specific item */
configRouter.post('/plex/play', async (req, res) => {
  try {
    const { clientId, ratingKey } = req.body;

    if (!clientId || !ratingKey) {
      res.status(400).json({ success: false, error: 'clientId and ratingKey are required' });
      return;
    }

    const success = await plexPlayback.playOnClient(clientId, ratingKey);

    if (!success) {
      res.status(500).json({ success: false, error: 'Failed to send play command. Client may be offline.' });
      return;
    }

    res.json({ success: true, data: { playing: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

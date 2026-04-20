import { Router } from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { config, saveConfigToEnv, reloadConfig, getEnvFilePath } from '../config.js';
import * as plex from '../services/plex.js';
import * as plexPlayback from '../services/plexPlayback.js';
import * as sonarr from '../services/sonarr.js';
import * as radarr from '../services/radarr.js';
import { getCached, setCached } from '../cache.js';
import type { ApiResponse } from '@whatson/shared';

const PLEX_CLIENT_ID = 'whatson-api-server';

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

  if (!service) {
    res.status(400).json({ success: false, error: 'service is required' });
    return;
  }

  // Plex can work without a URL (auto-discover), but Sonarr/Radarr need one
  if (service !== 'plex' && !url) {
    res.status(400).json({ success: false, error: 'url is required' });
    return;
  }

  let connected = false;

  try {
    if (service === 'plex') {
      const origUrl = config.plex.url;
      const origToken = config.plex.token;
      config.plex.url = url || '';
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

/** Save config to .env and hot-reload */
configRouter.post('/config/save', async (req, res) => {
  try {
    const { plex: plexCfg, sonarr: sonarrCfg, radarr: radarrCfg, epg: epgCfg, port } = req.body;
    const values: Record<string, string> = {};

    if (port != null) {
      values.PORT = String(port);
    }

    if (plexCfg) {
      if ('url' in plexCfg) values.PLEX_URL = plexCfg.url || '';
      if ('token' in plexCfg) values.PLEX_TOKEN = plexCfg.token || '';
    }
    if (sonarrCfg) {
      if ('url' in sonarrCfg) values.SONARR_URL = sonarrCfg.url || '';
      if ('apiKey' in sonarrCfg) values.SONARR_API_KEY = sonarrCfg.apiKey || '';
    }
    if (radarrCfg) {
      if ('url' in radarrCfg) values.RADARR_URL = radarrCfg.url || '';
      if ('apiKey' in radarrCfg) values.RADARR_API_KEY = radarrCfg.apiKey || '';
    }
    if (epgCfg) {
      if ('provider' in epgCfg) values.EPG_PROVIDER = epgCfg.provider || 'tvmaze';
      if ('country' in epgCfg) values.EPG_COUNTRY = epgCfg.country || 'US';
      if ('tmdbApiKey' in epgCfg) values.TMDB_API_KEY = epgCfg.tmdbApiKey || '';
    }

    if (Object.keys(values).length === 0) {
      res.status(400).json({ success: false, error: 'No config values provided' });
      return;
    }

    // Save to .env file
    saveConfigToEnv(values);

    // Re-read .env into process.env
    dotenv.config({ path: getEnvFilePath(), override: true });

    // Reload runtime config
    reloadConfig();

    // Reset service clients so they pick up new config
    plex.resetClient();
    sonarr.resetClient();
    radarr.resetClient();

    res.json({ success: true, data: { saved: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Plex OAuth: request a PIN */
configRouter.post('/plex/pin', async (_req, res) => {
  try {
    const response = await axios.post(
      'https://plex.tv/api/v2/pins',
      { strong: true, 'X-Plex-Product': 'Whats On', 'X-Plex-Client-Identifier': PLEX_CLIENT_ID },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );

    const { id, code } = response.data;
    const authUrl = `https://app.plex.tv/auth#?clientID=${PLEX_CLIENT_ID}&code=${code}&context%5Bdevice%5D%5Bproduct%5D=Whats%20On`;

    res.json({
      success: true,
      data: { pinId: id, code, authUrl },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Plex OAuth: check PIN status */
configRouter.get('/plex/pin/:pinId', async (req, res) => {
  try {
    const response = await axios.get(
      `https://plex.tv/api/v2/pins/${req.params.pinId}`,
      {
        headers: {
          Accept: 'application/json',
          'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
        },
      },
    );

    const { authToken } = response.data;

    if (authToken) {
      // Save the token immediately
      saveConfigToEnv({ PLEX_TOKEN: authToken });
      dotenv.config({ path: getEnvFilePath(), override: true });
      reloadConfig();
      plex.resetClient();

      res.json({ success: true, data: { completed: true, token: '••••' + authToken.slice(-4) } });
    } else {
      res.json({ success: true, data: { completed: false } });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Get Plex connection info for client-side testing */
configRouter.get('/plex/connections', async (_req, res) => {
  try {
    const { getDiscoveredConnections, getServerUrl } = await import('../services/plex.js');
    // Ensure discovery has run
    await getServerUrl();
    const conns = getDiscoveredConnections();
    res.json({
      success: true,
      data: {
        local: conns.local,
        remote: conns.remote,
        serverUrl: conns.serverUrl,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
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

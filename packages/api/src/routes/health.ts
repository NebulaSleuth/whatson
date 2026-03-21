import { Router } from 'express';
import * as plex from '../services/plex.js';
import * as sonarr from '../services/sonarr.js';
import * as radarr from '../services/radarr.js';
import { config } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const [plexOk, sonarrOk, radarrOk] = await Promise.all([
    config.plex.token ? plex.testConnection() : null,
    config.sonarr.url ? sonarr.testConnection() : null,
    config.radarr.url ? radarr.testConnection() : null,
  ]);

  res.json({
    success: true,
    data: {
      api: true,
      services: {
        plex: plexOk === null ? 'not_configured' : plexOk ? 'connected' : 'error',
        sonarr: sonarrOk === null ? 'not_configured' : sonarrOk ? 'connected' : 'error',
        radarr: radarrOk === null ? 'not_configured' : radarrOk ? 'connected' : 'error',
      },
    },
  });
});

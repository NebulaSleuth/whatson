import { Router } from 'express';
import type { ApiResponse } from '@whatson/shared';
import { config } from '../config.js';

export const authRouter = Router();

/**
 * Report which providers are configured so the client can skip Plex-only flows
 * (user picker, PIN) when Plex isn't in play and render appropriate status.
 */
authRouter.get('/auth/providers', (_req, res) => {
  const data = {
    plex: Boolean(config.plex.token),
    jellyfin: Boolean(config.jellyfin.url && config.jellyfin.username),
    emby: Boolean(config.emby.url && config.emby.username),
    sonarr: Boolean(config.sonarr.url && config.sonarr.apiKey),
    radarr: Boolean(config.radarr.url && config.radarr.apiKey),
  };
  const response: ApiResponse<typeof data> = { success: true, data };
  res.json(response);
});

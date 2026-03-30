import { Router } from 'express';
import * as plex from '../services/plex.js';
import { proxyArtworkUrls, proxyArtwork } from '../utils.js';
import { config } from '../config.js';
import type { ApiResponse, ContentItem } from '@whatson/shared';

export const libraryRouter = Router();

libraryRouter.get('/library/:type', async (req, res) => {
  try {
    const type = req.params.type as 'movie' | 'show';
    if (type !== 'movie' && type !== 'show') {
      res.status(400).json({ success: false, error: 'Type must be "movie" or "show"' });
      return;
    }

    if (!config.plex.token) {
      res.status(400).json({ success: false, error: 'Plex not configured' });
      return;
    }

    const items = await plex.getLibrary(type, req.plexUserToken);
    const response: ApiResponse<ContentItem[]> = { success: true, data: proxyArtworkUrls(items) };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Get seasons for a show */
libraryRouter.get('/library/show/:ratingKey/seasons', async (req, res) => {
  try {
    const seasons = await plex.getShowSeasons(req.params.ratingKey, req.plexUserToken);
    res.json({ success: true, data: seasons });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Get episodes for a season */
libraryRouter.get('/library/season/:ratingKey/episodes', async (req, res) => {
  try {
    const episodes = await plex.getSeasonEpisodes(req.params.ratingKey, req.plexUserToken);
    res.json({ success: true, data: proxyArtworkUrls(episodes) });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

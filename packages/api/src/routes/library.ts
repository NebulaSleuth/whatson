import { Router } from 'express';
import * as plex from '../services/plex.js';
import { proxyArtworkUrls } from '../utils.js';
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

    const items = await plex.getLibrary(type);
    const response: ApiResponse<ContentItem[]> = { success: true, data: proxyArtworkUrls(items) };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

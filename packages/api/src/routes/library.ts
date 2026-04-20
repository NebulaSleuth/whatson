import { Router } from 'express';
import type { ApiResponse, ContentItem, ContentSource } from '@whatson/shared';
import { getAdapterForSource } from '../services/adapters/registry.js';
import { proxyArtworkUrls } from '../utils.js';

export const libraryRouter = Router();

function sourceFrom(req: { query: Record<string, unknown> }): ContentSource {
  const raw = (req.query.source as string) || 'plex';
  return raw as ContentSource;
}

libraryRouter.get('/library/:type', async (req, res) => {
  try {
    const type = req.params.type as 'movie' | 'show';
    if (type !== 'movie' && type !== 'show') {
      res.status(400).json({ success: false, error: 'Type must be "movie" or "show"' });
      return;
    }

    const source = sourceFrom(req);
    const adapter = getAdapterForSource(source);
    if (!adapter || !adapter.isConfigured()) {
      res.status(400).json({ success: false, error: `Source "${source}" not configured` });
      return;
    }

    const items = await adapter.getLibrary(type, req.plexUserToken);
    const response: ApiResponse<ContentItem[]> = { success: true, data: proxyArtworkUrls(items) };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Get seasons for a show */
libraryRouter.get('/library/show/:ratingKey/seasons', async (req, res) => {
  try {
    const source = sourceFrom(req);
    const adapter = getAdapterForSource(source);
    if (!adapter) {
      res.status(400).json({ success: false, error: `Unsupported source "${source}"` });
      return;
    }
    const seasons = await adapter.getShowSeasons(req.params.ratingKey, req.plexUserToken);
    res.json({ success: true, data: seasons });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Get episodes for a season */
libraryRouter.get('/library/season/:ratingKey/episodes', async (req, res) => {
  try {
    const source = sourceFrom(req);
    const adapter = getAdapterForSource(source);
    if (!adapter) {
      res.status(400).json({ success: false, error: `Unsupported source "${source}"` });
      return;
    }
    const episodes = await adapter.getSeasonEpisodes(req.params.ratingKey, req.plexUserToken);
    res.json({ success: true, data: proxyArtworkUrls(episodes) });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

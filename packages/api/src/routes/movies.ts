import { Router } from 'express';
import * as radarr from '../services/radarr.js';
import * as plex from '../services/plex.js';
import * as tracked from '../services/tracked.js';
import { config } from '../config.js';
import { proxyArtworkUrls } from '../utils.js';
import type { ApiResponse, ContentItem } from '@whatson/shared';
import { STREAMING_PROVIDERS } from '@whatson/shared';

export const moviesRouter = Router();

function trackedMoviesToContentItems(): ContentItem[] {
  return tracked.getByType('movie').map((item) => ({
    id: item.id,
    type: 'movie' as const,
    title: item.title,
    summary: item.overview,
    duration: 0,
    artwork: { poster: item.poster, thumbnail: item.backdrop || item.poster, background: item.backdrop || item.poster },
    source: 'live' as const,
    sourceId: String(item.tmdbId),
    status: 'ready' as const,
    progress: { watched: false, percentage: 0, currentPosition: 0 },
    availability: { availableAt: item.addedAt, network: STREAMING_PROVIDERS[item.provider] || item.provider },
    addedAt: item.addedAt,
    year: item.year,
    rating: item.rating,
    genres: [],
  }));
}

moviesRouter.get('/movies/recent', async (req, res) => {
  try {
    const limit = 20;
    const [radarrRecent, plexRecent] = await Promise.all([
      config.radarr.url ? radarr.getRecentDownloads(limit) : [],
      config.plex.token ? plex.getRecentlyAdded(limit, req.plexUserToken) : [],
    ]);
    const movies = [
      ...radarrRecent,
      ...plexRecent.filter((i) => i.type === 'movie'),
      ...trackedMoviesToContentItems(),
    ].filter((i) => !i.progress.watched);

    const response: ApiResponse<ContentItem[]> = { success: true, data: proxyArtworkUrls(movies) };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

moviesRouter.get('/movies/upcoming', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const data = config.radarr.url ? await radarr.getUpcoming(days) : [];
    const response: ApiResponse<ContentItem[]> = { success: true, data: proxyArtworkUrls(data) };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

moviesRouter.get('/movies/downloading', async (_req, res) => {
  try {
    const data = config.radarr.url ? await radarr.getQueue() : [];
    const response: ApiResponse<ContentItem[]> = { success: true, data: proxyArtworkUrls(data) };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

import { Router } from 'express';
import * as radarr from '../services/radarr.js';
import * as tracked from '../services/tracked.js';
import { config } from '../config.js';
import { proxyArtworkUrls } from '../utils.js';
import { getConfiguredAdapters } from '../services/adapters/registry.js';
import { sortInProgressFirst } from '../services/aggregator.js';
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
    const adapters = getConfiguredAdapters();
    // Library-server movies + tracked items only — no Radarr passthrough.
    // Mirrors the TV tab's "library only" approach (no Sonarr) and matches
    // the user expectation that anything in Ready to Watch is playable from
    // a configured media server.
    const perAdapterRecent = await Promise.all(
      adapters.map((a) =>
        a.getRecentlyAdded(limit, req.plexUserToken).catch(() => [] as ContentItem[]),
      ),
    );
    const libraryRecent = perAdapterRecent.flat();
    const seen = new Set<string>();
    const movies = sortInProgressFirst(
      [
        ...libraryRecent.filter((i) => i.type === 'movie'),
        ...trackedMoviesToContentItems(),
      ]
        .filter((i) => !i.progress.watched)
        .filter((i) => {
          // Dedupe by title-year so the same movie on two servers doesn't
          // surface twice. First seen wins (matches home aggregator).
          const key = `${i.title}-${i.year}`.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
    );

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

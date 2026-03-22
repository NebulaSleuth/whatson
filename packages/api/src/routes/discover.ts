import { Router } from 'express';
import * as discover from '../services/discover.js';
import * as tracked from '../services/tracked.js';
import { notifyDataChanged } from '../ws.js';
import type { ApiResponse, TrackedItem, TmdbSearchResult } from '@whatson/shared';

export const discoverRouter = Router();

/** Search for shows and movies (TMDB or Sonarr/Radarr fallback) */
discoverRouter.get('/discover/search', async (req, res) => {
  try {
    const query = req.query.q as string;
    if (!query || query.trim().length < 2) {
      res.status(400).json({ success: false, error: 'Query must be at least 2 characters' });
      return;
    }

    const results = await discover.searchMulti(query.trim());

    // Mark items that are already tracked
    const trackedItems = tracked.getAll();
    const trackedTmdbIds = new Set(trackedItems.map((t) => t.tmdbId));

    const enriched = results.map((r) => ({
      ...r,
      isTracked: trackedTmdbIds.has(r.tmdbId),
    }));

    const response: ApiResponse<typeof enriched> = { success: true, data: enriched };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Get tracked items (excludes watched by default) */
discoverRouter.get('/tracked', async (req, res) => {
  try {
    const includeWatched = req.query.all === 'true';
    const type = req.query.type as string | undefined;
    let items = includeWatched ? tracked.getAllIncludingWatched() : tracked.getAll();
    if (type) {
      items = items.filter((i) => i.type === type);
    }
    const response: ApiResponse<TrackedItem[]> = { success: true, data: items };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Add a tracked item */
discoverRouter.post('/tracked', async (req, res) => {
  try {
    const { tmdbId, title, type, year, overview, poster, backdrop, rating, provider, imdbId } = req.body;

    if (!tmdbId || !title || !type || !provider) {
      res.status(400).json({ success: false, error: 'tmdbId, title, type, and provider are required' });
      return;
    }

    const item = tracked.add({
      tmdbId,
      imdbId,
      title,
      type,
      year: year || 0,
      overview: overview || '',
      poster: poster || '',
      backdrop: backdrop || '',
      rating: rating || 0,
      provider,
    });

    notifyDataChanged('tracked-add', 'home', 'tv', 'tracked');
    const response: ApiResponse<TrackedItem> = { success: true, data: item };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Remove a tracked item */
discoverRouter.delete('/tracked/:tmdbId', async (req, res) => {
  try {
    const tmdbId = parseInt(req.params.tmdbId);
    const removed = tracked.remove(tmdbId);
    notifyDataChanged('tracked-remove', 'home', 'tv', 'tracked');
    res.json({ success: true, data: { removed } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Update provider for a tracked item */
discoverRouter.patch('/tracked/:tmdbId', async (req, res) => {
  try {
    const tmdbId = parseInt(req.params.tmdbId);
    const { provider } = req.body;
    const item = tracked.updateProvider(tmdbId, provider);
    if (!item) {
      res.status(404).json({ success: false, error: 'Item not found' });
      return;
    }
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

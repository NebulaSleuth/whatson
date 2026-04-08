import { Router } from 'express';
import * as plex from '../services/plex.js';
import * as discover from '../services/discover.js';
import { proxyArtwork } from '../utils.js';
import { config } from '../config.js';
import { getCached, setCached } from '../cache.js';
import type { ContentItem, ContentSection } from '@whatson/shared';

export const recommendationsRouter = Router();

/**
 * GET /api/recommendations
 *
 * Returns recommendation shelves:
 * 1. Plex hubs (always available — "Similar to X", genre-based, etc.)
 * 2. TMDB "Because you watched X" (if TMDB API key is configured)
 */
recommendationsRouter.get('/recommendations', async (req, res) => {
  try {
    const userToken = req.plexUserToken;
    const sections: ContentSection[] = [];
    let order = 0;

    // 1. Plex recommendation hubs (per-user, no external API needed)
    if (config.plex.token) {
      const hubs = await plex.getRecommendationHubs(userToken);
      for (const hub of hubs) {
        sections.push({
          id: `rec-plex-${order}`,
          title: hub.title,
          type: 'mixed',
          items: hub.items.map(proxyArtwork),
          sortOrder: order++,
        });
      }
    }

    // 2. TMDB "Because you watched X" (requires TMDB API key + client opt-in)
    const enableTmdb = req.query.tmdb !== '0';
    if (enableTmdb && discover.isTmdbAvailable() && config.plex.token) {
      // Short cache with randomization seed based on hour — refreshes every hour
      const hourSeed = Math.floor(Date.now() / (1000 * 60 * 60));
      const cacheKey = `recommendations:tmdb:${userToken?.slice(-8) || 'default'}:${hourSeed}`;
      let tmdbSections = getCached<ContentSection[]>(cacheKey);

      if (!tmdbSections) {
        // Get user's currently watching + recently watched from library
        const [continueWatching, onDeck, recentMovies, recentShows] = await Promise.all([
          plex.getContinueWatching(userToken).catch(() => []),
          plex.getOnDeck(userToken).catch(() => []),
          plex.getLibrary('movie', userToken).catch(() => []),
          plex.getLibrary('show', userToken).catch(() => []),
        ]);

        // Current: items being watched now
        const currentItems = [...continueWatching, ...onDeck]
          .filter((item) => item.type === 'episode' || item.type === 'movie')
          .map((item) => ({
            title: item.showTitle || item.title,
            type: (item.type === 'episode' ? 'tv' : 'movie') as 'movie' | 'tv',
          }));

        // Recent: items watched in the last 90 days from library
        const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
        const recentlyWatched = [...recentMovies, ...recentShows]
          .filter((item) => item.lastViewedAt && new Date(item.lastViewedAt).getTime() > ninetyDaysAgo)
          .sort((a, b) => new Date(b.lastViewedAt!).getTime() - new Date(a.lastViewedAt!).getTime())
          .map((item) => ({
            title: item.showTitle || item.title,
            type: (item.type === 'episode' ? 'tv' : item.type === 'show' ? 'tv' : 'movie') as 'movie' | 'tv',
          }));

        // Merge and deduplicate — current first, then recent
        const allItems = [...currentItems, ...recentlyWatched]
          .filter((item, i, arr) => arr.findIndex((a) => a.title === item.title) === i);

        // Randomize selection — pick 5 from the pool, shuffled
        const shuffled = allItems.sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, 5);

        // Build Plex library index by lowercase title for cross-referencing
        const plexIndex = new Map<string, ContentItem>();
        for (const item of [...recentMovies, ...recentShows]) {
          const key = (item.showTitle || item.title).toLowerCase();
          plexIndex.set(key, item);
        }

        const tmdbRecs = await discover.getTmdbRecommendations(selected);
        tmdbSections = tmdbRecs.map((rec) => ({
          id: `rec-tmdb-${order}`,
          title: rec.title,
          type: 'mixed' as const,
          items: rec.items
            .map((item) => {
              const titleKey = item.title.toLowerCase();
              const plexItem = plexIndex.get(titleKey);

              if (plexItem) {
                // In Plex library — skip if watched or partially watched
                if (plexItem.progress.watched || plexItem.progress.percentage > 0) return null;
                // Use the Plex item (has ratingKey, artwork, watch state)
                return proxyArtwork(plexItem);
              }

              // Not in Plex — return as discovery item
              return {
                id: `tmdb-${item.tmdbId}`,
                type: item.type === 'tv' ? 'show' as const : 'movie' as const,
                title: item.title,
                summary: item.overview,
                duration: 0,
                artwork: {
                  poster: item.poster,
                  thumbnail: item.backdrop || item.poster,
                  background: item.backdrop || item.poster,
                },
                source: (item.type === 'tv' ? 'sonarr' : 'radarr') as ContentItem['source'],
                sourceId: String(item.tmdbId),
                status: 'ready' as const,
                progress: { watched: false, percentage: 0, currentPosition: 0 },
                availability: { availableAt: '' },
                addedAt: '',
                year: item.year,
                rating: item.rating,
                genres: [],
              } as ContentItem;
            })
            .filter((item): item is ContentItem => item !== null),
          sortOrder: order++,
        })).filter((s) => s.items.length > 0);

        setCached(cacheKey, tmdbSections, 1800); // Cache 30 minutes (hourSeed rotates every hour)
      }

      sections.push(...tmdbSections);
    }

    res.json({ success: true, data: { sections } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

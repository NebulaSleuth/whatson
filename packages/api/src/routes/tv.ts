import { Router } from 'express';
import * as sonarr from '../services/sonarr.js';
import * as tracked from '../services/tracked.js';
import * as tvmaze from '../services/tvmaze.js';
import { config } from '../config.js';
import { proxyArtworkUrls } from '../utils.js';
import { getConfiguredAdapters } from '../services/adapters/registry.js';
import type { ApiResponse, ContentItem } from '@whatson/shared';
import { STREAMING_PROVIDERS } from '@whatson/shared';

export const tvRouter = Router();

/** Get episode-level items for tracked TV shows */
async function getTrackedTvEpisodes(): Promise<{ ready: ContentItem[]; comingSoon: ContentItem[] }> {
  const tvShows = tracked.getByType('tv');
  const ready: ContentItem[] = [];
  const comingSoon: ContentItem[] = [];

  for (const show of tvShows) {
    const providerLabel = STREAMING_PROVIDERS[show.provider] || show.provider;
    const base = {
      showTitle: show.title,
      artwork: { poster: show.poster, thumbnail: show.backdrop || show.poster, background: show.backdrop || show.poster },
      source: 'live' as const,
      sourceId: String(show.tmdbId),
      year: show.year,
      rating: show.rating,
      genres: [] as string[],
    };

    try {
      const recent = await tvmaze.getMostRecentEpisode(show.title);
      if (recent) {
        const ep = recent.episode;
        const airDate = ep.airstamp || ep.airdate;
        const daysSinceAired = airDate
          ? (Date.now() - new Date(airDate).getTime()) / (1000 * 60 * 60 * 24)
          : 0;
        const hasAired = daysSinceAired >= 0;
        const target = hasAired ? ready : comingSoon;
        // Auto-expire: skip episodes older than 7 days past air date
        if (daysSinceAired <= 7) {
          target.push({
            ...base,
            id: `tracked-ep-${show.tmdbId}-S${ep.season}E${ep.number}`,
            type: 'episode',
            title: ep.name || 'New Episode',
            seasonNumber: ep.season,
            episodeNumber: ep.number,
            summary: ep.summary ? ep.summary.replace(/<[^>]+>/g, '').trim() : show.overview,
            duration: ep.runtime || 0,
            status: hasAired ? 'ready' : 'coming_soon',
            progress: { watched: false, percentage: 0, currentPosition: 0 },
            availability: { availableAt: airDate, network: providerLabel },
            addedAt: airDate,
          });
        }
      }

      const upcoming = await tvmaze.getUpcomingEpisodes(show.title);
      if (upcoming) {
        for (const ep of upcoming.episodes) {
          comingSoon.push({
            ...base,
            id: `tracked-ep-${show.tmdbId}-S${ep.season}E${ep.number}`,
            type: 'episode',
            title: ep.name || 'TBA',
            seasonNumber: ep.season,
            episodeNumber: ep.number,
            summary: ep.summary ? ep.summary.replace(/<[^>]+>/g, '').trim() : show.overview,
            duration: ep.runtime || 0,
            status: 'coming_soon',
            progress: { watched: false, percentage: 0, currentPosition: 0 },
            availability: { availableAt: ep.airstamp || ep.airdate, network: providerLabel },
            addedAt: ep.airstamp || ep.airdate,
          });
        }
      }
    } catch {}
  }

  return { ready, comingSoon };
}

tvRouter.get('/tv/upcoming', async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const [sonarrData, trackedEps] = await Promise.all([
      config.sonarr.url ? sonarr.getUpcoming(days) : [],
      getTrackedTvEpisodes(),
    ]);
    const data = [...sonarrData, ...trackedEps.comingSoon].sort(
      (a, b) => new Date(a.availability.availableAt).getTime() - new Date(b.availability.availableAt).getTime(),
    );
    const response: ApiResponse<ContentItem[]> = { success: true, data: proxyArtworkUrls(data) };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

tvRouter.get('/tv/recent', async (req, res) => {
  try {
    const limit = 20;
    const adapters = getConfiguredAdapters();
    const [perAdapterRecent, trackedEps] = await Promise.all([
      Promise.all(
        adapters.map((a) =>
          a.getRecentlyAdded(limit, req.plexUserToken).catch(() => [] as ContentItem[]),
        ),
      ),
      getTrackedTvEpisodes(),
    ]);
    const libraryRecent = perAdapterRecent.flat();
    const allEpisodes = [
      ...libraryRecent.filter((i) => i.type === 'episode'),
      ...trackedEps.ready,
    ].filter((i) => !i.progress.watched);

    // Only show earliest unwatched episode per show
    const seen = new Set<string>();
    const sorted = [...allEpisodes].sort((a, b) => {
      if (a.showTitle && b.showTitle && a.showTitle === b.showTitle) {
        return ((a.seasonNumber || 0) * 1000 + (a.episodeNumber || 0)) -
               ((b.seasonNumber || 0) * 1000 + (b.episodeNumber || 0));
      }
      return 0;
    });
    const episodes = sorted.filter((i) => {
      if (!i.showTitle) return true;
      const key = i.showTitle.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const response: ApiResponse<ContentItem[]> = { success: true, data: proxyArtworkUrls(episodes) };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

tvRouter.get('/tv/downloading', async (_req, res) => {
  try {
    const data = config.sonarr.url ? await sonarr.getQueue() : [];
    const response: ApiResponse<ContentItem[]> = { success: true, data: proxyArtworkUrls(data) };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

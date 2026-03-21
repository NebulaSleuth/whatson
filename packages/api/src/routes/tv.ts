import { Router } from 'express';
import * as sonarr from '../services/sonarr.js';
import * as plex from '../services/plex.js';
import * as tracked from '../services/tracked.js';
import * as tvmaze from '../services/tvmaze.js';
import { config } from '../config.js';
import { proxyArtworkUrls } from '../utils.js';
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
        ready.push({
          ...base,
          id: `tracked-ep-${show.tmdbId}-S${ep.season}E${ep.number}`,
          type: 'episode',
          title: ep.name || 'New Episode',
          seasonNumber: ep.season,
          episodeNumber: ep.number,
          summary: ep.summary ? ep.summary.replace(/<[^>]+>/g, '').trim() : show.overview,
          duration: ep.runtime || 0,
          status: 'ready',
          progress: { watched: false, percentage: 0, currentPosition: 0 },
          availability: { availableAt: ep.airstamp || ep.airdate, network: providerLabel },
          addedAt: ep.airstamp || ep.airdate,
        });
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

tvRouter.get('/tv/recent', async (_req, res) => {
  try {
    const limit = 20;
    const [plexRecent, trackedEps] = await Promise.all([
      config.plex.token ? plex.getRecentlyAdded(limit) : [],
      getTrackedTvEpisodes(),
    ]);
    const episodes = [
      ...plexRecent.filter((i) => i.type === 'episode'),
      ...trackedEps.ready,
    ].filter((i) => !i.progress.watched);

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

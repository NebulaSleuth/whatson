import { Router } from 'express';
import type { ContentSource } from '@whatson/shared';
import * as tracked from '../services/tracked.js';
import { getAdapterForSource } from '../services/adapters/registry.js';
import type { MediaServerAdapter } from '../services/adapters/types.js';
import { notifyDataChanged } from '../ws.js';

export const scrobbleRouter = Router();

scrobbleRouter.post('/scrobble', async (req, res) => {
  try {
    const { sourceId, source } = req.body as { sourceId?: string; source?: ContentSource };

    if (!sourceId || !source) {
      res.status(400).json({ success: false, error: 'sourceId and source are required' });
      return;
    }

    const adapter = getAdapterForSource(source);
    if (adapter) {
      await adapter.markWatched(sourceId, req.plexUserToken);
    } else if (source === 'live') {
      // Tracked/live TV item — sourceId could be "tmdbId" or item id like "tracked-ep-123-S1E5"
      const episodeKey = req.body.episodeKey || sourceId;
      tracked.markWatched(episodeKey);
    } else {
      console.log(`[Scrobble] Mark as watched: ${source}:${sourceId} (no adapter)`);
    }

    notifyDataChanged('scrobble', 'home', 'tv', 'movies');
    res.json({ success: true, data: { marked: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

scrobbleRouter.post('/unscrobble', async (req, res) => {
  try {
    const { sourceId, source } = req.body as { sourceId?: string; source?: ContentSource };

    if (!sourceId || !source) {
      res.status(400).json({ success: false, error: 'sourceId and source are required' });
      return;
    }

    const adapter = getAdapterForSource(source);
    if (adapter) {
      await adapter.markUnwatched(sourceId, req.plexUserToken);
    } else if (source === 'live') {
      const episodeKey = req.body.episodeKey || sourceId;
      tracked.markUnwatched(episodeKey);
    }

    notifyDataChanged('scrobble', 'home', 'tv', 'movies', 'tracked');
    res.json({ success: true, data: { unmarked: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * Apply mark/unmark to every episode of a show. Plex's scrobble endpoint
 * only affects the single item it's called on, so we enumerate via
 * seasons → episodes. Jellyfin and Emby recursively mark children when
 * called on a Series, so one call suffices.
 *
 * `showId` is the show's sourceId (Plex grandparent ratingKey for an
 * episode, or Jellyfin/Emby SeriesId).
 */
async function applyShowMark(
  adapter: MediaServerAdapter,
  source: ContentSource,
  showId: string,
  mode: 'watched' | 'unwatched',
  userToken?: string,
): Promise<number> {
  if (source === 'jellyfin' || source === 'emby') {
    if (mode === 'watched') await adapter.markWatched(showId, userToken);
    else await adapter.markUnwatched(showId, userToken);
    return -1;
  }
  const seasons = await adapter.getShowSeasons(showId, userToken);
  let count = 0;
  for (const season of seasons) {
    const eps = await adapter.getSeasonEpisodes(season.ratingKey, userToken);
    for (const ep of eps) {
      try {
        if (mode === 'watched') await adapter.markWatched(ep.sourceId, userToken);
        else await adapter.markUnwatched(ep.sourceId, userToken);
        count++;
      } catch {
        // best-effort: keep going on per-episode failures
      }
    }
  }
  return count;
}

/**
 * Legacy fallback for older clients that send only a show title. Search
 * is capped server-side (Jellyfin/Emby Limit=50) so this misses most
 * episodes for any show with more than a handful; modern clients should
 * send sourceId.
 */
async function markAllByTitle(
  adapter: MediaServerAdapter,
  showTitle: string,
  mode: 'watched' | 'unwatched',
  userToken?: string,
): Promise<number> {
  const items = await adapter.search(showTitle, userToken);
  const episodes = items.filter(
    (i) => i.type === 'episode' && i.showTitle?.toLowerCase() === showTitle.toLowerCase(),
  );
  for (const ep of episodes) {
    try {
      if (mode === 'watched') await adapter.markWatched(ep.sourceId, userToken);
      else await adapter.markUnwatched(ep.sourceId, userToken);
    } catch {}
  }
  return episodes.length;
}

scrobbleRouter.post('/scrobble/all', async (req, res) => {
  try {
    const { showTitle, source, sourceId } = req.body as {
      showTitle?: string;
      source?: ContentSource;
      sourceId?: string;
    };

    const adapter = source ? getAdapterForSource(source) : undefined;
    if (adapter && sourceId && source) {
      const count = await applyShowMark(adapter, source, sourceId, 'watched', req.plexUserToken);
      console.log(
        `[Scrobble] Marked show ${sourceId} on ${source} (${count === -1 ? 'recursive' : count + ' episodes'})`,
      );
    } else if (adapter && showTitle) {
      const n = await markAllByTitle(adapter, showTitle, 'watched', req.plexUserToken);
      console.log(`[Scrobble] Marked ${n} episodes of "${showTitle}" on ${source} (legacy title path)`);
    } else if (source === 'live' && sourceId) {
      tracked.markShowWatched(parseInt(sourceId));
    }

    notifyDataChanged('scrobble', 'home', 'tv', 'movies', 'tracked');
    res.json({ success: true, data: { marked: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

scrobbleRouter.post('/unscrobble/all', async (req, res) => {
  try {
    const { showTitle, source, sourceId } = req.body as {
      showTitle?: string;
      source?: ContentSource;
      sourceId?: string;
    };

    const adapter = source ? getAdapterForSource(source) : undefined;
    if (adapter && sourceId && source) {
      const count = await applyShowMark(adapter, source, sourceId, 'unwatched', req.plexUserToken);
      console.log(
        `[Scrobble] Unmarked show ${sourceId} on ${source} (${count === -1 ? 'recursive' : count + ' episodes'})`,
      );
    } else if (adapter && showTitle) {
      const n = await markAllByTitle(adapter, showTitle, 'unwatched', req.plexUserToken);
      console.log(
        `[Scrobble] Unmarked ${n} episodes of "${showTitle}" on ${source} (legacy title path)`,
      );
    } else if (source === 'live' && sourceId) {
      tracked.markUnwatched(String(sourceId));
    }

    notifyDataChanged('scrobble', 'home', 'tv', 'movies', 'tracked');
    res.json({ success: true, data: { unmarked: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

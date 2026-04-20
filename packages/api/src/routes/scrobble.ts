import { Router } from 'express';
import type { ContentSource } from '@whatson/shared';
import * as tracked from '../services/tracked.js';
import { getAdapterForSource } from '../services/adapters/registry.js';
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
 * Mark all episodes of a show as watched. Library-server adapters with
 * hierarchical scrobble (Plex) can accept a show ratingKey directly — but the
 * existing client still sends a show title, so we search + iterate for those.
 */
scrobbleRouter.post('/scrobble/all', async (req, res) => {
  try {
    const { showTitle, source, sourceId } = req.body as {
      showTitle?: string;
      source?: ContentSource;
      sourceId?: string;
    };

    const adapter = source ? getAdapterForSource(source) : undefined;
    if (adapter && showTitle) {
      const items = await adapter.search(showTitle, req.plexUserToken);
      const episodes = items.filter(
        (i) => i.type === 'episode' && i.showTitle?.toLowerCase() === showTitle.toLowerCase(),
      );
      for (const ep of episodes) {
        try { await adapter.markWatched(ep.sourceId, req.plexUserToken); } catch {}
      }
      console.log(`[Scrobble] Marked ${episodes.length} episodes of "${showTitle}" on ${source}`);
    } else if (source === 'live' && sourceId) {
      tracked.markShowWatched(parseInt(sourceId));
    }

    notifyDataChanged('scrobble', 'home', 'tv', 'movies', 'tracked');
    res.json({ success: true, data: { marked: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Mark all episodes of a tracked show as unwatched */
scrobbleRouter.post('/unscrobble/all', async (req, res) => {
  try {
    const { sourceId, source } = req.body as { sourceId?: string; source?: ContentSource };

    if (source === 'live' && sourceId) {
      tracked.markUnwatched(String(sourceId));
    }

    notifyDataChanged('scrobble', 'home', 'tv', 'movies', 'tracked');
    res.json({ success: true, data: { unmarked: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

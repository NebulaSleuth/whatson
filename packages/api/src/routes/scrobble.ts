import { Router } from 'express';
import * as plex from '../services/plex.js';
import * as tracked from '../services/tracked.js';
import { notifyDataChanged } from '../ws.js';

export const scrobbleRouter = Router();

scrobbleRouter.post('/scrobble', async (req, res) => {
  try {
    const { sourceId, source } = req.body;

    if (!sourceId || !source) {
      res.status(400).json({ success: false, error: 'sourceId and source are required' });
      return;
    }

    if (source === 'plex') {
      await plex.markWatched(sourceId, req.plexUserToken);
    } else if (source === 'live') {
      // Tracked/live TV item — sourceId could be "tmdbId" or item id like "tracked-ep-123-S1E5"
      // Extract a watched key from the request
      const episodeKey = req.body.episodeKey || sourceId;
      tracked.markWatched(episodeKey);
    } else {
      console.log(`[Scrobble] Mark as watched: ${source}:${sourceId}`);
    }

    notifyDataChanged('scrobble', 'home', 'tv', 'movies');
    res.json({ success: true, data: { marked: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

scrobbleRouter.post('/unscrobble', async (req, res) => {
  try {
    const { sourceId, source } = req.body;

    if (!sourceId || !source) {
      res.status(400).json({ success: false, error: 'sourceId and source are required' });
      return;
    }

    if (source === 'plex') {
      await plex.markUnwatched(sourceId, req.plexUserToken);
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

/** Mark all episodes of a show as watched in Plex */
scrobbleRouter.post('/scrobble/all', async (req, res) => {
  try {
    const { showTitle, source, sourceId } = req.body;

    if (source === 'plex' && showTitle) {
      const items = await plex.search(showTitle, req.plexUserToken);
      const episodes = items.filter(
        (i) => i.type === 'episode' && i.showTitle?.toLowerCase() === showTitle.toLowerCase(),
      );
      for (const ep of episodes) {
        try { await plex.markWatched(ep.sourceId, req.plexUserToken); } catch {}
      }
      console.log(`[Scrobble] Marked ${episodes.length} episodes of "${showTitle}" as watched in Plex`);
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
    const { sourceId, source } = req.body;

    if (source === 'live' && sourceId) {
      tracked.markUnwatched(String(sourceId));
    }

    notifyDataChanged('scrobble', 'home', 'tv', 'movies', 'tracked');
    res.json({ success: true, data: { unmarked: true } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

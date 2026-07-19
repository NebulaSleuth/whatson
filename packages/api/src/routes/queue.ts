import { Router } from 'express';
import * as sonarr from '../services/sonarr.js';
import * as radarr from '../services/radarr.js';
import { notifyDataChanged } from '../ws.js';

export const queueRouter = Router();

/** Extract a human error message from an axios failure against Sonarr/Radarr. */
function arrError(error: any): { status: number; message: string } {
  return {
    status: error?.response?.status || 500,
    message:
      error?.response?.data?.message ||
      error?.response?.data?.[0]?.errorMessage ||
      error?.message ||
      'Download queue action failed',
  };
}

/**
 * Cancel a download that's in a Sonarr/Radarr queue. Removes the item from the
 * queue + download client. `blocklist` (optional) remembers the release as bad.
 * Body: { source: 'sonarr' | 'radarr', queueId: number, blocklist?: boolean }
 */
queueRouter.post('/queue/cancel', async (req, res) => {
  try {
    const { source, queueId, blocklist } = req.body || {};
    const id = Number(queueId);
    if (!id) {
      res.status(400).json({ success: false, error: 'queueId is required' });
      return;
    }
    if (source === 'sonarr') await sonarr.cancelDownload(id, !!blocklist);
    else if (source === 'radarr') await radarr.cancelDownload(id, !!blocklist);
    else {
      res.status(400).json({ success: false, error: `Unsupported source "${source}"` });
      return;
    }
    notifyDataChanged('cancel-download', 'home', 'tv', 'movies');
    res.json({ success: true, data: { cancelled: true } });
  } catch (error) {
    const { status, message } = arrError(error);
    console.error('[Queue] cancel failed:', message);
    res.status(status).json({ success: false, error: message });
  }
});

/**
 * Cancel a download AND kick off a fresh search for a better release. The bad
 * release is blocklisted so it isn't grabbed again, then Sonarr/Radarr searches
 * for the episode/movie.
 * Body: { source, queueId, sourceId } — sourceId is the episode id (Sonarr) or
 * movie id (Radarr), which is exactly the ContentItem.sourceId of a queue item.
 */
queueRouter.post('/queue/cancel-research', async (req, res) => {
  try {
    const { source, queueId, sourceId } = req.body || {};
    const id = Number(queueId);
    const targetId = Number(sourceId);
    if (!id || !targetId) {
      res.status(400).json({ success: false, error: 'queueId and sourceId are required' });
      return;
    }
    if (source === 'sonarr') {
      await sonarr.cancelDownload(id, true);
      await sonarr.searchEpisode(targetId);
    } else if (source === 'radarr') {
      await radarr.cancelDownload(id, true);
      await radarr.searchMovie(targetId);
    } else {
      res.status(400).json({ success: false, error: `Unsupported source "${source}"` });
      return;
    }
    notifyDataChanged('research-download', 'home', 'tv', 'movies');
    res.json({ success: true, data: { researching: true } });
  } catch (error) {
    const { status, message } = arrError(error);
    console.error('[Queue] cancel-research failed:', message);
    res.status(status).json({ success: false, error: message });
  }
});

import { Router } from 'express';
import type { ContentSource } from '@whatson/shared';
import { notifyDataChanged } from '../ws.js';
import { getAdapterForSource } from '../services/adapters/registry.js';

export const playbackRouter = Router();

function sourceFrom(req: { query: Record<string, unknown> }): ContentSource {
  const raw = (req.query.source as string) || 'plex';
  return raw as ContentSource;
}

/**
 * Get playback info for a library item — stream URL, subtitles, audio tracks.
 * Dispatched via adapter; Plex is the only implementation today.
 */
playbackRouter.get('/playback/:ratingKey', async (req, res) => {
  try {
    const { ratingKey } = req.params;
    const source = sourceFrom(req);
    const adapter = getAdapterForSource(source);
    if (!adapter || !adapter.isConfigured()) {
      res.status(400).json({ success: false, error: `Source "${source}" not configured` });
      return;
    }

    const data = await adapter.getPlaybackInfo(ratingKey, {
      offsetMs: req.query.offset ? parseInt(req.query.offset as string) * 1000 : 0,
      maxBitrate: req.query.maxBitrate ? parseInt(req.query.maxBitrate as string) : undefined,
      resolution: (req.query.resolution as string) || undefined,
      subtitleStreamID: req.query.subtitleStreamID ? parseInt(req.query.subtitleStreamID as string) : undefined,
      audioStreamID: req.query.audioStreamID ? parseInt(req.query.audioStreamID as string) : undefined,
      forceTranscode: req.query.forceTranscode === '1',
      connectionType: req.plexConnectionType,
      userToken: req.plexUserToken,
    });

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Report playback progress. */
playbackRouter.post('/playback/progress', async (req, res) => {
  try {
    const { ratingKey, time, duration, state, sessionId, source } = req.body as {
      ratingKey: string; time: number; duration: number; state: string; sessionId: string;
      source?: ContentSource;
    };
    const adapter = getAdapterForSource(source || 'plex');
    if (adapter) {
      await adapter.reportProgress(ratingKey, time, duration, state, sessionId, req.plexUserToken);
    }
    res.json({ success: true });
  } catch {
    res.json({ success: true }); // Never fail playback over progress reporting
  }
});

/** Stop a transcode / playback session. */
playbackRouter.post('/playback/stop', async (req, res) => {
  try {
    const { sessionId, source } = req.body as { sessionId?: string; source?: ContentSource };
    const adapter = getAdapterForSource(source || 'plex');
    if (adapter && sessionId) {
      await adapter.stopPlayback(sessionId, req.plexUserToken);
    }
    notifyDataChanged('playback-stop', 'home', 'tv', 'movies');
    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

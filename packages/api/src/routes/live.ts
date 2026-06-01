import { Router } from 'express';
import * as liveTv from '../services/liveTv.js';
import { config } from '../config.js';
import type { ApiResponse, ContentItem, LiveChannel, LiveStreamInfo } from '@whatson/shared';
import {
  allLiveSources,
  getConfiguredLiveSources,
  getLiveSourceForChannel,
} from '../services/live/registry.js';

export const liveRouter = Router();

function parseChannels(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

liveRouter.get('/live/channels', async (req, res) => {
  try {
    const country = (req.query.country as string) || config.epg.country || 'US';
    const channels = await liveTv.getChannels(country);
    const response: ApiResponse<string[]> = { success: true, data: channels };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

liveRouter.get('/live/now', async (req, res) => {
  try {
    const channels = parseChannels(req.query.channels);
    const country = (req.query.country as string) || config.epg.country || 'US';
    const items = await liveTv.getOnNow(channels, country);
    const response: ApiResponse<ContentItem[]> = { success: true, data: items };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

liveRouter.get('/live/later', async (req, res) => {
  try {
    const channels = parseChannels(req.query.channels);
    const country = (req.query.country as string) || config.epg.country || 'US';
    const hours = Math.max(1, Math.min(24, parseInt((req.query.hours as string) || '6', 10) || 6));
    const items = await liveTv.getOnLater(channels, country, hours);
    const response: ApiResponse<ContentItem[]> = { success: true, data: items };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ─── Live TV — tuner-source endpoints (HDHomeRun direct first; Plex /
//     Jellyfin / Emby live sources plug in via the same registry later) ───

/**
 * Status of every live source for /setup → Tuners. Always returns one
 * entry per source kind even when not configured, so the page can
 * render placeholder rows.
 */
liveRouter.get('/live/sources', async (_req, res) => {
  const sources = allLiveSources();
  const data = await Promise.all(
    sources.map(async (s) => {
      const configured = s.isConfigured();
      let connected = false;
      let channelCount = 0;
      if (configured) {
        try {
          connected = await s.testConnection();
          if (connected) {
            const chans = await s.getChannels();
            channelCount = chans.length;
          }
        } catch {
          connected = false;
        }
      }
      return { kind: s.kind, configured, connected, channelCount };
    }),
  );
  res.json({ success: true, data });
});

/**
 * Union channel list across every configured live source. Channel IDs
 * are source-prefixed (`hdhr-5.1`, `jellyfin-abc`) so the stream
 * endpoint can dispatch without ambiguity. Optional ?source= filter
 * narrows to a single source.
 */
liveRouter.get('/live/tuner-channels', async (req, res) => {
  try {
    const filter = (req.query.source as string) || '';
    const sources = getConfiguredLiveSources().filter(
      (s) => !filter || filter === 'all' || s.kind === filter,
    );
    const userToken = req.plexUserToken;
    const lists = await Promise.all(
      sources.map((s) => s.getChannels(userToken).catch(() => [] as LiveChannel[])),
    );
    const channels = lists.flat();
    const response: ApiResponse<LiveChannel[]> = { success: true, data: channels };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * Playable stream URL for a channel. Dispatches by ID prefix. Phase 1
 * returns the raw MPEG-TS URL for HDHomeRun — clients that play
 * MPEG-TS natively (Roku, iOS, Android) use it directly. The browser
 * client will get an HLS-proxied URL once the transmux is wired up in
 * Phase 1 week 3.
 */
liveRouter.get('/live/stream/:channelId', async (req, res) => {
  try {
    const channelId = req.params.channelId;
    const source = getLiveSourceForChannel(channelId);
    if (!source) {
      res.status(404).json({ success: false, error: `No live source for channel id "${channelId}"` });
      return;
    }
    const info = await source.getStreamInfo(channelId, req.plexUserToken);
    const response: ApiResponse<LiveStreamInfo> = { success: true, data: info };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

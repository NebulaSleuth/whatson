import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as liveTv from '../services/liveTv.js';
import { config } from '../config.js';
import type { ApiResponse, ContentItem, LiveChannel, LiveStreamInfo } from '@whatson/shared';
import {
  allLiveSources,
  getConfiguredLiveSources,
  getLiveSourceForChannel,
} from '../services/live/registry.js';
import { ensureHlsSession, getSession, touchSession } from '../services/live/hlsProxy.js';

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
    const format = (req.query.format as string) || '';
    const source = getLiveSourceForChannel(channelId);
    if (!source) {
      res.status(404).json({ success: false, error: `No live source for channel id "${channelId}"` });
      return;
    }
    const info = await source.getStreamInfo(channelId, req.plexUserToken);

    // ?format=hls — caller wants the stream wrapped in HLS via ffmpeg
    // (Roku for AC-3 audio, browsers because they can't play MPEG-TS).
    // Only meaningful when the source is mpeg-ts; for already-HLS
    // sources (Plex / Jellyfin / Emby live in Phase 2) we hand the
    // original URL back unchanged.
    if (format === 'hls' && info.format === 'mpeg-ts') {
      const session = await ensureHlsSession(channelId, info.url);
      // Build an absolute URL relative to the request so clients on
      // the LAN reach the right host without depending on the proxy
      // configuration.
      const proto = req.protocol;
      const host = req.get('host') || `localhost:${config.port}`;
      const proxiedUrl = `${proto}://${host}/api/live/hls/${session.id}/index.m3u8`;
      // Pass the device auth key through as a query param so the
      // playlist request from Roku's Video node (which can't set
      // custom headers) survives the auth middleware. Clients that
      // requested via the cookie session keep working without it.
      const auth = (req.headers['x-whatson-auth'] as string) || (req.query.auth as string);
      const playlistUrl = auth ? `${proxiedUrl}?auth=${encodeURIComponent(auth)}` : proxiedUrl;
      res.json({
        success: true,
        data: { url: playlistUrl, format: 'hls', sessionId: session.id, channel: info.channel },
      });
      return;
    }

    const response: ApiResponse<LiveStreamInfo> = { success: true, data: info };
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * Serve HLS playlist + segments produced by the ffmpeg transmuxer.
 * The session id comes from the stream endpoint above; expired
 * sessions return 404. Touching the session here resets the idle
 * timer so active viewers don't get reaped.
 */
liveRouter.get('/live/hls/:sessionId/:file', async (req, res) => {
  try {
    const sessionId = req.params.sessionId;
    const file = req.params.file;
    const session = getSession(sessionId);
    if (!session) {
      res.status(404).send('HLS session expired');
      return;
    }
    // Whitelist file names to prevent path traversal.
    if (!/^[a-zA-Z0-9._-]+\.(m3u8|ts)$/.test(file)) {
      res.status(400).send('Invalid file name');
      return;
    }
    const filePath = path.join(session.dir, file);
    if (!fs.existsSync(filePath)) {
      res.status(404).send('Segment not found');
      return;
    }
    touchSession(sessionId);
    res.setHeader(
      'Content-Type',
      file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
    );
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    res.status(500).send((error as Error).message);
  }
});

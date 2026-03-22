import { Router } from 'express';
import axios from 'axios';
import { config } from '../config.js';
import { getServerUrl, getMachineIdentifier } from '../services/plex.js';
import { notifyDataChanged } from '../ws.js';
import { PLEX_CLIENT_IDENTIFIER, PLEX_PRODUCT, APP_VERSION } from '@whatson/shared';

export const playbackRouter = Router();

/**
 * Get playback info for a Plex item — stream URL, subtitles, audio tracks.
 */
playbackRouter.get('/playback/:ratingKey', async (req, res) => {
  try {
    const { ratingKey } = req.params;
    const offset = parseInt(req.query.offset as string) || 0;
    const serverUrl = await getServerUrl();

    if (!serverUrl) {
      res.status(500).json({ success: false, error: 'Plex server not available' });
      return;
    }

    // Get item metadata for duration, subtitles, audio tracks
    const { data: metaRaw } = await axios.get(`${serverUrl}/library/metadata/${ratingKey}`, {
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': config.plex.token,
        'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
      },
      timeout: 10000,
    });

    const metaData = typeof metaRaw === 'string' ? JSON.parse(metaRaw) : metaRaw;
    const item = metaData?.MediaContainer?.Metadata?.[0];
    if (!item) {
      res.status(404).json({ success: false, error: 'Item not found' });
      return;
    }

    const media = item.Media?.[0];
    const part = media?.Part?.[0];
    const streams = part?.Stream || [];

    // Extract subtitle tracks
    const subtitles = streams
      .filter((s: any) => s.streamType === 3)
      .map((s: any) => ({
        id: s.id,
        index: s.index,
        language: s.language || 'Unknown',
        languageCode: s.languageCode || '',
        codec: s.codec,
        title: s.displayTitle || s.language || 'Unknown',
        forced: s.forced === 1,
        selected: s.selected === 1,
      }));

    // Extract audio tracks
    const audioTracks = streams
      .filter((s: any) => s.streamType === 2)
      .map((s: any) => ({
        id: s.id,
        index: s.index,
        language: s.language || 'Unknown',
        languageCode: s.languageCode || '',
        codec: s.codec,
        channels: s.channels,
        title: s.displayTitle || `${s.language || 'Unknown'} (${s.codec} ${s.channels}ch)`,
        selected: s.selected === 1,
      }));

    // Build the HLS transcode URL
    // Quality params from query string (set by client when changing quality)
    const maxBitrate = parseInt(req.query.maxBitrate as string) || 20000;
    const resolution = (req.query.resolution as string) || '1920x1080';
    const forceTranscode = req.query.forceTranscode === '1';

    // directStream=1 allows remuxing without re-encode (ignores bitrate limits)
    // directPlay=1 serves the original file (no transcode at all)
    // To enforce bitrate, set both to 0 to force full transcode
    const directPlay = forceTranscode ? '0' : '0';
    const directStream = forceTranscode ? '0' : '1';

    const sessionId = `whatson-${Date.now()}`;
    const streamUrl = `${serverUrl}/video/:/transcode/universal/start.m3u8?` +
      new URLSearchParams({
        path: `/library/metadata/${ratingKey}`,
        protocol: 'hls',
        session: sessionId,
        offset: String(offset),
        directPlay,
        directStream,
        videoQuality: forceTranscode ? '75' : '100',
        videoResolution: resolution,
        maxVideoBitrate: String(maxBitrate),
        mediaIndex: '0',
        partIndex: '0',
        location: 'lan',
        subtitles: 'auto',
        'X-Plex-Token': config.plex.token,
        'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
        'X-Plex-Product': PLEX_PRODUCT,
        'X-Plex-Platform': 'Android',
      }).toString();

    // Also build a direct play URL as fallback
    const directPlayUrl = part?.key
      ? `${serverUrl}${part.key}?X-Plex-Token=${config.plex.token}`
      : null;

    res.json({
      success: true,
      data: {
        streamUrl,
        directPlayUrl,
        sessionId,
        title: item.grandparentTitle
          ? `${item.grandparentTitle} - ${item.title}`
          : item.title,
        showTitle: item.grandparentTitle || null,
        episodeTitle: item.grandparentTitle ? item.title : null,
        seasonNumber: item.parentIndex,
        episodeNumber: item.index,
        duration: item.duration || 0, // milliseconds
        viewOffset: item.viewOffset || 0, // milliseconds — resume position
        subtitles,
        audioTracks,
        serverUrl,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * Report playback progress to Plex.
 */
playbackRouter.post('/playback/progress', async (req, res) => {
  try {
    const { ratingKey, time, duration, state, sessionId } = req.body;
    const serverUrl = await getServerUrl();

    if (!serverUrl) {
      res.json({ success: true }); // Don't fail playback if we can't report
      return;
    }

    await axios.get(`${serverUrl}/:/timeline`, {
      params: {
        ratingKey,
        key: `/library/metadata/${ratingKey}`,
        state: state || 'playing',
        time: String(time),
        duration: String(duration),
      },
      headers: {
        'X-Plex-Token': config.plex.token,
        'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
        'X-Plex-Session-Identifier': sessionId || PLEX_CLIENT_IDENTIFIER,
      },
      timeout: 5000,
    }).catch(() => {}); // Don't fail on timeline errors

    res.json({ success: true });
  } catch {
    res.json({ success: true }); // Never fail playback over progress reporting
  }
});

/**
 * Stop a transcode session.
 */
playbackRouter.post('/playback/stop', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const serverUrl = await getServerUrl();

    if (serverUrl && sessionId) {
      await axios.get(`${serverUrl}/video/:/transcode/universal/stop`, {
        params: { session: sessionId, 'X-Plex-Token': config.plex.token },
        timeout: 5000,
      }).catch(() => {});
    }

    // Notify clients — play position has changed
    notifyDataChanged('playback-stop', 'home', 'tv', 'movies');

    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

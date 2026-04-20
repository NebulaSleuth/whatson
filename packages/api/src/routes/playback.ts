import { Router } from 'express';
import axios from 'axios';
import { config } from '../config.js';
import { getServerUrl, getMachineIdentifier, getDiscoveredConnections } from '../services/plex.js';
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
    // Use remote Plex URL if client is remote
    let serverUrl = await getServerUrl();
    if (req.plexConnectionType === 'remote') {
      const conns = getDiscoveredConnections();
      if (conns.remote.length > 0) serverUrl = conns.remote[0];
    }

    if (!serverUrl) {
      res.status(500).json({ success: false, error: 'Plex server not available' });
      return;
    }

    // Get item metadata for duration, subtitles, audio tracks, markers
    const { data: metaRaw } = await axios.get(`${serverUrl}/library/metadata/${ratingKey}`, {
      params: { includeMarkers: 1 },
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': req.plexUserToken || config.plex.token,
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

    const subtitleStreamID = req.query.subtitleStreamID as string | undefined;
    const audioStreamID = req.query.audioStreamID as string | undefined;

    // Force transcode when subtitle or audio track is explicitly selected
    const hasTrackOverride = !!subtitleStreamID || !!audioStreamID;
    const finalDirectPlay = hasTrackOverride ? '0' : directPlay;
    const finalDirectStream = hasTrackOverride ? '0' : directStream;

    const sessionId = `whatson-${Date.now()}`;
    const transcodeParams: Record<string, string> = {
      path: `/library/metadata/${ratingKey}`,
      protocol: 'hls',
      session: sessionId,
      offset: String(offset),
      directPlay: finalDirectPlay,
      directStream: finalDirectStream,
      videoQuality: forceTranscode ? '75' : '100',
      videoResolution: resolution,
      maxVideoBitrate: String(maxBitrate),
      mediaIndex: '0',
      partIndex: '0',
      location: 'lan',
      subtitles: 'auto',
      copyts: '1',
      hasMDE: '1',
      fastSeek: '1',
      'X-Plex-Token': req.plexUserToken || config.plex.token,
      'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
      'X-Plex-Product': PLEX_PRODUCT,
      'X-Plex-Platform': 'Chrome',
    };
    // Set audio/subtitle preferences on the part BEFORE transcoding
    const partId = part?.id;
    const plexToken = req.plexUserToken || config.plex.token;
    if (partId && (audioStreamID || subtitleStreamID)) {
      try {
        const partParams: Record<string, string> = { 'X-Plex-Token': plexToken };
        if (audioStreamID) partParams.audioStreamID = audioStreamID;
        if (subtitleStreamID) partParams.subtitleStreamID = subtitleStreamID;
        await axios.put(`${serverUrl}/library/parts/${partId}`, null, { params: partParams, timeout: 5000 });
      } catch {}
    }

    if (subtitleStreamID) {
      transcodeParams.subtitles = 'burn';
    }

    // Call the decision endpoint first — tells Plex to set up the transcode session
    try {
      await axios.get(`${serverUrl}/video/:/transcode/universal/decision`, {
        params: transcodeParams,
        headers: { Accept: 'application/json' },
        timeout: 10000,
      });
    } catch {}

    // Build stream URL using axios-style param encoding (Plex requires unencoded slashes in path)
    const streamUrl = axios.getUri({
      url: `${serverUrl}/video/:/transcode/universal/start.m3u8`,
      params: transcodeParams,
    });

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
        markers: (item.Marker || []).map((m: any) => ({
          type: m.type,
          startMs: m.startTimeOffset,
          endMs: m.endTimeOffset,
        })),
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
        'X-Plex-Token': req.plexUserToken || config.plex.token,
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

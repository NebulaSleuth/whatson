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
  const startedAt = Date.now();
  try {
    const { ratingKey } = req.params;
    const source = sourceFrom(req);
    const adapter = getAdapterForSource(source);
    if (!adapter || !adapter.isConfigured()) {
      res.status(400).json({ success: false, error: `Source "${source}" not configured` });
      return;
    }

    const opts = {
      offsetMs: req.query.offset ? parseInt(req.query.offset as string) * 1000 : 0,
      maxBitrate: req.query.maxBitrate ? parseInt(req.query.maxBitrate as string) : undefined,
      resolution: (req.query.resolution as string) || undefined,
      subtitleStreamID: req.query.subtitleStreamID ? parseInt(req.query.subtitleStreamID as string) : undefined,
      audioStreamID: req.query.audioStreamID ? parseInt(req.query.audioStreamID as string) : undefined,
      forceTranscode: req.query.forceTranscode === '1',
      connectionType: req.plexConnectionType,
      userToken: req.plexUserToken,
    };
    console.log(
      `[playback] GET /${ratingKey} src=${source} offsetMs=${opts.offsetMs} ` +
      `bitrate=${opts.maxBitrate ?? 'auto'} audio=${opts.audioStreamID ?? 'auto'} ` +
      `sub=${opts.subtitleStreamID ?? 'auto'} forceTranscode=${opts.forceTranscode}`,
    );
    const data = await adapter.getPlaybackInfo(ratingKey, opts);
    const ms = Date.now() - startedAt;
    let streamHost = '?';
    try { streamHost = new URL(data.streamUrl).host; } catch {}
    console.log(
      `[playback] resp in ${ms}ms session=${(data.sessionId || '').slice(0, 12)} ` +
      `streamHost=${streamHost} viewOffset=${data.viewOffset} ` +
      `audioCount=${data.audioTracks.length} subCount=${data.subtitles.length} ` +
      `selAudio=${data.audioTracks.find((t) => t.selected)?.id ?? '-'} ` +
      `selSub=${data.subtitles.find((t) => t.selected)?.id ?? '-'}`,
    );

    res.json({ success: true, data });
  } catch (error) {
    console.error(`[playback] error after ${Date.now() - startedAt}ms:`, (error as Error).message);
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
    console.log(
      `[playback] /progress src=${source ?? 'plex'} ratingKey=${ratingKey} ` +
      `timeMs=${time} state=${state} session=${(sessionId || '').slice(0, 12)}`,
    );
    res.json({ success: true });
  } catch {
    res.json({ success: true }); // Never fail playback over progress reporting
  }
});

/**
 * Auto-mark-watched thresholds. Clients pass durationMs + optional
 * creditsStartMs; if either signal fires we call adapter.markWatched
 * so the item drops off Continue Watching.
 *
 * - WATCHED_PERCENT: mirrors Plex's default (90% of runtime). Same
 *   default as Jellyfin/Emby, so the rule works uniformly across all
 *   three adapters.
 * - Credits marker: if the client is past the start of the credits
 *   marker we treat the item as effectively finished even if we're
 *   only at, say, 88% of runtime. Matches the "auto-play next"
 *   behaviour Plex's own clients ship.
 */
const WATCHED_PERCENT = 0.9;

/** Stop a transcode / playback session. */
playbackRouter.post('/playback/stop', async (req, res) => {
  const startedAt = Date.now();
  try {
    const { sessionId, source, ratingKey, positionMs, durationMs, creditsStartMs } = req.body as {
      sessionId?: string;
      source?: ContentSource;
      ratingKey?: string;
      positionMs?: number;
      durationMs?: number;
      creditsStartMs?: number;
    };
    console.log(
      `[playback] POST /stop session=${(sessionId || '').slice(0, 12)} src=${source ?? 'plex'} ` +
      `positionMs=${positionMs ?? '(unset)'} durationMs=${durationMs ?? '(unset)'} ` +
      `creditsStartMs=${creditsStartMs ?? '(unset)'} ratingKey=${ratingKey ?? '(unset)'}`,
    );
    const adapter = getAdapterForSource(source || 'plex');

    // Decide whether this stop should count as "watched". Once either
    // threshold fires we skip the pre-stop progress report — Plex's
    // /:/scrobble handles both marking watched AND wiping the resume
    // point, so sending viewOffset first would be a wasted call.
    const finished =
      typeof positionMs === 'number' &&
      positionMs > 0 &&
      ((typeof creditsStartMs === 'number' && creditsStartMs > 0 && positionMs >= creditsStartMs) ||
        (typeof durationMs === 'number' && durationMs > 0 && positionMs / durationMs >= WATCHED_PERCENT));

    // Seed the adapter with the final position before stopping. This
    // guarantees the resume position is saved to UserData (Jellyfin)
    // or scrobbled (Plex) even if /api/playback/progress hasn't been
    // called recently — for example when the user closes the player
    // quickly after seeking, the periodic 10s reporter might not have
    // fired yet. The client sends positionMs + ratingKey alongside the
    // stop call so the server can record a final progress event before
    // tearing down. State is "stopped" (not "paused") to match what
    // native Plex clients send, so Plex's own 90% threshold engages.
    if (!finished && adapter && sessionId && ratingKey && typeof positionMs === 'number' && positionMs > 0) {
      try {
        await adapter.reportProgress(
          ratingKey,
          positionMs,
          durationMs ?? 0,
          'stopped',
          sessionId,
          req.plexUserToken,
        );
      } catch (err) {
        console.warn(`[playback] stop pre-progress failed: ${(err as Error).message}`);
      }
    }
    if (finished && adapter && ratingKey) {
      try {
        await adapter.markWatched(ratingKey, req.plexUserToken);
        console.log(`[playback] auto-marked watched — ${ratingKey}`);
      } catch (err) {
        console.warn(`[playback] auto-mark-watched failed: ${(err as Error).message}`);
      }
    }
    if (adapter && sessionId) {
      await adapter.stopPlayback(sessionId, req.plexUserToken);
    }
    console.log(`[playback] stop done in ${Date.now() - startedAt}ms finished=${finished}`);
    notifyDataChanged('playback-stop', 'home', 'tv', 'movies');
    res.json({ success: true });
  } catch (err) {
    console.warn(`[playback] stop error after ${Date.now() - startedAt}ms:`, (err as Error).message);
    res.json({ success: true });
  }
});

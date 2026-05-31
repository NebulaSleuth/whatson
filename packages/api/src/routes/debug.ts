import { Router } from 'express';
import axios from 'axios';
import { config } from '../config.js';
import { search as plexSearch, getServerUrl } from '../services/plex.js';

export const debugRouter = Router();

/**
 * Fetch the Plex SHOW poster at /library/metadata/{showId}/thumb
 * (NO timestamp), bypassing the cache-busting `_v` query and the
 * /api/artwork proxy entirely. This is the most-current poster Plex
 * is willing to serve — if it still matches the OLD artwork after
 * a poster swap, the issue is on the Plex side; if it matches the
 * NEW one then our cache or URL building is the culprit.
 *
 * GET /api/debug/plex/show-poster?title=spider-noir[&ratingKey=N][&useTs=1]
 *
 * Returns the image bytes with a Content-Disposition: attachment
 * header so the browser downloads it. Open this URL while logged
 * into /setup (cookie auth) to grab the file.
 */
/**
 * Returns what the backend would currently send to a client as the
 * artwork URL for a given Plex show. Useful for verifying that
 * artworkUrl() is building stripped (no /timestamp) URLs after the
 * v0.1.98 fix — if the URL here still has a trailing /digits, the
 * fix isn't being applied (likely an older cached library payload).
 *
 * GET /api/debug/plex/show-url?title=spider-noir
 */
debugRouter.get('/debug/plex/show-url', async (req, res) => {
  try {
    const titleQ = (req.query.title as string) || '';
    const ratingKeyQ = (req.query.ratingKey as string) || '';

    // Direct ratingKey path — fetch metadata for the exact item the
    // user pointed at. Bypasses search entirely so it works even if
    // Plex's hub-search misreports the item type.
    if (ratingKeyQ) {
      const serverUrl = await getServerUrl();
      if (!serverUrl) {
        res.status(503).json({ error: 'Plex server URL not resolved' });
        return;
      }
      const r = await axios.get(`${serverUrl}/library/metadata/${ratingKeyQ}`, {
        params: { 'X-Plex-Token': config.plex.token },
        timeout: 10000,
      });
      const item = r.data?.MediaContainer?.Metadata?.[0];
      if (!item) {
        res.status(404).json({ error: 'No item at that ratingKey' });
        return;
      }
      res.json({
        ratingKey: item.ratingKey,
        type: item.type,
        title: item.title,
        rawThumb: item.thumb,
        rawArt: item.art,
        rawGrandparentThumb: item.grandparentThumb,
        addedAt: item.addedAt,
        updatedAt: item.updatedAt,
        // What we'd serve to a client. Re-derive via the public path
        // by hitting search? Simpler: just show the raw thumb path and
        // let the caller eyeball whether it ends in /<digits>.
      });
      return;
    }

    if (!titleQ) {
      res.status(400).json({ error: 'Provide ?title= or ?ratingKey=' });
      return;
    }
    const results = await plexSearch(titleQ);
    // Movies first, then shows, then episodes — covers any Plex content type.
    const hit = results.find((i) => i.type === 'movie') ||
      results.find((i) => i.type === 'show') ||
      results.find((i) => i.type === 'episode');
    if (!hit) {
      res.status(404).json({
        error: 'No match',
        searchHits: results.map((r) => ({ title: r.title, type: r.type, sourceId: r.sourceId })),
      });
      return;
    }
    res.json({
      sourceId: hit.sourceId,
      showRatingKey: hit.showRatingKey,
      type: hit.type,
      title: hit.title,
      artwork: hit.artwork,
      // Quick check: if poster ends in /digits, the strip-ts fix isn't
      // active for this item (either the deployed build is older or
      // this item came from a stale data cache).
      posterStripped: !/\/\d+(\?|$)/.test(hit.artwork.poster),
      // Other search hits so the caller can pick a different one if
      // the first match is the wrong type / wrong show.
      otherHits: results.map((r) => ({ title: r.title, type: r.type, sourceId: r.sourceId })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

debugRouter.get('/debug/plex/show-poster', async (req, res) => {
  try {
    const titleQ = (req.query.title as string) || '';
    let ratingKey = (req.query.ratingKey as string) || '';
    const useTs = req.query.useTs === '1';

    // Resolve a show ratingKey via search if the caller didn't pass one.
    let searchHits: Array<{ title: string; type: string; sourceId: string; showRatingKey?: string }> = [];
    if (!ratingKey && titleQ) {
      const results = await plexSearch(titleQ);
      searchHits = results.map((r) => ({
        title: r.title,
        type: r.type,
        sourceId: r.sourceId,
        showRatingKey: r.showRatingKey,
      }));
      const show = results.find((i) => i.type === 'show') ||
        results.find((i) => i.type === 'episode');
      if (show) {
        // For an episode, use the parent show via showRatingKey.
        ratingKey = show.showRatingKey || show.sourceId;
      }
    }

    if (!ratingKey) {
      res.status(404).json({
        error: titleQ
          ? `No show or episode found in Plex for title "${titleQ}". Pass ?ratingKey=N directly if you know the show's ratingKey (find it in the Plex web URL: /library/metadata/N).`
          : 'Provide ?title= or ?ratingKey=',
        searchHits,
      });
      return;
    }

    const serverUrl = await getServerUrl();
    if (!serverUrl) {
      res.status(503).json({ error: 'Plex server URL not resolved' });
      return;
    }

    // Build URL — `/thumb` (no timestamp) returns whatever poster is
    // currently selected. `/thumb/{ts}` returns the specific version
    // (the one with the matching versioned ID).
    let upstream = `${serverUrl}/library/metadata/${ratingKey}/thumb`;
    if (useTs) upstream += '/'; // signals to use last-known versioned URL
    upstream += `?X-Plex-Token=${config.plex.token}`;
    upstream += `&_bust=${Date.now()}`; // hard-no-cache

    console.log(`[debug/plex] fetching ${upstream.replace(/X-Plex-Token=[^&]+/, 'X-Plex-Token=***')}`);

    const response = await axios.get(upstream, {
      responseType: 'arraybuffer',
      timeout: 15000,
      // No 304 / If-None-Match — every request is fresh from Plex.
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    res.set('Content-Type', contentType);
    res.set('Content-Disposition', `attachment; filename="plex-show-${ratingKey}.${ext}"`);
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(response.data));
  } catch (e: any) {
    res.status(500).json({
      error: e.message,
      status: e.response?.status,
      responseData: typeof e.response?.data === 'string' ? e.response.data.slice(0, 400) : undefined,
    });
  }
});

/**
 * Raw debug endpoint — hits Sonarr/Radarr directly and returns the raw response.
 * Use this to see exactly what the APIs return.
 *
 * GET /api/debug/sonarr/series — raw series list
 * GET /api/debug/sonarr/history — raw history
 * GET /api/debug/sonarr/episode?seriesId=1 — raw episodes for a series
 * GET /api/debug/sonarr/:path — any Sonarr endpoint
 */
debugRouter.get('/debug/sonarr/*path', async (req, res) => {
  if (!config.sonarr.url) {
    res.status(400).json({ error: 'Sonarr not configured' });
    return;
  }

  const path = (req.params as any).path || (req.params as any)[0] || '';
  const url = `${config.sonarr.url}/api/v3/${path}`;

  try {
    const { data } = await axios.get(url, {
      headers: { 'X-Api-Key': config.sonarr.apiKey },
      params: req.query,
      timeout: 15000,
    });

    // Summarize arrays
    if (Array.isArray(data)) {
      res.json({
        _debug: { url, params: req.query },
        count: data.length,
        sample: data.slice(0, 3),
        sampleKeys: data.length > 0 ? Object.keys(data[0]) : [],
      });
    } else if (data && data.records) {
      res.json({
        _debug: { url, params: req.query },
        totalRecords: data.totalRecords,
        count: data.records.length,
        sample: data.records.slice(0, 3),
        sampleKeys: data.records.length > 0 ? Object.keys(data.records[0]) : [],
      });
    } else {
      res.json({ _debug: { url, params: req.query }, data });
    }
  } catch (error: any) {
    res.status(500).json({
      _debug: { url, params: req.query },
      error: error.message,
      status: error.response?.status,
      responseData: error.response?.data,
    });
  }
});

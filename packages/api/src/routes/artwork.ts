import { Router } from 'express';
import axios from 'axios';
import { getCached, setCached } from '../cache.js';
import { ARTWORK_CACHE_TTL } from '@whatson/shared';
import { config } from '../config.js';
import { ensureSession as ensureJellyfinSession } from '../services/jellyfin.js';
import { ensureSession as ensureEmbySession } from '../services/emby.js';

export const artworkRouter = Router();

/**
 * Build the auth headers needed to fetch a given artwork URL. Plex URLs embed
 * their token in the query string; Jellyfin requires an Authorization header
 * or an api_key query param. We do the latter so the proxy call is stateless.
 */
async function buildFetchConfig(imageUrl: string): Promise<{ url: string; headers: Record<string, string> }> {
  const headers: Record<string, string> = { Accept: 'image/*' };
  let url = imageUrl;

  const attach = async (ensure: () => Promise<{ accessToken: string } | null>) => {
    const session = await ensure().catch(() => null);
    if (session && !/[?&]api_key=/.test(url)) {
      url = `${url}${url.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(session.accessToken)}`;
    }
  };

  if (config.jellyfin.url && imageUrl.startsWith(config.jellyfin.url)) {
    await attach(ensureJellyfinSession);
  } else if (config.emby.url && imageUrl.startsWith(config.emby.url)) {
    await attach(ensureEmbySession);
  }

  return { url, headers };
}

/**
 * Proxy artwork requests through the backend.
 * This avoids CORS/auth issues and caches images server-side.
 * Usage: GET /api/artwork?url=<encoded-image-url>
 */
artworkRouter.get('/artwork', async (req, res) => {
  const imageUrl = req.query.url as string;

  if (!imageUrl) {
    res.status(400).send('Missing url parameter');
    return;
  }

  const cacheKey = `artwork:${imageUrl}`;
  const cached = getCached<{ data: Buffer; contentType: string }>(cacheKey);

  if (cached) {
    res.set('Content-Type', cached.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(cached.data);
    return;
  }

  try {
    const fetchCfg = await buildFetchConfig(imageUrl);
    const response = await axios.get(fetchCfg.url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: fetchCfg.headers,
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    const data = Buffer.from(response.data);

    // Cache for 24 hours
    setCached(cacheKey, { data, contentType }, ARTWORK_CACHE_TTL / 1000);

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(data);
  } catch {
    res.status(502).send('Failed to fetch artwork');
  }
});

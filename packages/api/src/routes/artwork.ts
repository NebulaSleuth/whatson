import { Router } from 'express';
import axios from 'axios';
import { getCached, setCached } from '../cache.js';
import { ARTWORK_CACHE_TTL } from '@whatson/shared';

export const artworkRouter = Router();

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
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { Accept: 'image/*' },
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

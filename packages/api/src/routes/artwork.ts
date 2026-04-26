import { Router } from 'express';
import axios from 'axios';
import { Jimp, JimpMime } from 'jimp';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { getCached, setCached } from '../cache.js';
import { ARTWORK_CACHE_TTL } from '@whatson/shared';
import { config } from '../config.js';
import { ensureSession as ensureJellyfinSession } from '../services/jellyfin.js';
import { ensureSession as ensureEmbySession } from '../services/emby.js';

export const artworkRouter = Router();

// On-disk cache directory. We pick the runtime-data folder so it
// follows the same install-mode logic as everything else (next to the
// exe, under ProgramData, or ./data in dev).
const DISK_CACHE_DIR = (() => {
  const candidates: string[] = [];
  if (process.env.WHATSON_DATA_DIR) candidates.push(process.env.WHATSON_DATA_DIR);
  if (process.platform === 'win32') candidates.push('C:\\ProgramData\\WhatsOn\\data');
  candidates.push(path.join(process.cwd(), 'data'));
  candidates.push(path.join(process.cwd(), 'packages', 'api', 'data'));
  for (const dir of candidates) {
    try {
      const sub = path.join(dir, 'artwork-cache');
      fs.mkdirSync(sub, { recursive: true });
      return sub;
    } catch {}
  }
  // Last resort — in-memory only.
  return '';
})();

function cacheKeyFor(url: string, w: number, h: number): string {
  return crypto.createHash('sha256').update(`${url}|${w}|${h}`).digest('hex');
}

function diskCachePath(key: string): string | null {
  if (!DISK_CACHE_DIR) return null;
  return path.join(DISK_CACHE_DIR, `${key}.jpg`);
}

/**
 * Build the auth headers needed to fetch a given artwork URL. Plex URLs embed
 * their token in the query string; Jellyfin requires an Authorization header
 * or an api_key query param. We do the latter so the proxy call is stateless.
 */
async function buildFetchConfig(imageUrl: string): Promise<{ url: string; headers: Record<string, string> }> {
  const headers: Record<string, string> = {
    Accept: 'image/jpeg, image/png;q=0.95, image/gif;q=0.9, image/*;q=0.6',
  };
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

function parseDim(value: unknown, fallback: number, min: number, max: number): number {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Proxy + resize artwork.
 *
 * Plex/Jellyfin/Emby return source-resolution images (often 2000×3000+) that
 * Roku has to fully decode before downscaling for a 180-wide poster cell.
 * That bloats the texture cache and makes it evict aggressively, which shows
 * up as posters going blank when the user scrolls back. Resizing at the
 * proxy boundary cuts the payload by 90%+ and keeps cards reliable.
 *
 * Two-tier cache so a service restart doesn't blow away the resized assets:
 *   L1: in-memory node-cache (existing, ARTWORK_CACHE_TTL)
 *   L2: disk under data/artwork-cache/<sha256>.jpg
 *
 * Usage:
 *   /api/artwork?url=<encoded>&w=360            — width-constrained resize
 *   /api/artwork?url=<encoded>&w=360&h=540      — fit within bounding box
 *   /api/artwork?url=<encoded>                  — pass-through (back-compat)
 */
artworkRouter.get('/artwork', async (req, res) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl) {
    res.status(400).send('Missing url parameter');
    return;
  }

  // Width/height hints. 0 means "no constraint" — caller didn't pass it.
  const w = parseDim(req.query.w, 0, 1, 4096);
  const h = parseDim(req.query.h, 0, 1, 4096);
  const wantsResize = w > 0 || h > 0;

  const key = cacheKeyFor(imageUrl, w, h);
  const cacheKey = `artwork:${key}`;

  // L1 — in-memory.
  const cached = getCached<{ data: Buffer; contentType: string }>(cacheKey);
  if (cached) {
    res.set('Content-Type', cached.contentType);
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
    res.send(cached.data);
    return;
  }

  // L2 — disk.
  const diskPath = diskCachePath(key);
  if (diskPath) {
    try {
      const data = await fs.promises.readFile(diskPath);
      const entry = { data, contentType: 'image/jpeg' };
      setCached(cacheKey, entry, ARTWORK_CACHE_TTL / 1000);
      res.set('Content-Type', entry.contentType);
      res.set('Cache-Control', 'public, max-age=2592000, immutable');
      res.send(data);
      return;
    } catch {
      // Cache miss / unreadable — fall through to upstream fetch.
    }
  }

  try {
    const fetchCfg = await buildFetchConfig(imageUrl);
    const response = await axios.get(fetchCfg.url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: fetchCfg.headers,
    });

    const upstreamContentType: string = response.headers['content-type'] || 'image/jpeg';
    let data = Buffer.from(response.data);
    let contentType = upstreamContentType;

    if (wantsResize) {
      try {
        const img = await Jimp.read(data);
        if (w > 0 && h > 0) {
          // Fit within the box, preserving aspect.
          img.scaleToFit({ w, h });
        } else if (w > 0) {
          // Width-constrained — scale only if upstream is wider.
          if (img.bitmap.width > w) {
            img.resize({ w });
          }
        } else if (h > 0) {
          if (img.bitmap.height > h) {
            img.resize({ h });
          }
        }
        // Output JPEG so Roku always gets a format it can decode and so
        // we get aggressive size reduction over the source PNGs.
        data = await img.getBuffer(JimpMime.jpeg, { quality: 85 });
        contentType = 'image/jpeg';
      } catch (resizeErr) {
        console.warn('[artwork] resize failed, serving original:', (resizeErr as Error).message);
      }
    }

    // L1 + L2 write.
    setCached(cacheKey, { data, contentType }, ARTWORK_CACHE_TTL / 1000);
    if (diskPath && contentType === 'image/jpeg') {
      fs.promises.writeFile(diskPath, data).catch(() => {});
    }

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
    res.send(data);
  } catch {
    res.status(502).send('Failed to fetch artwork');
  }
});

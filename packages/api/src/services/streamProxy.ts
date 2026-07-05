import axios from 'axios';
import type { Request, Response } from 'express';
import { config } from '../config.js';

/**
 * Remote stream proxy (M6). Jellyfin/Emby have no relay of their own, so their
 * HLS stream URLs point at the LAN media server and are unreachable off-network.
 * When a client is remote we rewrite the stream URL to route through this proxy
 * on the backend's internet-facing listener: it fetches the playlist/segments
 * from the LAN server and rewrites the URLs inside playlists so the segments
 * come back through the proxy too. Plex is unaffected (it rides its own relay).
 *
 * Security: the target is validated to live under the configured Jellyfin/Emby
 * base (SSRF guard), and the route is auth-gated like any consumer route — the
 * device key travels as the `auth` query param (players can't set headers on
 * segment fetches), same pattern as artwork + live HLS. Keys are sha256-hashed
 * so per-segment verification is cheap.
 */

function proxiableBases(): string[] {
  return [config.jellyfin.url, config.emby.url].filter((u): u is string => Boolean(u));
}

/** True if `target` is an HTTP(S) URL under a configured Jellyfin/Emby base. */
export function isProxiableTarget(target: string): boolean {
  if (!/^https?:\/\//i.test(target)) return false;
  return proxiableBases().some((base) => target.startsWith(base));
}

function b64urlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** App-facing proxy URL for a Jellyfin/Emby target. `base` = `<proto>://<host>`. */
export function buildProxyUrl(target: string, base: string, auth: string): string {
  return `${base}/api/stream/proxy?u=${b64urlEncode(target)}&auth=${encodeURIComponent(auth)}`;
}

/** Rewrite a URI inside a playlist to route through the proxy (if proxiable). */
function proxify(uri: string, targetUrl: string, base: string, auth: string): string {
  let abs: string;
  try {
    abs = new URL(uri, targetUrl).toString();
  } catch {
    return uri;
  }
  return isProxiableTarget(abs) ? buildProxyUrl(abs, base, auth) : uri;
}

/** Rewrite segment/media-playlist URLs in an HLS playlist to go through us. */
export function rewritePlaylist(body: string, targetUrl: string, base: string, auth: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) {
        // Tags may carry a URI="..." (EXT-X-KEY / EXT-X-MEDIA / EXT-X-MAP).
        return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => `URI="${proxify(uri, targetUrl, base, auth)}"`);
      }
      return proxify(t, targetUrl, base, auth);
    })
    .join('\n');
}

const IS_PLAYLIST_CT = /mpegurl/i;

export async function handleStreamProxy(req: Request, res: Response): Promise<void> {
  const target = (() => {
    try {
      return b64urlDecode(String(req.query.u || ''));
    } catch {
      return '';
    }
  })();
  if (!isProxiableTarget(target)) {
    res.status(403).json({ success: false, error: 'target not allowed' });
    return;
  }

  const auth = String(req.query.auth || '');
  const proxyBase = `${req.protocol}://${req.headers.host}`;
  const range = req.headers.range;

  try {
    const upstream = await axios.get(target, {
      responseType: 'stream',
      headers: range ? { Range: range } : {},
      validateStatus: () => true,
      timeout: 30_000,
      maxRedirects: 2,
    });

    const ct = String(upstream.headers['content-type'] || '');
    const isPlaylist = IS_PLAYLIST_CT.test(ct) || /\.m3u8($|\?)/i.test(target);

    if (isPlaylist) {
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        upstream.data.on('data', (c: Buffer) => chunks.push(c));
        upstream.data.on('end', () => resolve());
        upstream.data.on('error', reject);
      });
      const rewritten = rewritePlaylist(Buffer.concat(chunks).toString('utf8'), target, proxyBase, auth);
      res.status(upstream.status);
      res.setHeader('content-type', ct || 'application/vnd.apple.mpegurl');
      res.setHeader('cache-control', 'no-store');
      res.send(rewritten);
      return;
    }

    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
      const v = upstream.headers[h];
      if (v) res.setHeader(h, v as string);
    }
    upstream.data.pipe(res);
  } catch (err) {
    console.warn(`[stream.proxy] ${(err as Error).message}`);
    if (!res.headersSent) res.status(502).json({ success: false, error: 'upstream fetch failed' });
  }
}

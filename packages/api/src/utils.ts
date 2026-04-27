import type { ContentItem } from '@whatson/shared';

/**
 * Rewrite artwork URLs to go through the backend proxy.
 *
 * EVERY upstream URL — including public CDNs (TMDB, TVDB) — is wrapped
 * so the proxy's resize + cache layer is always in the path. Letting
 * clients hit `https://image.tmdb.org/.../original/...` directly meant
 * Roku was loading 2000×3000 masters straight into its texture cache,
 * blanking already-rendered posters under memory pressure. The proxy
 * resizes server-side (when clients pass &w=…) and caches resized
 * variants on disk so subsequent renders are cheap.
 */
function proxyArtworkUrl(url: string): string {
  if (!url) return '';
  return `/api/artwork?url=${encodeURIComponent(url)}`;
}

export function proxyArtwork(item: ContentItem): ContentItem {
  return {
    ...item,
    artwork: {
      poster: proxyArtworkUrl(item.artwork.poster),
      thumbnail: proxyArtworkUrl(item.artwork.thumbnail),
      background: proxyArtworkUrl(item.artwork.background),
    },
  };
}

export function proxyArtworkUrls(items: ContentItem[]): ContentItem[] {
  return items.map(proxyArtwork);
}

import type { ContentItem } from '@whatson/shared';

/**
 * Rewrite artwork URLs to go through the backend proxy.
 * Public CDN URLs (TMDB, TVDB) are left as-is.
 * Plex/local URLs get proxied so the mobile app doesn't need direct access.
 */
function proxyArtworkUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('https://image.tmdb.org') || url.startsWith('https://artworks.thetvdb.com')) {
    return url;
  }
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

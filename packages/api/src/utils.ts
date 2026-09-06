import type { ContentItem, DownloadStatus } from '@whatson/shared';

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

/**
 * Sonarr/Radarr report `timeleft` as a .NET TimeSpan string —
 * "HH:MM:SS" or "D.HH:MM:SS". Render a compact human form; return
 * undefined when there's no estimate (stalled / queued).
 */
export function formatTimeLeft(raw?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  let rest = raw;
  let days = 0;
  const dot = raw.indexOf('.');
  const colon = raw.indexOf(':');
  if (dot >= 0 && colon >= 0 && dot < colon) {
    days = parseInt(raw.slice(0, dot), 10) || 0;
    rest = raw.slice(dot + 1);
  }
  const [h = 0, m = 0] = rest.split(':').map((p) => parseInt(p, 10) || 0);
  if (days > 0) return `${days}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return '<1m';
}

/**
 * Convert a Sonarr/Radarr `/queue` record into the client-facing
 * DownloadStatus. `queueId` (record.id) is the handle the cancel +
 * re-search routes delete; percentage is derived from size/sizeleft.
 */
export function buildDownloadStatus(record: any): DownloadStatus {
  const size = Number(record?.size) || 0;
  const sizeLeft = Number(record?.sizeleft) || 0;
  const pct = size > 0 ? ((size - sizeLeft) / size) * 100 : 0;
  return {
    queueId: Number(record?.id) || 0,
    percentage: Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10,
    status: String(record?.status || record?.trackedDownloadState || 'downloading'),
    timeLeft: formatTimeLeft(record?.timeleft),
    estimatedCompletionTime: record?.estimatedCompletionTime || undefined,
    sizeBytes: size || undefined,
    sizeLeftBytes: sizeLeft || undefined,
    errorMessage: record?.errorMessage || undefined,
    warnings: flattenStatusMessages(record?.statusMessages),
  };
}

/**
 * Sonarr/Radarr `statusMessages` is `[{ title, messages: string[] }]`.
 * Flatten to a de-duplicated string list; undefined when there are none.
 */
export function flattenStatusMessages(raw: any): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = new Set<string>();
  for (const entry of raw) {
    const msgs = Array.isArray(entry?.messages) ? entry.messages : [];
    for (const m of msgs) {
      const s = String(m || '').trim();
      if (s) out.add(s);
    }
  }
  return out.size > 0 ? [...out] : undefined;
}

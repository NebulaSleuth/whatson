import axios, { type AxiosInstance } from 'axios';
import { config } from '../config.js';
import { getCached, setCached } from '../cache.js';
import type { ContentItem } from '@whatson/shared';

let client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!client) {
    if (!config.sonarr.url || !config.sonarr.apiKey) {
      throw new Error('Sonarr not configured');
    }
    client = axios.create({
      baseURL: `${config.sonarr.url}/api/v3`,
      headers: {
        'X-Api-Key': config.sonarr.apiKey,
        Accept: 'application/json',
      },
      timeout: 15000,
    });
  }
  return client;
}

function toArray(data: any): any[] {
  // Sonarr sometimes returns JSON as a string — parse it
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.records)) return data.records;
  return [];
}

function seriesImageUrl(images: any[], type: string): string {
  const img = images?.find((i: any) => i.coverType === type);
  if (!img) return '';
  if (img.remoteUrl) return img.remoteUrl;
  if (img.url) return `${config.sonarr.url}${img.url}`;
  return '';
}

function sonarrEpisodeToContentItem(
  episode: any,
  series: any,
  status: ContentItem['status'],
): ContentItem {
  const images = series?.images || [];
  return {
    id: `sonarr-${episode.id || episode.episodeId || Math.random()}`,
    type: 'episode',
    title: episode.title || 'TBA',
    showTitle: series?.title || episode.series?.title || '',
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    summary: episode.overview || series?.overview || '',
    duration: series?.runtime || 0,
    artwork: {
      poster: seriesImageUrl(images, 'poster'),
      thumbnail: seriesImageUrl(images, 'fanart'),
      background: seriesImageUrl(images, 'fanart'),
    },
    source: 'sonarr',
    sourceId: String(episode.id || episode.episodeId),
    status,
    progress: { watched: false, percentage: 0, currentPosition: 0 },
    availability: {
      availableAt: episode.airDateUtc || '',
      network: series?.network || '',
    },
    addedAt: episode.airDateUtc || '',
    year: series?.year || 0,
    rating: series?.ratings?.value,
    genres: series?.genres || [],
  };
}

export async function getUpcoming(days: number = 7): Promise<ContentItem[]> {
  const cacheKey = `sonarr:upcoming:${days}`;
  const cached = getCached<ContentItem[]>(cacheKey);
  if (cached) return cached;

  const http = getClient();
  const start = new Date().toISOString();
  const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await http.get('/calendar', {
    params: { start, end, includeSeries: true, includeEpisodeFile: true },
  });

  const items = toArray(data);
  const unaired = items.filter((ep: any) => !ep.hasFile);
  console.log(`[Sonarr] Calendar: ${items.length} upcoming, ${unaired.length} after hasFile filter`);

  const result = unaired
    .map((ep: any) => sonarrEpisodeToContentItem(ep, ep.series, 'coming_soon'))
    .sort(
      (a: ContentItem, b: ContentItem) =>
        new Date(a.availability.availableAt).getTime() -
        new Date(b.availability.availableAt).getTime(),
    );

  setCached(cacheKey, result);
  return result;
}

/**
 * Get recently downloaded TV episodes.
 * Uses /series to find shows with files, then /episode to get specific episodes.
 * NEVER caches empty results to avoid startup timing issues.
 */
export async function getRecentDownloads(limit: number = 20): Promise<ContentItem[]> {
  const cacheKey = `sonarr:recent:${limit}`;
  const cached = getCached<ContentItem[]>(cacheKey);
  if (cached && cached.length > 0) return cached; // Only use cache if it has data

  const http = getClient();

  // Step 1: Get all series — use direct axios call for reliability
  let allSeries: any[];
  try {
    const url = `${config.sonarr.url}/api/v3/series`;
    console.log(`[Sonarr] Fetching: ${url}`);
    const response = await axios.get(url, {
      headers: { 'X-Api-Key': config.sonarr.apiKey },
      timeout: 15000,
    });
    console.log(`[Sonarr] /series status=${response.status}, type=${typeof response.data}, isArray=${Array.isArray(response.data)}`);
    if (response.data && !Array.isArray(response.data)) {
      console.log(`[Sonarr] /series response keys:`, Object.keys(response.data));
    }
    allSeries = toArray(response.data);
    console.log(`[Sonarr] /series returned ${allSeries.length} series`);
    if (allSeries.length > 0) {
      console.log(`[Sonarr] First series: "${allSeries[0].title}", files: ${allSeries[0].statistics?.episodeFileCount}`);
    }
  } catch (error: any) {
    console.error(`[Sonarr] /series failed:`, error.message);
    if (error.response) {
      console.error(`[Sonarr] Response status: ${error.response.status}, data:`, JSON.stringify(error.response.data).slice(0, 200));
    }
    return [];
  }

  if (allSeries.length === 0) {
    console.log(`[Sonarr] No series found — skipping episode fetch`);
    return [];
  }

  // Step 2: Find series with downloaded episodes, sorted by most recently aired
  const seriesWithFiles = allSeries
    .filter((s: any) => (s.statistics?.episodeFileCount || 0) > 0)
    .sort((a: any, b: any) => {
      const aDate = a.previousAiring || a.lastAired || a.added || '';
      const bDate = b.previousAiring || b.lastAired || b.added || '';
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    })
    .slice(0, 10);

  console.log(`[Sonarr] ${seriesWithFiles.length} series have files (checking episodes)`);

  // Step 3: Fetch episodes for these series
  const allEpisodes: Array<{ episode: any; series: any; fileDate: string }> = [];

  for (const series of seriesWithFiles) {
    try {
      const { data } = await http.get('/episode', {
        params: { seriesId: series.id },
      });
      const episodes = toArray(data);
      const withFiles = episodes.filter((ep: any) => ep.hasFile);

      for (const ep of withFiles) {
        allEpisodes.push({
          episode: ep,
          series,
          fileDate: ep.episodeFile?.dateAdded || ep.airDateUtc || series.added || '',
        });
      }
    } catch (error) {
      console.warn(`[Sonarr] Failed to get episodes for "${series.title}":`, (error as Error).message);
    }
  }

  console.log(`[Sonarr] Found ${allEpisodes.length} total episodes with files`);

  // Step 4: Sort by file date descending, deduplicate, take top N
  allEpisodes.sort((a, b) => new Date(b.fileDate).getTime() - new Date(a.fileDate).getTime());

  const result: ContentItem[] = [];
  const seen = new Set<string>();

  for (const { episode, series } of allEpisodes) {
    if (result.length >= limit) break;
    const key = `${series.title}-S${episode.seasonNumber}E${episode.episodeNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(sonarrEpisodeToContentItem(episode, series, 'ready'));
  }

  console.log(`[Sonarr] Returning ${result.length} recent episodes`);

  // Only cache if we got results
  if (result.length > 0) {
    setCached(cacheKey, result);
  }

  return result;
}

export async function getQueue(): Promise<ContentItem[]> {
  const cacheKey = 'sonarr:queue';
  const cached = getCached<ContentItem[]>(cacheKey);
  if (cached) return cached;

  const http = getClient();
  const { data } = await http.get('/queue', {
    params: { includeSeries: true, includeEpisode: true },
  });

  const records = toArray(data);
  // Sonarr can have multiple queue entries for the same episode (quality upgrades).
  // Deduplicate by episode ID to prevent duplicate-key errors in the UI.
  const seen = new Set<number>();
  const result: ContentItem[] = [];
  for (const record of records) {
    const ep = record.episode || record;
    const epId = ep.id || ep.episodeId;
    if (epId && seen.has(epId)) continue;
    if (epId) seen.add(epId);
    result.push(sonarrEpisodeToContentItem(ep, record.series, 'downloading'));
  }

  setCached(cacheKey, result, 60);
  return result;
}

export async function searchSeries(query: string): Promise<ContentItem[]> {
  const http = getClient();
  const { data } = await http.get('/series');
  const items = toArray(data);
  const filtered = items.filter((s: any) => s.title.toLowerCase().includes(query.toLowerCase()));

  return filtered.map((series: any) => ({
    id: `sonarr-series-${series.id}`,
    type: 'show' as const,
    title: series.title,
    summary: series.overview || '',
    duration: series.runtime || 0,
    artwork: {
      poster: seriesImageUrl(series.images, 'poster'),
      thumbnail: seriesImageUrl(series.images, 'fanart'),
      background: seriesImageUrl(series.images, 'fanart'),
    },
    source: 'sonarr' as const,
    sourceId: String(series.id),
    status: 'ready' as const,
    progress: { watched: false, percentage: 0, currentPosition: 0 },
    availability: { availableAt: '' },
    addedAt: series.added || '',
    year: series.year || 0,
    rating: series.ratings?.value,
    genres: series.genres || [],
  }));
}

export async function testConnection(): Promise<boolean> {
  try {
    const http = getClient();
    await http.get('/system/status');
    return true;
  } catch {
    return false;
  }
}

export function resetClient(): void {
  client = null;
}

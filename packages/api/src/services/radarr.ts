import axios, { type AxiosInstance } from 'axios';
import { config } from '../config.js';
import { getCached, setCached } from '../cache.js';
import type { ContentItem } from '@whatson/shared';

let client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!client) {
    if (!config.radarr.url || !config.radarr.apiKey) {
      throw new Error('Radarr not configured');
    }
    client = axios.create({
      baseURL: `${config.radarr.url}/api/v3`,
      headers: {
        'X-Api-Key': config.radarr.apiKey,
        Accept: 'application/json',
      },
      timeout: 10000,
    });
  }
  return client;
}

/** Safely extract an array from API responses that may be arrays or paginated objects */
function toArray(data: any): any[] {
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

function movieImageUrl(images: any[], type: string): string {
  const img = images?.find((i: any) => i.coverType === type);
  if (!img) return '';
  if (img.remoteUrl) return img.remoteUrl;
  if (img.url) return `${config.radarr.url}${img.url}`;
  return '';
}

function radarrToContentItem(movie: any, status: ContentItem['status']): ContentItem {
  return {
    id: `radarr-${movie.id}`,
    type: 'movie',
    title: movie.title || '',
    summary: movie.overview || '',
    duration: movie.runtime || 0,
    artwork: {
      poster: movieImageUrl(movie.images, 'poster'),
      thumbnail: movieImageUrl(movie.images, 'fanart'),
      background: movieImageUrl(movie.images, 'fanart'),
    },
    source: 'radarr',
    sourceId: String(movie.id),
    status,
    progress: {
      watched: false,
      percentage: 0,
      currentPosition: 0,
    },
    availability: {
      availableAt: movie.digitalRelease || movie.physicalRelease || movie.inCinemas || '',
    },
    addedAt: movie.added || '',
    year: movie.year || 0,
    rating: movie.ratings?.tmdb?.value || movie.ratings?.value,
    genres: movie.genres || [],
  };
}

export async function getRecentDownloads(limit: number = 20): Promise<ContentItem[]> {
  const cacheKey = `radarr:recent:${limit}`;
  const cached = getCached<ContentItem[]>(cacheKey);
  if (cached) return cached;

  const http = getClient();
  const { data } = await http.get('/history', {
    params: {
      page: 1,
      pageSize: limit,
      sortKey: 'date',
      sortDirection: 'descending',
      eventType: 3, // downloadFolderImported
    },
  });

  const records = toArray(data);
  // Fetch full movie details for each history record
  const movieIds = [...new Set(records.map((r: any) => r.movieId).filter(Boolean))];
  const movies = await Promise.all(
    movieIds.slice(0, 20).map(async (id) => {
      try {
        const { data: movie } = await http.get(`/movie/${id}`);
        return movie;
      } catch {
        return null;
      }
    }),
  );

  const movieMap = new Map(movies.filter(Boolean).map((m: any) => [m.id, m]));
  const result = records
    .map((record: any) => {
      const movie = movieMap.get(record.movieId);
      if (!movie) return null;
      return radarrToContentItem(movie, movie.hasFile ? 'ready' : 'coming_soon');
    })
    .filter(Boolean) as ContentItem[];

  // Deduplicate by movie ID
  const seen = new Set<string>();
  const deduped = result.filter((item) => {
    if (seen.has(item.sourceId)) return false;
    seen.add(item.sourceId);
    return true;
  });

  setCached(cacheKey, deduped);
  return deduped;
}

export async function getUpcoming(days: number = 30): Promise<ContentItem[]> {
  const cacheKey = `radarr:upcoming:${days}`;
  const cached = getCached<ContentItem[]>(cacheKey);
  if (cached) return cached;

  const http = getClient();
  const start = new Date().toISOString();
  const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await http.get('/calendar', {
    params: { start, end, unmonitored: false },
  });

  const items = toArray(data);
  const result = items
    .map((movie: any) => radarrToContentItem(movie, 'coming_soon'))
    .sort(
      (a: ContentItem, b: ContentItem) =>
        new Date(a.availability.availableAt).getTime() -
        new Date(b.availability.availableAt).getTime(),
    );

  setCached(cacheKey, result);
  return result;
}

export async function getQueue(): Promise<ContentItem[]> {
  const cacheKey = 'radarr:queue';
  const cached = getCached<ContentItem[]>(cacheKey);
  if (cached) return cached;

  const http = getClient();
  const { data } = await http.get('/queue', { params: { includeMovie: true } });
  const records = toArray(data);
  // Radarr can have multiple queue entries for the same movie (quality upgrades).
  // Deduplicate by movie ID to prevent duplicate-key errors in the UI.
  const seen = new Set<number>();
  const result: ContentItem[] = [];
  for (const record of records) {
    const movie = record.movie || record;
    const movieId = movie.id;
    if (movieId && seen.has(movieId)) continue;
    if (movieId) seen.add(movieId);
    result.push(radarrToContentItem(movie, 'downloading'));
  }

  setCached(cacheKey, result, 60);
  return result;
}

export async function searchMovies(query: string): Promise<ContentItem[]> {
  const http = getClient();
  const { data } = await http.get('/movie');
  const items = toArray(data);
  const filtered = items.filter((m: any) => m.title.toLowerCase().includes(query.toLowerCase()));
  return filtered.map((movie: any) =>
    radarrToContentItem(movie, movie.hasFile ? 'ready' : 'coming_soon'),
  );
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

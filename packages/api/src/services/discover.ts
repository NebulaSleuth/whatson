import axios from 'axios';
import { config } from '../config.js';
import { TMDB_BASE_URL, TMDB_IMAGE_BASE } from '@whatson/shared';
import type { TmdbSearchResult } from '@whatson/shared';

// ── Helpers ──

function toArray(data: any): any[] {
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return []; }
  }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.records)) return data.records;
  return [];
}

function tmdbImage(path: string | null, size: string = 'w500'): string {
  if (!path) return '';
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

function hasTmdbKey(): boolean {
  const key = config.epg.tmdbApiKey;
  // TMDB keys are 32-char hex strings; reject anything that doesn't look right
  return Boolean(key && key.length >= 20 && !key.includes('your_'));
}

// ── TMDB Search ──

/**
 * TMDB search. With no opts, hits /search/multi (the discover flow).
 * Pass `type` to use the type-specific endpoint (/search/movie or /search/tv)
 * and optionally `year` to disambiguate same-titled releases — the
 * "Because you watched X" flow uses both so it doesn't pick the wrong
 * franchise/remake/UK-vs-US-version when looking up the title.
 */
async function searchTmdb(
  query: string,
  opts: { type?: 'movie' | 'tv'; year?: number } = {},
): Promise<TmdbSearchResult[]> {
  const endpoint = opts.type === 'movie'
    ? 'search/movie'
    : opts.type === 'tv'
      ? 'search/tv'
      : 'search/multi';
  const params: Record<string, unknown> = {
    api_key: config.epg.tmdbApiKey,
    query,
    include_adult: false,
    language: 'en-US',
    page: 1,
  };
  if (opts.type === 'movie' && opts.year) params.year = opts.year;
  if (opts.type === 'tv' && opts.year) params.first_air_date_year = opts.year;

  const { data } = await axios.get(`${TMDB_BASE_URL}/${endpoint}`, {
    params,
    timeout: 10000,
  });

  const results: TmdbSearchResult[] = [];
  for (const item of data.results || []) {
    // /search/multi returns media_type per row; type-specific endpoints don't
    // — fall back to the explicit opts.type in that case.
    const mediaType = (item.media_type as string | undefined) || opts.type;
    if (mediaType !== 'movie' && mediaType !== 'tv') continue;
    const isMovie = mediaType === 'movie';
    results.push({
      id: item.id,
      tmdbId: item.id,
      title: (isMovie ? item.title : item.name) || '',
      type: isMovie ? 'movie' : 'tv',
      year: new Date((isMovie ? item.release_date : item.first_air_date) || '').getFullYear() || 0,
      overview: item.overview || '',
      poster: tmdbImage(item.poster_path),
      backdrop: tmdbImage(item.backdrop_path, 'w1280'),
      rating: item.vote_average || 0,
      popularity: item.popularity || 0,
    });
  }
  return results;
}

// ── Sonarr/Radarr Lookup Fallback ──

function sonarrImageUrl(images: any[], type: string): string {
  const img = images?.find((i: any) => i.coverType === type);
  if (!img) return '';
  return img.remoteUrl || '';
}

async function searchSonarrLookup(query: string): Promise<TmdbSearchResult[]> {
  if (!config.sonarr.url || !config.sonarr.apiKey) return [];

  try {
    const { data } = await axios.get(`${config.sonarr.url}/api/v3/series/lookup`, {
      params: { term: query },
      headers: { 'X-Api-Key': config.sonarr.apiKey },
      timeout: 15000,
    });

    const items = toArray(data);
    return items.map((s: any) => ({
      id: s.tvdbId || s.tmdbId || Math.random(),
      tmdbId: s.tmdbId || 0,
      imdbId: s.imdbId,
      title: s.title || '',
      type: 'tv' as const,
      year: s.year || 0,
      overview: s.overview || '',
      poster: sonarrImageUrl(s.images, 'poster'),
      backdrop: sonarrImageUrl(s.images, 'fanart'),
      rating: s.ratings?.value || 0,
      popularity: 0,
    }));
  } catch (error) {
    console.warn('[Discover] Sonarr lookup failed:', (error as Error).message);
    return [];
  }
}

async function searchRadarrLookup(query: string): Promise<TmdbSearchResult[]> {
  if (!config.radarr.url || !config.radarr.apiKey) return [];

  try {
    const { data } = await axios.get(`${config.radarr.url}/api/v3/movie/lookup`, {
      params: { term: query },
      headers: { 'X-Api-Key': config.radarr.apiKey },
      timeout: 15000,
    });

    const items = toArray(data);
    return items.slice(0, 20).map((m: any) => ({
      id: m.tmdbId || Math.random(),
      tmdbId: m.tmdbId || 0,
      imdbId: m.imdbId,
      title: m.title || '',
      type: 'movie' as const,
      year: m.year || 0,
      overview: m.overview || '',
      poster: sonarrImageUrl(m.images, 'poster'),
      backdrop: sonarrImageUrl(m.images, 'fanart'),
      rating: m.ratings?.tmdb?.value || m.ratings?.value || 0,
      popularity: m.popularity || 0,
    }));
  } catch (error) {
    console.warn('[Discover] Radarr lookup failed:', (error as Error).message);
    return [];
  }
}

// ── Public API ──

async function searchViaArrLookup(query: string): Promise<TmdbSearchResult[]> {
  const [tvResults, movieResults] = await Promise.all([
    searchSonarrLookup(query),
    searchRadarrLookup(query),
  ]);
  return [...tvResults, ...movieResults];
}

/**
 * Search for shows and movies to discover.
 * Uses TMDB if API key is configured and working, otherwise falls back to Sonarr/Radarr lookup.
 */
export async function searchMulti(query: string): Promise<TmdbSearchResult[]> {
  if (hasTmdbKey()) {
    try {
      console.log('[Discover] Trying TMDB search');
      const results = await searchTmdb(query);
      return results;
    } catch (error) {
      console.warn('[Discover] TMDB failed, falling back to Sonarr/Radarr:', (error as Error).message);
    }
  } else {
    console.log('[Discover] No TMDB key configured');
  }

  // Fallback: use Sonarr + Radarr lookup endpoints
  console.log('[Discover] Using Sonarr/Radarr lookup');
  return searchViaArrLookup(query);
}

/** Check if TMDB recommendations are available */
export function isTmdbAvailable(): boolean {
  return hasTmdbKey();
}

/**
 * TMDB recommendations for a given movie/TV id.
 *
 * Hits `/recommendations`, not `/similar`. TMDB's `/similar` is shallow
 * keyword + genre overlap, which produces a lot of "thrillers from the
 * 2010s" filler. `/recommendations` is collaborative-filtering data
 * (people-who-rated-X-also-liked-Y) and is noticeably more relevant.
 */
export async function getTmdbSimilar(
  tmdbId: number,
  type: 'movie' | 'tv',
): Promise<TmdbSearchResult[]> {
  if (!hasTmdbKey()) return [];

  try {
    const { data } = await axios.get(`${TMDB_BASE_URL}/${type}/${tmdbId}/recommendations`, {
      params: { api_key: config.epg.tmdbApiKey, page: 1 },
      timeout: 10000,
    });

    return (data.results || [])
      .filter((item: any) => item.poster_path)
      .slice(0, 20)
      .map((item: any) => ({
        tmdbId: item.id,
        title: item.title || item.name || '',
        type: type === 'movie' ? 'movie' as const : 'tv' as const,
        year: parseInt((item.release_date || item.first_air_date || '').slice(0, 4)) || 0,
        overview: item.overview || '',
        poster: tmdbImage(item.poster_path),
        backdrop: tmdbImage(item.backdrop_path, 'w780'),
        rating: item.vote_average || 0,
        tracked: false,
      }));
  } catch {
    return [];
  }
}

/**
 * Build "Because you watched X" recommendations from TMDB.
 * Takes the user's recent watch history and finds similar titles.
 */
export async function getTmdbRecommendations(
  watchedItems: Array<{ title: string; tmdbId?: number; type: 'movie' | 'tv'; year?: number }>,
): Promise<{ title: string; items: TmdbSearchResult[] }[]> {
  if (!hasTmdbKey() || watchedItems.length === 0) return [];

  const results: { title: string; items: TmdbSearchResult[] }[] = [];
  const seenIds = new Set<number>();

  // Get recommendations for up to 5 recent items
  for (const watched of watchedItems.slice(0, 5)) {
    let tmdbId = watched.tmdbId;

    // If no TMDB ID, search for it. Type-specific endpoint plus year (when
    // we have it) keeps us from picking the wrong "Avatar" / "It" / "The
    // Office" — a very common cause of completely off-topic recs.
    if (!tmdbId) {
      try {
        const searchResults = await searchTmdb(watched.title, {
          type: watched.type,
          year: watched.year,
        });
        const match = searchResults.find(
          (r) => r.type === watched.type && r.title.toLowerCase() === watched.title.toLowerCase(),
        ) || searchResults[0];
        if (match) tmdbId = match.tmdbId;
      } catch {}
    }

    if (!tmdbId) continue;

    const similar = await getTmdbSimilar(tmdbId, watched.type);
    const filtered = similar.filter((item) => {
      if (seenIds.has(item.tmdbId)) return false;
      seenIds.add(item.tmdbId);
      return true;
    });

    if (filtered.length > 0) {
      results.push({
        title: `Because you watched ${watched.title}`,
        items: filtered.slice(0, 10),
      });
    }
  }

  return results;
}

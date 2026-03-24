import type { ApiResponse, HomeResponse, SearchResponse, ContentItem } from '@whatson/shared';
import { useAppStore } from './store';

function getBaseUrl(): string {
  return useAppStore.getState().apiUrl;
}

/** Resolve artwork URLs — converts relative proxy paths to absolute backend URLs */
export function resolveArtworkUrl(url: string): string {
  if (!url) return '';
  // Already absolute
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  // Relative proxy URL like /api/artwork?url=...
  const base = getBaseUrl().replace(/\/api\/?$/, '');
  return `${base}${url}`;
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  // Read response as text first to avoid JSON parse errors on HTML responses
  const text = await response.text();

  if (!response.ok) {
    let errorMsg = `HTTP ${response.status}`;
    try {
      const errorJson = JSON.parse(text);
      errorMsg = errorJson.error || errorMsg;
    } catch {
      // Response was not JSON (likely HTML error page)
      errorMsg = `API unreachable (${response.status}). Check API URL in Settings.`;
    }
    throw new Error(errorMsg);
  }

  let json: ApiResponse<T>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid response from API. Check API URL in Settings. (got: ${text.slice(0, 50)}...)`);
  }

  if (!json.success) {
    throw new Error(json.error || 'Unknown error');
  }

  return json.data!;
}

export const api = {
  // Home
  getHome: (forceRefresh?: boolean) =>
    fetchApi<HomeResponse>(forceRefresh ? '/home?refresh=true' : '/home'),

  // TV Shows
  getTvUpcoming: (days = 7) => fetchApi<ContentItem[]>(`/tv/upcoming?days=${days}`),
  getTvRecent: () => fetchApi<ContentItem[]>('/tv/recent'),
  getTvDownloading: () => fetchApi<ContentItem[]>('/tv/downloading'),

  // Movies
  getMoviesRecent: () => fetchApi<ContentItem[]>('/movies/recent'),
  getMoviesUpcoming: (days = 30) => fetchApi<ContentItem[]>(`/movies/upcoming?days=${days}`),
  getMoviesDownloading: () => fetchApi<ContentItem[]>('/movies/downloading'),

  // Search
  search: (query: string, type?: 'tv' | 'movie') => {
    const params = new URLSearchParams({ q: query });
    if (type) params.set('type', type);
    return fetchApi<SearchResponse>(`/search?${params}`);
  },

  // Scrobble
  markWatched: (sourceId: string, source: string, episodeKey?: string) =>
    fetchApi<{ marked: true }>('/scrobble', {
      method: 'POST',
      body: JSON.stringify({ sourceId, source, episodeKey }),
    }),

  markUnwatched: (sourceId: string, source: string) =>
    fetchApi<{ unmarked: true }>('/unscrobble', {
      method: 'POST',
      body: JSON.stringify({ sourceId, source }),
    }),

  markAllWatched: (showTitle: string, source: string, sourceId?: string) =>
    fetchApi<{ marked: true }>('/scrobble/all', {
      method: 'POST',
      body: JSON.stringify({ showTitle, source, sourceId }),
    }),

  markAllUnwatched: (sourceId: string, source: string) =>
    fetchApi<{ unmarked: true }>('/unscrobble/all', {
      method: 'POST',
      body: JSON.stringify({ sourceId, source }),
    }),

  // Health
  getHealth: () => fetchApi<{ api: boolean; services: Record<string, string> }>('/health'),

  // Config
  getConfigStatus: () => fetchApi<Record<string, boolean>>('/config/status'),

  getConfig: () => fetchApi<Record<string, any>>('/config'),

  getPlexPlayLink: (ratingKey: string) =>
    fetchApi<{ appLink: string; webLink: string; serverLink: string | null; machineId: string; ratingKey: string }>(`/plex/play/${ratingKey}`),

  getPlexClients: () =>
    fetchApi<Array<{ name: string; machineIdentifier: string; product: string; platform: string }>>('/plex/clients'),

  playOnPlexClient: (clientId: string, ratingKey: string) =>
    fetchApi<{ playing: boolean }>('/plex/play', {
      method: 'POST',
      body: JSON.stringify({ clientId, ratingKey }),
    }),

  // Library
  getLibrary: (type: 'movie' | 'show') => fetchApi<ContentItem[]>(`/library/${type}`),

  // Playback
  getPlaybackInfo: (ratingKey: string, offset?: number, maxBitrate?: number, resolution?: string) => {
    const params = new URLSearchParams();
    if (offset) params.set('offset', String(Math.floor(offset / 1000)));
    if (maxBitrate) {
      params.set('maxBitrate', String(maxBitrate));
      params.set('forceTranscode', '1');
    }
    if (resolution) params.set('resolution', resolution);
    const qs = params.toString();
    return fetchApi<{
      streamUrl: string;
      directPlayUrl: string | null;
      sessionId: string;
      title: string;
      showTitle: string | null;
      episodeTitle: string | null;
      seasonNumber?: number;
      episodeNumber?: number;
      duration: number;
      viewOffset: number;
      subtitles: Array<{ id: number; index: number; language: string; title: string; selected: boolean }>;
      audioTracks: Array<{ id: number; index: number; language: string; title: string; selected: boolean }>;
      serverUrl: string;
    }>(`/playback/${ratingKey}${qs ? `?${qs}` : ''}`);
  },

  reportProgress: (ratingKey: string, time: number, duration: number, state: string, sessionId: string) =>
    fetchApi<any>('/playback/progress', {
      method: 'POST',
      body: JSON.stringify({ ratingKey, time, duration, state, sessionId }),
    }),

  stopPlayback: (sessionId: string) =>
    fetchApi<any>('/playback/stop', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),

  testConnection: (service: string, url: string, token?: string, apiKey?: string) =>
    fetchApi<{ connected: boolean }>('/config/test', {
      method: 'POST',
      body: JSON.stringify({ service, url, token, apiKey }),
    }),

  // Discover / TMDB Search
  discoverSearch: (query: string) =>
    fetchApi<Array<any>>(`/discover/search?q=${encodeURIComponent(query)}`),

  // Tracked items
  getTracked: () => fetchApi<Array<any>>('/tracked'),
  getAllTrackedTv: () => fetchApi<Array<any>>('/tracked?all=true&type=tv'),

  addTracked: (item: {
    tmdbId: number;
    imdbId?: string;
    title: string;
    type: 'movie' | 'tv';
    year?: number;
    overview?: string;
    poster?: string;
    backdrop?: string;
    rating?: number;
    provider: string;
  }) =>
    fetchApi<any>('/tracked', {
      method: 'POST',
      body: JSON.stringify(item),
    }),

  removeTracked: (tmdbId: number) =>
    fetchApi<{ removed: boolean }>(`/tracked/${tmdbId}`, { method: 'DELETE' }),

  // Sonarr/Radarr add
  getSonarrProfiles: () => fetchApi<Array<{ id: number; name: string }>>('/sonarr/profiles'),
  getSonarrRootFolders: () => fetchApi<Array<{ id: number; path: string }>>('/sonarr/rootfolders'),
  addToSonarr: (opts: { title: string; tvdbId?: number; tmdbId?: number; qualityProfileId: number; rootFolderPath: string; monitor: string; searchForMissing: boolean }) =>
    fetchApi<{ id: number; title: string }>('/sonarr/add', { method: 'POST', body: JSON.stringify(opts) }),

  getRadarrProfiles: () => fetchApi<Array<{ id: number; name: string }>>('/radarr/profiles'),
  getRadarrRootFolders: () => fetchApi<Array<{ id: number; path: string }>>('/radarr/rootfolders'),
  addToRadarr: (opts: { title: string; tmdbId: number; qualityProfileId: number; rootFolderPath: string }) =>
    fetchApi<{ id: number; title: string }>('/radarr/add', { method: 'POST', body: JSON.stringify(opts) }),
};

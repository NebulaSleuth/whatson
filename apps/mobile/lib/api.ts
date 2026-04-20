import type { ApiResponse, HomeResponse, SearchResponse, ContentItem, ContentSection } from '@whatson/shared';
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

function getUserId(): string | undefined {
  const user = useAppStore.getState().currentUser;
  return user ? String(user.id) : undefined;
}

function getPlexConnectionType(): string {
  return useAppStore.getState().plexConnectionType;
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path}`;
  const userId = getUserId();
  const connType = getPlexConnectionType();
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(userId ? { 'X-Plex-User': userId } : {}),
      'X-Plex-Connection': connType,
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

  getPlexConnections: () =>
    fetchApi<{ local: string[]; remote: string[]; serverUrl: string | null }>('/plex/connections'),

  getPlexClients: () =>
    fetchApi<Array<{ name: string; machineIdentifier: string; product: string; platform: string }>>('/plex/clients'),

  playOnPlexClient: (clientId: string, ratingKey: string) =>
    fetchApi<{ playing: boolean }>('/plex/play', {
      method: 'POST',
      body: JSON.stringify({ clientId, ratingKey }),
    }),

  // Recommendations
  getRecommendations: (showTmdb: boolean = true) =>
    fetchApi<{ sections: ContentSection[] }>(`/recommendations${showTmdb ? '' : '?tmdb=0'}`),

  // Server updates
  getUpdateStatus: () =>
    fetchApi<{
      currentVersion: string;
      latestVersion: string | null;
      updateAvailable: boolean;
      releaseUrl: string | null;
      assetName: string | null;
      downloadUrl: string | null;
      publishedAt: string | null;
      lastCheckedAt: string | null;
      lastError: string | null;
      enabled: boolean;
      platformSupported: boolean;
    }>('/update/status'),
  checkForUpdate: () =>
    fetchApi<{
      currentVersion: string;
      latestVersion: string | null;
      updateAvailable: boolean;
      lastCheckedAt: string | null;
      lastError: string | null;
    }>('/update/check', { method: 'POST' }),
  applyUpdate: () =>
    fetchApi<{ started: boolean }>('/update/apply', { method: 'POST' }),

  // Live TV
  getLiveChannels: () => fetchApi<string[]>('/live/channels'),
  getLiveNow: (channels: string[]) => {
    const params = new URLSearchParams();
    if (channels.length > 0) params.set('channels', channels.join(','));
    const qs = params.toString();
    return fetchApi<ContentItem[]>(`/live/now${qs ? `?${qs}` : ''}`);
  },
  getLiveLater: (channels: string[], hours = 6) => {
    const params = new URLSearchParams();
    if (channels.length > 0) params.set('channels', channels.join(','));
    params.set('hours', String(hours));
    return fetchApi<ContentItem[]>(`/live/later?${params.toString()}`);
  },

  // Library
  getLibrary: (type: 'movie' | 'show', source: string = 'plex') =>
    fetchApi<ContentItem[]>(`/library/${type}?source=${source}`),

  getShowSeasons: (ratingKey: string, source: string = 'plex') =>
    fetchApi<Array<{ ratingKey: string; index: number; title: string; episodeCount: number; watchedCount: number; thumb: string }>>(`/library/show/${ratingKey}/seasons?source=${source}`),

  getSeasonEpisodes: (ratingKey: string, source: string = 'plex') =>
    fetchApi<ContentItem[]>(`/library/season/${ratingKey}/episodes?source=${source}`),

  // Playback
  getPlaybackInfo: (ratingKey: string, opts?: { offset?: number; maxBitrate?: number; resolution?: string; subtitleStreamID?: number; audioStreamID?: number; source?: string }) => {
    const { offset, maxBitrate, resolution, subtitleStreamID, audioStreamID, source = 'plex' } = opts || {};
    const params = new URLSearchParams();
    params.set('source', source);
    if (offset) params.set('offset', String(Math.floor(offset / 1000)));
    if (maxBitrate) {
      params.set('maxBitrate', String(maxBitrate));
      params.set('forceTranscode', '1');
    }
    if (resolution) params.set('resolution', resolution);
    if (subtitleStreamID != null) params.set('subtitleStreamID', String(subtitleStreamID));
    if (audioStreamID != null) params.set('audioStreamID', String(audioStreamID));
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
      markers: Array<{ type: 'intro' | 'credits'; startMs: number; endMs: number }>;
      serverUrl: string;
    }>(`/playback/${ratingKey}?${params.toString()}`);
  },

  reportProgress: (ratingKey: string, time: number, duration: number, state: string, sessionId: string, source: string = 'plex') =>
    fetchApi<any>('/playback/progress', {
      method: 'POST',
      body: JSON.stringify({ ratingKey, time, duration, state, sessionId, source }),
    }),

  stopPlayback: (sessionId: string, source: string = 'plex') =>
    fetchApi<any>('/playback/stop', {
      method: 'POST',
      body: JSON.stringify({ sessionId, source }),
    }),

  // Auth / server providers
  getAuthProviders: () =>
    fetchApi<{ plex: boolean; jellyfin: boolean; emby: boolean; sonarr: boolean; radarr: boolean }>('/auth/providers'),

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

  // Users
  getUsers: () =>
    fetchApi<Array<{ id: number; title: string; thumb: string; admin: boolean; hasPassword: boolean; restricted: boolean }>>('/users'),

  selectUser: (userId: number, pin?: string) =>
    fetchApi<{ userId: number; token: string; selected: boolean }>('/users/select', {
      method: 'POST',
      body: JSON.stringify({ userId, pin }),
    }),

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

import type {
  HomeResponse,
  ContentItem,
  SportsEvent,
  SportsPrefs,
  LiveChannel,
  LiveStreamInfo,
  LiveProgram,
} from '@whatson/shared';

// API base — when served from the backend at /, requests stay relative.
// In dev (vite serve), the proxy in vite.config.ts forwards /api to
// VITE_API_PROXY. So callers can always use bare /api/... paths.
const BASE = '';

function getLocalStr(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function setLocalStr(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode / storage full — swallow */
  }
}

export function getAuthKey(): string {
  return getLocalStr('whatson.authKey');
}
export function setAuthKey(key: string): void {
  setLocalStr('whatson.authKey', key);
}

export function getCurrentUserId(): string {
  return getLocalStr('whatson.userId');
}
export function setCurrentUserId(id: string): void {
  setLocalStr('whatson.userId', id);
}

/**
 * Which kind of user is currently selected. Determines whether
 * fetchApi sends X-Plex-User (legacy Plex Home picker) or
 * X-Whatson-User (unified Whats On Users feature). Defaults to
 * 'plex' so existing installs upgrade without breakage.
 */
export type UserKind = 'plex' | 'whatson';

export function getCurrentUserKind(): UserKind {
  return getLocalStr('whatson.userKind') === 'whatson' ? 'whatson' : 'plex';
}
export function setCurrentUserKind(kind: UserKind): void {
  setLocalStr('whatson.userKind', kind);
}

export function getConnectionType(): 'local' | 'remote' {
  const v = getLocalStr('whatson.connectionType');
  return v === 'remote' ? 'remote' : 'local';
}

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const userId = getCurrentUserId();
  const userKind = getCurrentUserKind();
  const userHeader: Record<string, string> = userId
    ? userKind === 'whatson'
      ? { 'X-Whatson-User': userId }
      : { 'X-Plex-User': userId }
    : {};
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...userHeader,
    'X-Plex-Connection': getConnectionType(),
    ...((init?.headers as Record<string, string>) || {}),
  };
  const authKey = getAuthKey();
  if (authKey) headers['X-Whatson-Auth'] = authKey;
  if (init?.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = (body as { error?: string })?.error || `HTTP ${res.status}`;
    throw new Error(err);
  }
  const env = body as { success?: boolean; data?: T; error?: string };
  if (env && typeof env === 'object' && 'success' in env) {
    if (!env.success) throw new Error(env.error || 'API error');
    return env.data as T;
  }
  return body as T;
}

export const api = {
  // Auth + setup
  getAdminStatus: () => fetchApi<{ hasAdminPassword: boolean }>('/api/auth/admin-status'),
  getAuthProviders: () =>
    fetchApi<{ plex: boolean; jellyfin: boolean; emby: boolean; sonarr: boolean; radarr: boolean }>(
      '/api/auth/providers',
    ),
  pairStart: (deviceLabel: string) =>
    fetchApi<{ code: string; expiresAt: string }>(
      '/api/auth/pair/start',
      { method: 'POST', body: JSON.stringify({ deviceLabel }) },
    ),
  pairPoll: (code: string) =>
    fetchApi<{ key?: string; status: 'pending' | 'completed' | 'expired' }>(
      `/api/auth/pair/poll?code=${encodeURIComponent(code)}`,
    ),

  // Users
  getUsers: () =>
    fetchApi<Array<{ id: number; title: string; thumb: string; admin: boolean; hasPassword: boolean; restricted: boolean }>>(
      '/api/users',
    ),
  selectUser: (userId: number, pin?: string) =>
    fetchApi<{ id: number; title: string; admin: boolean; hasPassword: boolean; restricted: boolean }>(
      '/api/users/select',
      { method: 'POST', body: JSON.stringify({ userId, pin }) },
    ),

  // Whats On Users (multi-service unified picker)
  getWhatsOnConfig: () =>
    fetchApi<{ enabled: boolean }>('/api/whatson-users/config'),
  getWhatsOnAvatars: () =>
    fetchApi<Array<{ key: string; label: string; bg: string; emoji: string; url: string }>>(
      '/api/whatson-users/avatars',
    ),
  getWhatsOnUsers: () =>
    fetchApi<Array<{
      id: string;
      name: string;
      avatar: string;
      hasPin: boolean;
      hasPlexToken: boolean;
      plexUserId: number | null;
      jellyfinUserId: string | null;
      embyUserId: string | null;
    }>>('/api/whatson-users'),
  selectWhatsOnUser: (id: string, pin?: string) =>
    fetchApi<{
      id: string;
      name: string;
      avatar: string;
      hasPin: boolean;
      hasPlexToken: boolean;
      plexUserId: number | null;
      jellyfinUserId: string | null;
      embyUserId: string | null;
    }>(`/api/whatson-users/${encodeURIComponent(id)}/select`, {
      method: 'POST',
      body: JSON.stringify(pin ? { pin } : {}),
    }),

  // Home
  getHome: () => fetchApi<HomeResponse>('/api/home'),

  // TV / Movies shelves
  getTvRecent: () => fetchApi<ContentItem[]>('/api/tv/recent'),
  getTvRecentlyDownloaded: () => fetchApi<ContentItem[]>('/api/tv/recently-downloaded'),
  getTvUpcoming: (days = 7) => fetchApi<ContentItem[]>(`/api/tv/upcoming?days=${days}`),
  getTvDownloading: () => fetchApi<ContentItem[]>('/api/tv/downloading'),
  getMoviesRecent: () => fetchApi<ContentItem[]>('/api/movies/recent'),
  getMoviesRecentlyDownloaded: () => fetchApi<ContentItem[]>('/api/movies/recently-downloaded'),
  getMoviesUpcoming: (days = 30) => fetchApi<ContentItem[]>(`/api/movies/upcoming?days=${days}`),
  getMoviesDownloading: () => fetchApi<ContentItem[]>('/api/movies/downloading'),

  // Library
  getLibrary: (type: 'movie' | 'show', source: string = 'plex') =>
    fetchApi<ContentItem[]>(`/api/library/${type}?source=${source}`),

  getShowSeasons: (ratingKey: string, source: string = 'plex') =>
    fetchApi<Array<{ ratingKey: string; index: number; title: string; episodeCount: number; watchedCount: number; thumb: string }>>(`/api/library/show/${encodeURIComponent(ratingKey)}/seasons?source=${source}`),

  getSeasonEpisodes: (ratingKey: string, source: string = 'plex') =>
    fetchApi<ContentItem[]>(`/api/library/season/${encodeURIComponent(ratingKey)}/episodes?source=${source}`),

  // Search
  searchLibrary: (query: string, type?: 'tv' | 'movie') => {
    const params = new URLSearchParams({ q: query });
    if (type) params.set('type', type);
    return fetchApi<{ items: ContentItem[] }>(`/api/search?${params.toString()}`);
  },
  searchDiscover: (query: string) =>
    fetchApi<Array<{ id: string; tmdbId: number; title: string; type: 'tv' | 'movie'; year?: number; poster?: string; isTracked?: boolean }>>(
      `/api/discover/search?q=${encodeURIComponent(query)}`,
    ),

  // Tracked
  getAllTrackedTv: () => fetchApi<Array<{ id: string; title: string; tmdbId: number; year?: number; rating?: number; poster: string; backdrop?: string; overview?: string; provider: string; addedAt: string }>>('/api/tracked?all=true&type=tv'),
  removeTracked: (tmdbId: number) =>
    fetchApi<{ removed: boolean }>('/api/tracked', {
      method: 'DELETE',
      body: JSON.stringify({ tmdbId }),
    }),

  // Scrobble — mark watched / unwatched
  markWatched: (sourceId: string, source: string, episodeKey?: string) =>
    fetchApi<{ marked: true }>('/api/scrobble', {
      method: 'POST',
      body: JSON.stringify({ sourceId, source, episodeKey }),
    }),
  markUnwatched: (sourceId: string, source: string) =>
    fetchApi<{ unmarked: true }>('/api/unscrobble', {
      method: 'POST',
      body: JSON.stringify({ sourceId, source }),
    }),
  markAllWatched: (showTitle: string, source: string, sourceId?: string) =>
    fetchApi<{ marked: true }>('/api/scrobble/all', {
      method: 'POST',
      body: JSON.stringify({ showTitle, source, sourceId }),
    }),
  markAllUnwatched: (sourceId: string, source: string) =>
    fetchApi<{ unmarked: true }>('/api/unscrobble/all', {
      method: 'POST',
      body: JSON.stringify({ sourceId, source }),
    }),

  // Playback
  getPlaybackInfo: (
    ratingKey: string,
    opts?: {
      offset?: number;
      source?: string;
      maxBitrate?: number;
      resolution?: string;
      subtitleStreamID?: number;
      audioStreamID?: number;
    },
  ) => {
    const { offset, source = 'plex', maxBitrate, resolution, subtitleStreamID, audioStreamID } = opts || {};
    const params = new URLSearchParams({ source });
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
      duration: number;
      viewOffset: number;
      clientSeekMs?: number;
      subtitles: Array<{ id: number; index: number; language: string; title: string; selected: boolean }>;
      audioTracks: Array<{ id: number; index: number; language: string; title: string; selected: boolean }>;
      markers: Array<{ type: 'intro' | 'credits'; startMs: number; endMs: number }>;
      serverUrl: string;
    }>(`/api/playback/${encodeURIComponent(ratingKey)}?${params.toString()}`);
  },
  reportProgress: (ratingKey: string, time: number, duration: number, state: string, sessionId: string, source: string = 'plex') =>
    fetchApi<unknown>('/api/playback/progress', {
      method: 'POST',
      body: JSON.stringify({ ratingKey, time, duration, state, sessionId, source }),
    }),
  stopPlayback: (sessionId: string, source: string = 'plex', extras?: { ratingKey?: string; positionMs?: number }) =>
    fetchApi<unknown>('/api/playback/stop', {
      method: 'POST',
      body: JSON.stringify({ sessionId, source, ...(extras || {}) }),
    }),

  // Sonarr / Radarr add (used by Discover items)
  addToSonarr: (tmdbId: number, profileId?: number, rootFolderPath?: string, monitor?: string) =>
    fetchApi<{ added: true }>('/api/sonarr/add', {
      method: 'POST',
      body: JSON.stringify({ tmdbId, profileId, rootFolderPath, monitor }),
    }),
  addToRadarr: (tmdbId: number, profileId?: number, rootFolderPath?: string) =>
    fetchApi<{ added: true }>('/api/radarr/add', {
      method: 'POST',
      body: JSON.stringify({ tmdbId, profileId, rootFolderPath }),
    }),

  // Sports
  getSportsNow: () => fetchApi<SportsEvent[]>('/api/sports/now'),
  getSportsLater: (hours = 168) => fetchApi<SportsEvent[]>(`/api/sports/later?hours=${hours}`),
  getSportsCompleted: (days = 7) => fetchApi<SportsEvent[]>(`/api/sports/completed?days=${days}`),
  getSportsPrefs: () => fetchApi<SportsPrefs>('/api/sports/prefs'),

  // Live TV
  getLiveNow: (channels: string[]) => {
    const qs = channels.length > 0 ? `?channels=${encodeURIComponent(channels.join(','))}` : '';
    return fetchApi<ContentItem[]>(`/api/live/now${qs}`);
  },

  // Health
  getHealth: () =>
    fetchApi<{ status: string; version?: string; services: Record<string, string> }>('/api/health'),

  // Server config + updates
  getConfig: () => fetchApi<Record<string, { url?: string; configured?: boolean }>>('/api/config'),
  getUpdateStatus: () =>
    fetchApi<{
      currentVersion: string;
      latestVersion: string | null;
      updateAvailable: boolean;
      platformSupported?: boolean;
      lastCheckedAt: string | null;
      lastError: string | null;
    }>('/api/update/status'),
  checkUpdate: () =>
    fetchApi<{ currentVersion: string; latestVersion: string | null; updateAvailable: boolean; lastCheckedAt: string | null; lastError: string | null }>(
      '/api/update/check',
      { method: 'POST' },
    ),
  applyUpdate: () => fetchApi<{ started: boolean }>('/api/update/apply', { method: 'POST' }),

  // Live TV
  getLiveChannels: () => fetchApi<string[]>('/api/live/channels'),
  getLiveTunerChannels: (source: string = 'all') =>
    fetchApi<LiveChannel[]>(`/api/live/tuner-channels?source=${source}`),
  getLiveStreamInfo: (channelId: string) =>
    fetchApi<LiveStreamInfo>(`/api/live/stream/${encodeURIComponent(channelId)}?format=hls`),
  getLiveEpg: (channelIds: string[], hours: number = 4) =>
    fetchApi<LiveProgram[]>(
      `/api/live/epg?hours=${hours}&channelIds=${channelIds.map(encodeURIComponent).join(',')}`,
    ),
};

/** Rewrite a relative /api/artwork URL to an absolute one — the SPA
 * runs at the same origin so this is just the path itself, but the
 * helper exists so callers don't hard-code the prefix. */
export function resolveArtworkUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return url;
}

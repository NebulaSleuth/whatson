import type {
  HomeResponse,
  ContentItem,
  SportsEvent,
  SportsPrefs,
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

export function getConnectionType(): 'local' | 'remote' {
  const v = getLocalStr('whatson.connectionType');
  return v === 'remote' ? 'remote' : 'local';
}

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Plex-User': getCurrentUserId(),
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
    fetchApi<{ authKey?: string; status: 'pending' | 'paired' | 'expired' }>(
      `/api/auth/pair/poll?code=${encodeURIComponent(code)}`,
    ),

  // Users
  getUsers: () =>
    fetchApi<Array<{ id: number; title: string; thumb: string; admin: boolean; hasPassword: boolean; restricted: boolean }>>(
      '/api/users',
    ),
  selectUser: (id: number) =>
    fetchApi<{ ok: true }>('/api/users/select', { method: 'POST', body: JSON.stringify({ id }) }),

  // Home
  getHome: () => fetchApi<HomeResponse>('/api/home'),

  // TV / Movies shelves
  getTvRecent: () => fetchApi<ContentItem[]>('/api/tv/recent'),
  getTvUpcoming: (days = 7) => fetchApi<ContentItem[]>(`/api/tv/upcoming?days=${days}`),
  getTvDownloading: () => fetchApi<ContentItem[]>('/api/tv/downloading'),
  getMoviesRecent: () => fetchApi<ContentItem[]>('/api/movies/recent'),
  getMoviesUpcoming: (days = 30) => fetchApi<ContentItem[]>(`/api/movies/upcoming?days=${days}`),
  getMoviesDownloading: () => fetchApi<ContentItem[]>('/api/movies/downloading'),

  // Library
  getLibrary: (type: 'movie' | 'show', source: string = 'plex') =>
    fetchApi<ContentItem[]>(`/api/library/${type}?source=${source}`),

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
};

/** Rewrite a relative /api/artwork URL to an absolute one — the SPA
 * runs at the same origin so this is just the path itself, but the
 * helper exists so callers don't hard-code the prefix. */
export function resolveArtworkUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return url;
}

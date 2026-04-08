import axios, { type AxiosInstance } from 'axios';
import { config } from '../config.js';
import { getCached, setCached } from '../cache.js';
import { PLEX_CLIENT_IDENTIFIER, PLEX_PRODUCT, APP_VERSION } from '@whatson/shared';
import type { ContentItem } from '@whatson/shared';

let client: AxiosInstance | null = null;
let resolvedServerUrl: string | null = null;
let discoveryPromise: Promise<string> | null = null;

// ── Plex.tv Server Discovery ──

interface PlexConnection {
  uri: string;
  local: boolean;
  protocol: string;
}

interface PlexResource {
  name: string;
  provides: string;
  owned: boolean;
  connections: PlexConnection[];
}

/** Test if a Plex connection is reachable */
async function testPlexConnection(uri: string): Promise<boolean> {
  try {
    await axios.get(`${uri}/identity`, {
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': config.plex.token,
        'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
      },
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

async function discoverServerUrl(): Promise<string> {
  if (resolvedServerUrl) return resolvedServerUrl;

  // If a direct URL is provided, use it as-is
  if (config.plex.url) {
    resolvedServerUrl = config.plex.url.replace(/\/$/, '');
    console.log(`[Plex] Using configured URL: ${resolvedServerUrl}`);
    return resolvedServerUrl;
  }

  // Otherwise, discover via plex.tv
  if (!config.plex.token) {
    throw new Error('Plex not configured: provide either PLEX_URL or PLEX_TOKEN for discovery');
  }

  console.log('[Plex] No URL configured — discovering server via plex.tv...');

  const { data } = await axios.get<PlexResource[]>(
    'https://plex.tv/api/v2/resources',
    {
      params: { includeHttps: 1, includeRelay: 1 },
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': config.plex.token,
        'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
      },
      timeout: 10000,
    },
  );

  // Find owned servers that provide "server" capability
  const servers = data.filter((r) => r.provides.includes('server') && r.owned);

  if (servers.length === 0) {
    throw new Error('No Plex servers found on your account. Check your PLEX_TOKEN.');
  }

  const server = servers[0];
  console.log(`[Plex] Found server: "${server.name}" with ${server.connections.length} connections`);

  // Log all available connections
  for (const c of server.connections) {
    console.log(`[Plex]   ${c.local ? 'local' : 'remote'} ${c.protocol}: ${c.uri}`);
  }

  // Try connections in priority order, actually testing each one
  const ordered: PlexConnection[] = [
    ...server.connections.filter((c) => c.local && c.protocol === 'https'),
    ...server.connections.filter((c) => c.local && c.protocol === 'http'),
    ...server.connections.filter((c) => !c.local && c.protocol === 'https'),
    ...server.connections.filter((c) => !c.local && c.protocol === 'http'),
  ];

  for (const conn of ordered) {
    console.log(`[Plex] Testing ${conn.local ? 'local' : 'remote'} ${conn.protocol}: ${conn.uri}...`);
    const reachable = await testPlexConnection(conn.uri);
    if (reachable) {
      resolvedServerUrl = conn.uri;
      console.log(`[Plex] Connected via ${conn.local ? 'local' : 'remote'} ${conn.protocol}: ${resolvedServerUrl}`);
      return resolvedServerUrl;
    }
    console.log(`[Plex]   Not reachable`);
  }

  throw new Error(`Plex server "${server.name}" found but no connections are reachable. Check your network/firewall.`);
}

// ── HTTP Client ──

/** Ensures only one discovery runs at a time */
async function ensureDiscovered(): Promise<string> {
  if (resolvedServerUrl) return resolvedServerUrl;
  if (!discoveryPromise) {
    discoveryPromise = discoverServerUrl().finally(() => {
      // Clear promise on failure so it can be retried
      if (!resolvedServerUrl) discoveryPromise = null;
    });
  }
  return discoveryPromise;
}

// Per-user client cache: token -> AxiosInstance
const userClients = new Map<string, AxiosInstance>();

function getTokenForClient(userToken?: string): string {
  return userToken || config.plex.token;
}

async function getClient(userToken?: string): Promise<AxiosInstance> {
  const token = getTokenForClient(userToken);

  // Check per-user client cache
  const cached = userClients.get(token);
  if (cached) return cached;

  // Build default client if none cached
  if (!client || userToken) {
    const baseURL = await ensureDiscovered();

    const newClient = axios.create({
      baseURL,
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': token,
        'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
        'X-Plex-Product': PLEX_PRODUCT,
        'X-Plex-Version': APP_VERSION,
      },
      timeout: 30000,
    });

    if (userToken) {
      userClients.set(token, newClient);
      return newClient;
    }

    client = newClient;
  }
  return client;
}

function artworkUrl(path: string | undefined, userToken?: string): string {
  if (!path) return '';
  if (!resolvedServerUrl) return '';
  return `${resolvedServerUrl}${path}?X-Plex-Token=${getTokenForClient(userToken)}`;
}

/** Get the resolved server URL (triggers discovery if needed) */
export async function getServerUrl(): Promise<string | null> {
  try {
    return await discoverServerUrl();
  } catch {
    return null;
  }
}

/** Get the server's machine identifier for deep linking */
export async function getMachineIdentifier(): Promise<string | null> {
  try {
    const http = await getClient();
    const { data } = await http.get('/identity');
    return data?.MediaContainer?.machineIdentifier || null;
  } catch {
    return null;
  }
}

// ── Data Mapping ──

function plexToContentItem(item: any, status: ContentItem['status'], userToken?: string): ContentItem {
  const isEpisode = item.type === 'episode';
  const duration = item.duration ? Math.round(item.duration / 60000) : 0;
  const viewOffset = item.viewOffset || 0;
  const watched = (item.viewCount || 0) > 0 && !viewOffset;
  const percentage = item.duration ? Math.round((viewOffset / item.duration) * 100) : 0;

  return {
    id: `plex-${item.ratingKey}`,
    type: isEpisode ? 'episode' : 'movie',
    title: isEpisode ? item.title : item.title,
    showTitle: isEpisode ? item.grandparentTitle : undefined,
    seasonNumber: isEpisode ? item.parentIndex : undefined,
    episodeNumber: isEpisode ? item.index : undefined,
    summary: item.summary || '',
    duration,
    artwork: {
      poster: artworkUrl(isEpisode ? item.grandparentThumb : item.thumb, userToken),
      thumbnail: artworkUrl(item.thumb, userToken),
      background: artworkUrl(item.art, userToken),
    },
    source: 'plex',
    sourceId: String(item.ratingKey),
    status,
    progress: {
      watched,
      percentage,
      currentPosition: Math.round(viewOffset / 1000),
    },
    availability: {
      availableAt: new Date((item.addedAt || 0) * 1000).toISOString(),
    },
    playbackUrl: resolvedServerUrl
      ? `${resolvedServerUrl}/web/index.html#!/server/${item.machineIdentifier}/details?key=${encodeURIComponent(`/library/metadata/${item.ratingKey}`)}`
      : undefined,
    addedAt: new Date((item.addedAt || 0) * 1000).toISOString(),
    lastViewedAt: item.lastViewedAt ? new Date(item.lastViewedAt * 1000).toISOString() : undefined,
    year: item.year || 0,
    rating: item.rating,
    genres: item.Genre?.map((g: any) => g.tag) || [],
  };
}

// ── Public API ──

/** Cache key prefix scoped to the user token */
function userCacheKey(base: string, userToken?: string): string {
  const token = getTokenForClient(userToken);
  const scope = token ? token.slice(-8) : 'default';
  return `${base}:${scope}`;
}

export async function getOnDeck(userToken?: string): Promise<ContentItem[]> {
  const cacheKey = userCacheKey('plex:onDeck', userToken);
  const cached = getCached<ContentItem[]>(cacheKey);
  if (cached) return cached;

  const http = await getClient(userToken);
  const { data } = await http.get('/library/onDeck');
  const items = data.MediaContainer?.Metadata || [];
  const result = items.map((item: any) => plexToContentItem(item, 'watching', userToken));

  setCached(cacheKey, result);
  return result;
}

export async function getContinueWatching(userToken?: string): Promise<ContentItem[]> {
  const cacheKey = userCacheKey('plex:continueWatching', userToken);
  const cached = getCached<ContentItem[]>(cacheKey);
  if (cached) return cached;

  const http = await getClient(userToken);
  const { data } = await http.get('/hubs');
  const hubs = data.MediaContainer?.Hub || [];
  const continueHub = hubs.find(
    (h: any) => h.hubIdentifier === 'home.continue' || h.title === 'Continue Watching',
  );
  const items = continueHub?.Metadata || [];
  const result = items.map((item: any) => plexToContentItem(item, 'watching', userToken));

  setCached(cacheKey, result);
  return result;
}

/** Get recommendation hubs from Plex (e.g., "Similar to X", "Top Rated", genre-based) */
export async function getRecommendationHubs(userToken?: string): Promise<{ title: string; items: ContentItem[] }[]> {
  const cacheKey = userCacheKey('plex:recommendationHubs', userToken);
  const cached = getCached<{ title: string; items: ContentItem[] }[]>(cacheKey);
  if (cached) return cached;

  const http = await getClient(userToken);
  const { data } = await http.get('/hubs', {
    params: { count: 10 }, // Get more items per hub
  });
  const hubs = data.MediaContainer?.Hub || [];

  // Filter to recommendation-type hubs, skip system hubs we already use
  const skipIdentifiers = new Set([
    'home.continue', 'home.ondeck', 'hub.home.recentlyadded',
  ]);

  const result: { title: string; items: ContentItem[] }[] = [];
  for (const hub of hubs) {
    if (skipIdentifiers.has(hub.hubIdentifier)) continue;
    if (!hub.Metadata || hub.Metadata.length === 0) continue;
    // Only include movie/episode/show hubs
    const items = hub.Metadata
      .filter((m: any) => m.type === 'movie' || m.type === 'episode' || m.type === 'show')
      .map((m: any) => plexToContentItem(m, 'ready', userToken));
    if (items.length > 0) {
      result.push({ title: hub.title, items });
    }
  }

  setCached(cacheKey, result, 600); // Cache 10 minutes
  return result;
}

export async function getRecentlyAdded(limit: number = 50, userToken?: string): Promise<ContentItem[]> {
  const cacheKey = userCacheKey(`plex:recentlyAdded:${limit}`, userToken);
  const cached = getCached<ContentItem[]>(cacheKey);
  if (cached) return cached;

  const http = await getClient(userToken);

  // Fetch movies from global recently added
  const { data: globalData } = await http.get('/library/recentlyAdded', {
    params: { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': limit },
  });
  const globalItems = (globalData.MediaContainer?.Metadata || [])
    .filter((item: any) => item.type === 'movie');

  // Fetch recent episodes from TV library sections (global recentlyAdded only returns seasons, not episodes)
  let episodeItems: any[] = [];
  try {
    const { data: sectionsData } = await http.get('/library/sections');
    const tvSections = (sectionsData.MediaContainer?.Directory || []).filter((s: any) => s.type === 'show');
    for (const section of tvSections) {
      const { data: epData } = await http.get(`/library/sections/${section.key}/recentlyAdded`, {
        params: { 'X-Plex-Container-Size': limit, type: 4 }, // type=4 = episodes
      });
      episodeItems.push(...(epData.MediaContainer?.Metadata || []));
    }
  } catch {}

  const result = [...globalItems, ...episodeItems]
    .map((item: any) => plexToContentItem(item, 'ready', userToken))
    .filter((item: ContentItem) => !item.progress.watched);

  setCached(cacheKey, result);
  return result;
}

export async function markWatched(ratingKey: string, userToken?: string): Promise<void> {
  const http = await getClient(userToken);
  await http.get('/:/scrobble', {
    params: {
      key: ratingKey,
      identifier: 'com.plexapp.plugins.library',
    },
  });
  const onDeckKey = userCacheKey('plex:onDeck', userToken);
  const continueKey = userCacheKey('plex:continueWatching', userToken);
  const recentKey = userCacheKey('plex:recentlyAdded:50', userToken);
  getCached(onDeckKey) && setCached(onDeckKey, undefined, 1);
  getCached(continueKey) && setCached(continueKey, undefined, 1);
  getCached(recentKey) && setCached(recentKey, undefined, 1);
}

export async function markUnwatched(ratingKey: string, userToken?: string): Promise<void> {
  const http = await getClient(userToken);
  await http.get('/:/unscrobble', {
    params: {
      key: ratingKey,
      identifier: 'com.plexapp.plugins.library',
    },
  });
}

/**
 * Get all items from a Plex library section, sorted alphabetically.
 * @param type 'movie' or 'show'
 */
export async function getLibrary(type: 'movie' | 'show', userToken?: string): Promise<ContentItem[]> {
  const cacheKey = userCacheKey(`plex:library:${type}`, userToken);
  const cached = getCached<ContentItem[]>(cacheKey);
  if (cached) return cached;

  const http = await getClient(userToken);

  // First get library sections to find the right one
  const { data: sectionsData } = await http.get('/library/sections');
  const sections = sectionsData.MediaContainer?.Directory || [];

  // Find sections by type: 'movie' or 'show'
  const matchingSections = sections.filter((s: any) => s.type === type);

  const allItems: ContentItem[] = [];
  const PAGE_SIZE = 500;

  for (const section of matchingSections) {
    let start = 0;
    while (true) {
      const { data } = await http.get(`/library/sections/${section.key}/all`, {
        params: { 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': PAGE_SIZE },
      });
      const items = data.MediaContainer?.Metadata || [];
      for (const item of items) {
        allItems.push(plexToContentItem(item, 'ready', userToken));
      }
      if (items.length < PAGE_SIZE) break;
      start += PAGE_SIZE;
    }
  }

  // Sort alphabetically
  allItems.sort((a, b) => {
    const titleA = (a.showTitle || a.title).toLowerCase();
    const titleB = (b.showTitle || b.title).toLowerCase();
    return titleA.localeCompare(titleB);
  });

  setCached(cacheKey, allItems, 600); // Cache for 10 minutes
  return allItems;
}

export interface PlexSeason {
  ratingKey: string;
  index: number;
  title: string;
  episodeCount: number;
  thumb: string;
}

export async function getShowSeasons(showRatingKey: string, userToken?: string): Promise<PlexSeason[]> {
  const http = await getClient(userToken);
  const { data } = await http.get(`/library/metadata/${showRatingKey}/children`);
  const items = data.MediaContainer?.Metadata || [];
  return items
    .filter((s: any) => s.index != null && s.index > 0) // Skip specials (index=0)
    .map((s: any) => ({
      ratingKey: String(s.ratingKey),
      index: s.index,
      title: s.title || `Season ${s.index}`,
      episodeCount: s.leafCount || 0,
      thumb: artworkUrl(s.thumb, userToken),
    }));
}

export async function getSeasonEpisodes(seasonRatingKey: string, userToken?: string): Promise<ContentItem[]> {
  const http = await getClient(userToken);
  const { data } = await http.get(`/library/metadata/${seasonRatingKey}/children`);
  const items = data.MediaContainer?.Metadata || [];
  return items.map((item: any) => plexToContentItem(item, 'ready', userToken));
}

export async function search(query: string, userToken?: string): Promise<ContentItem[]> {
  const http = await getClient(userToken);
  const { data } = await http.get('/search', { params: { query } });
  const items = data.MediaContainer?.Metadata || [];
  return items
    .filter((item: any) => item.type === 'movie' || item.type === 'episode' || item.type === 'show')
    .map((item: any) => plexToContentItem(item, 'ready', userToken));
}

export async function testConnection(): Promise<boolean> {
  try {
    const http = await getClient();
    await http.get('/identity');
    return true;
  } catch {
    return false;
  }
}

export function resetClient(): void {
  client = null;
  // Don't clear resolvedServerUrl — it's the same server for all users
  // and artwork URLs depend on it being set
  userClients.clear();
}

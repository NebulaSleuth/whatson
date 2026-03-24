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

async function getClient(): Promise<AxiosInstance> {
  if (!client) {
    const baseURL = await ensureDiscovered();

    client = axios.create({
      baseURL,
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': config.plex.token,
        'X-Plex-Client-Identifier': PLEX_CLIENT_IDENTIFIER,
        'X-Plex-Product': PLEX_PRODUCT,
        'X-Plex-Version': APP_VERSION,
      },
      timeout: 30000,
    });
  }
  return client;
}

function artworkUrl(path: string | undefined): string {
  if (!path) return '';
  if (!resolvedServerUrl) return '';
  return `${resolvedServerUrl}${path}?X-Plex-Token=${config.plex.token}`;
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

function plexToContentItem(item: any, status: ContentItem['status']): ContentItem {
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
      poster: artworkUrl(isEpisode ? item.grandparentThumb : item.thumb),
      thumbnail: artworkUrl(item.thumb),
      background: artworkUrl(item.art),
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
    year: item.year || 0,
    rating: item.rating,
    genres: item.Genre?.map((g: any) => g.tag) || [],
  };
}

// ── Public API ──

export async function getOnDeck(): Promise<ContentItem[]> {
  const cacheKey = 'plex:onDeck';
  const cached = getCached<ContentItem[]>(cacheKey);
  if (cached) return cached;

  const http = await getClient();
  const { data } = await http.get('/library/onDeck');
  const items = data.MediaContainer?.Metadata || [];
  const result = items.map((item: any) => plexToContentItem(item, 'watching'));

  setCached(cacheKey, result);
  return result;
}

export async function getContinueWatching(): Promise<ContentItem[]> {
  const cacheKey = 'plex:continueWatching';
  const cached = getCached<ContentItem[]>(cacheKey);
  if (cached) return cached;

  const http = await getClient();
  const { data } = await http.get('/hubs');
  const hubs = data.MediaContainer?.Hub || [];
  const continueHub = hubs.find(
    (h: any) => h.hubIdentifier === 'home.continue' || h.title === 'Continue Watching',
  );
  const items = continueHub?.Metadata || [];
  const result = items.map((item: any) => plexToContentItem(item, 'watching'));

  setCached(cacheKey, result);
  return result;
}

export async function getRecentlyAdded(limit: number = 50): Promise<ContentItem[]> {
  const cacheKey = `plex:recentlyAdded:${limit}`;
  const cached = getCached<ContentItem[]>(cacheKey);
  if (cached) return cached;

  const http = await getClient();
  const { data } = await http.get('/library/recentlyAdded', {
    params: { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': limit },
  });
  const items = data.MediaContainer?.Metadata || [];
  const result = items
    .map((item: any) => plexToContentItem(item, 'ready'))
    .filter((item: ContentItem) => !item.progress.watched);

  setCached(cacheKey, result);
  return result;
}

export async function markWatched(ratingKey: string): Promise<void> {
  const http = await getClient();
  await http.get('/:/scrobble', {
    params: {
      key: ratingKey,
      identifier: 'com.plexapp.plugins.library',
    },
  });
  // Invalidate relevant caches
  getCached('plex:onDeck') && setCached('plex:onDeck', undefined, 1);
  getCached('plex:continueWatching') && setCached('plex:continueWatching', undefined, 1);
  getCached('plex:recentlyAdded:50') && setCached('plex:recentlyAdded:50', undefined, 1);
}

export async function markUnwatched(ratingKey: string): Promise<void> {
  const http = await getClient();
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
export async function getLibrary(type: 'movie' | 'show'): Promise<ContentItem[]> {
  const cacheKey = `plex:library:${type}`;
  const cached = getCached<ContentItem[]>(cacheKey);
  if (cached) return cached;

  const http = await getClient();

  // First get library sections to find the right one
  const { data: sectionsData } = await http.get('/library/sections');
  const sections = sectionsData.MediaContainer?.Directory || [];

  // Find sections by type: 'movie' or 'show'
  const matchingSections = sections.filter((s: any) => s.type === type);

  const allItems: ContentItem[] = [];

  for (const section of matchingSections) {
    const { data } = await http.get(`/library/sections/${section.key}/all`, {
      params: { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 500 },
    });
    const items = data.MediaContainer?.Metadata || [];
    for (const item of items) {
      allItems.push(plexToContentItem(item, 'ready'));
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

export async function search(query: string): Promise<ContentItem[]> {
  const http = await getClient();
  const { data } = await http.get('/search', { params: { query } });
  const items = data.MediaContainer?.Metadata || [];
  return items
    .filter((item: any) => item.type === 'movie' || item.type === 'episode' || item.type === 'show')
    .map((item: any) => plexToContentItem(item, 'ready'));
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
  resolvedServerUrl = null;
}

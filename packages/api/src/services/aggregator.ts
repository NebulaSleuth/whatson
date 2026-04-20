import type { ContentItem, ContentSection, HomeResponse, TrackedItem } from '@whatson/shared';
import { STREAMING_PROVIDERS } from '@whatson/shared';
import * as plex from './plex.js';
import * as sonarr from './sonarr.js';
import * as radarr from './radarr.js';
import * as tracked from './tracked.js';
import * as tvmaze from './tvmaze.js';
import { config } from '../config.js';
import { proxyArtwork } from '../utils.js';
import { getConfiguredAdapters } from './adapters/registry.js';

// ── Watch State Merging ──

function buildPlexWatchIndex(plexItems: ContentItem[]): Map<string, ContentItem> {
  const index = new Map<string, ContentItem>();
  for (const item of plexItems) {
    if (item.type === 'episode' && item.showTitle && item.seasonNumber != null && item.episodeNumber != null) {
      const key = `${item.showTitle}-S${item.seasonNumber}E${item.episodeNumber}`.toLowerCase();
      index.set(key, item);
    }
    if (item.type === 'movie') {
      const key = `${item.title}-${item.year}`.toLowerCase();
      index.set(key, item);
    }
  }
  return index;
}

function mergeWithPlexState(item: ContentItem, plexIndex: Map<string, ContentItem>): ContentItem {
  let key: string;
  if (item.type === 'episode' && item.showTitle && item.seasonNumber != null && item.episodeNumber != null) {
    key = `${item.showTitle}-S${item.seasonNumber}E${item.episodeNumber}`.toLowerCase();
  } else if (item.type === 'movie') {
    key = `${item.title}-${item.year}`.toLowerCase();
  } else {
    return item;
  }

  const plexItem = plexIndex.get(key);
  if (!plexItem) return item;

  return {
    ...item,
    progress: plexItem.progress,
    status: plexItem.progress.percentage > 0 && !plexItem.progress.watched
      ? 'watching'
      : plexItem.progress.watched
        ? 'ready'
        : item.status,
    artwork: plexItem.artwork.poster ? plexItem.artwork : item.artwork,
    playbackUrl: plexItem.playbackUrl || item.playbackUrl,
    source: 'plex',
    sourceId: plexItem.sourceId,
  };
}

// ── Tracked Items → ContentItems ──

function trackedMovieToContentItem(item: TrackedItem): ContentItem {
  const providerLabel = STREAMING_PROVIDERS[item.provider] || item.provider;
  return {
    id: item.id,
    type: 'movie',
    title: item.title,
    summary: item.overview,
    duration: 0,
    artwork: {
      poster: item.poster,
      thumbnail: item.backdrop || item.poster,
      background: item.backdrop || item.poster,
    },
    source: (item.provider === 'plex' || item.provider === 'sonarr' || item.provider === 'radarr')
      ? item.provider as ContentItem['source']
      : 'live',
    sourceId: String(item.tmdbId),
    status: 'ready',
    progress: { watched: false, percentage: 0, currentPosition: 0 },
    availability: { availableAt: item.addedAt, network: providerLabel },
    addedAt: item.addedAt,
    year: item.year,
    rating: item.rating,
    genres: [],
  };
}

/**
 * Convert a tracked TV show into episode-level ContentItems
 * using TVmaze to find the most recent and upcoming episodes.
 */
async function trackedTvToEpisodeItems(
  item: TrackedItem,
): Promise<{ ready: ContentItem[]; comingSoon: ContentItem[] }> {
  const providerLabel = STREAMING_PROVIDERS[item.provider] || item.provider;
  const ready: ContentItem[] = [];
  const comingSoon: ContentItem[] = [];

  const baseItem = {
    showTitle: item.title,
    artwork: {
      poster: item.poster,
      thumbnail: item.backdrop || item.poster,
      background: item.backdrop || item.poster,
    },
    source: 'live' as const,
    sourceId: String(item.tmdbId),
    year: item.year,
    rating: item.rating,
    genres: [] as string[],
  };

  // Check watched state
  const isShowWatched = tracked.isWatched(String(item.tmdbId));
  if (isShowWatched) return { ready, comingSoon }; // Entire show marked watched

  // Get most recent episode
  const recent = await tvmaze.getMostRecentEpisode(item.title);
  if (recent) {
    const ep = recent.episode;
    const epKey = `tracked-ep-${item.tmdbId}-S${ep.season}E${ep.number}`;
    const airDate = ep.airstamp || ep.airdate;

    // Auto-expire: skip episodes older than 7 days past air date
    const daysSinceAired = airDate
      ? (Date.now() - new Date(airDate).getTime()) / (1000 * 60 * 60 * 24)
      : 0;

    if (!tracked.isWatched(epKey) && daysSinceAired <= 7) {
      const summary = ep.summary
        ? ep.summary.replace(/<[^>]+>/g, '').trim()
        : item.overview;
      const hasAired = daysSinceAired >= 0;
      const target = hasAired ? ready : comingSoon;
      target.push({
        ...baseItem,
        id: epKey,
        type: 'episode',
        title: ep.name || 'New Episode',
        seasonNumber: ep.season,
        episodeNumber: ep.number,
        summary,
        duration: ep.runtime || 0,
        status: hasAired ? 'ready' : 'coming_soon',
        progress: { watched: false, percentage: 0, currentPosition: 0 },
        availability: {
          availableAt: airDate,
          network: providerLabel,
        },
        addedAt: airDate,
      });
    }
  }

  // Get upcoming episodes
  const upcoming = await tvmaze.getUpcomingEpisodes(item.title);
  if (upcoming) {
    for (const ep of upcoming.episodes) {
      const summary = ep.summary
        ? ep.summary.replace(/<[^>]+>/g, '').trim()
        : item.overview;
      comingSoon.push({
        ...baseItem,
        id: `tracked-ep-${item.tmdbId}-S${ep.season}E${ep.number}`,
        type: 'episode',
        title: ep.name || 'TBA',
        seasonNumber: ep.season,
        episodeNumber: ep.number,
        summary,
        duration: ep.runtime || 0,
        status: 'coming_soon',
        progress: { watched: false, percentage: 0, currentPosition: 0 },
        availability: {
          availableAt: ep.airstamp || ep.airdate,
          network: providerLabel,
        },
        addedAt: ep.airstamp || ep.airdate,
      });
    }
  }

  // If no episodes found at all, don't show the show
  return { ready, comingSoon };
}

// ── Helpers ──

function sortInProgressFirst(items: ContentItem[]): ContentItem[] {
  return [...items].sort((a, b) => {
    const aInProgress = a.progress.percentage > 0 && !a.progress.watched;
    const bInProgress = b.progress.percentage > 0 && !b.progress.watched;
    if (aInProgress && !bInProgress) return -1;
    if (!aInProgress && bInProgress) return 1;
    return 0;
  });
}

function filterWatched(items: ContentItem[]): ContentItem[] {
  return items.filter((item) => !item.progress.watched);
}

function sortByDate(items: ContentItem[]): ContentItem[] {
  return items.sort((a, b) => {
    const dateA = a.availability.availableAt ? new Date(a.availability.availableAt).getTime() : 0;
    const dateB = b.availability.availableAt ? new Date(b.availability.availableAt).getTime() : 0;
    return dateA - dateB; // Soonest first
  });
}

/** Keep only the earliest unwatched episode per show */
function oneEpisodePerShow(items: ContentItem[]): ContentItem[] {
  const seen = new Set<string>();
  // Sort by season+episode so earliest comes first
  const sorted = [...items].sort((a, b) => {
    if (a.showTitle && b.showTitle && a.showTitle === b.showTitle) {
      const seA = (a.seasonNumber || 0) * 1000 + (a.episodeNumber || 0);
      const seB = (b.seasonNumber || 0) * 1000 + (b.episodeNumber || 0);
      return seA - seB;
    }
    return 0;
  });
  return sorted.filter((item) => {
    if (item.type !== 'episode' || !item.showTitle) return true; // keep movies as-is
    const key = item.showTitle.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateById(items: ContentItem[]): ContentItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.type === 'episode' && item.showTitle
      ? `${item.showTitle}-S${item.seasonNumber}E${item.episodeNumber}`.toLowerCase()
      : `${item.title}-${item.year}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function safeCall<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    console.warn(`[Aggregator] Service call failed:`, (error as Error).message);
    return fallback;
  }
}

function isPlexConfigured(): boolean {
  return Boolean(config.plex.token);
}

// ── Main Aggregation ──

export async function getHomeData(userToken?: string): Promise<HomeResponse> {
  // Pull library-server shelves from every configured adapter (Plex today; Jellyfin/Emby later).
  // Each adapter call is isolated via safeCall so one bad server doesn't kill the home payload.
  const mediaAdapters = getConfiguredAdapters();
  const perAdapter = await Promise.all(
    mediaAdapters.map(async (a) => ({
      continueWatching: await safeCall(() => a.getContinueWatching(userToken), []),
      onDeck: await safeCall(() => a.getOnDeck(userToken), []),
      recent: await safeCall(() => a.getRecentlyAdded(50, userToken), []),
    })),
  );
  const continueWatching = perAdapter.flatMap((x) => x.continueWatching);
  const onDeck = perAdapter.flatMap((x) => x.onDeck);
  const recentPlex = perAdapter.flatMap((x) => x.recent);

  const [sonarrUpcoming, sonarrRecent, sonarrQueue, radarrRecent, radarrUpcoming, radarrQueue] =
    await Promise.all([
      config.sonarr.url ? safeCall(() => sonarr.getUpcoming(), []) : [],
      config.sonarr.url ? safeCall(() => sonarr.getRecentDownloads(), []) : [],
      config.sonarr.url ? safeCall(() => sonarr.getQueue(), []) : [],
      config.radarr.url ? safeCall(() => radarr.getRecentDownloads(), []) : [],
      config.radarr.url ? safeCall(() => radarr.getUpcoming(), []) : [],
      config.radarr.url ? safeCall(() => radarr.getQueue(), []) : [],
    ]);

  // Get tracked items from watchlist
  const trackedItems = tracked.getAll();
  const trackedTvShows = trackedItems.filter((t) => t.type === 'tv');
  const trackedMovies = trackedItems.filter((t) => t.type === 'movie').map(trackedMovieToContentItem);

  // Resolve tracked TV shows to episode-level items via TVmaze (in parallel)
  const trackedTvResults = await Promise.all(
    trackedTvShows.map((t) => safeCall(() => trackedTvToEpisodeItems(t), { ready: [], comingSoon: [] })),
  );
  const trackedTvReady = trackedTvResults.flatMap((r) => r.ready);
  const trackedTvComingSoon = trackedTvResults.flatMap((r) => r.comingSoon);

  console.log(`[Aggregator] Tracked TV: ${trackedTvReady.length} ready, ${trackedTvComingSoon.length} coming soon`);

  // Build Plex watch state index from all Plex data
  const allPlexItems = [...continueWatching, ...onDeck, ...recentPlex];
  const plexIndex = buildPlexWatchIndex(allPlexItems);

  // Enrich Sonarr/Radarr items with Plex watch state
  const enrichedSonarrRecent = sonarrRecent.map((i) => mergeWithPlexState(i, plexIndex));
  const enrichedRadarrRecent = radarrRecent.map((i) => mergeWithPlexState(i, plexIndex));
  const enrichedSonarrUpcoming = sonarrUpcoming.map((i) => mergeWithPlexState(i, plexIndex));
  const enrichedRadarrUpcoming = radarrUpcoming.map((i) => mergeWithPlexState(i, plexIndex));

  // Merge continue watching + on deck, deduplicate
  const watchingMap = new Map<string, ContentItem>();
  for (const item of [...continueWatching, ...onDeck]) {
    if (!watchingMap.has(item.id)) {
      watchingMap.set(item.id, item);
    }
  }
  const allWatching = sortInProgressFirst([...watchingMap.values()]);

  // Build a set of IDs already in Continue Watching so we don't duplicate them in Ready to Watch
  const watchingIds = new Set(allWatching.map((i) => i.id));

  // TV: ready to watch = Plex episodes (not in Continue Watching) + tracked TV recent episodes
  // Only show the earliest unwatched episode per show
  const tvReady = oneEpisodePerShow(deduplicateById(
    filterWatched(
      sortInProgressFirst([
        ...recentPlex.filter((i) => i.type === 'episode' && !watchingIds.has(i.id)),
        ...trackedTvReady,
      ]),
    ),
  ));

  // TV: coming soon = Sonarr calendar + downloading queue + tracked TV upcoming episodes.
  // Filter out items that mergeWithPlexState upgraded to 'ready'/'watching' — those are in the library now.
  // Only show one card per show, sorted by availability date (soonest first).
  const tvComingSoon = sortByDate(oneEpisodePerShow(filterWatched(deduplicateById([
    ...sonarrQueue,
    ...enrichedSonarrUpcoming,
    ...trackedTvComingSoon,
  ].filter((i) => i.status === 'coming_soon' || i.status === 'downloading')))));

  // Movies: ready to watch = Plex movies (not in Continue Watching) + Radarr downloads + tracked movies
  const moviesReady = deduplicateById(
    filterWatched(
      sortInProgressFirst([
        ...recentPlex.filter((i) => i.type === 'movie' && !watchingIds.has(i.id)),
        ...enrichedRadarrRecent,
        ...trackedMovies,
      ]),
    ),
  );

  // Movies: coming soon = Radarr calendar + downloading queue. Drop any item mergeWithPlexState upgraded.
  const moviesComingSoon = sortByDate(filterWatched(deduplicateById(
    [...radarrQueue, ...enrichedRadarrUpcoming].filter((i) => i.status === 'coming_soon' || i.status === 'downloading'),
  )));

  const sections: ContentSection[] = [];
  let order = 0;

  const px = (items: ContentItem[]) => items.map(proxyArtwork);

  if (allWatching.length > 0) {
    sections.push({
      id: 'continue-watching',
      title: 'Continue Watching',
      type: 'mixed',
      items: px(allWatching),
      sortOrder: order++,
    });
  }

  if (tvReady.length > 0) {
    sections.push({
      id: 'tv-ready',
      title: 'Ready to Watch - TV Shows',
      type: 'tv',
      items: px(tvReady),
      sortOrder: order++,
    });
  }

  if (moviesReady.length > 0) {
    sections.push({
      id: 'movies-ready',
      title: 'Ready to Watch - Movies',
      type: 'movie',
      items: px(moviesReady),
      sortOrder: order++,
    });
  }

  if (tvComingSoon.length > 0) {
    sections.push({
      id: 'tv-coming-soon',
      title: 'Coming Soon - TV Shows',
      type: 'tv',
      items: px(tvComingSoon),
      sortOrder: order++,
    });
  }

  if (moviesComingSoon.length > 0) {
    sections.push({
      id: 'movies-coming-soon',
      title: 'Coming Soon - Movies',
      type: 'movie',
      items: px(moviesComingSoon),
      sortOrder: order++,
    });
  }

  return {
    sections,
    lastUpdated: new Date().toISOString(),
  };
}

export async function searchAll(
  query: string,
  type?: 'tv' | 'movie',
): Promise<ContentItem[]> {
  const plexResults = isPlexConfigured()
    ? await safeCall(() => plex.search(query), [])
    : [];
  const plexIndex = buildPlexWatchIndex(plexResults);

  const searches = await Promise.all([
    config.sonarr.url && type !== 'movie'
      ? safeCall(() => sonarr.searchSeries(query), [])
      : [],
    config.radarr.url && type !== 'tv'
      ? safeCall(() => radarr.searchMovies(query), [])
      : [],
  ]);

  const enriched: ContentItem[] = [];
  for (const items of searches) {
    for (const item of items) {
      enriched.push(mergeWithPlexState(item, plexIndex));
    }
  }

  const allResults = [...plexResults, ...enriched];

  let filtered = allResults;
  if (type === 'tv') {
    filtered = allResults.filter((i) => i.type === 'episode' || i.type === 'show');
  } else if (type === 'movie') {
    filtered = allResults.filter((i) => i.type === 'movie');
  }

  const seen = new Map<string, ContentItem>();
  for (const item of filtered) {
    const key = item.type === 'episode' && item.showTitle
      ? `${item.showTitle}-S${item.seasonNumber}E${item.episodeNumber}`.toLowerCase()
      : `${item.title}-${item.year}`.toLowerCase();
    if (!seen.has(key) || item.source === 'plex') {
      seen.set(key, item);
    }
  }

  return [...seen.values()].map(proxyArtwork);
}

import type { ContentItem, ContentSection } from '@whatson/shared';
import { config } from '../../config.js';
import * as plex from '../plex.js';
import * as users from '../users.js';
import type {
  MediaServerAdapter,
  PlaybackInfo,
  PlaybackOpts,
  Season,
  ServerUser,
} from './types.js';

/**
 * Plex adapter — thin wrapper over the existing plex.ts / users.ts modules.
 * Preserves all current Plex behavior; the adapter only exists so callers can
 * be server-agnostic. Plex-specific concerns (plex.tv discovery, Home users,
 * PIN flow) are still owned by plex.ts and users.ts directly.
 */
export const plexAdapter: MediaServerAdapter = {
  kind: 'plex',
  label: 'Plex',

  isConfigured(): boolean {
    return Boolean(config.plex.token);
  },

  async ensureReady(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const url = await plex.getServerUrl();
    return Boolean(url);
  },

  testConnection(): Promise<boolean> {
    return plex.testConnection();
  },

  resetClient(): void {
    plex.resetClient();
  },

  async listUsers(): Promise<ServerUser[]> {
    const list = await users.listUsers();
    return list.map((u) => ({
      id: String(u.id),
      title: u.title,
      thumb: u.thumb,
      admin: u.admin,
      hasPassword: u.hasPassword,
      restricted: u.restricted,
    }));
  },

  async resolveUserToken(userId?: string, pin?: string): Promise<string | null> {
    if (!userId) return config.plex.token || null;
    const id = parseInt(userId, 10);
    if (Number.isNaN(id)) return null;
    try {
      return await users.selectUser(id, pin);
    } catch {
      return null;
    }
  },

  getContinueWatching(userToken?: string): Promise<ContentItem[]> {
    return plex.getContinueWatching(userToken);
  },

  getOnDeck(userToken?: string): Promise<ContentItem[]> {
    return plex.getOnDeck(userToken);
  },

  getRecentlyAdded(limit: number, userToken?: string): Promise<ContentItem[]> {
    return plex.getRecentlyAdded(limit, userToken);
  },

  getLibrary(type: 'movie' | 'show', userToken?: string): Promise<ContentItem[]> {
    return plex.getLibrary(type, userToken);
  },

  async getShowSeasons(showId: string, userToken?: string): Promise<Season[]> {
    const seasons = await plex.getShowSeasons(showId, userToken);
    return seasons.map((s) => ({
      ratingKey: s.ratingKey,
      index: s.index,
      title: s.title,
      episodeCount: s.episodeCount,
      watchedCount: s.watchedCount,
      thumb: s.thumb,
    }));
  },

  getSeasonEpisodes(seasonId: string, userToken?: string): Promise<ContentItem[]> {
    return plex.getSeasonEpisodes(seasonId, userToken);
  },

  search(query: string, userToken?: string): Promise<ContentItem[]> {
    return plex.search(query, userToken);
  },

  async getRecommendationHubs(userToken?: string): Promise<ContentSection[]> {
    const hubs = await plex.getRecommendationHubs(userToken);
    return hubs.map((h, idx) => ({
      id: `plex-hub-${idx}`,
      title: h.title,
      type: 'mixed' as const,
      items: h.items,
      sortOrder: idx,
    }));
  },

  getPlaybackInfo(id: string, opts: PlaybackOpts): Promise<PlaybackInfo> {
    return plex.getPlaybackInfo(id, opts);
  },

  reportProgress(id: string, timeMs: number, durationMs: number, state: string, sessionId: string, userToken?: string): Promise<void> {
    return plex.reportProgress(id, timeMs, durationMs, state, sessionId, userToken);
  },

  stopPlayback(sessionId: string, userToken?: string): Promise<void> {
    return plex.stopPlayback(sessionId, userToken);
  },

  markWatched(id: string, userToken?: string): Promise<void> {
    return plex.markWatched(id, userToken);
  },

  markUnwatched(id: string, userToken?: string): Promise<void> {
    return plex.markUnwatched(id, userToken);
  },

  resolveArtwork(raw: string): string {
    // Plex artwork URLs are already absolute with token embedded; just return them.
    return raw;
  },
};

import type { ContentItem } from '@whatson/shared';
import { config } from '../../config.js';
import * as emby from '../emby.js';
import type {
  MediaServerAdapter,
  PlaybackInfo,
  PlaybackOpts,
  Season,
  ServerUser,
} from './types.js';

/**
 * Emby adapter — uses the same Jellyfin/Emby-compatible API as jellyfinAdapter,
 * but scoped to config.emby credentials. Shares 100% of its code path through
 * embyLike.ts; only the config selector and source tag differ.
 */
export const embyAdapter: MediaServerAdapter = {
  kind: 'emby',
  label: 'Emby',

  isConfigured(): boolean {
    return Boolean(config.emby.url && config.emby.username);
  },

  async ensureReady(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const s = await emby.ensureSession();
    return !!s;
  },

  testConnection(): Promise<boolean> {
    return emby.testConnection();
  },

  resetClient(): void {
    emby.resetClient();
  },

  async listUsers(): Promise<ServerUser[]> {
    return emby.listUsers();
  },

  async resolveUserToken(): Promise<string | null> {
    const s = await emby.ensureSession();
    return s?.accessToken || null;
  },

  getContinueWatching(): Promise<ContentItem[]> {
    return emby.getContinueWatching();
  },

  getOnDeck(): Promise<ContentItem[]> {
    return emby.getOnDeck();
  },

  getRecentlyAdded(limit: number): Promise<ContentItem[]> {
    return emby.getRecentlyAdded(limit);
  },

  getLibrary(type: 'movie' | 'show'): Promise<ContentItem[]> {
    return emby.getLibrary(type);
  },

  getShowSeasons(showId: string): Promise<Season[]> {
    return emby.getShowSeasons(showId);
  },

  getSeasonEpisodes(seasonId: string): Promise<ContentItem[]> {
    return emby.getSeasonEpisodes(seasonId);
  },

  search(query: string): Promise<ContentItem[]> {
    return emby.search(query);
  },

  getPlaybackInfo(id: string, opts: PlaybackOpts): Promise<PlaybackInfo> {
    return emby.getPlaybackInfo(id, opts);
  },

  reportProgress(id: string, timeMs: number, durationMs: number, state: string, sessionId: string): Promise<void> {
    return emby.reportProgress(id, timeMs, durationMs, state, sessionId);
  },

  stopPlayback(sessionId: string): Promise<void> {
    return emby.stopPlayback(sessionId);
  },

  markWatched(id: string): Promise<void> {
    return emby.markWatched(id);
  },

  markUnwatched(id: string): Promise<void> {
    return emby.markUnwatched(id);
  },

  resolveArtwork(raw: string): string {
    return raw;
  },
};

import type { ContentItem } from '@whatson/shared';
import { config } from '../../config.js';
import * as jellyfin from '../jellyfin.js';
import type {
  MediaServerAdapter,
  PlaybackInfo,
  PlaybackOpts,
  Season,
  ServerUser,
} from './types.js';

/**
 * Jellyfin adapter. Unlike Plex, Jellyfin has no Home-user model — the
 * adapter always acts on behalf of the single configured account. Auth
 * happens on first use and tokens are held in memory; 401s trigger a
 * transparent re-auth from jellyfin.ts.
 */
export const jellyfinAdapter: MediaServerAdapter = {
  kind: 'jellyfin',
  label: 'Jellyfin',

  isConfigured(): boolean {
    return Boolean(config.jellyfin.url && config.jellyfin.username);
  },

  async ensureReady(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    const s = await jellyfin.ensureSession();
    return !!s;
  },

  testConnection(): Promise<boolean> {
    return jellyfin.testConnection();
  },

  resetClient(): void {
    jellyfin.resetClient();
  },

  async listUsers(): Promise<ServerUser[]> {
    return jellyfin.listUsers();
  },

  async resolveUserToken(): Promise<string | null> {
    const s = await jellyfin.ensureSession();
    return s?.accessToken || null;
  },

  getContinueWatching(): Promise<ContentItem[]> {
    return jellyfin.getContinueWatching();
  },

  getOnDeck(): Promise<ContentItem[]> {
    return jellyfin.getOnDeck();
  },

  getRecentlyAdded(limit: number): Promise<ContentItem[]> {
    return jellyfin.getRecentlyAdded(limit);
  },

  getLibrary(type: 'movie' | 'show'): Promise<ContentItem[]> {
    return jellyfin.getLibrary(type);
  },

  getShowSeasons(showId: string): Promise<Season[]> {
    return jellyfin.getShowSeasons(showId);
  },

  getSeasonEpisodes(seasonId: string): Promise<ContentItem[]> {
    return jellyfin.getSeasonEpisodes(seasonId);
  },

  search(query: string): Promise<ContentItem[]> {
    return jellyfin.search(query);
  },

  getPlaybackInfo(id: string, opts: PlaybackOpts): Promise<PlaybackInfo> {
    return jellyfin.getPlaybackInfo(id, opts);
  },

  reportProgress(id: string, timeMs: number, _durationMs: number, state: string, sessionId: string): Promise<void> {
    return jellyfin.reportProgress(id, timeMs, _durationMs, state, sessionId);
  },

  stopPlayback(sessionId: string): Promise<void> {
    return jellyfin.stopPlayback(sessionId);
  },

  markWatched(id: string): Promise<void> {
    return jellyfin.markWatched(id);
  },

  markUnwatched(id: string): Promise<void> {
    return jellyfin.markUnwatched(id);
  },

  resolveArtwork(raw: string): string {
    return raw;
  },
};

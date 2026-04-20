import type { ContentItem, ContentSection, ContentSource } from '@whatson/shared';

export type MediaServerKind = Extract<ContentSource, 'plex' | 'jellyfin' | 'emby'>;

/** A user account on a media server (Plex Home user, Jellyfin/Emby account, etc.). */
export interface ServerUser {
  id: string;
  title: string;
  thumb: string;
  admin: boolean;
  hasPassword: boolean;
  restricted: boolean;
}

export interface Season {
  ratingKey: string;
  index: number;
  title: string;
  episodeCount: number;
  watchedCount: number;
  thumb: string;
}

export interface SubtitleTrack {
  id: number;
  index: number;
  language: string;
  title: string;
  selected: boolean;
}

export interface AudioTrack {
  id: number;
  index: number;
  language: string;
  title: string;
  selected: boolean;
}

export interface PlaybackMarker {
  type: 'intro' | 'credits';
  startMs: number;
  endMs: number;
}

export interface PlaybackOpts {
  offsetMs?: number;
  maxBitrate?: number;       // kbps
  resolution?: string;       // e.g., "1920x1080"
  subtitleStreamID?: number;
  audioStreamID?: number;
  userToken?: string;
  /** Plex-specific: force a full transcode even when direct-stream would work. */
  forceTranscode?: boolean;
  /** Plex-specific: tells the adapter whether the client is on LAN or remote. */
  connectionType?: 'local' | 'remote';
}

export interface PlaybackInfo {
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
  subtitles: SubtitleTrack[];
  audioTracks: AudioTrack[];
  markers: PlaybackMarker[];
  serverUrl: string;
}

/**
 * Uniform interface over Plex / Jellyfin / Emby.
 *
 * Adapter implementations MUST tolerate being called when unconfigured — `isConfigured()`
 * lets the aggregator skip them without catching exceptions. `ensureReady()` is the
 * one place authentication can fail loudly during startup.
 */
export interface MediaServerAdapter {
  readonly kind: MediaServerKind;
  readonly label: string;

  // ── Lifecycle ──
  isConfigured(): boolean;
  ensureReady(): Promise<boolean>;
  testConnection(): Promise<boolean>;
  resetClient(): void;

  // ── Users (multi-user servers). Single-user adapters return a 1-element list. ──
  listUsers(): Promise<ServerUser[]>;
  /**
   * Resolve a user token for the given user id. For single-user adapters (Jellyfin/Emby
   * as currently scoped) this returns the shared server token regardless of userId.
   */
  resolveUserToken(userId?: string, pin?: string): Promise<string | null>;

  // ── Content ──
  getContinueWatching(userToken?: string): Promise<ContentItem[]>;
  getOnDeck(userToken?: string): Promise<ContentItem[]>;
  getRecentlyAdded(limit: number, userToken?: string): Promise<ContentItem[]>;
  getLibrary(type: 'movie' | 'show', userToken?: string): Promise<ContentItem[]>;
  getShowSeasons(showId: string, userToken?: string): Promise<Season[]>;
  getSeasonEpisodes(seasonId: string, userToken?: string): Promise<ContentItem[]>;
  search(query: string, userToken?: string): Promise<ContentItem[]>;

  /** Optional — only servers with curated hubs (Plex) implement this. */
  getRecommendationHubs?(userToken?: string): Promise<ContentSection[]>;

  // ── Playback ──
  getPlaybackInfo(id: string, opts: PlaybackOpts): Promise<PlaybackInfo>;
  reportProgress(id: string, timeMs: number, durationMs: number, state: string, sessionId: string, userToken?: string): Promise<void>;
  stopPlayback(sessionId: string, userToken?: string): Promise<void>;

  // ── Watched state ──
  markWatched(id: string, userToken?: string): Promise<void>;
  markUnwatched(id: string, userToken?: string): Promise<void>;

  // ── Artwork ──
  /** Resolve a raw artwork path/url from this server to a fully-qualified URL the proxy can fetch. */
  resolveArtwork(raw: string, userToken?: string): string;
}

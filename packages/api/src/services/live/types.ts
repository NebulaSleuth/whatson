import type { LiveChannel, LiveStreamInfo, LiveProgram } from '@whatson/shared';

/**
 * Common contract every live-TV source implements. Direct tuners
 * (HDHomeRun, M3U) and media-server Live TV adapters (Plex DVR /
 * Jellyfin Live TV / Emby Live TV) all expose the same surface so the
 * channel grid + player can union across sources without caring
 * where any given channel lives.
 *
 * Each implementation lives in its own file under `services/live/`
 * and registers itself in `registry.ts`.
 */
export interface LiveSource {
  /** Source tag. Becomes the prefix in channel IDs (`hdhr-5.1`). */
  kind: LiveChannel['source'];

  /** True when the user has configured this source. */
  isConfigured(): boolean;

  /**
   * Cheap connectivity probe — returns true if the source is reachable
   * with the current config. Used by /setup → Tuners "Test" button.
   */
  testConnection(): Promise<boolean>;

  /**
   * List every available channel. Returns [] (not an error) when the
   * source isn't configured so the aggregator can degrade gracefully.
   */
  getChannels(userToken?: string): Promise<LiveChannel[]>;

  /**
   * Get the playable URL for a single channel. `channelId` is the
   * source-prefixed id from `getChannels()`.
   */
  getStreamInfo(channelId: string, userToken?: string): Promise<LiveStreamInfo>;

  /**
   * Optional — EPG. Sources without an EPG implementation return [].
   * Wired up in Week 4 of Phase 1.
   */
  getProgramsForChannel?(channelId: string, lookaheadHours?: number): Promise<LiveProgram[]>;
}

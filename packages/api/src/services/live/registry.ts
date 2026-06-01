import type { LiveSource } from './types.js';
import { hdhomerunSource } from './hdhomerun.js';

/**
 * Live-TV source registry. Phase 1 ships with HDHomeRun only;
 * Phase 2 will add plex / jellyfin / emby live-source implementations
 * that drop in here without any route or client changes.
 */
const sources: LiveSource[] = [
  hdhomerunSource,
  // jellyfinLiveSource,
  // embyLiveSource,
  // plexLiveSource,
];

/** Every source — configured or not. Used by /setup to render status dots. */
export function allLiveSources(): LiveSource[] {
  return sources.slice();
}

/** Sources the user has configured. Used by the channel aggregator. */
export function getConfiguredLiveSources(): LiveSource[] {
  return sources.filter((s) => s.isConfigured());
}

/**
 * Resolve a source-prefixed channel id (`hdhr-5.1`, `jellyfin-abc`)
 * back to its source so the stream endpoint can dispatch.
 */
export function getLiveSourceForChannel(channelId: string): LiveSource | null {
  const dash = channelId.indexOf('-');
  if (dash < 0) return null;
  const prefix = channelId.slice(0, dash);
  return sources.find((s) => s.kind === prefix) || null;
}

/** Lookup by source kind. */
export function getLiveSource(kind: LiveSource['kind']): LiveSource | null {
  return sources.find((s) => s.kind === kind) || null;
}

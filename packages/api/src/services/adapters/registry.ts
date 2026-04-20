import type { ContentSource } from '@whatson/shared';
import { plexAdapter } from './plex.js';
import type { MediaServerAdapter, MediaServerKind } from './types.js';

/**
 * All known media-server adapters. Jellyfin and Emby entries will land here as
 * they come online. Order matters only for logging/debugging — shelf ordering
 * is decided by the aggregator.
 */
const adapters: Record<MediaServerKind, MediaServerAdapter> = {
  plex: plexAdapter,
  // jellyfin: jellyfinAdapter,   // PR 2
  // emby: embyAdapter,           // PR 3
} as Record<MediaServerKind, MediaServerAdapter>;

export function getAdapter(kind: MediaServerKind): MediaServerAdapter | undefined {
  return adapters[kind];
}

/**
 * Look up an adapter for a ContentItem.source. Returns undefined for non-library
 * sources (sonarr/radarr/live) so callers can skip gracefully.
 */
export function getAdapterForSource(source: ContentSource): MediaServerAdapter | undefined {
  if (source === 'plex' || source === 'jellyfin' || source === 'emby') {
    return adapters[source as MediaServerKind];
  }
  return undefined;
}

/** Every adapter the operator has configured, in a stable order. */
export function getConfiguredAdapters(): MediaServerAdapter[] {
  return Object.values(adapters).filter((a) => a.isConfigured());
}

/** Every adapter we know about, regardless of config — for admin/status UIs. */
export function getAllAdapters(): MediaServerAdapter[] {
  return Object.values(adapters);
}

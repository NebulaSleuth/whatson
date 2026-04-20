import type { ContentSource } from '@whatson/shared';
import { plexAdapter } from './plex.js';
import { jellyfinAdapter } from './jellyfin.js';
import { embyAdapter } from './emby.js';
import type { MediaServerAdapter, MediaServerKind } from './types.js';

/**
 * All known media-server adapters. Order matters only for logging/debugging —
 * shelf ordering is decided by the aggregator.
 */
const adapters: Record<MediaServerKind, MediaServerAdapter> = {
  plex: plexAdapter,
  jellyfin: jellyfinAdapter,
  emby: embyAdapter,
};

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

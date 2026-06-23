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

/**
 * Per-request Whats On user scope. Mirrors the request-global pattern
 * tracked.ts uses for setRequestUserId. The middleware sets this on
 * every request that resolves a WO user; cleared on response 'finish'.
 *
 * When set, getConfiguredAdapters() filters to only the adapters this
 * user is mapped to. When null (default / WO feature off / legacy mode)
 * every configured adapter is returned, matching today's behaviour.
 */
interface WhatsOnUserScope {
  plexUserId: number | null;
  jellyfinUserId: string | null;
  embyUserId: string | null;
}

let activeScope: WhatsOnUserScope | null = null;

export function setActiveUserScope(scope: WhatsOnUserScope | null): void {
  activeScope = scope;
}

function isAdapterMappedForScope(kind: MediaServerKind, scope: WhatsOnUserScope): boolean {
  switch (kind) {
    case 'plex':     return scope.plexUserId !== null;
    case 'jellyfin': return scope.jellyfinUserId !== null;
    case 'emby':     return scope.embyUserId !== null;
  }
}

/**
 * Every adapter the operator has configured AND the active Whats On
 * user (if any) is mapped to. In legacy mode (no active scope) returns
 * every configured adapter, matching pre-WO behaviour.
 */
export function getConfiguredAdapters(): MediaServerAdapter[] {
  const scope = activeScope;
  return Object.values(adapters).filter((a) => {
    if (!a.isConfigured()) return false;
    if (scope && !isAdapterMappedForScope(a.kind, scope)) return false;
    return true;
  });
}

/** Every adapter we know about, regardless of config — for admin/status UIs. */
export function getAllAdapters(): MediaServerAdapter[] {
  return Object.values(adapters);
}

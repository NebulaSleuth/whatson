export const APP_NAME = 'Whats On';
export const APP_VERSION = '0.1.18';

export const PLEX_CLIENT_IDENTIFIER = 'com.whatson.app';
export const PLEX_PRODUCT = APP_NAME;

export const DEFAULT_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
export const ARTWORK_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export const SOURCE_COLORS = {
  plex: '#E5A00D',
  jellyfin: '#AA5CC3',
  emby: '#52B54B',
  sonarr: '#35C5F4',
  radarr: '#FFC230',
  live: '#4CAF50',
} as const;

export const SOURCE_LABELS = {
  plex: 'Plex',
  jellyfin: 'Jellyfin',
  emby: 'Emby',
  sonarr: 'Sonarr',
  radarr: 'Radarr',
  live: 'Live TV',
} as const;

export const DEFAULT_EPG_COUNTRY = 'US';
export const TVMAZE_BASE_URL = 'https://api.tvmaze.com';
export const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

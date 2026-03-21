import type { ServerConfig } from '@whatson/shared';

export interface AppConfig extends ServerConfig {
  port: number;
}

function trimUrl(url: string | undefined): string {
  return (url || '').replace(/\/+$/, '');
}

export const config: AppConfig = {
  port: parseInt(process.env.PORT || '3001', 10),
  plex: {
    url: trimUrl(process.env.PLEX_URL),
    token: (process.env.PLEX_TOKEN || '').trim(),
  },
  sonarr: {
    url: trimUrl(process.env.SONARR_URL),
    apiKey: (process.env.SONARR_API_KEY || '').trim(),
  },
  radarr: {
    url: trimUrl(process.env.RADARR_URL),
    apiKey: (process.env.RADARR_API_KEY || '').trim(),
  },
  epg: {
    provider: (process.env.EPG_PROVIDER as 'tvmaze' | 'tmdb' | 'xmltv') || 'tvmaze',
    country: process.env.EPG_COUNTRY || 'US',
    tmdbApiKey: process.env.TMDB_API_KEY || '',
  },
};

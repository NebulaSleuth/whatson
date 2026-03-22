import type { ServerConfig } from '@whatson/shared';

export interface AppConfig extends ServerConfig {
  port: number;
}

function trimUrl(url: string | undefined): string {
  return (url || '').replace(/\/+$/, '');
}

/**
 * Config is loaded lazily on first access.
 * This ensures dotenv has been called before env vars are read,
 * which matters in the standalone (esbuild) bundle where all
 * modules are evaluated in a single file.
 */
let _config: AppConfig | null = null;

function loadConfig(): AppConfig {
  return {
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
}

export const config: AppConfig = new Proxy({} as AppConfig, {
  get(_target, prop) {
    if (!_config) _config = loadConfig();
    return (_config as any)[prop];
  },
  set(_target, prop, value) {
    if (!_config) _config = loadConfig();
    (_config as any)[prop] = value;
    return true;
  },
});

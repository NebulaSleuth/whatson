import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { ServerConfig } from '@whatson/shared';

export interface AppConfig extends ServerConfig {
  port: number;
}

function trimUrl(url: string | undefined): string {
  let u = (url || '').replace(/\/+$/, '').trim();
  // Add http:// if no protocol specified
  if (u && !u.startsWith('http://') && !u.startsWith('https://')) {
    u = `http://${u}`;
  }
  return u;
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
    jellyfin: {
      url: trimUrl(process.env.JELLYFIN_URL),
      username: (process.env.JELLYFIN_USERNAME || '').trim(),
      password: process.env.JELLYFIN_PASSWORD || '',
    },
    emby: {
      url: trimUrl(process.env.EMBY_URL),
      username: (process.env.EMBY_USERNAME || '').trim(),
      password: process.env.EMBY_PASSWORD || '',
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
    update: {
      // Default: on. Disable by setting AUTO_UPDATE=false in .env.
      enabled: (process.env.AUTO_UPDATE || 'true').toLowerCase() !== 'false',
      repo: process.env.UPDATE_REPO || 'NebulaSleuth/whatson',
      channel: (process.env.UPDATE_CHANNEL as 'stable' | 'prerelease') || 'stable',
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

/**
 * Find the .env file path (same search order as index.ts).
 * If none exists, creates one next to the executable or in cwd.
 */
export function getEnvFilePath(): string {
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  const candidates = [
    join(dirname(process.execPath), '.env'),
    join(programData, 'WhatsOn', '.env'),
    join(process.cwd(), '.env'),
    join(__dirname, '..', '.env'),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // Default: create in cwd
  return join(process.cwd(), '.env');
}

/**
 * Save config values to the .env file.
 * Preserves comments and unrecognized keys; updates known keys in place.
 */
export function saveConfigToEnv(values: Record<string, string>): void {
  const envPath = getEnvFilePath();
  let lines: string[] = [];

  if (existsSync(envPath)) {
    lines = readFileSync(envPath, 'utf-8').split('\n');
  }

  const written = new Set<string>();

  // Update existing lines
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([A-Z_]+)\s*=/);
    if (match && match[1] in values) {
      lines[i] = `${match[1]}=${values[match[1]]}`;
      written.add(match[1]);
    }
  }

  // Append new keys
  for (const [key, val] of Object.entries(values)) {
    if (!written.has(key)) {
      lines.push(`${key}=${val}`);
    }
  }

  const dir = dirname(envPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(envPath, lines.join('\n'));
  console.log(`[Config] Saved config to ${envPath}`);
}

/**
 * Reload config from current process.env values.
 * Call after updating process.env (e.g., after saving .env and re-parsing).
 */
export function reloadConfig(): void {
  _config = loadConfig();
}

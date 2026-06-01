import axios from 'axios';
import type { LiveChannel, LiveStreamInfo } from '@whatson/shared';
import { config, saveConfigToEnv } from '../../config.js';
import { getCached, setCached } from '../../cache.js';
import type { LiveSource } from './types.js';

/**
 * HDHomeRun network tuner. Silicondust's HTTP API is open and
 * unauthenticated on the LAN — discovery, channel lineup, and stream
 * URLs are all just `GET` against the device.
 *
 *   GET {url}/discover.json   → { FriendlyName, ModelNumber, DeviceID,
 *                                  TunerCount, LineupURL, BaseURL,
 *                                  DeviceAuth, ... }
 *   GET {LineupURL}           → [ { GuideNumber, GuideName, URL, HD,
 *                                    Favorite, DRM, VideoCodec, ... } ]
 *   GET {channel.URL}         → continuous MPEG-TS HTTP stream
 *
 * Streams are raw MPEG-TS — Roku Video node + iOS AVPlayer +
 * Android ExoPlayer play them natively. Browsers need a backend
 * transmux (handled separately in `hlsProxy.ts`, Phase 1 week 3).
 */

interface DiscoverResponse {
  FriendlyName?: string;
  ModelNumber?: string;
  DeviceID?: string;
  TunerCount?: number;
  LineupURL?: string;
  BaseURL?: string;
  DeviceAuth?: string;
}

interface LineupChannel {
  GuideNumber?: string;
  GuideName?: string;
  URL?: string;
  HD?: number;
  Favorite?: number;
  DRM?: number;
  VideoCodec?: string;
  AudioCodec?: string;
}

const CACHE_TTL_DISCOVER = 60 * 60; // 1 hour
const CACHE_TTL_LINEUP = 10 * 60;   // 10 minutes
const HTTP_TIMEOUT_MS = 4000;

function baseUrl(): string | null {
  const raw = (config.hdhomerun?.url || '').trim();
  if (!raw) return null;
  // Strip trailing slash, accept either http://host or http://host:port
  return raw.replace(/\/+$/, '');
}

/**
 * Hit /discover.json against the configured device. Caches the result
 * so subsequent calls (lineup, EPG) don't re-probe. Returns null when
 * the device is unreachable or not configured.
 */
async function discover(): Promise<DiscoverResponse | null> {
  const base = baseUrl();
  if (!base) return null;

  const cacheKey = `hdhr:discover:${base}`;
  const cached = getCached<DiscoverResponse>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await axios.get<DiscoverResponse>(`${base}/discover.json`, {
      timeout: HTTP_TIMEOUT_MS,
    });
    if (!data || typeof data !== 'object') return null;
    setCached(cacheKey, data, CACHE_TTL_DISCOVER);

    // Mirror DeviceAuth into config + .env so the cloud EPG endpoint
    // has it without the admin having to copy it manually. Skip if
    // unchanged or unset.
    if (data.DeviceAuth && data.DeviceAuth !== config.hdhomerun?.deviceAuth) {
      try {
        saveConfigToEnv({ HDHOMERUN_DEVICE_AUTH: data.DeviceAuth });
      } catch {}
    }

    return data;
  } catch (err) {
    console.warn(`[hdhr] discover failed: ${(err as Error).message}`);
    return null;
  }
}

async function fetchLineup(): Promise<LineupChannel[]> {
  const base = baseUrl();
  if (!base) return [];

  const cacheKey = `hdhr:lineup:${base}`;
  const cached = getCached<LineupChannel[]>(cacheKey);
  if (cached) return cached;

  // Prefer the LineupURL the device tells us about — some HDHomeRun
  // models put it at a non-default path. Fall back to /lineup.json
  // for the common case.
  const disc = await discover();
  const lineupUrl = disc?.LineupURL || `${base}/lineup.json`;

  try {
    const { data } = await axios.get<LineupChannel[]>(lineupUrl, {
      timeout: HTTP_TIMEOUT_MS,
    });
    if (!Array.isArray(data)) return [];
    setCached(cacheKey, data, CACHE_TTL_LINEUP);
    return data;
  } catch (err) {
    console.warn(`[hdhr] lineup fetch failed: ${(err as Error).message}`);
    return [];
  }
}

function toLiveChannel(c: LineupChannel): LiveChannel | null {
  if (!c.GuideNumber || !c.URL) return null;
  return {
    id: `hdhr-${c.GuideNumber}`,
    source: 'hdhr',
    name: c.GuideName || c.GuideNumber,
    number: c.GuideNumber,
    callSign: c.GuideName,
    hd: c.HD === 1,
    drm: c.DRM === 1,
    // HDHomeRun lineup doesn't include logos — clients fall back to
    // a generic glyph or the channel name. We could fetch logos from
    // Silicondust's cloud guide in Phase 1 week 4 (EPG) and stash
    // them here.
  };
}

export const hdhomerunSource: LiveSource = {
  kind: 'hdhr',

  isConfigured(): boolean {
    return baseUrl() !== null;
  },

  async testConnection(): Promise<boolean> {
    const disc = await discover();
    return disc !== null && (disc.DeviceID !== undefined || disc.ModelNumber !== undefined);
  },

  async getChannels(): Promise<LiveChannel[]> {
    if (!baseUrl()) return [];
    const lineup = await fetchLineup();
    const out: LiveChannel[] = [];
    for (const c of lineup) {
      const lc = toLiveChannel(c);
      // Drop DRM channels — we can't actually stream them anyway
      if (lc && !lc.drm) out.push(lc);
    }
    // Stable sort by channel number (treat as decimal: "5.1" < "5.2" < "12.1")
    out.sort((a, b) => {
      const aN = parseFloat(a.number || '0');
      const bN = parseFloat(b.number || '0');
      if (aN === bN) return (a.name || '').localeCompare(b.name || '');
      return aN - bN;
    });
    return out;
  },

  async getStreamInfo(channelId: string): Promise<LiveStreamInfo> {
    if (!channelId.startsWith('hdhr-')) {
      throw new Error(`Not an HDHomeRun channel id: ${channelId}`);
    }
    const guideNumber = channelId.slice('hdhr-'.length);
    const lineup = await fetchLineup();
    const match = lineup.find((c) => c.GuideNumber === guideNumber);
    if (!match || !match.URL) {
      throw new Error(`Channel ${guideNumber} not found in HDHomeRun lineup`);
    }
    const channel = toLiveChannel(match);
    if (!channel) {
      throw new Error(`Channel ${guideNumber} has no URL`);
    }
    return {
      url: match.URL,
      format: 'mpeg-ts',
      channel,
    };
  },
};

/**
 * Resets the in-memory discover/lineup caches. Called after the user
 * saves a new HDHomeRun URL in /setup so the next request re-probes.
 */
export function resetHdHomeRunCache(): void {
  const base = baseUrl();
  if (!base) return;
  setCached(`hdhr:discover:${base}`, undefined, 1);
  setCached(`hdhr:lineup:${base}`, undefined, 1);
}

import axios from 'axios';
import type { LiveChannel, LiveProgram, LiveStreamInfo } from '@whatson/shared';
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

/**
 * Silicondust's cloud guide format. One entry per channel; the `Guide`
 * array holds programs sorted by StartTime. Source documented at
 * https://info.hdhomerun.com/info/http_api (EPG section).
 */
interface CloudGuideChannel {
  GuideNumber?: string;
  GuideName?: string;
  Affiliate?: string;
  /** Channel logo on Silicondust CDN — re-served through /api/artwork */
  ImageURL?: string;
  Guide?: CloudGuideProgram[];
}

interface CloudGuideProgram {
  StartTime?: number;  // unix seconds
  EndTime?: number;
  Title?: string;
  EpisodeTitle?: string;
  Synopsis?: string;
  EpisodeNumber?: string;
  ImageURL?: string;
  Filter?: string[];
  OriginalAirdate?: number;
}

const CACHE_TTL_DISCOVER = 60 * 60; // 1 hour
const CACHE_TTL_LINEUP = 10 * 60;   // 10 minutes
const CACHE_TTL_GUIDE = 10 * 60;    // 10 minutes — Silicondust schedules
                                    // rarely shift within a 10 min window,
                                    // and we don't want to hammer their API.
const HTTP_TIMEOUT_MS = 4000;
const GUIDE_TIMEOUT_MS = 8000;      // Cloud guide is slower than LAN; give it more

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

/**
 * Fetch the Silicondust cloud guide for the configured device.
 * Returns an array of channels each with a `Guide` of ~36 hours of
 * upcoming programs. DeviceAuth is taken from the cached /discover
 * response. Cached for 10 minutes to avoid hammering Silicondust.
 */
async function fetchCloudGuide(): Promise<CloudGuideChannel[]> {
  const disc = await discover();
  const auth = (disc?.DeviceAuth || config.hdhomerun?.deviceAuth || '').trim();
  if (!auth) return [];

  const cacheKey = `hdhr:guide:${auth}`;
  const cached = getCached<CloudGuideChannel[]>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await axios.get<CloudGuideChannel[]>(
      'https://api.hdhomerun.com/api/guide.php',
      { params: { DeviceAuth: auth }, timeout: GUIDE_TIMEOUT_MS },
    );
    if (!Array.isArray(data)) return [];
    setCached(cacheKey, data, CACHE_TTL_GUIDE);
    console.log(`[hdhr] cloud guide loaded — ${data.length} channels`);
    return data;
  } catch (err) {
    console.warn(`[hdhr] cloud guide fetch failed: ${(err as Error).message}`);
    return [];
  }
}

function toLiveChannel(c: LineupChannel, guideEntry?: CloudGuideChannel): LiveChannel | null {
  if (!c.GuideNumber || !c.URL) return null;
  // Silicondust cloud guide carries channel logos — preferred when
  // available. Re-served through /api/artwork so clients on the LAN
  // hit our backend (already cached + CORS-friendly) rather than
  // Silicondust's CDN directly.
  let logoUrl: string | undefined;
  if (guideEntry?.ImageURL) {
    logoUrl = `/api/artwork?url=${encodeURIComponent(guideEntry.ImageURL)}&w=360`;
  }
  return {
    id: `hdhr-${c.GuideNumber}`,
    source: 'hdhr',
    name: c.GuideName || c.GuideNumber,
    number: c.GuideNumber,
    callSign: c.GuideName,
    logoUrl,
    hd: c.HD === 1,
    drm: c.DRM === 1,
  };
}

function toLiveProgram(channelId: string, p: CloudGuideProgram): LiveProgram | null {
  if (!p.StartTime || !p.EndTime || !p.Title) return null;
  return {
    channelId,
    startMs: p.StartTime * 1000,
    endMs: p.EndTime * 1000,
    title: p.Title,
    episodeTitle: p.EpisodeTitle,
    description: p.Synopsis,
    rating: undefined, // Silicondust guide doesn't surface TV ratings reliably
    thumbUrl: p.ImageURL,
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
    // Fetch lineup + cloud guide in parallel. Guide gives us channel
    // logos for free, but its failure mustn't kill the channel list —
    // we degrade to the lineup-only data when the guide doesn't
    // respond.
    const [lineup, guide] = await Promise.all([
      fetchLineup(),
      fetchCloudGuide().catch(() => [] as CloudGuideChannel[]),
    ]);
    const guideByNumber = new Map<string, CloudGuideChannel>();
    for (const g of guide) {
      if (g.GuideNumber) guideByNumber.set(g.GuideNumber, g);
    }
    // GuideNumbers the admin explicitly hid in /setup → Tuners.
    // Filtered out here so they don't appear in the channel grid OR
    // EPG lookups. Empty list (default) means show everything from
    // the lineup.
    const disabled = new Set((config.hdhomerun?.disabledChannels || []).map((s) => s.trim()));
    const out: LiveChannel[] = [];
    for (const c of lineup) {
      if (c.GuideNumber && disabled.has(c.GuideNumber)) continue;
      const lc = toLiveChannel(c, c.GuideNumber ? guideByNumber.get(c.GuideNumber) : undefined);
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

  async getProgramsForChannel(channelId: string, lookaheadHours: number = 6): Promise<LiveProgram[]> {
    if (!channelId.startsWith('hdhr-')) return [];
    const guideNumber = channelId.slice('hdhr-'.length);
    const guide = await fetchCloudGuide();
    const entry = guide.find((g) => g.GuideNumber === guideNumber);
    if (!entry?.Guide) return [];

    const nowMs = Date.now();
    const horizonMs = nowMs + lookaheadHours * 3600 * 1000;
    const programs: LiveProgram[] = [];
    for (const p of entry.Guide) {
      const lp = toLiveProgram(channelId, p);
      if (!lp) continue;
      // Drop already-finished items (endMs in the past) and anything
      // after the horizon. Keep currently-airing even if it started
      // before now — that's what populates "Now: …" on the cards.
      if (lp.endMs <= nowMs) continue;
      if (lp.startMs > horizonMs) continue;
      programs.push(lp);
    }
    return programs;
  },
};

/**
 * Admin-only: list every channel in the lineup (including disabled
 * ones) with an `enabled` flag. Used by /setup → Tuners → Channels
 * to render the toggle UI.
 */
export async function getAllChannelsWithEnabled(): Promise<
  Array<LiveChannel & { enabled: boolean }>
> {
  if (!baseUrl()) return [];
  const [lineup, guide] = await Promise.all([
    fetchLineup(),
    fetchCloudGuide().catch(() => [] as CloudGuideChannel[]),
  ]);
  const guideByNumber = new Map<string, CloudGuideChannel>();
  for (const g of guide) {
    if (g.GuideNumber) guideByNumber.set(g.GuideNumber, g);
  }
  const disabled = new Set((config.hdhomerun?.disabledChannels || []).map((s) => s.trim()));
  const out: Array<LiveChannel & { enabled: boolean }> = [];
  for (const c of lineup) {
    const lc = toLiveChannel(c, c.GuideNumber ? guideByNumber.get(c.GuideNumber) : undefined);
    if (!lc || lc.drm) continue;
    out.push({ ...lc, enabled: !(c.GuideNumber && disabled.has(c.GuideNumber)) });
  }
  out.sort((a, b) => {
    const aN = parseFloat(a.number || '0');
    const bN = parseFloat(b.number || '0');
    if (aN === bN) return (a.name || '').localeCompare(b.name || '');
    return aN - bN;
  });
  return out;
}

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

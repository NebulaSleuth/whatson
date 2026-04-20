import axios from 'axios';
import { TVMAZE_BASE_URL } from '@whatson/shared';
import type { ContentItem } from '@whatson/shared';
import { getCached, setCached } from '../cache.js';

interface TvMazeScheduleItem {
  id: number;
  name: string;
  season: number;
  number: number;
  airdate: string;
  airtime: string;
  airstamp: string;
  runtime: number;
  image: { medium: string; original: string } | null;
  summary: string | null;
  show: {
    id: number;
    name: string;
    network: { name: string; country: { code: string } | null } | null;
    webChannel: { name: string } | null;
    image: { medium: string; original: string } | null;
    summary: string | null;
    genres: string[];
    premiered?: string | null;
  };
}

async function fetchSchedule(country: string, date?: string): Promise<TvMazeScheduleItem[]> {
  const cacheKey = `live:schedule:${country}:${date || 'today'}`;
  const cached = getCached<TvMazeScheduleItem[]>(cacheKey);
  if (cached) return cached;
  try {
    const params: Record<string, string> = { country };
    if (date) params.date = date;
    const { data } = await axios.get<TvMazeScheduleItem[]>(`${TVMAZE_BASE_URL}/schedule`, {
      params,
      timeout: 10000,
    });
    if (Array.isArray(data) && data.length > 0) setCached(cacheKey, data, 600);
    return data || [];
  } catch (error) {
    console.warn('[liveTv] TVmaze fetch failed:', (error as Error).message);
    return [];
  }
}

function stripHtml(s: string | null | undefined): string {
  return (s || '').replace(/<[^>]+>/g, '').trim();
}

function networkOf(ep: TvMazeScheduleItem): string | undefined {
  return ep.show.network?.name || ep.show.webChannel?.name || undefined;
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function toItem(ep: TvMazeScheduleItem): ContentItem | null {
  const network = networkOf(ep);
  if (!network) return null;

  const airStart = new Date(ep.airstamp).getTime();
  if (Number.isNaN(airStart)) return null;
  const runtimeMs = Math.max(1, ep.runtime || 30) * 60 * 1000;
  const airEnd = airStart + runtimeMs;
  const now = Date.now();

  const poster =
    ep.show.image?.original ||
    ep.show.image?.medium ||
    ep.image?.original ||
    ep.image?.medium ||
    '';

  const isCurrentlyAiring = now >= airStart && now <= airEnd;
  const percentage = isCurrentlyAiring
    ? Math.min(100, ((now - airStart) / runtimeMs) * 100)
    : 0;

  const isNew = ep.airdate === todayYmd();
  const isRerun = !isNew;

  return {
    id: `live:${ep.id}`,
    type: 'episode',
    title: ep.name || ep.show.name,
    showTitle: ep.show.name,
    seasonNumber: ep.season || undefined,
    episodeNumber: ep.number || undefined,
    summary: stripHtml(ep.summary) || stripHtml(ep.show.summary),
    duration: Math.max(1, ep.runtime || 30),
    artwork: { poster, thumbnail: poster, background: poster },
    source: 'live',
    sourceId: String(ep.id),
    status: isCurrentlyAiring ? 'live_now' : 'coming_soon',
    progress: { watched: false, percentage, currentPosition: 0 },
    availability: { availableAt: ep.airstamp, channel: network, network },
    addedAt: ep.airstamp,
    year: new Date(ep.airstamp).getFullYear(),
    genres: ep.show.genres || [],
    isNew,
    isRerun,
  };
}

export async function getChannels(country = 'US'): Promise<string[]> {
  const cacheKey = `live:channels:${country}`;
  const cached = getCached<string[]>(cacheKey);
  if (cached) return cached;

  const schedule = await fetchSchedule(country);
  const set = new Set<string>();
  for (const ep of schedule) {
    const n = networkOf(ep);
    if (n) set.add(n);
  }
  const list = [...set].sort((a, b) => a.localeCompare(b));
  if (list.length > 0) setCached(cacheKey, list, 86400);
  return list;
}

export async function getOnNow(channels: string[], country = 'US'): Promise<ContentItem[]> {
  if (channels.length === 0) return [];
  const allow = new Set(channels);
  const schedule = await fetchSchedule(country);
  const now = Date.now();
  const out: ContentItem[] = [];

  for (const ep of schedule) {
    const network = networkOf(ep);
    if (!network || !allow.has(network)) continue;

    const airStart = new Date(ep.airstamp).getTime();
    if (Number.isNaN(airStart)) continue;
    const airEnd = airStart + Math.max(1, ep.runtime || 30) * 60 * 1000;
    if (now < airStart || now > airEnd) continue;

    const item = toItem(ep);
    if (item) out.push(item);
  }

  out.sort((a, b) => (a.availability.channel || '').localeCompare(b.availability.channel || ''));
  return out;
}

export async function getOnLater(
  channels: string[],
  country = 'US',
  hours = 6,
): Promise<ContentItem[]> {
  if (channels.length === 0) return [];
  const allow = new Set(channels);
  const schedule = await fetchSchedule(country);
  const now = Date.now();
  const windowEnd = now + Math.max(1, hours) * 60 * 60 * 1000;
  const out: ContentItem[] = [];

  for (const ep of schedule) {
    const network = networkOf(ep);
    if (!network || !allow.has(network)) continue;

    const airStart = new Date(ep.airstamp).getTime();
    if (Number.isNaN(airStart)) continue;
    if (airStart <= now || airStart > windowEnd) continue;

    const item = toItem(ep);
    if (item) out.push(item);
  }

  out.sort((a, b) => new Date(a.availability.availableAt).getTime() - new Date(b.availability.availableAt).getTime());
  return out;
}

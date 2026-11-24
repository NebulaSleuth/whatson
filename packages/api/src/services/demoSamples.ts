/**
 * Sample "Coming Soon", "Late" and "Downloading" cards for the public demo.
 *
 * The demo has no Sonarr or Radarr, so those shelves would always be empty.
 * In demo mode only, the home payload gets a few made-up items from
 * `<DATA_DIR>/demoSamples.json` (written by deploy/demo/setup-jellyfin.sh from
 * deploy/demo/seed/demoSamples.json). Nothing is downloading and nothing will
 * arrive; the cards only show what those states look like.
 *
 * Dates are stored as hours from now, so the cards never go stale: a "late"
 * item is always a day overdue, a "coming soon" one always a few days out.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContentItem } from '@whatson/shared';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

export type SampleState = 'coming_soon' | 'late' | 'downloading';

export interface SampleEntry {
  kind: 'episode' | 'movie';
  state: SampleState;
  /** Hours from now the item airs / releases. Negative for late items. */
  offsetHours: number;
  title: string;
  year: number;
  /** Episodes: the library series it belongs to; its artwork is reused. */
  series?: string;
  season?: number;
  episode?: number;
  /** Movies: poster URL (looked up by setup-jellyfin.sh). */
  poster?: string;
  summary?: string;
  network?: string;
  /** Downloading items: percent complete and a time-left label. */
  percentage?: number;
  timeLeft?: string;
}

export function loadSampleEntries(file = join(DATA_DIR, 'demoSamples.json')): SampleEntry[] {
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    return Array.isArray(parsed?.items) ? (parsed.items as SampleEntry[]) : [];
  } catch (err) {
    console.warn(`[demoSamples] ignoring ${file}: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Turn sample entries into content items. `library` is what the media server
 * returned, so an episode sample can borrow its series' poster; an episode
 * whose series isn't in the library is dropped rather than shown without art.
 */
export function buildSampleItems(
  entries: SampleEntry[],
  library: ContentItem[],
  now = Date.now(),
): { tv: ContentItem[]; movies: ContentItem[] } {
  const seriesArt = new Map<string, ContentItem['artwork']>();
  for (const it of library) {
    if (it.type === 'episode' && it.showTitle && !seriesArt.has(it.showTitle)) {
      seriesArt.set(it.showTitle, it.artwork);
    }
  }

  const tv: ContentItem[] = [];
  const movies: ContentItem[] = [];
  entries.forEach((e, i) => {
    const isEpisode = e.kind === 'episode';
    let artwork: ContentItem['artwork'];
    if (isEpisode) {
      const art = e.series ? seriesArt.get(e.series) : undefined;
      if (!art) return;
      artwork = art;
    } else {
      if (!e.poster) return;
      artwork = { poster: e.poster, thumbnail: e.poster, background: '' };
    }
    const source = isEpisode ? 'sonarr' : 'radarr';
    const availableAt = new Date(now + e.offsetHours * 3600_000).toISOString();
    const item: ContentItem = {
      id: `demo-sample-${i}`,
      type: isEpisode ? 'episode' : 'movie',
      title: e.title,
      ...(isEpisode
        ? { showTitle: e.series, seasonNumber: e.season, episodeNumber: e.episode }
        : {}),
      summary: e.summary ?? '',
      duration: 0,
      artwork,
      source,
      sourceId: `demo-sample-${i}`,
      status: e.state === 'downloading' ? 'downloading' : 'coming_soon',
      progress: { watched: false, percentage: 0, currentPosition: 0 },
      availability: { availableAt, ...(e.network ? { network: e.network } : {}) },
      addedAt: availableAt,
      year: e.year,
      ...(e.state === 'late' ? { isLate: true } : {}),
      ...(e.state === 'downloading'
        ? {
            download: {
              // Negative so it can never collide with a real queue record.
              queueId: -(i + 1),
              percentage: e.percentage ?? 50,
              status: 'downloading',
              ...(e.timeLeft ? { timeLeft: e.timeLeft } : {}),
            },
          }
        : {}),
    };
    (isEpisode ? tv : movies).push(item);
  });
  return { tv, movies };
}

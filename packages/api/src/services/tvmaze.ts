import axios from 'axios';
import { TVMAZE_BASE_URL } from '@whatson/shared';
import { getCached, setCached } from '../cache.js';

export interface TvMazeEpisode {
  id: number;
  name: string;
  season: number;
  number: number;
  airdate: string;     // "2026-03-20"
  airstamp: string;    // ISO 8601
  runtime: number;
  summary: string | null;
  image: { medium: string; original: string } | null;
}

export interface TvMazeShow {
  id: number;
  name: string;
  image: { medium: string; original: string } | null;
}

interface TvMazeSearchResult {
  show: TvMazeShow;
}

/**
 * Search TVmaze for a show by name. Returns the best match's TVmaze ID.
 */
async function findShowId(title: string): Promise<number | null> {
  const cacheKey = `tvmaze:search:${title.toLowerCase()}`;
  const cached = getCached<number | null>(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const { data } = await axios.get<TvMazeSearchResult[]>(`${TVMAZE_BASE_URL}/search/shows`, {
      params: { q: title },
      timeout: 5000,
    });
    const match = data[0]?.show;
    const id = match ? match.id : null;
    setCached(cacheKey, id, 3600); // cache for 1 hour
    return id;
  } catch {
    return null;
  }
}

/**
 * Get episodes for a show. Returns all episodes.
 */
async function getEpisodes(showId: number): Promise<TvMazeEpisode[]> {
  const cacheKey = `tvmaze:episodes:${showId}`;
  const cached = getCached<TvMazeEpisode[]>(cacheKey);
  if (cached) return cached;

  try {
    const { data } = await axios.get<TvMazeEpisode[]>(
      `${TVMAZE_BASE_URL}/shows/${showId}/episodes`,
      { timeout: 5000 },
    );
    setCached(cacheKey, data, 3600); // cache for 1 hour
    return data;
  } catch {
    return [];
  }
}

/**
 * Get the most recent aired episode for a show (within the last 30 days).
 */
export async function getMostRecentEpisode(
  title: string,
): Promise<{ episode: TvMazeEpisode; showId: number } | null> {
  const showId = await findShowId(title);
  if (!showId) return null;

  const episodes = await getEpisodes(showId);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Find most recent aired episode within 30 days
  const recent = episodes
    .filter((ep) => {
      if (!ep.airdate) return false;
      const airDate = new Date(ep.airdate);
      return airDate <= now && airDate >= thirtyDaysAgo;
    })
    .sort((a, b) => new Date(b.airdate).getTime() - new Date(a.airdate).getTime());

  return recent[0] ? { episode: recent[0], showId } : null;
}

/**
 * Get upcoming episodes for a show (next 14 days).
 */
export async function getUpcomingEpisodes(
  title: string,
): Promise<{ episodes: TvMazeEpisode[]; showId: number } | null> {
  const showId = await findShowId(title);
  if (!showId) return null;

  const allEpisodes = await getEpisodes(showId);
  const now = new Date();
  const twoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const upcoming = allEpisodes.filter((ep) => {
    if (!ep.airdate) return false;
    const airDate = new Date(ep.airdate);
    return airDate > now && airDate <= twoWeeks;
  });

  return upcoming.length > 0 ? { episodes: upcoming, showId } : null;
}

import axios from 'axios';
import { TMDB_BASE_URL, TMDB_IMAGE_BASE } from '@whatson/shared';
import { config } from '../config.js';

const TMDB_API_KEY = () => config.epg.tmdbApiKey;

function tmdbImage(path: string | null, size: string = 'w500'): string {
  if (!path) return '';
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export interface TmdbSearchResult {
  id: number;
  tmdbId: number;
  imdbId?: string;
  title: string;
  type: 'movie' | 'tv';
  year: number;
  overview: string;
  poster: string;
  backdrop: string;
  rating: number;
  popularity: number;
}

export async function searchMulti(query: string): Promise<TmdbSearchResult[]> {
  const apiKey = TMDB_API_KEY();
  if (!apiKey) {
    throw new Error('TMDB API key not configured');
  }

  const { data } = await axios.get(`${TMDB_BASE_URL}/search/multi`, {
    params: {
      api_key: apiKey,
      query,
      include_adult: false,
      language: 'en-US',
      page: 1,
    },
    timeout: 10000,
  });

  const results: TmdbSearchResult[] = [];

  for (const item of data.results || []) {
    if (item.media_type !== 'movie' && item.media_type !== 'tv') continue;

    const isMovie = item.media_type === 'movie';
    const title = isMovie ? item.title : item.name;
    const year = isMovie
      ? new Date(item.release_date || '').getFullYear()
      : new Date(item.first_air_date || '').getFullYear();

    results.push({
      id: item.id,
      tmdbId: item.id,
      title: title || '',
      type: isMovie ? 'movie' : 'tv',
      year: year || 0,
      overview: item.overview || '',
      poster: tmdbImage(item.poster_path),
      backdrop: tmdbImage(item.backdrop_path, 'w1280'),
      rating: item.vote_average || 0,
      popularity: item.popularity || 0,
    });
  }

  return results;
}

export async function getMovieDetails(tmdbId: number): Promise<TmdbSearchResult & { imdbId?: string }> {
  const apiKey = TMDB_API_KEY();
  if (!apiKey) throw new Error('TMDB API key not configured');

  const { data } = await axios.get(`${TMDB_BASE_URL}/movie/${tmdbId}`, {
    params: { api_key: apiKey, append_to_response: 'external_ids' },
    timeout: 10000,
  });

  return {
    id: data.id,
    tmdbId: data.id,
    imdbId: data.imdb_id || data.external_ids?.imdb_id,
    title: data.title,
    type: 'movie',
    year: new Date(data.release_date || '').getFullYear() || 0,
    overview: data.overview || '',
    poster: tmdbImage(data.poster_path),
    backdrop: tmdbImage(data.backdrop_path, 'w1280'),
    rating: data.vote_average || 0,
    popularity: data.popularity || 0,
  };
}

export async function getTvDetails(tmdbId: number): Promise<TmdbSearchResult & { imdbId?: string }> {
  const apiKey = TMDB_API_KEY();
  if (!apiKey) throw new Error('TMDB API key not configured');

  const { data } = await axios.get(`${TMDB_BASE_URL}/tv/${tmdbId}`, {
    params: { api_key: apiKey, append_to_response: 'external_ids' },
    timeout: 10000,
  });

  return {
    id: data.id,
    tmdbId: data.id,
    imdbId: data.external_ids?.imdb_id,
    title: data.name,
    type: 'tv',
    year: new Date(data.first_air_date || '').getFullYear() || 0,
    overview: data.overview || '',
    poster: tmdbImage(data.poster_path),
    backdrop: tmdbImage(data.backdrop_path, 'w1280'),
    rating: data.vote_average || 0,
    popularity: data.popularity || 0,
  };
}

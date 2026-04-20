// ── Content Models ──

export type ContentType = 'movie' | 'episode' | 'show';
export type ContentSource = 'plex' | 'sonarr' | 'radarr' | 'live';
export type ContentStatus = 'watching' | 'ready' | 'coming_soon' | 'downloading' | 'live_now';
export type SectionType = 'tv' | 'movie' | 'mixed';

export interface Artwork {
  poster: string;
  thumbnail: string;
  background: string;
}

export interface Progress {
  watched: boolean;
  percentage: number;
  currentPosition: number; // seconds
}

export interface Availability {
  availableAt: string; // ISO 8601
  channel?: string;
  network?: string;
}

export interface ContentItem {
  id: string;
  type: ContentType;
  title: string;
  showTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  summary: string;
  duration: number; // minutes
  artwork: Artwork;
  source: ContentSource;
  sourceId: string;
  status: ContentStatus;
  progress: Progress;
  availability: Availability;
  playbackUrl?: string;
  addedAt: string; // ISO 8601
  lastViewedAt?: string; // ISO 8601 — when last watched
  year: number;
  rating?: number;
  genres?: string[];
  isNew?: boolean;
  isRerun?: boolean;
  showRatingKey?: string;
  /** When multiple items are collapsed into one card (e.g., multiple downloading episodes of the same show). */
  groupCount?: number;
}

export interface ContentSection {
  id: string;
  title: string;
  type: SectionType;
  items: ContentItem[];
  sortOrder: number;
}

// ── API Response Models ──

export interface HomeResponse {
  sections: ContentSection[];
  lastUpdated: string;
}

export interface SearchResponse {
  results: ContentItem[];
  query: string;
  total: number;
}

// ── Tracked Items (Watchlist) ──

export type StreamingProvider =
  | 'netflix'
  | 'disney_plus'
  | 'hulu'
  | 'amazon_prime'
  | 'max'
  | 'apple_tv_plus'
  | 'paramount_plus'
  | 'peacock'
  | 'youtube_tv'
  | 'sling_tv'
  | 'fubo_tv'
  | 'directv'
  | 'philo'
  | 'amc_plus'
  | 'starz'
  | 'showtime'
  | 'mubi'
  | 'crunchyroll'
  | 'britbox'
  | 'bet_plus'
  | 'tubi'
  | 'pluto_tv'
  | 'roku_channel'
  | 'freevee'
  | 'crackle'
  | 'plex'
  | 'sonarr'
  | 'radarr'
  | 'other';

export interface TrackedItem {
  id: string;
  tmdbId: number;
  imdbId?: string;
  title: string;
  type: 'movie' | 'tv';
  year: number;
  overview: string;
  poster: string;
  backdrop: string;
  rating: number;
  provider: StreamingProvider;
  addedAt: string; // ISO 8601
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

export const STREAMING_PROVIDERS: Record<StreamingProvider, string> = {
  netflix: 'Netflix',
  disney_plus: 'Disney+',
  hulu: 'Hulu',
  amazon_prime: 'Amazon Prime Video',
  max: 'Max',
  apple_tv_plus: 'Apple TV+',
  paramount_plus: 'Paramount+',
  peacock: 'Peacock',
  youtube_tv: 'YouTube TV',
  sling_tv: 'Sling TV',
  fubo_tv: 'Fubo TV',
  directv: 'DirecTV',
  philo: 'Philo',
  amc_plus: 'AMC+',
  starz: 'Starz',
  showtime: 'Showtime',
  mubi: 'MUBI',
  crunchyroll: 'Crunchyroll',
  britbox: 'BritBox',
  bet_plus: 'BET+',
  tubi: 'Tubi',
  pluto_tv: 'Pluto TV',
  roku_channel: 'Roku Channel',
  freevee: 'Freevee',
  crackle: 'Crackle',
  plex: 'Plex',
  sonarr: 'Sonarr',
  radarr: 'Radarr',
  other: 'Other',
};

// ── Server Configuration ──

export interface PlexConfig {
  url: string;
  token: string;
}

export interface SonarrConfig {
  url: string;
  apiKey: string;
}

export interface RadarrConfig {
  url: string;
  apiKey: string;
}

export interface EpgConfig {
  provider: 'tvmaze' | 'tmdb' | 'xmltv';
  country: string;
  tmdbApiKey?: string;
  xmltvUrl?: string;
}

export interface UpdateConfig {
  enabled: boolean;
  repo: string;           // "<owner>/<name>" on GitHub
  channel: 'stable' | 'prerelease';
}

export interface ServerConfig {
  plex: PlexConfig;
  sonarr: SonarrConfig;
  radarr: RadarrConfig;
  epg: EpgConfig;
  update: UpdateConfig;
}

// ── API Request/Response ──

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ScrobbleRequest {
  sourceId: string;
  source: ContentSource;
}

export interface SearchRequest {
  query: string;
  type?: 'tv' | 'movie';
  source?: ContentSource;
  limit?: number;
  offset?: number;
}

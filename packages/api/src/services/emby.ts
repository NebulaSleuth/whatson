import { config } from '../config.js';
import { createEmbyLikeService } from './embyLike.js';

const service = createEmbyLikeService({
  getConfig: () => config.emby,
  source: 'emby',
  label: 'Emby',
});

export const {
  ensureSession,
  resetClient,
  testConnection,
  listUsers,
  getContinueWatching,
  getOnDeck,
  getRecentlyAdded,
  getLibrary,
  getShowSeasons,
  getSeasonEpisodes,
  search,
  markWatched,
  markUnwatched,
  getPlaybackInfo,
  reportProgress,
  stopPlayback,
} = service;

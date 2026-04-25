import axios, { type AxiosInstance } from 'axios';
import { APP_NAME, APP_VERSION, PLEX_CLIENT_IDENTIFIER } from '@whatson/shared';
import type { ContentItem } from '@whatson/shared';
import { getCached, setCached } from '../cache.js';
import type {
  PlaybackInfo,
  PlaybackOpts,
  Season,
  ServerUser,
} from './adapters/types.js';

// 1 tick = 100ns. Jellyfin/Emby store runtime and position in ticks.
const TICKS_PER_MS = 10_000;

const DEVICE_ID = PLEX_CLIENT_IDENTIFIER;
const AUTH_PREFIX = `MediaBrowser Client="${APP_NAME}", Device="${APP_NAME} Server", DeviceId="${DEVICE_ID}", Version="${APP_VERSION}"`;

export interface EmbyLikeConfig {
  url: string;
  username: string;
  password: string;
}

export interface EmbyLikeOptions {
  /** Selector so the service always reads the current config (hot reload safe). */
  getConfig: () => EmbyLikeConfig;
  /** 'jellyfin' or 'emby' — stamped on every ContentItem and used as cache key prefix. */
  source: 'jellyfin' | 'emby';
  /** Label for logs. */
  label: string;
}

export interface EmbyLikeSession {
  accessToken: string;
  userId: string;
}

export interface EmbyLikeService {
  ensureSession(forceRefresh?: boolean): Promise<EmbyLikeSession | null>;
  resetClient(): void;
  testConnection(): Promise<boolean>;
  listUsers(): Promise<ServerUser[]>;
  getContinueWatching(): Promise<ContentItem[]>;
  getOnDeck(): Promise<ContentItem[]>;
  getRecentlyAdded(limit: number): Promise<ContentItem[]>;
  getLibrary(type: 'movie' | 'show'): Promise<ContentItem[]>;
  getShowSeasons(showId: string): Promise<Season[]>;
  getSeasonEpisodes(seasonId: string): Promise<ContentItem[]>;
  search(query: string): Promise<ContentItem[]>;
  markWatched(itemId: string): Promise<void>;
  markUnwatched(itemId: string): Promise<void>;
  getPlaybackInfo(itemId: string, opts: PlaybackOpts): Promise<PlaybackInfo>;
  reportProgress(itemId: string, timeMs: number, durationMs: number, state: string, sessionId: string): Promise<void>;
  stopPlayback(sessionId: string): Promise<void>;
}

interface JfItem {
  Id: string;
  Name: string;
  Type: string;
  SeriesName?: string;
  SeriesId?: string;
  SeasonId?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ProductionYear?: number;
  Overview?: string;
  RunTimeTicks?: number;
  ImageTags?: { Primary?: string; Thumb?: string; Backdrop?: string };
  BackdropImageTags?: string[];
  ParentBackdropImageTags?: string[];
  ParentBackdropItemId?: string;
  SeriesPrimaryImageTag?: string;
  ParentPrimaryImageTag?: string;
  CommunityRating?: number;
  Genres?: string[];
  UserData?: {
    Played?: boolean;
    PlayCount?: number;
    PlaybackPositionTicks?: number;
    PlayedPercentage?: number;
  };
  DateCreated?: string;
  PremiereDate?: string;
  ChildCount?: number;
  UnplayedItemCount?: number;
}

export function createEmbyLikeService(opts: EmbyLikeOptions): EmbyLikeService {
  let session: EmbyLikeSession | null = null;
  let authInFlight: Promise<EmbyLikeSession | null> | null = null;
  // Track the most recent progress per active PlaySessionId so stopPlayback can
  // replay ItemId + PositionTicks on /Sessions/Playing/Stopped. Without those,
  // Emby treats the Stopped event as "ended at position 0" and wipes the
  // resume point, even though progress reports saved it seconds earlier.
  const lastProgress = new Map<string, { itemId: string; positionTicks: number }>();

  const authHeader = (token?: string): string =>
    token ? `${AUTH_PREFIX}, Token="${token}"` : AUTH_PREFIX;

  /**
   * Jellyfin accepts both `Authorization` and `X-Emby-Authorization`; Emby only
   * reliably reads the latter. We send both so a single client factory works
   * against either flavour. Post-auth we additionally set `X-Emby-Token` which
   * Emby uses for simple token-passing on most endpoints.
   */
  const clientFor = (baseUrl: string, token?: string): AxiosInstance => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authHeader(token),
      'X-Emby-Authorization': authHeader(token),
    };
    if (token) headers['X-Emby-Token'] = token;
    return axios.create({ baseURL: baseUrl, timeout: 15000, headers });
  };

  const authenticate = async (): Promise<EmbyLikeSession | null> => {
    if (authInFlight) return authInFlight;
    const cfg = opts.getConfig();
    if (!cfg.url || !cfg.username) return null;

    authInFlight = (async () => {
      try {
        const http = clientFor(cfg.url);
        const { data } = await http.post('/Users/AuthenticateByName', {
          Username: cfg.username,
          Pw: cfg.password,
        });
        if (!data?.AccessToken || !data?.User?.Id) {
          console.warn(`[${opts.label}] AuthenticateByName returned no token`);
          return null;
        }
        console.log(`[${opts.label}] Authenticated as ${data.User.Name} (id ${data.User.Id})`);
        return { accessToken: data.AccessToken, userId: data.User.Id };
      } catch (error) {
        console.warn(`[${opts.label}] Auth failed:`, (error as Error).message);
        return null;
      } finally {
        authInFlight = null;
      }
    })();

    return authInFlight;
  };

  const ensureSession = async (forceRefresh = false): Promise<EmbyLikeSession | null> => {
    if (session && !forceRefresh) return session;
    session = await authenticate();
    return session;
  };

  const resetClient = (): void => {
    session = null;
  };

  const authedRequest = async <T>(
    fn: (http: AxiosInstance, s: EmbyLikeSession) => Promise<T>,
  ): Promise<T> => {
    const s = await ensureSession();
    if (!s) throw new Error(`${opts.label} not authenticated`);
    const cfg = opts.getConfig();
    try {
      return await fn(clientFor(cfg.url, s.accessToken), s);
    } catch (error) {
      const status = (error as any)?.response?.status;
      if (status === 401) {
        const fresh = await ensureSession(true);
        if (!fresh) throw error;
        return fn(clientFor(cfg.url, fresh.accessToken), fresh);
      }
      throw error;
    }
  };

  const testConnection = async (): Promise<boolean> => {
    try {
      const s = await ensureSession(true);
      return !!s;
    } catch {
      return false;
    }
  };

  const imageUrl = (itemId: string, tag: string | undefined, type: 'Primary' | 'Backdrop' | 'Thumb' = 'Primary'): string => {
    if (!tag) return '';
    return `${opts.getConfig().url}/Items/${itemId}/Images/${type}?tag=${tag}`;
  };

  const toContentItem = (item: JfItem): ContentItem => {
    const isEpisode = item.Type === 'Episode';
    const isMovie = item.Type === 'Movie';
    const durationMs = (item.RunTimeTicks || 0) / TICKS_PER_MS;
    const positionMs = (item.UserData?.PlaybackPositionTicks || 0) / TICKS_PER_MS;
    const watched = item.UserData?.Played === true;
    const percentage = durationMs > 0 ? Math.round((positionMs / durationMs) * 100) : 0;

    const posterTag = isEpisode
      ? item.SeriesPrimaryImageTag || item.ParentPrimaryImageTag
      : item.ImageTags?.Primary;
    const posterId = isEpisode ? item.SeriesId || item.Id : item.Id;
    const poster = imageUrl(posterId, posterTag, 'Primary');

    const thumbTag = item.ImageTags?.Thumb || item.ImageTags?.Primary;
    const thumbnail = imageUrl(item.Id, thumbTag, item.ImageTags?.Thumb ? 'Thumb' : 'Primary');

    const backdropTag = item.BackdropImageTags?.[0] || item.ParentBackdropImageTags?.[0];
    const backdropId = item.BackdropImageTags?.length ? item.Id : item.ParentBackdropItemId || item.Id;
    const background = imageUrl(backdropId, backdropTag, 'Backdrop');

    return {
      id: `${opts.source}-${item.Id}`,
      type: isEpisode ? 'episode' : isMovie ? 'movie' : 'show',
      title: item.Name,
      showTitle: isEpisode ? item.SeriesName : undefined,
      seasonNumber: isEpisode ? item.ParentIndexNumber : undefined,
      episodeNumber: isEpisode ? item.IndexNumber : undefined,
      summary: item.Overview || '',
      duration: Math.round(durationMs / 1000 / 60),
      artwork: { poster, thumbnail, background },
      source: opts.source,
      sourceId: item.Id,
      status: 'ready',
      progress: {
        watched,
        percentage,
        currentPosition: Math.round(positionMs / 1000),
      },
      availability: {
        availableAt: item.DateCreated || item.PremiereDate || '',
      },
      addedAt: item.DateCreated || item.PremiereDate || '',
      year: item.ProductionYear || 0,
      rating: item.CommunityRating,
      genres: item.Genres || [],
      showRatingKey: isEpisode ? item.SeriesId : undefined,
    };
  };

  const listUsers = async (): Promise<ServerUser[]> => {
    const s = await ensureSession();
    if (!s) return [];
    const cfg = opts.getConfig();
    try {
      const http = clientFor(cfg.url, s.accessToken);
      const { data } = await http.get(`/Users/${s.userId}`);
      return [{
        id: data.Id,
        title: data.Name || cfg.username,
        thumb: data.PrimaryImageTag ? imageUrl(data.Id, data.PrimaryImageTag, 'Primary') : '',
        admin: !!data.Policy?.IsAdministrator,
        hasPassword: false,
        restricted: false,
      }];
    } catch {
      return [{
        id: s.userId,
        title: cfg.username,
        thumb: '',
        admin: false,
        hasPassword: false,
        restricted: false,
      }];
    }
  };

  const cacheKey = (suffix: string): string => `${opts.source}:${suffix}`;

  const getContinueWatching = async (): Promise<ContentItem[]> => {
    const key = cacheKey('continue');
    const cached = getCached<ContentItem[]>(key);
    if (cached) return cached;

    const items = await authedRequest(async (http, s) => {
      const { data } = await http.get(`/Users/${s.userId}/Items/Resume`, {
        params: {
          IncludeItemTypes: 'Episode,Movie',
          Fields: 'PrimaryImageAspectRatio,Overview,UserData,DateCreated,PremiereDate',
          Limit: 50,
        },
      });
      return (data?.Items || []) as JfItem[];
    }).catch((err) => {
      console.warn(`[${opts.label}] getContinueWatching:`, err.message);
      return [] as JfItem[];
    });

    const result = items.map(toContentItem);
    if (result.length > 0) setCached(key, result);
    return result;
  };

  const getOnDeck = async (): Promise<ContentItem[]> => {
    const key = cacheKey('nextup');
    const cached = getCached<ContentItem[]>(key);
    if (cached) return cached;

    const items = await authedRequest(async (http, s) => {
      const { data } = await http.get('/Shows/NextUp', {
        params: {
          UserId: s.userId,
          Fields: 'PrimaryImageAspectRatio,Overview,UserData,DateCreated,PremiereDate',
          Limit: 50,
        },
      });
      return (data?.Items || []) as JfItem[];
    }).catch((err: Error) => {
      console.warn(`[${opts.label}] fetch failed:`, err.message);
      return [] as JfItem[];
    });

    const result = items.map(toContentItem);
    if (result.length > 0) setCached(key, result);
    return result;
  };

  const getRecentlyAdded = async (limit: number): Promise<ContentItem[]> => {
    const key = cacheKey(`recent:${limit}`);
    const cached = getCached<ContentItem[]>(key);
    if (cached) return cached;

    const items = await authedRequest(async (http, s) => {
      const { data } = await http.get(`/Users/${s.userId}/Items/Latest`, {
        params: {
          IncludeItemTypes: 'Episode,Movie',
          Fields: 'PrimaryImageAspectRatio,Overview,UserData,ParentBackdropImageTags,DateCreated,PremiereDate',
          // GroupItems defaults to true, which collapses newly-added episodes
          // into their parent Series — they then come back with Type='Series',
          // get mapped to type:'show', and miss the aggregator's Ready-to-Watch
          // TV filter (which requires type:'episode'). Force individual
          // episodes; aggregator's oneEpisodePerShow collapses dupes downstream.
          GroupItems: false,
          Limit: limit,
        },
      });
      return (Array.isArray(data) ? data : data?.Items || []) as JfItem[];
    }).catch((err: Error) => {
      console.warn(`[${opts.label}] fetch failed:`, err.message);
      return [] as JfItem[];
    });

    const result = items.map(toContentItem);
    if (result.length > 0) setCached(key, result);
    return result;
  };

  const getLibrary = async (type: 'movie' | 'show'): Promise<ContentItem[]> => {
    const jfType = type === 'movie' ? 'Movie' : 'Series';
    const key = cacheKey(`library:${type}`);
    const cached = getCached<ContentItem[]>(key);
    if (cached) return cached;

    const all: JfItem[] = [];
    const pageSize = 500;
    let startIndex = 0;

    while (true) {
      const batch = await authedRequest(async (http, s) => {
        const { data } = await http.get(`/Users/${s.userId}/Items`, {
          params: {
            Recursive: true,
            IncludeItemTypes: jfType,
            Fields: 'PrimaryImageAspectRatio,Overview,UserData,Genres,DateCreated,PremiereDate',
            SortBy: 'SortName',
            SortOrder: 'Ascending',
            StartIndex: startIndex,
            Limit: pageSize,
          },
        });
        return (data?.Items || []) as JfItem[];
      }).catch((err: Error) => {
      console.warn(`[${opts.label}] fetch failed:`, err.message);
      return [] as JfItem[];
    });

      all.push(...batch);
      if (batch.length < pageSize) break;
      startIndex += pageSize;
    }

    const result = all.map(toContentItem);
    if (result.length > 0) setCached(key, result, 600);
    return result;
  };

  const getShowSeasons = async (showId: string): Promise<Season[]> => {
    const items = await authedRequest(async (http, s) => {
      const { data } = await http.get(`/Shows/${showId}/Seasons`, {
        params: { UserId: s.userId, Fields: 'UserData' },
      });
      return (data?.Items || []) as JfItem[];
    }).catch((err: Error) => {
      console.warn(`[${opts.label}] fetch failed:`, err.message);
      return [] as JfItem[];
    });

    return items
      .filter((it) => (it.IndexNumber ?? 0) > 0)
      .map((it) => {
        const count = it.ChildCount || 0;
        const unplayed = it.UnplayedItemCount ?? Math.max(0, count - (it.UserData?.PlayCount || 0));
        return {
          ratingKey: it.Id,
          index: it.IndexNumber ?? 0,
          title: it.Name,
          episodeCount: count,
          watchedCount: Math.max(0, count - unplayed),
          thumb: imageUrl(it.Id, it.ImageTags?.Primary, 'Primary'),
        };
      });
  };

  const getSeasonEpisodes = async (seasonId: string): Promise<ContentItem[]> => {
    const items = await authedRequest(async (http, s) => {
      const { data: seasonData } = await http.get(`/Users/${s.userId}/Items/${seasonId}`);
      const seriesId = seasonData?.SeriesId;
      if (!seriesId) return [] as JfItem[];
      const { data } = await http.get(`/Shows/${seriesId}/Episodes`, {
        params: {
          SeasonId: seasonId,
          UserId: s.userId,
          Fields: 'Overview,UserData,PrimaryImageAspectRatio,DateCreated,PremiereDate',
        },
      });
      return (data?.Items || []) as JfItem[];
    }).catch((err: Error) => {
      console.warn(`[${opts.label}] fetch failed:`, err.message);
      return [] as JfItem[];
    });

    return items.map(toContentItem);
  };

  const search = async (query: string): Promise<ContentItem[]> => {
    const items = await authedRequest(async (http, s) => {
      const { data } = await http.get(`/Users/${s.userId}/Items`, {
        params: {
          SearchTerm: query,
          IncludeItemTypes: 'Movie,Series,Episode',
          Recursive: true,
          Fields: 'Overview,UserData,DateCreated,PremiereDate',
          Limit: 50,
        },
      });
      return (data?.Items || []) as JfItem[];
    }).catch((err: Error) => {
      console.warn(`[${opts.label}] fetch failed:`, err.message);
      return [] as JfItem[];
    });

    return items.map(toContentItem);
  };

  const markWatched = async (itemId: string): Promise<void> => {
    await authedRequest(async (http, s) => {
      await http.post(`/Users/${s.userId}/PlayedItems/${itemId}`);
    });
  };

  const markUnwatched = async (itemId: string): Promise<void> => {
    await authedRequest(async (http, s) => {
      await http.delete(`/Users/${s.userId}/PlayedItems/${itemId}`);
    });
  };

  const getPlaybackInfo = async (itemId: string, playOpts: PlaybackOpts): Promise<PlaybackInfo> => {
    const s = await ensureSession();
    if (!s) throw new Error(`${opts.label} not authenticated`);
    const cfg = opts.getConfig();

    const http = clientFor(cfg.url, s.accessToken);
    const { data: item } = await http.get(`/Users/${s.userId}/Items/${itemId}`);

    // Auto-resume: Plex streams carry `offset=N` which the client rewrites when
    // info.viewOffset > 0; Emby streams carry `StartTimeTicks=N` which the
    // client doesn't know to rewrite, so the adapter has to bake the saved
    // resume position into the URL itself when the client didn't pass one.
    const savedPositionTicks = (item as JfItem).UserData?.PlaybackPositionTicks || 0;
    const requestedTicks = (playOpts.offsetMs || 0) * TICKS_PER_MS;
    const startTicks = requestedTicks > 0 ? requestedTicks : savedPositionTicks;

    const { data: playback } = await http.post(
      `/Items/${itemId}/PlaybackInfo`,
      {
        UserId: s.userId,
        DeviceProfile: {
          MaxStreamingBitrate: (playOpts.maxBitrate || 20000) * 1000,
          MaxStaticBitrate: (playOpts.maxBitrate || 20000) * 1000,
        },
        StartTimeTicks: startTicks,
        MaxStreamingBitrate: (playOpts.maxBitrate || 20000) * 1000,
      },
      { params: { UserId: s.userId } },
    );

    const mediaSource = playback?.MediaSources?.[0];
    const sessionId = playback?.PlaySessionId || `whatson-${opts.source}-${Date.now()}`;

    const streamParams: Record<string, string> = {
      DeviceId: DEVICE_ID,
      MediaSourceId: mediaSource?.Id || itemId,
      PlaySessionId: sessionId,
      api_key: s.accessToken,
      VideoCodec: 'h264',
      AudioCodec: 'aac,mp3',
      Container: 'ts',
      SubtitleMethod: 'Encode',
      MaxStreamingBitrate: String((playOpts.maxBitrate || 20000) * 1000),
      StartTimeTicks: String(startTicks),
    };
    if (playOpts.subtitleStreamID != null) streamParams.SubtitleStreamIndex = String(playOpts.subtitleStreamID);
    if (playOpts.audioStreamID != null) streamParams.AudioStreamIndex = String(playOpts.audioStreamID);

    const streamUrl = axios.getUri({
      url: `${cfg.url}/Videos/${itemId}/master.m3u8`,
      params: streamParams,
    });

    const directPlayUrl = mediaSource?.Path
      ? `${cfg.url}/Videos/${itemId}/stream?api_key=${s.accessToken}&static=true&mediaSourceId=${mediaSource.Id}`
      : null;

    const subtitles = (mediaSource?.MediaStreams || [])
      .filter((st: any) => st.Type === 'Subtitle')
      .map((st: any, i: number) => ({
        id: st.Index ?? i,
        index: st.Index ?? i,
        language: st.Language || 'Unknown',
        title: st.DisplayTitle || st.Language || `Subtitle ${i + 1}`,
        selected: st.IsDefault === true,
      }));

    const audioTracks = (mediaSource?.MediaStreams || [])
      .filter((st: any) => st.Type === 'Audio')
      .map((st: any, i: number) => ({
        id: st.Index ?? i,
        index: st.Index ?? i,
        language: st.Language || 'Unknown',
        title: st.DisplayTitle || st.Language || `Audio ${i + 1}`,
        selected: st.IsDefault === true,
      }));

    return {
      streamUrl,
      directPlayUrl,
      sessionId,
      title: item.SeriesName ? `${item.SeriesName} - ${item.Name}` : item.Name,
      showTitle: item.SeriesName || null,
      episodeTitle: item.SeriesName ? item.Name : null,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber,
      duration: (item.RunTimeTicks || 0) / TICKS_PER_MS,
      viewOffset: startTicks / TICKS_PER_MS,
      subtitles,
      audioTracks,
      markers: [],
      serverUrl: cfg.url,
    };
  };

  const reportProgress = async (
    itemId: string,
    timeMs: number,
    _durationMs: number,
    state: string,
    sessionId: string,
  ): Promise<void> => {
    const s = await ensureSession();
    if (!s) return;
    const positionTicks = Math.max(0, Math.floor(timeMs * TICKS_PER_MS));
    lastProgress.set(sessionId, { itemId, positionTicks });
    const cfg = opts.getConfig();
    const http = clientFor(cfg.url, s.accessToken);
    await http.post('/Sessions/Playing/Progress', {
      ItemId: itemId,
      PlaySessionId: sessionId,
      PositionTicks: positionTicks,
      IsPaused: state === 'paused',
      PlayMethod: 'Transcode',
      EventName: 'timeupdate',
    }).catch(() => {});
  };

  const stopPlayback = async (sessionId: string): Promise<void> => {
    const s = await ensureSession();
    if (!s) return;
    const cfg = opts.getConfig();
    const http = clientFor(cfg.url, s.accessToken);
    const last = lastProgress.get(sessionId);
    const body: Record<string, unknown> = { PlaySessionId: sessionId };
    if (last) {
      body.ItemId = last.itemId;
      body.PositionTicks = last.positionTicks;
    }
    await http.post('/Sessions/Playing/Stopped', body).catch(() => {});
    lastProgress.delete(sessionId);
  };

  return {
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
  };
}

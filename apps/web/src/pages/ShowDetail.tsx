import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContentItem } from '@whatson/shared';
import { api, resolveArtworkUrl } from '@/lib/api';
import { SourceBadge } from '@/components/SourceBadge';
import { DetailSheet } from '@/components/DetailSheet';

// Show detail page — seasons picker + episode list. Mirrors the
// mobile/show-detail.tsx UI at a high level. Navigated to from
// DetailSheet's "Go to Show" button when viewing an episode.
//
// URL: /show/:source/:ratingKey?title=...&poster=...&backdrop=...&summary=...
//
// Show metadata that's hard to fetch generically across servers (poster,
// summary, year) is passed via URL params from the episode that
// triggered the navigation — instant render without waiting on a
// separate show GET. Seasons + episodes are fetched.

export default function ShowDetail() {
  const { source = 'plex', ratingKey = '' } = useParams<{ source: string; ratingKey: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const showTitle = search.get('title') || 'Show';
  const showPoster = search.get('poster') || '';
  const showBackdrop = search.get('backdrop') || showPoster;
  const showSummary = search.get('summary') || '';
  const showYear = search.get('year') || '';
  const showSourceId = search.get('sourceId') || ratingKey;

  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<ContentItem | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const seasonsQ = useQuery({
    queryKey: ['show-seasons', source, ratingKey],
    queryFn: () => api.getShowSeasons(ratingKey, source),
    enabled: !!ratingKey,
  });

  // Auto-select the first season once they load. Episodes only fetch
  // when selectedSeason is set.
  useEffect(() => {
    if (!selectedSeason && seasonsQ.data && seasonsQ.data.length > 0) {
      setSelectedSeason(seasonsQ.data[0].ratingKey);
    }
  }, [seasonsQ.data, selectedSeason]);

  const episodesQ = useQuery({
    queryKey: ['season-episodes', source, selectedSeason],
    queryFn: () => api.getSeasonEpisodes(selectedSeason!, source),
    enabled: !!selectedSeason,
  });

  async function withWork(label: string, fn: () => Promise<unknown>) {
    setWorking(label);
    try {
      await fn();
      // Invalidate seasons + episodes so progress / watched state
      // refreshes after a mark-all action.
      queryClient.invalidateQueries({ queryKey: ['show-seasons', source, ratingKey] });
      queryClient.invalidateQueries({ queryKey: ['season-episodes', source] });
    } catch (e) {
      alert(`${label} failed: ${(e as Error).message}`);
    } finally {
      setWorking(null);
    }
  }
  function markAllWatched() {
    withWork('Mark all watched', () => api.markAllWatched(showTitle, source, showSourceId));
  }
  function markAllUnwatched() {
    withWork('Mark all unwatched', () => api.markAllUnwatched(showSourceId, source));
  }

  return (
    <div>
      {/* Backdrop */}
      {showBackdrop && (
        <div className="relative h-72 overflow-hidden -mt-px">
          <img
            src={resolveArtworkUrl(showBackdrop) || ''}
            alt=""
            className="w-full h-full object-cover opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
        </div>
      )}

      <div className="px-6 -mt-32 relative">
        <button
          onClick={() => navigate(-1)}
          className="mb-4 text-sm text-text-secondary hover:text-text"
        >
          ← Back
        </button>

        <div className="flex gap-6">
          {showPoster && (
            <img
              src={resolveArtworkUrl(showPoster) || ''}
              alt={showTitle}
              className="w-[200px] h-[300px] rounded shadow-2xl shrink-0"
            />
          )}
          <div className="flex-1 min-w-0 pt-4">
            <h1 className="text-3xl font-bold mb-2">{showTitle}</h1>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <SourceBadge source={source as ContentItem['source']} />
              {showYear && <span className="text-sm text-text-muted">{showYear}</span>}
            </div>
            {showSummary && (
              <p className="text-text leading-relaxed mb-4 max-w-3xl">{showSummary}</p>
            )}

            <div className="flex flex-wrap gap-2">
              <Btn onClick={markAllWatched}>Mark All Watched</Btn>
              <Btn onClick={markAllUnwatched}>Mark All Unwatched</Btn>
              {working && (
                <span className="self-center text-sm text-text-muted">{working}…</span>
              )}
            </div>
          </div>
        </div>

        {/* Seasons + episodes */}
        <div className="mt-8 flex gap-6">
          {/* Seasons sidebar */}
          <div className="w-56 shrink-0">
            <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-3">
              Seasons
            </h2>
            {seasonsQ.isLoading ? (
              <p className="text-text-muted text-sm">Loading…</p>
            ) : seasonsQ.error ? (
              <p className="text-red-400 text-sm">{(seasonsQ.error as Error).message}</p>
            ) : (seasonsQ.data || []).length === 0 ? (
              <p className="text-text-muted text-sm">No seasons.</p>
            ) : (
              <ul className="space-y-1">
                {(seasonsQ.data || []).map((s) => (
                  <li key={s.ratingKey}>
                    <button
                      onClick={() => setSelectedSeason(s.ratingKey)}
                      className={[
                        'w-full text-left px-3 py-2 rounded text-sm transition-colors',
                        selectedSeason === s.ratingKey
                          ? 'bg-primary text-black font-semibold'
                          : 'hover:bg-surface text-text',
                      ].join(' ')}
                    >
                      <div>{s.title || `Season ${s.index}`}</div>
                      <div
                        className={[
                          'text-xs mt-0.5',
                          selectedSeason === s.ratingKey
                            ? 'text-black/70'
                            : 'text-text-muted',
                        ].join(' ')}
                      >
                        {s.watchedCount} / {s.episodeCount} watched
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Episodes list */}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-3">
              Episodes
            </h2>
            {!selectedSeason ? (
              <p className="text-text-muted text-sm">Pick a season.</p>
            ) : episodesQ.isLoading ? (
              <p className="text-text-muted text-sm">Loading…</p>
            ) : episodesQ.error ? (
              <p className="text-red-400 text-sm">{(episodesQ.error as Error).message}</p>
            ) : (episodesQ.data || []).length === 0 ? (
              <p className="text-text-muted text-sm">No episodes.</p>
            ) : (
              <ul className="space-y-2">
                {(episodesQ.data || []).map((ep) => (
                  <li key={ep.id}>
                    <EpisodeRow episode={ep} onClick={() => setSelectedEpisode(ep)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="h-12" />
      </div>

      {selectedEpisode && (
        <DetailSheet item={selectedEpisode} onClose={() => setSelectedEpisode(null)} />
      )}
    </div>
  );
}

function EpisodeRow({ episode, onClick }: { episode: ContentItem; onClick: () => void }) {
  const epLabel =
    episode.episodeNumber != null
      ? `E${String(episode.episodeNumber).padStart(2, '0')}`
      : '';
  const thumb = resolveArtworkUrl(episode.artwork?.thumbnail || episode.artwork?.poster);
  const pct = episode.progress?.percentage ?? 0;
  const watched = episode.progress?.watched === true;
  return (
    <button
      onClick={onClick}
      className="w-full flex gap-3 p-2 rounded hover:bg-surface text-left transition-colors group"
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          className="w-40 h-24 object-cover rounded shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="w-40 h-24 bg-surface rounded shrink-0" />
      )}
      <div className="flex-1 min-w-0 py-1">
        <div className="flex items-baseline gap-2">
          {epLabel && (
            <span className="text-xs font-semibold text-text-secondary">{epLabel}</span>
          )}
          <span className="font-semibold group-hover:text-primary transition-colors truncate">
            {episode.title}
          </span>
          {watched && (
            <span className="text-xs text-primary shrink-0">✓ Watched</span>
          )}
        </div>
        {episode.summary && (
          <p className="text-sm text-text-muted mt-1 line-clamp-2">{episode.summary}</p>
        )}
        {!watched && pct > 0 && (
          <div className="mt-2 h-1 bg-card-border rounded overflow-hidden max-w-md">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        )}
      </div>
    </button>
  );
}

function Btn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded font-semibold bg-card-border text-text hover:bg-surface-hover transition-colors"
    >
      {children}
    </button>
  );
}

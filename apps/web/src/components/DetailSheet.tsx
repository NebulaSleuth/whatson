import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ContentItem } from '@whatson/shared';
import { api, resolveArtworkUrl } from '@/lib/api';
import { SourceBadge } from './SourceBadge';
import { VideoPlayer } from './VideoPlayer';

interface Props {
  item: ContentItem;
  onClose: () => void;
}

export function DetailSheet({ item, onClose }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [playing, setPlaying] = useState(false);
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !playing) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose, playing]);

  const poster = resolveArtworkUrl(item.artwork?.poster);
  const backdrop = resolveArtworkUrl(item.artwork?.background) || poster;
  const episodeLabel =
    item.type === 'episode' && item.seasonNumber != null && item.episodeNumber != null
      ? `S${String(item.seasonNumber).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')}`
      : null;
  const subtitle = item.showTitle ? item.title : null;
  const meta: string[] = [];
  if (episodeLabel) meta.push(episodeLabel);
  if (item.year) meta.push(String(item.year));
  if (item.duration) meta.push(`${item.duration} min`);
  if (item.rating) meta.push(`★ ${item.rating.toFixed(1)}`);

  const isLibraryItem = item.source === 'plex' || item.source === 'jellyfin' || item.source === 'emby';
  const isLiveItem = item.source === 'live';
  const isTrackedItem = item.id.startsWith('tracked-');
  const isDiscoveryItem = item.id.startsWith('tmdb-') || item.source === 'sonarr' || item.source === 'radarr';
  const isTvShow = item.type === 'episode' || item.type === 'show';

  async function withWork(label: string, fn: () => Promise<unknown>) {
    setWorking(label);
    try {
      await fn();
      queryClient.invalidateQueries();
      onClose();
    } catch (e) {
      alert(`${label} failed: ${(e as Error).message}`);
    } finally {
      setWorking(null);
    }
  }

  function play() {
    setPlaying(true);
  }
  function markWatched() {
    withWork('Mark watched', () => api.markWatched(item.sourceId, item.source, item.id));
  }
  function markUnwatched() {
    withWork('Mark unwatched', () => api.markUnwatched(item.sourceId, item.source));
  }
  function showIdForMarkAll(): string {
    // For episodes, the parent show's id; for show-type items, sourceId itself.
    return item.showRatingKey || item.sourceId;
  }
  function markAllWatched() {
    withWork('Mark all watched', () =>
      api.markAllWatched(item.showTitle || item.title, item.source, showIdForMarkAll()),
    );
  }
  function markAllUnwatched() {
    withWork('Mark all unwatched', () =>
      api.markAllUnwatched(showIdForMarkAll(), item.source),
    );
  }
  function removeTracked() {
    const id = parseInt(item.sourceId, 10);
    if (!Number.isFinite(id)) return;
    if (!confirm(`Remove "${item.title}" from your watchlist?`)) return;
    withWork('Remove from watchlist', () => api.removeTracked(id));
  }
  function addToSonarr() {
    const id = parseInt(item.sourceId, 10);
    if (!Number.isFinite(id)) return;
    withWork('Add to Sonarr', () => api.addToSonarr(id));
  }
  function addToRadarr() {
    const id = parseInt(item.sourceId, 10);
    if (!Number.isFinite(id)) return;
    withWork('Add to Radarr', () => api.addToRadarr(id));
  }
  function goToShow() {
    // Navigate to the show-detail page. We pass the show's display
    // metadata via query params so it renders instantly before the
    // seasons fetch completes. The show ratingKey is showRatingKey
    // for episodes, or sourceId when we're already looking at a
    // show-typed item.
    const showKey = item.showRatingKey || item.sourceId;
    if (!showKey) return;
    const params = new URLSearchParams({
      title: item.showTitle || item.title,
      sourceId: showKey,
    });
    if (item.artwork?.poster) params.set('poster', item.artwork.poster);
    if (item.artwork?.background) params.set('backdrop', item.artwork.background);
    if (item.summary) params.set('summary', item.summary);
    if (item.year) params.set('year', String(item.year));
    onClose();
    navigate(`/show/${item.source}/${encodeURIComponent(showKey)}?${params.toString()}`);
  }

  if (playing) {
    return <VideoPlayer item={item} onClose={() => setPlaying(false)} />;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div
        className="relative bg-surface border border-card-border rounded-lg shadow-2xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {backdrop && (
          <div className="relative h-64 overflow-hidden rounded-t-lg">
            <img src={backdrop} alt="" className="w-full h-full object-cover opacity-50" />
            <div className="absolute inset-0 bg-gradient-to-t from-surface to-transparent" />
          </div>
        )}

        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white text-xl z-10"
        >
          ×
        </button>

        <div className="p-6 flex gap-6">
          {poster && (
            <img src={poster} alt={item.title} className="w-[180px] h-[270px] rounded shadow-lg shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold mb-1">{item.showTitle || item.title}</h1>
            {subtitle && <p className="text-text-secondary mb-2">{subtitle}</p>}

            <div className="flex flex-wrap items-center gap-2 mb-3">
              <SourceBadge source={item.source} />
              {item.availability?.network && (
                <span className="bg-card-border text-xs font-semibold px-2 py-0.5 rounded text-text-secondary">
                  {item.availability.network}
                </span>
              )}
              {meta.length > 0 && (
                <span className="text-sm text-text-muted">{meta.join(' · ')}</span>
              )}
            </div>

            {(item.progress?.percentage ?? 0) > 0 && (
              <div className="mb-4">
                <p className="text-xs text-text-muted mb-1">
                  {item.progress.percentage.toFixed(1)}% {isLiveItem ? 'complete' : 'watched'}
                </p>
                <div className="h-1.5 bg-card-border rounded overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${Math.min(item.progress.percentage, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {item.summary && <p className="text-text leading-relaxed mb-4">{item.summary}</p>}

            <div className="flex flex-wrap gap-2 mt-4">
              {isLibraryItem && (
                <Btn primary onClick={play}>Play</Btn>
              )}
              {isLibraryItem && item.type === 'episode' && (item.showRatingKey || item.showTitle) && (
                <Btn onClick={goToShow}>Go to Show</Btn>
              )}
              {isLibraryItem && !isLiveItem && item.type !== 'show' && !item.progress?.watched && (
                <Btn onClick={markWatched}>Mark as Watched</Btn>
              )}
              {isLibraryItem && !isLiveItem && item.type !== 'show' && item.progress?.watched && (
                <Btn onClick={markUnwatched}>Mark as Unwatched</Btn>
              )}
              {isLibraryItem && !isLiveItem && isTvShow && (
                <Btn onClick={markAllWatched}>Mark All Watched</Btn>
              )}
              {isTrackedItem && isTvShow && (
                <Btn onClick={markAllUnwatched}>Mark All Unwatched</Btn>
              )}
              {isDiscoveryItem && item.type !== 'movie' && (
                <Btn primary onClick={addToSonarr}>Add to Sonarr</Btn>
              )}
              {isDiscoveryItem && item.type === 'movie' && (
                <Btn primary onClick={addToRadarr}>Add to Radarr</Btn>
              )}
              {isTrackedItem && (
                <Btn danger onClick={removeTracked}>Remove from Watchlist</Btn>
              )}
              {working && <span className="self-center text-sm text-text-muted">{working}…</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Btn({
  children,
  onClick,
  primary,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  let cls = 'px-4 py-2 rounded font-semibold transition-colors ';
  if (primary) cls += 'bg-primary text-black hover:bg-primary/90';
  else if (danger) cls += 'bg-red-600/20 text-red-400 border border-red-600/40 hover:bg-red-600/30';
  else cls += 'bg-card-border text-text hover:bg-surface-hover';
  return (
    <button onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

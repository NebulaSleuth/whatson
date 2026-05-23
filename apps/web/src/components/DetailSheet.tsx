import { useEffect } from 'react';
import type { ContentItem } from '@whatson/shared';
import { resolveArtworkUrl } from '@/lib/api';

interface Props {
  item: ContentItem;
  onClose: () => void;
}

export function DetailSheet({ item, onClose }: Props) {
  // Esc closes the sheet.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
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
          className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white text-xl"
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
            {meta.length > 0 && (
              <p className="text-sm text-text-muted mb-4">{meta.join(' · ')}</p>
            )}
            {item.summary && <p className="text-text leading-relaxed mb-4">{item.summary}</p>}

            <div className="flex flex-wrap gap-2 mt-6">
              {(item.source === 'plex' || item.source === 'jellyfin' || item.source === 'emby') && (
                <button className="bg-primary text-black px-4 py-2 rounded font-semibold hover:bg-primary/90">
                  Play
                </button>
              )}
              <div className="text-xs text-text-muted self-center ml-auto">
                {item.source.toUpperCase()} · {item.id}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

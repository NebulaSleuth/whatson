import type { ContentItem } from '@whatson/shared';
import { resolveArtworkUrl } from '@/lib/api';

interface Props {
  item: ContentItem;
  onClick?: (item: ContentItem) => void;
}

const SOURCE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  plex: { bg: 'bg-primary', text: 'text-black', label: 'PLEX' },
  jellyfin: { bg: 'bg-purple-600', text: 'text-white', label: 'JELLY' },
  emby: { bg: 'bg-green-600', text: 'text-white', label: 'EMBY' },
};

export function PosterCard({ item, onClick }: Props) {
  const poster = resolveArtworkUrl(item.artwork?.poster);
  const badge = SOURCE_BADGE[item.source];
  const progress = item.progress?.percentage ?? 0;
  const watched = item.progress?.watched === true;
  const showProgress = !watched && progress > 0 && progress < 100;

  return (
    <button
      type="button"
      onClick={() => onClick?.(item)}
      className="relative w-[180px] shrink-0 text-left group focus:outline-none"
    >
      <div className="relative w-[180px] h-[270px] rounded overflow-hidden bg-surface border-2 border-transparent group-hover:border-primary group-focus:border-primary transition-colors">
        {poster ? (
          <img
            src={poster}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted text-xs">
            No artwork
          </div>
        )}

        {badge && (
          <span
            className={[
              'absolute top-1.5 left-1.5 px-2 py-0.5 text-[10px] font-bold rounded',
              badge.bg,
              badge.text,
            ].join(' ')}
          >
            {badge.label}
          </span>
        )}

        {watched && <div className="absolute inset-0 bg-black/50" />}

        {showProgress && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60">
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        )}
      </div>
      <div className="mt-2 text-sm text-text-secondary group-hover:text-text truncate">
        {item.showTitle || item.title}
      </div>
    </button>
  );
}

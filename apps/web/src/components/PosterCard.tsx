import type { ContentItem } from '@whatson/shared';
import { resolveArtworkUrl } from '@/lib/api';

interface Props {
  item: ContentItem;
  onClick?: (item: ContentItem) => void;
}

// Source colours mirror apps/mobile/constants/theme.ts.
const SOURCE_BADGE: Record<string, { style: React.CSSProperties; label: string }> = {
  plex: { style: { backgroundColor: '#E5A00D', color: '#000' }, label: 'PLEX' },
  jellyfin: { style: { backgroundColor: '#AA5CC3', color: '#FFF' }, label: 'JELLY' },
  emby: { style: { backgroundColor: '#4CAF50', color: '#FFF' }, label: 'EMBY' },
  sonarr: { style: { backgroundColor: '#35C5F4', color: '#000' }, label: 'SONARR' },
  radarr: { style: { backgroundColor: '#FFC230', color: '#000' }, label: 'RADARR' },
  live: { style: { backgroundColor: '#4CAF50', color: '#000' }, label: 'LIVE TV' },
};

// Mirrors apps/mobile/components/ContentCard.tsx → formatAvailableDate.
// Shows the time when the event is today, "Tomorrow" for +1, a short
// weekday for the next week, and an explicit month/day past that.
function formatAvailableDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((dateLocal.getTime() - todayLocal.getTime()) / (1000 * 60 * 60 * 24));
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 0) return time;
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays > 1 && diffDays <= 7) return date.toLocaleDateString([], { weekday: 'short' });
  if (diffDays > 7) return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  if (diffDays === -1) return 'Yesterday';
  if (diffDays >= -6) return 'Last ' + date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

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
      <div className="relative w-[180px] h-[270px] rounded-lg overflow-hidden bg-surface border-2 border-transparent group-hover:border-primary group-focus:border-primary transition-colors">
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
            className="absolute top-1.5 left-1.5 px-2 py-0.5 text-[10px] font-bold rounded"
            style={badge.style}
          >
            {badge.label}
          </span>
        )}

        {watched && <div className="absolute inset-0 bg-black/50" />}

        {/* Status overlay — coming-soon date, downloading state, or
            live-airing time. Mirrors the mobile ContentCard overlay. */}
        {item.status === 'downloading' && (
          <div className="absolute bottom-0 left-0 right-0 bg-black/75 py-1 text-center">
            <span className="text-[11px] font-bold text-cyan-400">Downloading</span>
          </div>
        )}
        {item.status === 'coming_soon' && item.availability?.availableAt && (
          <div className="absolute bottom-0 left-0 right-0 bg-black/75 py-1 text-center">
            <span className="text-[11px] font-bold text-primary">
              {formatAvailableDate(item.availability.availableAt)}
            </span>
          </div>
        )}
        {item.status === 'ready' && item.source === 'live' && item.availability?.availableAt && (
          <div className="absolute bottom-0 left-0 right-0 bg-black/75 py-1 text-center">
            <span className="text-[11px] font-bold text-primary">
              {formatAvailableDate(item.availability.availableAt)}
            </span>
          </div>
        )}

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

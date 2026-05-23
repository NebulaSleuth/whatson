import type { ContentItem } from '@whatson/shared';

const SOURCE_STYLES: Record<string, { style: React.CSSProperties; label: string }> = {
  plex: { style: { backgroundColor: '#E5A00D', color: '#000' }, label: 'PLEX' },
  jellyfin: { style: { backgroundColor: '#AA5CC3', color: '#FFF' }, label: 'JELLYFIN' },
  emby: { style: { backgroundColor: '#00A4DC', color: '#FFF' }, label: 'EMBY' },
  sonarr: { style: { backgroundColor: '#35C5F4', color: '#000' }, label: 'SONARR' },
  radarr: { style: { backgroundColor: '#FFC230', color: '#000' }, label: 'RADARR' },
  live: { style: { backgroundColor: '#4CAF50', color: '#000' }, label: 'LIVE TV' },
};

export function SourceBadge({ source }: { source: ContentItem['source'] }) {
  const cfg = SOURCE_STYLES[source];
  if (!cfg) return null;
  return (
    <span
      className="inline-block px-2 py-0.5 text-[10px] font-bold rounded tracking-wide"
      style={cfg.style}
    >
      {cfg.label}
    </span>
  );
}

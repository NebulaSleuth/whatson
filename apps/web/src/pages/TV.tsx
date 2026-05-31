import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContentItem, ContentSection } from '@whatson/shared';
import { api } from '@/lib/api';
import { Shelf } from '@/components/Shelf';
import { DetailSheet } from '@/components/DetailSheet';

function trackedShowToContentItem(t: Awaited<ReturnType<typeof api.getAllTrackedTv>>[number]): ContentItem {
  return {
    id: t.id,
    type: 'show',
    title: t.title,
    summary: t.overview ?? '',
    duration: 0,
    artwork: { poster: t.poster, thumbnail: t.backdrop || t.poster, background: t.backdrop || t.poster },
    source: 'live' as any,
    sourceId: String(t.tmdbId),
    status: 'ready' as any,
    progress: { watched: false, percentage: 0, currentPosition: 0 },
    availability: { availableAt: t.addedAt, network: t.provider },
    addedAt: t.addedAt,
    year: t.year ?? 0,
    rating: t.rating,
    genres: [],
  };
}

export default function TV() {
  const [selected, setSelected] = useState<ContentItem | null>(null);
  const recent = useQuery({ queryKey: ['tv', 'recent'], queryFn: api.getTvRecent });
  const recentlyDownloaded = useQuery({ queryKey: ['tv', 'recently-downloaded'], queryFn: api.getTvRecentlyDownloaded });
  const upcoming = useQuery({ queryKey: ['tv', 'upcoming'], queryFn: () => api.getTvUpcoming(7) });
  const downloading = useQuery({ queryKey: ['tv', 'downloading'], queryFn: api.getTvDownloading });
  const tracked = useQuery({ queryKey: ['tracked', 'tv', 'all'], queryFn: api.getAllTrackedTv });

  const sections = useMemo<ContentSection[]>(() => {
    const out: ContentSection[] = [];
    const dl = downloading.data ?? [];
    if (dl.length > 0) out.push({ id: 'tv-downloading', title: 'Downloading', type: 'tv', items: dl, sortOrder: 0 });
    const ready = (recent.data ?? []).filter((i) => !i.progress.watched);
    if (ready.length > 0) out.push({ id: 'tv-ready', title: 'Ready to Watch', type: 'tv', items: ready, sortOrder: 1 });
    const recentDl = recentlyDownloaded.data ?? [];
    if (recentDl.length > 0) out.push({ id: 'tv-recently-downloaded', title: 'Recently Downloaded', type: 'tv', items: recentDl, sortOrder: 2 });
    const coming = upcoming.data ?? [];
    if (coming.length > 0) out.push({ id: 'tv-coming', title: 'Coming Soon', type: 'tv', items: coming, sortOrder: 3 });
    const trackedItems = (tracked.data ?? []).slice().sort((a, b) => a.title.localeCompare(b.title)).map(trackedShowToContentItem);
    if (trackedItems.length > 0) out.push({ id: 'tv-tracked', title: 'Tracked', type: 'tv', items: trackedItems, sortOrder: 4 });
    return out;
  }, [recent.data, recentlyDownloaded.data, upcoming.data, downloading.data, tracked.data]);

  const isLoading = recent.isLoading || upcoming.isLoading;

  if (isLoading) {
    return (
      <div className="px-6 py-10 space-y-6">
        {[0, 1].map((i) => (
          <div key={i}>
            <div className="h-5 w-48 bg-surface rounded mb-3 animate-pulse" />
            <div className="flex gap-4 overflow-hidden">
              {Array.from({ length: 6 }).map((_, j) => (
                <div key={j} className="w-[180px] h-[270px] rounded bg-surface animate-pulse" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="py-6">
      {sections.length === 0 ? (
        <p className="px-6 text-text-muted">Nothing to show yet.</p>
      ) : (
        sections.map((s) => <Shelf key={s.id} section={s} onItemClick={setSelected} />)
      )}
      {selected && <DetailSheet item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

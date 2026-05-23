import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContentItem, ContentSection } from '@whatson/shared';
import { api } from '@/lib/api';
import { Shelf } from '@/components/Shelf';
import { DetailSheet } from '@/components/DetailSheet';

export default function Movies() {
  const [selected, setSelected] = useState<ContentItem | null>(null);
  const recent = useQuery({ queryKey: ['movies', 'recent'], queryFn: api.getMoviesRecent });
  const upcoming = useQuery({ queryKey: ['movies', 'upcoming'], queryFn: () => api.getMoviesUpcoming(30) });
  const downloading = useQuery({ queryKey: ['movies', 'downloading'], queryFn: api.getMoviesDownloading });

  const sections = useMemo<ContentSection[]>(() => {
    const out: ContentSection[] = [];
    const dl = downloading.data ?? [];
    if (dl.length > 0) out.push({ id: 'mv-downloading', title: 'Downloading', type: 'movie', items: dl, sortOrder: 0 });
    const ready = (recent.data ?? []).filter((i) => !i.progress.watched);
    if (ready.length > 0) out.push({ id: 'mv-ready', title: 'Ready to Watch', type: 'movie', items: ready, sortOrder: 1 });
    const coming = upcoming.data ?? [];
    if (coming.length > 0) out.push({ id: 'mv-coming', title: 'Coming Soon', type: 'movie', items: coming, sortOrder: 2 });
    return out;
  }, [recent.data, upcoming.data, downloading.data]);

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

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContentItem } from '@whatson/shared';
import { api } from '@/lib/api';
import { Shelf } from '@/components/Shelf';
import { DetailSheet } from '@/components/DetailSheet';

export default function Home() {
  const [selected, setSelected] = useState<ContentItem | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['home'],
    queryFn: () => api.getHome(),
  });

  if (isLoading) {
    return (
      <div className="px-6 py-10 space-y-6">
        {[0, 1, 2].map((i) => (
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

  if (error) {
    return (
      <div className="px-6 py-10">
        <div className="bg-surface border border-card-border rounded p-6">
          <h2 className="text-lg font-semibold mb-2">Couldn't load home</h2>
          <p className="text-text-muted">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  const sections = data?.sections ?? [];
  if (sections.length === 0) {
    return (
      <div className="px-6 py-10 text-center text-text-muted">
        <p className="text-lg">Nothing to show yet.</p>
        <p className="text-sm mt-2">
          Configure your media servers from{' '}
          <a className="text-primary underline" href="/setup">
            /setup
          </a>{' '}
          to populate Home.
        </p>
      </div>
    );
  }

  return (
    <div className="py-6">
      {sections.map((s) => (
        <Shelf key={s.id} section={s} onItemClick={setSelected} />
      ))}
      {selected && <DetailSheet item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

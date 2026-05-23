import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ContentItem } from '@whatson/shared';
import { api } from '@/lib/api';
import { Grid } from '@/components/Grid';
import { DetailSheet } from '@/components/DetailSheet';

type Mode = 'library' | 'discover';
type Filter = 'all' | 'tv' | 'movie';

export default function Search() {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [mode, setMode] = useState<Mode>('library');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<ContentItem | null>(null);

  const lib = useQuery({
    queryKey: ['search', 'library', submitted, filter],
    queryFn: () => api.searchLibrary(submitted, filter === 'all' ? undefined : filter),
    enabled: mode === 'library' && submitted.length > 0,
  });

  const discover = useQuery({
    queryKey: ['search', 'discover', submitted],
    queryFn: () => api.searchDiscover(submitted),
    enabled: mode === 'discover' && submitted.length > 0,
  });

  return (
    <div className="py-6">
      <div className="px-6 mb-4">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setSubmitted(query.trim());
          }}
          placeholder={mode === 'library' ? 'Search your library…' : 'Search shows & movies to track…'}
          className="w-full max-w-2xl bg-surface border border-card-border rounded px-4 py-3 text-text focus:outline-none focus:border-primary"
        />
      </div>
      <div className="flex items-center gap-2 px-6 mb-6">
        <Pill on={mode === 'library'} onClick={() => setMode('library')}>My Library</Pill>
        <Pill on={mode === 'discover'} onClick={() => setMode('discover')}>Discover &amp; Track</Pill>
        {mode === 'library' && (
          <>
            <span className="mx-3 w-px h-6 bg-card-border" />
            <Pill on={filter === 'all'} onClick={() => setFilter('all')}>All</Pill>
            <Pill on={filter === 'tv'} onClick={() => setFilter('tv')}>TV Shows</Pill>
            <Pill on={filter === 'movie'} onClick={() => setFilter('movie')}>Movies</Pill>
          </>
        )}
      </div>

      {submitted.length === 0 ? (
        <p className="px-6 text-text-muted">
          {mode === 'library' ? 'Type to search your library.' : 'Search to find shows & movies to track.'}
        </p>
      ) : mode === 'library' ? (
        lib.isLoading ? (
          <p className="px-6 text-text-muted">Searching…</p>
        ) : (
          <Grid items={lib.data?.items ?? []} onItemClick={setSelected} emptyMessage="No matches." />
        )
      ) : discover.isLoading ? (
        <p className="px-6 text-text-muted">Searching…</p>
      ) : (
        <DiscoverGrid items={discover.data ?? []} />
      )}
      {selected && <DetailSheet item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-4 py-2 rounded-full text-sm font-semibold transition-colors',
        on ? 'bg-primary text-black' : 'bg-surface text-text-secondary hover:text-text',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function DiscoverGrid({ items }: { items: Awaited<ReturnType<typeof api.searchDiscover>> }) {
  if (items.length === 0) return <p className="px-6 text-text-muted">No matches.</p>;
  return (
    <div className="grid gap-4 px-6 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
      {items.map((it) => (
        <div key={it.id} className="w-[180px]">
          <div className="w-[180px] h-[270px] rounded overflow-hidden bg-surface border-2 border-transparent hover:border-primary transition-colors">
            {it.poster ? (
              <img src={it.poster} alt={it.title} className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-text-muted text-xs">
                No artwork
              </div>
            )}
          </div>
          <div className="mt-2 text-sm text-text-secondary truncate">{it.title}</div>
          <div className="text-xs text-text-muted">
            {it.type === 'tv' ? 'TV' : 'Movie'} {it.year ? `· ${it.year}` : ''}
            {it.isTracked ? ' · Tracked' : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

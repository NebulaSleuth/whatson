import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { ContentItem } from '@whatson/shared';
import { api } from '@/lib/api';
import { Grid } from '@/components/Grid';
import { DetailSheet } from '@/components/DetailSheet';

type LibType = 'show' | 'movie';
type LibSource = 'plex' | 'jellyfin' | 'emby';
type SortField = 'alpha' | 'added' | 'release' | 'watched' | 'ready';
type SortDir = 'asc' | 'desc';

const SORT_LABELS: Record<SortField, string> = {
  alpha: 'A-Z',
  added: 'Date Added',
  release: 'Release Year',
  watched: 'Last Watched',
  ready: 'Ready to Watch',
};

function parseSort(raw: string | null): SortField {
  if (raw === 'added' || raw === 'release' || raw === 'watched' || raw === 'ready' || raw === 'alpha') return raw;
  return 'alpha';
}

export default function Library() {
  const [params] = useSearchParams();
  const initialType: LibType = params.get('type') === 'movie' ? 'movie' : 'show';
  const initialSort: SortField = parseSort(params.get('sort'));
  const initialDir: SortDir =
    initialSort === 'added' || initialSort === 'watched' || initialSort === 'ready' ? 'desc' : 'asc';

  const [type, setType] = useState<LibType>(initialType);
  const [source, setSource] = useState<LibSource>('plex');
  const [selected, setSelected] = useState<ContentItem | null>(null);
  const [sortField, setSortField] = useState<SortField>(initialSort);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  const providers = useQuery({ queryKey: ['auth', 'providers'], queryFn: api.getAuthProviders });
  const lib = useQuery({
    queryKey: ['library', type, source],
    queryFn: () => api.getLibrary(type, source),
  });

  const items = useMemo(() => {
    const raw = lib.data ?? [];
    // "Ready to Watch" isn't a sort — it's a filter (unwatched + no
    // in-progress position) followed by a date-added ordering. Matches
    // the home page's Ready to Watch shelf definition.
    const source = sortField === 'ready'
      ? raw.filter((i) => !i.progress?.watched && (i.progress?.percentage ?? 0) === 0)
      : raw;
    const sorted = [...source].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'alpha': {
          const tA = (a.showTitle || a.title).toLowerCase();
          const tB = (b.showTitle || b.title).toLowerCase();
          cmp = tA.localeCompare(tB);
          break;
        }
        case 'added':
          cmp = new Date(a.addedAt || 0).getTime() - new Date(b.addedAt || 0).getTime();
          break;
        case 'release':
          cmp = (a.year || 0) - (b.year || 0);
          break;
        case 'watched':
          cmp = new Date(a.lastViewedAt || 0).getTime() - new Date(b.lastViewedAt || 0).getTime();
          break;
        case 'ready':
          cmp = new Date(a.addedAt || 0).getTime() - new Date(b.addedAt || 0).getTime();
          break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [lib.data, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'added' || field === 'watched' || field === 'ready' ? 'desc' : 'asc');
    }
  }

  return (
    <div className="py-6">
      <div className="flex flex-wrap items-center gap-2 px-6 mb-4">
        <Pill on={type === 'show'} onClick={() => setType('show')}>TV Shows</Pill>
        <Pill on={type === 'movie'} onClick={() => setType('movie')}>Movies</Pill>
        <span className="mx-3 w-px h-6 bg-card-border" />
        {(['plex', 'jellyfin', 'emby'] as const).map((s) => (
          <Pill
            key={s}
            on={source === s}
            disabled={providers.data ? !providers.data[s] : false}
            onClick={() => setSource(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Pill>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-6 mb-6">
        <span className="text-xs uppercase tracking-wider text-text-muted mr-2">Sort</span>
        {(Object.keys(SORT_LABELS) as SortField[]).map((field) => (
          <SortChip
            key={field}
            on={sortField === field}
            dir={sortField === field ? sortDir : undefined}
            onClick={() => toggleSort(field)}
          >
            {SORT_LABELS[field]}
          </SortChip>
        ))}
      </div>
      {lib.isLoading ? (
        <p className="px-6 text-text-muted">Loading…</p>
      ) : lib.error ? (
        <p className="px-6 text-red-400">{(lib.error as Error).message}</p>
      ) : (
        <Grid items={items} onItemClick={setSelected} emptyMessage="Nothing in this library." />
      )}
      {selected && <DetailSheet item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Pill({ on, onClick, disabled, children }: { on: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'px-4 py-2 rounded-full text-sm font-semibold transition-colors',
        on ? 'bg-primary text-black' : 'bg-surface text-text-secondary hover:text-text',
        disabled ? 'opacity-30 cursor-not-allowed' : '',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function SortChip({ on, dir, onClick, children }: { on: boolean; dir?: SortDir; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-3 py-1.5 rounded text-xs font-semibold border transition-colors',
        on ? 'border-primary text-primary bg-surface' : 'border-card-border text-text-muted hover:text-text',
      ].join(' ')}
    >
      {children}{on && dir ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );
}

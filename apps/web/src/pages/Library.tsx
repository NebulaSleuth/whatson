import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Grid } from '@/components/Grid';

type LibType = 'show' | 'movie';
type LibSource = 'plex' | 'jellyfin' | 'emby';

export default function Library() {
  const [type, setType] = useState<LibType>('show');
  const [source, setSource] = useState<LibSource>('plex');
  const providers = useQuery({ queryKey: ['auth', 'providers'], queryFn: api.getAuthProviders });
  const lib = useQuery({
    queryKey: ['library', type, source],
    queryFn: () => api.getLibrary(type, source),
  });

  return (
    <div className="py-6">
      <div className="flex flex-wrap items-center gap-2 px-6 mb-6">
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
      {lib.isLoading ? (
        <p className="px-6 text-text-muted">Loading…</p>
      ) : lib.error ? (
        <p className="px-6 text-red-400">{(lib.error as Error).message}</p>
      ) : (
        <Grid items={lib.data ?? []} emptyMessage="Nothing in this library." />
      )}
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

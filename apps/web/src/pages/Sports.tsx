import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { SportsShelf } from '@/components/SportsShelf';

export default function Sports() {
  const now = useQuery({
    queryKey: ['sports', 'now'],
    queryFn: api.getSportsNow,
    refetchInterval: 30_000,
  });
  const later = useQuery({
    queryKey: ['sports', 'later'],
    queryFn: () => api.getSportsLater(168),
    refetchInterval: 5 * 60_000,
  });
  const completed = useQuery({
    queryKey: ['sports', 'completed'],
    queryFn: () => api.getSportsCompleted(7),
    refetchInterval: 5 * 60_000,
  });
  const prefs = useQuery({ queryKey: ['sports', 'prefs'], queryFn: api.getSportsPrefs });

  const isLoading = now.isLoading || later.isLoading;
  const noPrefs = (prefs.data?.leagues.length ?? 0) === 0;
  const hasNow = (now.data?.length ?? 0) > 0;
  const hasLater = (later.data?.length ?? 0) > 0;
  const hasCompleted = (completed.data?.length ?? 0) > 0;

  if (isLoading) return <p className="px-6 py-10 text-text-muted">Loading sports…</p>;

  if (noPrefs) {
    return (
      <div className="px-6 py-10 max-w-xl">
        <h2 className="text-xl font-bold mb-2">No teams or sports followed yet</h2>
        <p className="text-text-muted mb-4">Open Settings → Sports and pick at least one league to populate this tab.</p>
      </div>
    );
  }

  return (
    <div className="py-6">
      {hasNow && <SportsShelf title="Sports On Now" events={now.data!} />}
      {hasLater && <SportsShelf title="Sports On Later" events={later.data!} />}
      {hasCompleted && <SportsShelf title="Recently Completed" events={completed.data!} />}
      {!hasNow && !hasLater && !hasCompleted && (
        <p className="px-6 text-text-muted">Nothing on right now for your followed leagues.</p>
      )}
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, setCurrentUserId, setCurrentUserKind } from '@/lib/api';

export default function SelectUser() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.getUsers(),
  });

  async function pick(id: number) {
    try {
      await api.selectUser(id);
      setCurrentUserKind('plex');
      setCurrentUserId(String(id));
      navigate('/', { replace: true });
    } catch (e) {
      alert((e as Error).message);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-3xl w-full p-6">
        <h1 className="text-3xl font-bold text-primary mb-2">Who's Watching?</h1>
        <p className="text-text-muted mb-6">Choose a Plex Home user to continue.</p>

        {isLoading && <p className="text-text-secondary">Loading users…</p>}
        {error && <p className="text-red-400">{(error as Error).message}</p>}

        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {data.map((u) => (
              <button
                key={u.id}
                onClick={() => pick(u.id)}
                className="bg-surface hover:bg-surface-hover border border-card-border rounded-lg p-4 flex flex-col items-center gap-3 transition-colors focus:outline-none focus:border-primary"
              >
                {u.thumb ? (
                  <img
                    src={u.thumb}
                    alt={u.title}
                    className="w-20 h-20 rounded-full"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center text-2xl text-primary font-bold">
                    {u.title.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="font-semibold">{u.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

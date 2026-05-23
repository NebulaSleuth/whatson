import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, setAuthKey, setCurrentUserId } from '@/lib/api';

export default function Settings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: ['auth', 'providers'], queryFn: api.getAuthProviders });
  const health = useQuery({ queryKey: ['health'], queryFn: api.getHealth });
  const update = useQuery({ queryKey: ['update', 'status'], queryFn: api.getUpdateStatus });
  const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });

  async function checkForUpdates() {
    try {
      await api.checkUpdate();
      update.refetch();
    } catch (e) {
      alert((e as Error).message);
    }
  }
  async function applyUpdate() {
    if (!confirm('Restart backend to install the update?')) return;
    try {
      await api.applyUpdate();
      alert('Installer launched — backend will restart in ~30 seconds.');
    } catch (e) {
      alert((e as Error).message);
    }
  }
  function repair() {
    setAuthKey('');
    setCurrentUserId('');
    queryClient.clear();
    navigate('/pair', { replace: true });
  }
  function switchUser() {
    setCurrentUserId('');
    queryClient.clear();
    navigate('/select-user', { replace: true });
  }

  return (
    <div className="px-6 py-6 max-w-3xl space-y-8">
      {/* User */}
      <Section title="User">
        <button onClick={switchUser} className="bg-primary text-black px-4 py-2 rounded font-semibold hover:bg-primary/90">
          Switch User
        </button>
      </Section>

      {/* Service Status */}
      <Section title="Service Status">
        <ServiceRow name="Plex" state={health.data?.services?.plex} />
        <ServiceRow name="Jellyfin" state={providers.data?.jellyfin ? 'connected' : 'not_configured'} />
        <ServiceRow name="Emby" state={providers.data?.emby ? 'connected' : 'not_configured'} />
        <ServiceRow name="Sonarr" state={health.data?.services?.sonarr} />
        <ServiceRow name="Radarr" state={health.data?.services?.radarr} />
      </Section>

      {/* Server Configuration */}
      <Section title="Server Configuration">
        {config.data
          ? Object.entries(config.data).map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm py-1.5 border-b border-card-border last:border-b-0">
                <span className="text-text-secondary capitalize">{k}</span>
                <span className={v && v.configured ? 'text-text' : 'text-text-muted'}>
                  {v && v.url ? v.url : 'not configured'}
                </span>
              </div>
            ))
          : <p className="text-text-muted text-sm">Loading…</p>
        }
      </Section>

      {/* Server Updates */}
      <Section title="Server Updates">
        {update.data?.platformSupported === false ? (
          <p className="text-text-muted text-sm">In-process updater available on Windows backends only.</p>
        ) : update.data ? (
          <>
            <Row label="Current" value={update.data.currentVersion} />
            <Row label="Latest" value={update.data.latestVersion || '—'} />
            <Row label="Last checked" value={update.data.lastCheckedAt ? new Date(update.data.lastCheckedAt).toLocaleString() : 'Never'} />
            {update.data.lastError && <p className="text-red-400 text-sm py-2">{update.data.lastError}</p>}
            <div className="mt-3 flex gap-2">
              <button onClick={checkForUpdates} className="bg-surface hover:bg-surface-hover border border-card-border px-4 py-2 rounded text-sm">
                Check for Updates
              </button>
              {update.data.updateAvailable && (
                <button onClick={applyUpdate} className="bg-primary text-black px-4 py-2 rounded font-semibold text-sm hover:bg-primary/90">
                  Install Update
                </button>
              )}
            </div>
          </>
        ) : <p className="text-text-muted text-sm">Loading…</p>}
      </Section>

      {/* Pair Device */}
      <Section title="Pair Device">
        <p className="text-text-muted text-sm mb-3">
          Reset the local auth key and pair this browser again — useful if the backend's admin password changed.
        </p>
        <button onClick={repair} className="bg-surface hover:bg-surface-hover border border-card-border px-4 py-2 rounded text-sm">
          Pair this browser again
        </button>
      </Section>

      {/* About */}
      <Section title="About">
        <Row label="Backend version" value={health.data?.version || update.data?.currentVersion || '—'} />
        <Row label="Web UI" value="0.0.1" />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-primary font-semibold uppercase text-xs tracking-wider mb-3">{title}</h2>
      <div className="bg-surface border border-card-border rounded-lg p-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-1.5 border-b border-card-border last:border-b-0">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text">{value}</span>
    </div>
  );
}

function ServiceRow({ name, state }: { name: string; state?: string }) {
  const connected = state === 'connected';
  const notConfigured = !state || state === 'not_configured';
  const color = connected ? 'bg-green-500' : notConfigured ? 'bg-gray-500' : 'bg-red-500';
  const label = connected ? 'connected' : notConfigured ? 'not configured' : state;
  return (
    <div className="flex items-center gap-3 py-1.5 border-b border-card-border last:border-b-0">
      <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
      <span className="font-semibold">{name}</span>
      <span className="ml-auto text-text-muted text-sm">{label}</span>
    </div>
  );
}

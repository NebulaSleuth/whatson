import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import Home from './pages/Home';
import SelectUser from './pages/SelectUser';
import PairDevice from './pages/PairDevice';
import { Placeholder } from './pages/Placeholder';
import { api, getAuthKey, getCurrentUserId } from './lib/api';

type BootStatus = 'checking' | 'needsPair' | 'needsUser' | 'ready';

export default function App() {
  const [boot, setBoot] = useState<BootStatus>('checking');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    async function init() {
      try {
        const status = await api.getAdminStatus();
        if (status.hasAdminPassword && !getAuthKey()) {
          setBoot('needsPair');
          navigate('/pair', { replace: true });
          return;
        }
      } catch {
        // /auth/admin-status is open — if it fails, backend is unreachable.
        // We still let the user proceed; pages will surface their own errors.
      }

      // Plex multi-user: if Plex is configured, force the user picker on
      // first run. Single-server backends (Jellyfin / Emby) skip it.
      try {
        const providers = await api.getAuthProviders();
        if (providers.plex && !getCurrentUserId()) {
          setBoot('needsUser');
          navigate('/select-user', { replace: true });
          return;
        }
      } catch {
        /* swallow — let the home page surface errors */
      }

      setBoot('ready');
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (boot === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center text-text-muted">
        Loading…
      </div>
    );
  }

  // Pair + select-user pages render without the top bar (full-screen flows).
  const chromelessPaths = ['/pair', '/select-user'];
  const showChrome = !chromelessPaths.includes(location.pathname);

  return (
    <div className="min-h-screen flex flex-col">
      {showChrome && <TopBar />}
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tv" element={<Placeholder title="TV Shows" />} />
          <Route path="/movies" element={<Placeholder title="Movies" />} />
          <Route path="/sports" element={<Placeholder title="Sports" />} />
          <Route path="/library" element={<Placeholder title="Library" />} />
          <Route path="/search" element={<Placeholder title="Search" />} />
          <Route path="/settings" element={<Placeholder title="Settings" />} />
          <Route path="/select-user" element={<SelectUser />} />
          <Route path="/pair" element={<PairDevice />} />
        </Routes>
      </main>
    </div>
  );
}

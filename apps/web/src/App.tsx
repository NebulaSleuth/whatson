import { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import Home from './pages/Home';
import TV from './pages/TV';
import Movies from './pages/Movies';
import Sports from './pages/Sports';
import LiveTV from './pages/LiveTV';
import Library from './pages/Library';
import Search from './pages/Search';
import Settings from './pages/Settings';
import ShowDetail from './pages/ShowDetail';
import SelectUser from './pages/SelectUser';
import SelectWhatsOnUser from './pages/SelectWhatsOnUser';
import PairDevice from './pages/PairDevice';
import { api, getAuthKey, setAuthKey, getCurrentUserId } from './lib/api';

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
        // Verify the auth key by probing a protected endpoint. Without
        // this, a revoked/stale key lets boot complete and every later
        // call 401s — stranding the user on an error screen with no way
        // back to the pair flow.
        if (status.hasAdminPassword && getAuthKey()) {
          try {
            await api.getAuthProviders();
          } catch (err) {
            const msg = (err as Error).message || '';
            if (msg.includes('Invalid auth key') || msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
              setAuthKey('');
              setBoot('needsPair');
              navigate('/pair', { replace: true });
              return;
            }
          }
        }
      } catch {
        // /auth/admin-status is open — if it fails, backend is unreachable.
        // We still let the user proceed; pages will surface their own errors.
      }

      // Pick the right picker. With Whats On Users enabled, the unified
      // picker fully replaces the Plex Home picker — even when Plex isn't
      // configured. Otherwise fall back to the legacy Plex picker (and
      // skip entirely when Plex isn't configured either).
      try {
        const woCfg = await api.getWhatsOnConfig();
        if (woCfg.enabled && !getCurrentUserId()) {
          setBoot('needsUser');
          navigate('/select-whatson-user', { replace: true });
          return;
        }
      } catch {
        /* swallow — old backends won't have the endpoint */
      }

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
  const chromelessPaths = ['/pair', '/select-user', '/select-whatson-user'];
  const showChrome = !chromelessPaths.includes(location.pathname);

  return (
    <div className="min-h-screen flex flex-col">
      {showChrome && <TopBar />}
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tv" element={<TV />} />
          <Route path="/movies" element={<Movies />} />
          <Route path="/sports" element={<Sports />} />
          <Route path="/live-tv" element={<LiveTV />} />
          <Route path="/library" element={<Library />} />
          <Route path="/show/:source/:ratingKey" element={<ShowDetail />} />
          <Route path="/search" element={<Search />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/select-user" element={<SelectUser />} />
          <Route path="/select-whatson-user" element={<SelectWhatsOnUser />} />
          <Route path="/pair" element={<PairDevice />} />
        </Routes>
      </main>
    </div>
  );
}

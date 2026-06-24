import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useRealtimeUpdates } from '@/lib/useRealtimeUpdates';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { colors } from '@/constants/theme';
import { useAppStore } from '@/lib/store';
import { getStoredApiUrl, isAppConfigured, getSavedUser, getRememberUser, setSavedUser, getAutoSkipIntro, getAutoSkipCredits, getDisableTouchSurface, getShowBecauseYouWatched, getLiveTvChannels, getStoredAuthKey, setStoredAuthKey } from '@/lib/storage';
import { isTV, isTVOS } from '@/lib/tv';
import { api } from '@/lib/api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,       // Data is fresh for 2 minutes
      gcTime: 10 * 60 * 1000,          // Keep unused data for 10 minutes
      refetchOnWindowFocus: true,       // Refetch when app comes to foreground
      refetchOnReconnect: true,
      retry: 2,
    },
  },
});

// Refetch queries when app comes back to foreground
focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (state) => {
    handleFocus(state === 'active');
  });
  return () => subscription.remove();
});

function AppInitializer({ children }: { children: React.ReactNode }) {
  const { setApiUrl, setConfigured, setReady } = useAppStore();
  const lastRefreshDate = useRef(new Date().toDateString());
  const initDone = useRef(false);

  useEffect(() => {
    async function init() {
      if (initDone.current) return;
      initDone.current = true;
      const [storedUrl, configured, authKey, savedUser, rememberUser, skipIntro, skipCredits, disableTouch, showByw, liveChannels] = await Promise.all([
        getStoredApiUrl(),
        isAppConfigured(),
        getStoredAuthKey(),
        getSavedUser(),
        getRememberUser(),
        getAutoSkipIntro(),
        getAutoSkipCredits(),
        getDisableTouchSurface(),
        getShowBecauseYouWatched(),
        getLiveTvChannels(),
      ]);
      if (storedUrl) {
        setApiUrl(storedUrl);
      }
      setConfigured(configured);
      useAppStore.getState().setAuthKey(authKey);
      useAppStore.getState().setRememberUser(rememberUser);
      useAppStore.getState().setAutoSkipIntro(skipIntro);
      useAppStore.getState().setAutoSkipCredits(skipCredits);
      useAppStore.getState().setDisableTouchSurface(disableTouch);
      useAppStore.getState().setShowBecauseYouWatched(showByw);
      useAppStore.getState().setLiveTvChannels(liveChannels);

      // Apply touch surface setting on Apple TV
      if (isTVOS && disableTouch) {
        try {
          const { TVEventControl } = require('react-native');
          TVEventControl?.disableTVPanGesture?.();
        } catch {}
      }

      // If the backend has an admin password set and we don't have a
      // paired auth key locally, every /api/* call will 401. Route to
      // the pair flow before doing anything else. /auth/admin-status
      // is open and pre-dates the gate, so it works without a key.
      let needsPair = false;
      const effectiveUrl = storedUrl || useAppStore.getState().apiUrl;
      if (!effectiveUrl) {
        // Fresh install — no URL configured. Route to pair-device, which
        // doubles as the server-URL setup screen.
        console.log('[Init] no API URL configured → /pair-device');
        needsPair = true;
      } else {
        try {
          const adminStatus = await api.getAdminStatus();
          if (adminStatus.hasAdminPassword && !authKey) {
            needsPair = true;
          } else if (adminStatus.hasAdminPassword && authKey) {
            // We have a key — verify it actually works. A stale or revoked
            // key would otherwise let init complete and 401 every protected
            // call downstream, stranding the user on the picker error
            // screen with no way back to /pair-device. We probe
            // /whatson-users/config since it's small AND properly gated
            // (auth-providers is in the public allowlist, so a bad key
            // wouldn't be detected there).
            try {
              await api.getWhatsOnConfig();
              console.log('[Init] auth key verified');
            } catch (err) {
              const msg = (err as Error).message || '';
              if (msg.includes('Invalid auth key') || msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
                console.warn('[Init] auth key rejected — clearing and re-pairing');
                useAppStore.getState().setAuthKey(null);
                await setStoredAuthKey(null);
                needsPair = true;
              } else {
                console.warn('[Init] /auth/providers unavailable:', msg);
              }
            }
          }
          console.log(`[Init] hasAdminPassword=${adminStatus.hasAdminPassword} authKey=${authKey ? 'set' : 'unset'} needsPair=${needsPair}`);
        } catch (err) {
          // Backend unreachable — likely the API URL is wrong. Route to
          // pair-device so the user can fix it.
          console.warn('[Init] /auth/admin-status unavailable:', (err as Error).message);
          needsPair = true;
        }
      }

      if (needsPair) {
        setReady(true);
        console.log('[Init] needs pair → /pair-device');
        setTimeout(() => {
          router.replace('/pair-device' as any);
        }, 100);
        return;
      }

      // Discover whether the operator has enabled Whats On Users. When
      // on, this replaces the legacy Plex-only picker with a unified
      // multi-service picker that the admin has pre-configured.
      let whatsonEnabled = false;
      try {
        const woCfg = await api.getWhatsOnConfig();
        whatsonEnabled = !!woCfg.enabled;
      } catch {}

      // If "remember user" is on and we have a saved user, auto-login.
      // Dispatches on kind so legacy Plex saved users still work after
      // upgrade, and new Whats On saved users route through the new API.
      let userRestored = false;
      if (rememberUser && savedUser) {
        try {
          if (savedUser.kind === 'whatson') {
            // Pre-PIN flow only — PIN-protected WO users can't auto-login.
            const u = await api.selectWhatsOnUser(savedUser.id);
            useAppStore.getState().setCurrentUser({
              id: u.id,
              kind: 'whatson',
              title: u.name,
              thumb: savedUser.thumb,
              hasPassword: u.hasPin,
            });
            userRestored = true;
          } else {
            const userIdNum = Number(savedUser.id);
            if (Number.isFinite(userIdNum)) {
              await api.selectUser(userIdNum);
              useAppStore.getState().setCurrentUser({
                id: savedUser.id,
                kind: 'plex',
                title: savedUser.title,
                thumb: savedUser.thumb,
                hasPassword: false,
              });
              userRestored = true;
            }
          }
        } catch {
          // Token expired, user removed, or PIN now required.
          await setSavedUser(null);
        }
      }

      // Discover which server providers are configured. Determines
      // whether to route to the legacy Plex picker when WhatsOn is off.
      let plexConfigured = true;
      try {
        const providers = await api.getAuthProviders();
        plexConfigured = providers.plex;
        console.log(`[Init] Providers: plex=${providers.plex} jellyfin=${providers.jellyfin} emby=${providers.emby}`);
      } catch {}

      // Test Plex connection — determine if client can reach Plex directly (local) or needs remote.
      if (plexConfigured) {
        try {
          const conns = await api.getPlexConnections();
          let isLocal = false;
          for (const url of conns.local) {
            try {
              const ctrl = new AbortController();
              const timer = setTimeout(() => ctrl.abort(), 3000);
              await fetch(`${url}/identity`, { signal: ctrl.signal });
              clearTimeout(timer);
              isLocal = true;
              break;
            } catch {}
          }
          useAppStore.getState().setPlexConnectionType(isLocal ? 'local' : 'remote');
          console.log(`[Init] Plex connection: ${isLocal ? 'local' : 'remote'}`);
        } catch {}
      }

      setReady(true);

      // Pick the right picker. With Whats On Users enabled, that flow
      // replaces the Plex-only picker entirely — even if Plex isn't
      // configured. Otherwise fall back to today's Plex Home picker
      // (and skip entirely when Plex isn't configured).
      if (!userRestored) {
        if (whatsonEnabled) {
          console.log('[Init] No user restored, redirecting to select-whatson-user');
          setTimeout(() => router.replace('/select-whatson-user' as any), 100);
        } else if (plexConfigured) {
          console.log('[Init] No user restored, redirecting to select-user');
          setTimeout(() => router.replace('/select-user' as any), 100);
        } else {
          console.log('[Init] No picker available — skipping');
        }
      } else {
        console.log('[Init] User restored: ' + useAppStore.getState().currentUser?.title);
      }
    }
    init();
  }, [setApiUrl, setConfigured, setReady]);

  // Check if the date has changed — if so, invalidate all caches
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const today = new Date().toDateString();
        if (today !== lastRefreshDate.current) {
          lastRefreshDate.current = today;
          queryClient.invalidateQueries();
        }
      }
    });
    return () => subscription.remove();
  }, []);

  // Connect to WebSocket for real-time updates
  useRealtimeUpdates();

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInitializer>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="pair-device" options={{ animation: 'fade' }} />
          <Stack.Screen name="select-user" options={{ animation: 'fade' }} />
          <Stack.Screen name="select-whatson-user" options={{ animation: 'fade' }} />
          <Stack.Screen name="show-detail" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="player"
            options={{
              headerShown: false,
              contentStyle: { backgroundColor: '#000' },
              animation: 'fade',
            }}
          />
        </Stack>
      </AppInitializer>
    </QueryClientProvider>
  );
}

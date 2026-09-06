import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useRealtimeUpdates } from '@/lib/useRealtimeUpdates';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { colors } from '@/constants/theme';
import { useAppStore } from '@/lib/store';
import { getStoredApiUrl, isAppConfigured, getSavedUser, getRememberUser, setSavedUser, getAutoSkipIntro, getAutoSkipCredits, getDisableTouchSurface, getShowBecauseYouWatched, getLiveTvChannels, getStoredAuthKey, setStoredAuthKey, getStoredSessionToken, setStoredSessionToken, getStoredPlexConnectionType } from '@/lib/storage';
import { resolveConnection, updateCandidates } from '@/lib/connection';
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
      const [storedUrl, configured, authKey, savedUser, rememberUser, skipIntro, skipCredits, disableTouch, showByw, liveChannels, storedSessionToken, storedConnType] = await Promise.all([
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
        getStoredSessionToken(),
        getStoredPlexConnectionType(),
      ]);
      if (storedUrl) {
        setApiUrl(storedUrl);
      }
      // M5: if cached connection candidates exist (from cloud onboarding), race
      // them and pin the best reachable one — verifying serverId so we don't
      // attach to a stranger's device on a foreign LAN. No-op for installs
      // without candidates (leaves the stored single apiUrl in place).
      await resolveConnection();
      setConfigured(configured);
      useAppStore.getState().setAuthKey(authKey);
      useAppStore.getState().setRememberUser(rememberUser);
      useAppStore.getState().setAutoSkipIntro(skipIntro);
      useAppStore.getState().setAutoSkipCredits(skipCredits);
      useAppStore.getState().setDisableTouchSurface(disableTouch);
      useAppStore.getState().setShowBecauseYouWatched(showByw);
      useAppStore.getState().setLiveTvChannels(liveChannels);
      // Explicit Settings → Connection pick (Local/Remote) wins over the
      // boot-time auto-detect below; null = never chosen → auto-detect.
      if (storedConnType) useAppStore.getState().setPlexConnectionType(storedConnType);

      // Apply touch surface setting on Apple TV
      if (isTVOS && disableTouch) {
        try {
          const { TVEventControl } = require('react-native');
          TVEventControl?.disableTVPanGesture?.();
        } catch {}
      }

      // Apple TV: route the Siri Remote Menu button to BackHandler.
      // react-native-tvos only emits the 'menu' TV event (which its
      // BackHandler.ios.js turns into hardwareBackPress) once the menu
      // key is enabled — RCTTVRemoteHandler.m `useMenuKey` defaults to
      // NO, in which case tvOS handles Menu itself and backgrounds the
      // app from any screen. Enabling it gives tvOS the same back
      // behaviour as Android TV (useTVBackHandler + player/detail back).
      if (isTVOS) {
        try {
          const { TVEventControl } = require('react-native');
          TVEventControl?.enableTVMenuKey?.();
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

      // M7: we're paired + reachable — learn this server's connection candidates
      // (LAN + WAN hostname) and cache them, so the racer can reach the server
      // from anywhere later (the foreground re-race picks whichever answers).
      // Best-effort; typically runs while on the home LAN.
      try {
        const cands = await api.getRemoteCandidates();
        if (cands.candidates?.length) {
          await updateCandidates(cands.candidates as any, cands.serverId);
          console.log(`[Init] cached ${cands.candidates.length} connection candidate(s)`);
        }
      } catch {}

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
            // /select mints a fresh session token; fall back to the one
            // persisted at last login if the backend didn't return one.
            const token = u.sessionToken || storedSessionToken || null;
            useAppStore.getState().setSessionToken(token);
            if (token !== storedSessionToken) await setStoredSessionToken(token);
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
          await setStoredSessionToken(null);
        }
      }
      if (!userRestored && storedSessionToken) {
        // Orphaned token (no user restored) — drop it so it can't leak
        // onto a different user's requests.
        await setStoredSessionToken(null);
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
      // Skipped when the user picked Local/Remote explicitly in Settings → Connection.
      if (plexConfigured && !storedConnType) {
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

  // M5: re-race cached connection candidates when the app returns to the
  // foreground. The user may have moved between the home LAN and cellular/
  // remote, so a previously-pinned LAN URL could now be unreachable (or a
  // remote URL now has a faster LAN path). resolveConnection() no-ops for
  // installs without a candidate cache, so this is dormant until cloud
  // onboarding populates candidates — zero effect on today's single-URL setup.
  // Debounced so a rapid background/foreground flip doesn't spam probes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const before = useAppStore.getState().apiUrl;
        const status = await resolveConnection();
        const after = useAppStore.getState().apiUrl;
        if (status === 'connected' && after !== before) {
          console.log(`[Conn] re-raced on resume: ${before} → ${after}`);
          queryClient.invalidateQueries();
        }
      }, 800);
    });
    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
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
          <Stack.Screen name="cloud-signin" options={{ animation: 'fade' }} />
          <Stack.Screen name="select-user" options={{ animation: 'fade' }} />
          <Stack.Screen name="select-whatson-user" options={{ animation: 'fade' }} />
          <Stack.Screen name="create-profile" options={{ animation: 'fade' }} />
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

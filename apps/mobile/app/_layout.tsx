import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useRealtimeUpdates } from '@/lib/useRealtimeUpdates';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { colors } from '@/constants/theme';
import { useAppStore } from '@/lib/store';
import { getStoredApiUrl, isAppConfigured, getSavedUser, getRememberUser, setSavedUser, getAutoSkipIntro, getAutoSkipCredits, getDisableTouchSurface, getShowBecauseYouWatched, getLiveTvChannels } from '@/lib/storage';
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
      const [storedUrl, configured, savedUser, rememberUser, skipIntro, skipCredits, disableTouch, showByw, liveChannels] = await Promise.all([
        getStoredApiUrl(),
        isAppConfigured(),
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

      // If "remember user" is on and we have a saved user, auto-login
      let userRestored = false;
      if (rememberUser && savedUser) {
        try {
          await api.selectUser(savedUser.id);
          useAppStore.getState().setCurrentUser({
            ...savedUser,
            admin: false,
            hasPassword: false,
            restricted: false,
          });
          userRestored = true;
        } catch {
          // Token expired or user removed — clear saved user
          await setSavedUser(null);
        }
      }

      // Test Plex connection — determine if client can reach Plex directly (local) or needs remote
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

      setReady(true);

      // Navigate to user selection if no user is active (only on initial load)
      if (!userRestored) {
        console.log('[Init] No user restored, redirecting to select-user');
        setTimeout(() => {
          router.replace('/select-user' as any);
        }, 100);
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
          <Stack.Screen name="select-user" options={{ animation: 'fade' }} />
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

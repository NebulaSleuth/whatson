import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useRealtimeUpdates } from '@/lib/useRealtimeUpdates';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { colors } from '@/constants/theme';
import { useAppStore } from '@/lib/store';
import { getStoredApiUrl, isAppConfigured, getSavedUser, getRememberUser, setSavedUser } from '@/lib/storage';
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

  useEffect(() => {
    async function init() {
      const [storedUrl, configured, savedUser, rememberUser] = await Promise.all([
        getStoredApiUrl(),
        isAppConfigured(),
        getSavedUser(),
        getRememberUser(),
      ]);
      if (storedUrl) {
        setApiUrl(storedUrl);
      }
      setConfigured(configured);
      useAppStore.getState().setRememberUser(rememberUser);

      // If "remember user" is on and we have a saved user, auto-login
      if (rememberUser && savedUser) {
        try {
          await api.selectUser(savedUser.id);
          useAppStore.getState().setCurrentUser({
            ...savedUser,
            admin: false,
            hasPassword: false,
            restricted: false,
          });
        } catch {
          // Token expired or user removed — clear saved user
          await setSavedUser(null);
        }
      }

      setReady(true);
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

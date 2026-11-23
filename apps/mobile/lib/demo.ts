import { Alert } from 'react-native';
import { router } from 'expo-router';
import { DEMO_API_URL } from '@whatson/shared';
import { api, isDemoReadOnlyError } from './api';
import { useAppStore } from './store';
import { queryClient } from './queryClient';
import {
  setStoredApiUrl,
  clearStoredApiUrl,
  clearStoredCandidates,
  setExpectedServerId,
  setStoredAuthKey,
  setSavedUser,
  setStoredSessionToken,
} from './storage';

/** True while connected to the public read-only demo server. */
export function useIsDemo(): boolean {
  return useAppStore((s) => s.demo);
}

/**
 * Show an error alert unless it's the demo server's quiet 403 — a write that
 * slipped past the hidden-button gating should be a silent no-op, not a toast.
 */
export function alertError(error: unknown, title = 'Error'): void {
  if (isDemoReadOnlyError(error)) return;
  Alert.alert(title, (error as Error)?.message || String(error));
}

/** Refresh the store's `demo` flag from /auth/providers. Best-effort. */
export async function refreshDemoFlag(): Promise<boolean> {
  try {
    const providers = await api.getAuthProviders();
    const demo = providers.demo === true;
    useAppStore.getState().setDemo(demo);
    return demo;
  } catch {
    return useAppStore.getState().demo;
  }
}

/**
 * Point the app at the public demo server. Clears any candidates / pinned
 * server id (so the connection racer can't swap us back to the user's own
 * server) and any auth key from a previous server, then continues into the app.
 */
export async function enterDemo(): Promise<void> {
  const apiUrl = `${DEMO_API_URL}/api`;
  const store = useAppStore.getState();
  // Probe first so an unreachable demo leaves the current server untouched.
  const previousUrl = store.apiUrl;
  const previousKey = store.authKey;
  store.setApiUrl(apiUrl);
  store.setAuthKey(null);
  try {
    await api.getAdminStatus();
  } catch (err) {
    store.setApiUrl(previousUrl);
    store.setAuthKey(previousKey);
    throw err;
  }
  await Promise.all([
    setStoredApiUrl(apiUrl),
    clearStoredCandidates(),
    setExpectedServerId(null),
    setStoredAuthKey(null),
    setSavedUser(null),
    setStoredSessionToken(null),
  ]);
  store.setApiUrl(apiUrl);
  store.setAuthKey(null);
  store.setCurrentUser(null);
  store.setSessionToken(null);
  queryClient.clear();
  await refreshDemoFlag();
  // Boot already ran (and stopped at /pair-device), so pick the profile here:
  // the demo runs Whats On Users with a guest profile.
  let whatsonEnabled = false;
  try {
    whatsonEnabled = !!(await api.getWhatsOnConfig()).enabled;
  } catch {}
  store.setReady(true);
  router.replace((whatsonEnabled ? '/select-whatson-user' : '/') as any);
}

/**
 * Forget the current server entirely: API URL, connection candidates, pinned
 * server id, auth key, saved user and PIN session (both storage and store),
 * plus the query cache, then return to /pair-device. Used by "Leave demo".
 */
export async function forgetServer(): Promise<void> {
  await Promise.all([
    clearStoredApiUrl(),
    clearStoredCandidates(),
    setExpectedServerId(null),
    setStoredAuthKey(null),
    setSavedUser(null),
    setStoredSessionToken(null),
  ]);
  const store = useAppStore.getState();
  store.setApiUrl('');
  store.setAuthKey(null);
  store.setCurrentUser(null);
  store.setSessionToken(null);
  store.setDemo(false);
  queryClient.clear();
  router.replace('/pair-device' as any);
}

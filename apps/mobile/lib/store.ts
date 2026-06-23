import { create } from 'zustand';

// Default API URL is intentionally empty for release builds — first-run
// installs route to /pair-device for setup, where the user enters the
// server address. For local dev, set EXPO_PUBLIC_API_URL in apps/mobile/.env.
const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL || '';

/** Wire shape from /api/users (Plex Home). */
export interface PlexUser {
  id: number;
  title: string;
  thumb: string;
  admin: boolean;
  hasPassword: boolean;
  restricted: boolean;
}

/**
 * Active user for the current session — works for either the legacy
 * Plex Home picker (kind: 'plex') or a Whats On user (kind: 'whatson').
 * `id` is a string in both cases (numeric Plex ids get stringified)
 * so the wire header is uniform. `hasPassword` reflects whether the
 * user-side picker should prompt for a PIN.
 */
export interface CurrentUser {
  id: string;
  kind: 'plex' | 'whatson';
  title: string;
  thumb: string;
  hasPassword: boolean;
}

interface AppState {
  apiUrl: string;
  isConfigured: boolean;
  isReady: boolean;
  authKey: string | null;
  currentUser: CurrentUser | null;
  rememberUser: boolean;
  autoSkipIntro: boolean;
  autoSkipCredits: boolean;
  disableTouchSurface: boolean;
  showBecauseYouWatched: boolean;
  plexConnectionType: 'local' | 'remote';
  liveTvChannels: string[];
  setApiUrl: (url: string) => void;
  setConfigured: (configured: boolean) => void;
  setReady: (ready: boolean) => void;
  setAuthKey: (key: string | null) => void;
  setCurrentUser: (user: CurrentUser | null) => void;
  setRememberUser: (remember: boolean) => void;
  setAutoSkipIntro: (skip: boolean) => void;
  setAutoSkipCredits: (skip: boolean) => void;
  setDisableTouchSurface: (disable: boolean) => void;
  setShowBecauseYouWatched: (show: boolean) => void;
  setPlexConnectionType: (type: 'local' | 'remote') => void;
  setLiveTvChannels: (channels: string[]) => void;
}

export const useAppStore = create<AppState>((set) => ({
  apiUrl: DEFAULT_API_URL,
  isConfigured: false,
  isReady: false,
  authKey: null,
  currentUser: null,
  rememberUser: false,
  autoSkipIntro: false,
  autoSkipCredits: false,
  disableTouchSurface: false,
  showBecauseYouWatched: true,
  plexConnectionType: 'local',
  liveTvChannels: [],
  setApiUrl: (apiUrl) => set({ apiUrl }),
  setConfigured: (isConfigured) => set({ isConfigured }),
  setReady: (isReady) => set({ isReady }),
  setAuthKey: (authKey) => set({ authKey }),
  setCurrentUser: (currentUser) => set({ currentUser }),
  setRememberUser: (rememberUser) => set({ rememberUser }),
  setAutoSkipIntro: (autoSkipIntro) => set({ autoSkipIntro }),
  setAutoSkipCredits: (autoSkipCredits) => set({ autoSkipCredits }),
  setDisableTouchSurface: (disableTouchSurface) => set({ disableTouchSurface }),
  setShowBecauseYouWatched: (showBecauseYouWatched) => set({ showBecauseYouWatched }),
  setPlexConnectionType: (plexConnectionType) => set({ plexConnectionType }),
  setLiveTvChannels: (liveTvChannels) => set({ liveTvChannels }),
}));

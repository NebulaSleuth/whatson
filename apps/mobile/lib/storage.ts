import * as SecureStore from 'expo-secure-store';

const KEYS = {
  API_URL: 'whatson_apiUrl',
  CONFIGURED: 'whatson_configured',
  SAVED_USER: 'whatson_savedUser',
  REMEMBER_USER: 'whatson_rememberUser',
  SONARR_PROFILE: 'whatson_sonarrProfile',
  SONARR_FOLDER: 'whatson_sonarrFolder',
  SONARR_MONITOR: 'whatson_sonarrMonitor',
  RADARR_PROFILE: 'whatson_radarrProfile',
  RADARR_FOLDER: 'whatson_radarrFolder',
} as const;

export async function getStoredApiUrl(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEYS.API_URL);
  } catch {
    return null;
  }
}

export async function setStoredApiUrl(url: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEYS.API_URL, url);
  } catch {}
}

export async function isAppConfigured(): Promise<boolean> {
  try {
    const value = await SecureStore.getItemAsync(KEYS.CONFIGURED);
    return value === 'true';
  } catch {
    return false;
  }
}

export async function setAppConfigured(configured: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEYS.CONFIGURED, String(configured));
  } catch {}
}

// ── User Preferences ──

export async function getSavedUser(): Promise<{ id: number; title: string; thumb: string } | null> {
  try {
    const json = await SecureStore.getItemAsync(KEYS.SAVED_USER);
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
}

export async function setSavedUser(user: { id: number; title: string; thumb: string } | null): Promise<void> {
  try {
    if (user) {
      await SecureStore.setItemAsync(KEYS.SAVED_USER, JSON.stringify(user));
    } else {
      await SecureStore.deleteItemAsync(KEYS.SAVED_USER);
    }
  } catch {}
}

export async function getRememberUser(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEYS.REMEMBER_USER)) === 'true';
  } catch {
    return false;
  }
}

export async function setRememberUser(remember: boolean): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEYS.REMEMBER_USER, String(remember));
    if (!remember) {
      await SecureStore.deleteItemAsync(KEYS.SAVED_USER);
    }
  } catch {}
}

// ── Arr Preferences ──

export interface ArrPrefs {
  profileId: number | null;
  folderPath: string | null;
  monitor: string | null;
}

export async function getSonarrPrefs(): Promise<ArrPrefs> {
  try {
    const [profileId, folderPath, monitor] = await Promise.all([
      SecureStore.getItemAsync(KEYS.SONARR_PROFILE),
      SecureStore.getItemAsync(KEYS.SONARR_FOLDER),
      SecureStore.getItemAsync(KEYS.SONARR_MONITOR),
    ]);
    return {
      profileId: profileId ? parseInt(profileId) : null,
      folderPath,
      monitor,
    };
  } catch {
    return { profileId: null, folderPath: null, monitor: null };
  }
}

export async function setSonarrPrefs(profileId: number, folderPath: string, monitor: string): Promise<void> {
  try {
    await Promise.all([
      SecureStore.setItemAsync(KEYS.SONARR_PROFILE, String(profileId)),
      SecureStore.setItemAsync(KEYS.SONARR_FOLDER, folderPath),
      SecureStore.setItemAsync(KEYS.SONARR_MONITOR, monitor),
    ]);
  } catch {}
}

export async function getRadarrPrefs(): Promise<ArrPrefs> {
  try {
    const [profileId, folderPath] = await Promise.all([
      SecureStore.getItemAsync(KEYS.RADARR_PROFILE),
      SecureStore.getItemAsync(KEYS.RADARR_FOLDER),
    ]);
    return {
      profileId: profileId ? parseInt(profileId) : null,
      folderPath,
      monitor: null,
    };
  } catch {
    return { profileId: null, folderPath: null, monitor: null };
  }
}

export async function setRadarrPrefs(profileId: number, folderPath: string): Promise<void> {
  try {
    await Promise.all([
      SecureStore.setItemAsync(KEYS.RADARR_PROFILE, String(profileId)),
      SecureStore.setItemAsync(KEYS.RADARR_FOLDER, folderPath),
    ]);
  } catch {}
}

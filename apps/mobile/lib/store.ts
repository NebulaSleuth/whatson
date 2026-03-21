import { create } from 'zustand';
import { Platform } from 'react-native';

// Android emulator uses 10.0.2.2 to reach host's localhost
const isEmulator = Platform.OS === 'android' && !process.env.EXPO_PUBLIC_API_URL;
const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL || (isEmulator ? 'http://10.0.2.2:3001/api' : 'http://localhost:3001/api');

interface AppState {
  apiUrl: string;
  isConfigured: boolean;
  isReady: boolean;
  setApiUrl: (url: string) => void;
  setConfigured: (configured: boolean) => void;
  setReady: (ready: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  apiUrl: DEFAULT_API_URL,
  isConfigured: false,
  isReady: false,
  setApiUrl: (apiUrl) => set({ apiUrl }),
  setConfigured: (isConfigured) => set({ isConfigured }),
  setReady: (isReady) => set({ isReady }),
}));

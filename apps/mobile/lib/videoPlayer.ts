// Detect whether expo-video native module is available (native build)
// or if we need to fall back to expo-av (Expo Go)

let hasExpoVideo = false;

try {
  const mod = require('expo-video');
  // Check if the native module constructor works
  if (mod?.useVideoPlayer) {
    hasExpoVideo = true;
  }
} catch {}

export const useNativePlayer = hasExpoVideo;

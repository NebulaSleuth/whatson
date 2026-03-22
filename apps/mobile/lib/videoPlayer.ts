// Check if expo-video native module is available (native build only)
// In Expo Go, this will be false — hide the "Play Here" button

let _hasExpoVideo = false;

try {
  // This will throw in Expo Go where the native module isn't loaded
  require('expo-video');
  _hasExpoVideo = true;
} catch {
  _hasExpoVideo = false;
}

export const hasVideoPlayer = _hasExpoVideo;

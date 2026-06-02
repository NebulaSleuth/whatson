import { ExpoConfig, ConfigContext } from 'expo/config';
import { withAndroidManifest } from 'expo/config-plugins';

/**
 * Tiny inline config plugin: adds android:usesCleartextTraffic="true"
 * to the <application> tag. The user's backend is on the LAN at
 * http://192.168.x.x:3001 (no TLS); Android 9+ blocks cleartext by
 * default, which would otherwise prevent the pair-code flow from
 * reaching the server. The top-level `android.usesCleartextTraffic`
 * key on ExpoConfig is silently ignored in modern Expo SDKs — this
 * mod is what actually writes the attribute into the manifest.
 */
const withCleartextTraffic = (cfg: ExpoConfig) =>
  withAndroidManifest(cfg, (mod) => {
    const app = mod.modResults.manifest.application?.[0];
    if (app) (app.$ as Record<string, string>)['android:usesCleartextTraffic'] = 'true';
    return mod;
  });

/**
 * Dynamic Expo config that supports separate phone and TV builds.
 *
 * Usage:
 *   TV build:    WHATSON_TV=1 npx expo run:android
 *   Phone build: npx expo run:android  (default)
 *
 * For EAS Build:
 *   eas build --profile android-tv
 *   eas build --profile android-phone
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const isTV = process.env.WHATSON_TV === '1';

  const base: ExpoConfig = {
    ...config,
    name: isTV ? 'Whats On TV' : 'Whats On',
    slug: 'whatson',
    version: '0.1.0',
    orientation: 'default',
    icon: './assets/icon.png',
    scheme: 'whatson',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#0F0F0F',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: isTV ? 'com.extrastrength.whatson' : 'com.whatson.app',
      infoPlist: {
        LSApplicationQueriesSchemes: ['plex', 'plexapp', 'nflx', 'hulu', 'aiv'],
        ...(isTV ? { UIRequiredDeviceCapabilities: ['arm64'] } : {}),
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#0F0F0F',
      },
      package: isTV ? 'com.whatson.tv' : 'com.whatson.app',
    },
    plugins: [
      ['expo-router', { root: './app' }],
      ['@react-native-tvos/config-tv', {
        isTV: true,
        tvosDeploymentTarget: '15.1',
        androidTVRequired: isTV, // true = TV-only, false = universal
        androidTVBanner: './assets/tv-banner.png',
        ...(isTV ? {
          appleTVImages: {
            icon: './assets/tv/icon-1280x768.png',
            iconSmall: './assets/tv/icon-small-400x240.png',
            iconSmall2x: './assets/tv/icon-small-2x-800x480.png',
            topShelf: './assets/tv/topshelf-1920x720.png',
            topShelf2x: './assets/tv/topshelf-2x-3840x1440.png',
            topShelfWide: './assets/tv/topshelf-wide-2320x720.png',
            topShelfWide2x: './assets/tv/topshelf-wide-2x-4640x1440.png',
          },
        } : {}),
      }],
    ],
    install: {
      exclude: ['react-native'],
    },
    experiments: {
      typedRoutes: true,
    },
    extra: {
      isTV,
    },
  } as ExpoConfig;

  return withCleartextTraffic(base);
};

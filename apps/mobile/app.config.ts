import { ExpoConfig, ConfigContext } from 'expo/config';

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

  return {
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
      bundleIdentifier: 'com.whatson.app',
      infoPlist: {
        LSApplicationQueriesSchemes: ['plex', 'plexapp', 'nflx', 'hulu', 'aiv'],
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
      'expo-router',
      ['@react-native-tvos/config-tv', {
        isTV: true,
        androidTVRequired: isTV, // true = TV-only, false = universal
        androidTVBanner: './assets/tv-banner.png',
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
};

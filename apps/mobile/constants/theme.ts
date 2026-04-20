import { Platform, Dimensions } from 'react-native';

const isTV = Platform.isTV;
const SCREEN_WIDTH = Dimensions.get('window').width;

// Target ~14% of screen width per card (gives ~6 cards on 1920, ~5 on 960)
const TV_POSTER_WIDTH = isTV
  ? Math.max(140, Math.min(300, Math.floor(SCREEN_WIDTH * 0.14)))
  : 140;

export const colors = {
  background: '#0F0F0F',
  surface: '#1A1A1A',
  surfaceHover: '#252525',
  card: '#1E1E1E',
  cardBorder: '#2A2A2A',
  primary: '#E5A00D',
  accent: '#35C5F4',
  text: '#FFFFFF',
  textSecondary: '#A0A0A0',
  textMuted: '#666666',
  error: '#F44336',
  success: '#4CAF50',
  progressBar: '#E5A00D',
  sourcePlex: '#E5A00D',
  sourceJellyfin: '#AA5CC3',
  sourceEmby: '#52B54B',
  sourceSonarr: '#35C5F4',
  sourceRadarr: '#FFC230',
  sourceLive: '#4CAF50',
  focus: '#E5A00D',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: isTV ? 20 : 16,
  xl: isTV ? 32 : 24,
  xxl: isTV ? 40 : 32,
} as const;

export const typography = {
  title: {
    fontSize: isTV ? 28 : 24,
    fontWeight: '700' as const,
    color: colors.text,
  },
  sectionTitle: {
    fontSize: isTV ? 22 : 18,
    fontWeight: '600' as const,
    color: colors.text,
  },
  cardTitle: {
    fontSize: isTV ? 16 : 14,
    fontWeight: '600' as const,
    color: colors.text,
  },
  cardSubtitle: {
    fontSize: isTV ? 14 : 12,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
  body: {
    fontSize: isTV ? 18 : 14,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
  caption: {
    fontSize: isTV ? 13 : 11,
    fontWeight: '400' as const,
    color: colors.textMuted,
  },
} as const;

export const cardDimensions = {
  // Portrait poster card (2:3 ratio) — sized relative to screen width on TV
  poster: {
    width: isTV ? TV_POSTER_WIDTH : 140,
    height: isTV ? Math.floor(TV_POSTER_WIDTH * 1.5) : 210,
  },
  // Landscape thumbnail card (16:9 ratio)
  landscape: {
    width: isTV ? Math.floor(TV_POSTER_WIDTH * 1.875) : 280,
    height: isTV ? Math.floor(TV_POSTER_WIDTH * 1.875 * 9 / 16) : 158,
  },
};

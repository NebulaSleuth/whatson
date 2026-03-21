import { Platform } from 'react-native';

const isTV = Platform.isTV;

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
  // Portrait poster card (2:3 ratio) — sized to fit ~5-6 cards on a 1080p TV
  poster: {
    width: isTV ? 160 : 140,
    height: isTV ? 240 : 210,
  },
  // Landscape thumbnail card (16:9 ratio)
  landscape: {
    width: isTV ? 300 : 280,
    height: isTV ? 169 : 158,
  },
} as const;

import { Platform, Dimensions } from 'react-native';

const isTV = Platform.isTV;

// On TV, size the poster so exactly two shelves fit in the visible
// area. A shelf's height is the section title + the poster + the
// item's title/subtitle/meta rows + margins; we back out the poster
// height from the screen height minus known chrome (tab bar, safe
// areas, per-shelf label chrome). Falls back to 140 on phones.
const TV_SCREEN_HEIGHT = Dimensions.get('window').height;
// Chrome we can't shrink: tab bar (~72) + safe area top+bottom
// (~54) + slack for status bar / drop shadows / rounding (~40).
const TV_PAGE_CHROME = 260;
// Per-shelf overhead above and below the poster:
//   section title + margin       ~40
//   item title + subtitle + meta ~60
//   inter-shelf margin           ~16
const TV_SHELF_LABEL_CHROME = 116;
const TV_TARGET_SHELF_HEIGHT = Math.floor((TV_SCREEN_HEIGHT - TV_PAGE_CHROME) / 2);
const TV_POSTER_HEIGHT_CALC = Math.max(180, TV_TARGET_SHELF_HEIGHT - TV_SHELF_LABEL_CHROME);
// Round the width to preserve the 2:3 poster aspect ratio.
const TV_POSTER_WIDTH = isTV ? Math.floor(TV_POSTER_HEIGHT_CALC / 1.5) : 140;

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
  sourceEmby: '#4CAF50',
  sourceSonarr: '#35C5F4',
  sourceRadarr: '#FFC230',
  sourceLive: '#4CAF50',
  // Pale gold for TV focus rings. Brand gold `#E5A00D` is too close
  // to gold-coloured buttons (Play, Save, etc.) — a focus ring drawn
  // in the same shade is nearly invisible against them. This is the
  // brand hue shifted ~+20% lightness so the highlight reads as gold
  // but stays distinct from the button fill.
  focus: '#F5D87A',
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
  // Portrait poster card (2:3 ratio) — TV picks a width that makes
  // exactly two shelves fit (see calc above). Phones stay at 140.
  poster: {
    width: isTV ? TV_POSTER_WIDTH : 140,
    height: isTV ? TV_POSTER_HEIGHT_CALC : 210,
  },
  // Landscape thumbnail card (16:9 ratio)
  landscape: {
    width: isTV ? Math.floor(TV_POSTER_WIDTH * 1.875) : 280,
    height: isTV ? Math.floor(TV_POSTER_WIDTH * 1.875 * 9 / 16) : 158,
  },
};

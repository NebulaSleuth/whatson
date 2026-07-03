import { Platform, Dimensions } from 'react-native';

const isTV = Platform.isTV;

// On TV, size the poster so exactly two shelves fit in the visible
// area. A shelf's height is the section title + the poster + the
// item's title/subtitle/meta rows + margins; we back out the poster
// height from the screen height minus known chrome (tab bar, safe
// areas, per-shelf label chrome).
//
// The Shield reports 540 dp height (4K panel with 1080p override at
// density 320, so RN halves it). Real chrome measured on that device:
//   - tab bar         72 dp   (see (tabs)/_layout.tsx)
//   - safe area top   27 dp   (lib/tv.ts TV_SAFE_AREA.vertical)
//   - safe area bot   27 dp
//   - inter-margin    ~4  dp
// ≈ 130 dp, or ~24% of a 540 dp screen. Per-shelf label chrome
// (section title + item title/subtitle/meta + inter-shelf margin) is
// text-sized in fixed dp, not proportional — ~90 dp on any TV.
const TV_SCREEN_HEIGHT = Dimensions.get('window').height;
const TV_PAGE_CHROME = 130;
// Shrunk from 90 → 65 after tightening cardTitle/cardSubtitle/caption
// sizes below. Recovered ~25 dp per shelf → adds ~50 dp to each poster
// on a 540 dp Shield screen (roughly 46% larger).
const TV_SHELF_LABEL_CHROME = 65;
const TV_TARGET_SHELF_HEIGHT = Math.floor((TV_SCREEN_HEIGHT - TV_PAGE_CHROME) / 2);
const TV_POSTER_HEIGHT_CALC = Math.max(80, TV_TARGET_SHELF_HEIGHT - TV_SHELF_LABEL_CHROME);
// Round the width to preserve the 2:3 poster aspect ratio.
const TV_POSTER_WIDTH = isTV ? Math.floor(TV_POSTER_HEIGHT_CALC / 1.5) : 140;

if (isTV) {
  // Diagnostic — check what the runtime is actually reporting so we can
  // tune the chrome constants if the calculation is off on other
  // Android TV models. Shows up in `adb logcat -s ReactNativeJS`.
  console.log(
    `[theme] TV screen=${TV_SCREEN_HEIGHT}dp chrome=${TV_PAGE_CHROME} ` +
    `shelfTarget=${TV_TARGET_SHELF_HEIGHT} labelChrome=${TV_SHELF_LABEL_CHROME} ` +
    `poster=${TV_POSTER_WIDTH}x${TV_POSTER_HEIGHT_CALC}`,
  );
}

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
    fontSize: isTV ? 18 : 18,
    fontWeight: '600' as const,
    color: colors.text,
  },
  cardTitle: {
    fontSize: isTV ? 13 : 14,
    fontWeight: '600' as const,
    color: colors.text,
  },
  cardSubtitle: {
    fontSize: isTV ? 11 : 12,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
  body: {
    fontSize: isTV ? 18 : 14,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
  caption: {
    fontSize: isTV ? 11 : 11,
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

import { Platform } from 'react-native';

/** Whether the app is running on a TV (Android TV or Apple TV) */
export const isTV = Platform.isTV;

/** Whether running on Apple TV specifically */
export const isTVOS = (Platform as any).isTVOS === true;

/** Whether running on Android TV specifically */
export const isAndroidTV = isTV && Platform.OS === 'android';

/** Safe area padding for TV (10-foot UI guidelines) */
export const TV_SAFE_AREA = {
  horizontal: isTV ? 48 : 0,
  vertical: isTV ? 27 : 0,
};

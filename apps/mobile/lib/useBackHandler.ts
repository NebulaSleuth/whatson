import { useEffect } from 'react';
import { BackHandler, UIManager, Platform, findNodeHandle } from 'react-native';
import { isTV } from './tv';

/**
 * On Android TV, override the back button behavior for a screen.
 * The callback should return true if it handled the back press
 * (preventing default behavior like exiting the app).
 */
export function useTVBackHandler(handler: () => boolean) {
  useEffect(() => {
    if (!isTV) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      return handler();
    });

    return () => subscription.remove();
  }, [handler]);
}

/**
 * Programmatically set focus to a React component on Android TV.
 * Pass a ref to the component you want to focus.
 */
export function requestTVFocus(ref: React.RefObject<any>) {
  if (!isTV || !ref.current) return;
  try {
    const nodeHandle = findNodeHandle(ref.current);
    if (nodeHandle && Platform.OS === 'android') {
      UIManager.updateView(nodeHandle, 'RCTView', { hasTVPreferredFocus: true });
    }
  } catch {}
}

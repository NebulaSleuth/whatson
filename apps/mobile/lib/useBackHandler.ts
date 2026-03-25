import { useEffect } from 'react';
import { BackHandler } from 'react-native';
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

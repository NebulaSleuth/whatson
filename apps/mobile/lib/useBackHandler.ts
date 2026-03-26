import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { isTV } from './tv';

/**
 * On Android TV, override the back button behavior for a screen.
 * The callback should return true if it handled the back press
 * (preventing default behavior like exiting the app).
 *
 * Only fires when the screen is currently focused, so multiple
 * tabs can each register a handler without conflicting.
 */
export function useTVBackHandler(handler: () => boolean) {
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;

  useEffect(() => {
    if (!isTV) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isFocusedRef.current) return false;
      return handler();
    });

    return () => subscription.remove();
  }, [handler]);
}

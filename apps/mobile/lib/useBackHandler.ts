import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { isTV } from './tv';

/**
 * On TV (Android TV back button / Apple TV Siri Remote Menu button),
 * override the back behavior for a screen. The callback should return
 * true if it handled the back press (preventing default behavior like
 * exiting the app).
 *
 * `hardwareBackPress` covers both platforms: react-native-tvos's
 * BackHandler.ios.js subscribes to TVEventHandler and dispatches
 * `eventType === 'menu'` into the same subscription list, so no
 * separate tvOS event handler is needed here. Note the native side only
 * emits 'menu' once TVEventControl.enableTVMenuKey() has been called
 * (RCTTVRemoteHandler.m `useMenuKey`); before that tvOS handles Menu
 * itself and backgrounds the app.
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

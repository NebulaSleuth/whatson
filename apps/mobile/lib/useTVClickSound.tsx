import { useEffect, useRef } from 'react';
import { Audio } from 'expo-av';
import { usePathname } from 'expo-router';

let useTVEventHandler: any = null;
try {
  useTVEventHandler = require('react-native').useTVEventHandler;
} catch {}

const CLICK_SOUND = require('@/assets/sounds/click.mp3');

/**
 * Mounts a global Android TV "click" sound. Plays a short click on every
 * remote SELECT press. Suppressed in the player route so the sound never
 * fires during video playback.
 *
 * The Shield denies audio focus to playback that starts before any user
 * gesture (the "no sound until you adjust the volume" symptom). To work
 * around it, warm-up is deferred to the *first* SELECT — that's a real
 * user gesture and reliably grants focus.
 */
export function TVClickSound() {
  const soundRef = useRef<Audio.Sound | null>(null);
  const warmedUpRef = useRef(false);
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: false,
        });
        const { sound } = await Audio.Sound.createAsync(CLICK_SOUND, { volume: 0.2 });
        if (cancelled) {
          await sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
      } catch (err) {
        console.warn('[TVClickSound] preload failed:', (err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      const s = soundRef.current;
      soundRef.current = null;
      s?.unloadAsync().catch(() => {});
    };
  }, []);

  if (useTVEventHandler) {
    useTVEventHandler((evt: any) => {
      if (evt?.eventType !== 'select') return;
      const p = pathnameRef.current;
      if (p && p.startsWith('/player')) return;
      const sound = soundRef.current;
      if (!sound) return;
      // First SELECT after mount: fire two rapid plays. The first grabs
      // audio focus from the launcher; the second is the audible click
      // the user expects. Subsequent presses go through the single-play
      // fast path.
      if (!warmedUpRef.current) {
        warmedUpRef.current = true;
        sound.replayAsync()
          .then(() => sound.replayAsync())
          .catch(() => {});
        return;
      }
      sound.replayAsync().catch(() => {});
    });
  }

  return null;
}

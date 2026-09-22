/**
 * Reduce motion. The setting is three-state: `on` and `off` are the player's
 * own answer, `system` asks the platform — `AccessibilityInfo` and its
 * `reduceMotionChanged` event on a phone, `prefers-reduced-motion` on the
 * web. Two guards the platforms force: the native query *rejects* when its
 * module is absent (jest, a bare dev client), and a rejection means "no
 * preference", not "reduce"; react-native-web's own query resolves *true*
 * when `matchMedia` is missing (jsdom, an old browser), so on the web a page
 * without `matchMedia` is read as no preference here as well.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import type { ReduceMotionChoice } from './app/settings';

const QUERY = '(prefers-reduced-motion: reduce)';

/** The web's media query, or null off the web and wherever `matchMedia` is missing. */
function webMedia(): MediaQueryList | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(QUERY);
}

/** Whether the platform asks for less motion right now, kept current. */
export function useSystemReduceMotion(): boolean {
  const [reduced, setReduced] = useState(() => webMedia()?.matches ?? false);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const media = webMedia();
      if (!media) return;
      const onChange = (e: { matches: boolean }) => setReduced(e.matches);
      // Safari before 14 has only the older pair.
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', onChange);
        return () => media.removeEventListener('change', onChange);
      }
      media.addListener(onChange);
      return () => media.removeListener(onChange);
    }
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) setReduced(on);
      })
      .catch(() => {
        if (alive) setReduced(false);
      });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
      if (alive) setReduced(on);
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

/** The setting resolved: the player's override either way, or the platform's answer. */
export function useReduceMotion(setting: ReduceMotionChoice): boolean {
  const system = useSystemReduceMotion();
  return setting === 'system' ? system : setting === 'on';
}

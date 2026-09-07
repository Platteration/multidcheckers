/**
 * Haptic and audio feedback, guarded by the user's settings and by platform
 * support. Each function names a moment in the game, not a device effect,
 * so screens don't need to know which cue is which.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { playSound, setSoundEnabled } from './sound';

let hapticsOn = true;

export function setHapticsEnabled(on: boolean): void {
  hapticsOn = on;
}

export { setSoundEnabled };

async function haptic(fn: () => Promise<void>): Promise<void> {
  if (!hapticsOn || Platform.OS === 'web') return;
  try {
    await fn();
  } catch {
    // Device without a haptic engine; nothing to do.
  }
}

/** A light tick: selecting or placing something. */
export function tap(): void {
  playSound('tap');
  void haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A heavier thud: a disc lands, a piece is captured. */
export function thud(): void {
  playSound('thud');
  void haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
}

/** The board turns. */
export function spin(): void {
  playSound('spin');
  void haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** A time travel branched a new timeline. */
export function warp(): void {
  playSound('warp');
  void haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

export function win(): void {
  playSound('win');
  void haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

export function nope(): void {
  playSound('nope');
  void haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}

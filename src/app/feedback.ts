/**
 * Haptic feedback, guarded by the user's setting and by platform support.
 * Sound lives in ./sound.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

let enabled = true;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

async function run(fn: () => Promise<void>): Promise<void> {
  if (!enabled || Platform.OS === 'web') return;
  try {
    await fn();
  } catch {
    // Device without a haptic engine; nothing to do.
  }
}

/** A light tick: selecting or placing something. */
export function tap(): void {
  void run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A heavier thud: a disc lands, a piece is captured, the board spins. */
export function thud(): void {
  void run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
}

/** Something notable happened: a time travel branched a new timeline. */
export function warp(): void {
  void run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

export function win(): void {
  void run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

export function nope(): void {
  void run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { haptics as VOCAB, type HapticName } from '@mada/shared';

/*
 * The haptic vocabulary (EXPERIENCE.md §4.6), the prototype's HAPTIC map on native patterns. One haptic per action.
 * The web build vibrates where browsers allow it (Android Chrome), as the prototype did.
 * Core Haptics / Android compositions (heartbeat, touchdown) come with the native haptics module later.
 */
let enabled = true;
export const setHapticsEnabled = (on: boolean) => { enabled = on; };

const IMPACT: Record<string, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light, soft: Haptics.ImpactFeedbackStyle.Soft, heavy: Haptics.ImpactFeedbackStyle.Heavy,
  rigid: Haptics.ImpactFeedbackStyle.Rigid, medium: Haptics.ImpactFeedbackStyle.Medium,
};
const NOTIFY: Record<string, Haptics.NotificationFeedbackType> = {
  success: Haptics.NotificationFeedbackType.Success, warning: Haptics.NotificationFeedbackType.Warning, error: Haptics.NotificationFeedbackType.Error,
};

export function buzz(name: HapticName): void {
  if (!enabled) return;
  const h = VOCAB[name];
  if (Platform.OS === 'web') {
    try { (globalThis.navigator as Navigator | undefined)?.vibrate?.(h.web as number | number[]); } catch { /* not supported */ }
    return;
  }
  const p = h.kind === 'selection' ? Haptics.selectionAsync()
    : h.kind === 'notification' ? Haptics.notificationAsync(NOTIFY[h.style] ?? Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(IMPACT[h.style] ?? Haptics.ImpactFeedbackStyle.Light);
  p.catch(() => {});
}

/** Ticks that get stronger as the slide-to-book knob nears the end. */
export function tick(step: 0 | 1 | 2): void {
  if (!enabled) return;
  if (Platform.OS === 'web') { try { (globalThis.navigator as Navigator | undefined)?.vibrate?.(6 + step * 6); } catch { /* */ } return; }
  Haptics.impactAsync([Haptics.ImpactFeedbackStyle.Light, Haptics.ImpactFeedbackStyle.Medium, Haptics.ImpactFeedbackStyle.Rigid][step]!).catch(() => {});
}

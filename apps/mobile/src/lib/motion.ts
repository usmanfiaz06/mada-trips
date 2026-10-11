import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, type ViewStyle } from 'react-native';
import { FadeInDown } from 'react-native-reanimated';

/** Reduce Motion replaces movement with stillness (EXPERIENCE.md §4.5). */
export function useReduceMotion() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setOn).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOn);
    return () => sub.remove();
  }, []);
  return on;
}

/**
 * The prototype's `.rise` entrance (12 points up, 500 ms, its ease), staggered by `step` × 60 ms, for `entering=`.
 *
 * Phones only: on the web, Reanimated's entering animations can stall and leave the view absolutely positioned
 * (top: -120px, over the next view), so there `rise()` is nothing and the view sits in its normal place. Pair it with
 * `style={riseStyle(step)}` to get the same movement on the web as a plain CSS animation.
 */
export const rise = (step = 0) => (Platform.OS === 'web' ? undefined : FadeInDown.duration(500).delay(step * 60).withInitialValues({ opacity: 0, transform: [{ translateY: 12 }] }));

/**
 * The web's rise as a CSS animation (nothing on phones). `fadeOnly` for views that carry their own transform
 * (a rotated photo), which a transform keyframe would override.
 */
export const riseStyle = (step = 0, fadeOnly = false): ViewStyle | null => (Platform.OS === 'web' ? ({
  animationKeyframes: [fadeOnly
    ? { from: { opacity: 0 }, to: { opacity: 1 } }
    : { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'translateY(0px)' } }],
  animationDuration: '500ms', animationDelay: `${step * 60}ms`, animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)', animationFillMode: 'both',
} as unknown as ViewStyle) : null);

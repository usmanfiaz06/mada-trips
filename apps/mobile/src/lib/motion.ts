import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, type ViewStyle } from 'react-native';
import { rise } from './rise';

export { rise };

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
 * The web's rise as a CSS animation (nothing on phones). `fadeOnly` for views that carry their own transform
 * (a rotated photo), which a transform keyframe would override.
 */
export const riseStyle = (step = 0, fadeOnly = false): ViewStyle | null => (Platform.OS === 'web' ? ({
  animationKeyframes: [fadeOnly
    ? { from: { opacity: 0 }, to: { opacity: 1 } }
    : { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'translateY(0px)' } }],
  animationDuration: '500ms', animationDelay: `${step * 60}ms`, animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)', animationFillMode: 'both',
} as unknown as ViewStyle) : null);

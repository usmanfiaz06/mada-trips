import { useEffect, useState } from 'react';
import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useReduceMotion } from '@/lib/motion';
import { colors, radii } from '@/theme';

/*
 * Placeholders in the shape of what's coming: a soft sheen moves across them once every 1.6 s. With Reduce Motion on
 * they simply sit still (EXPERIENCE.md §4.5). Screen readers hear one "Loading" for the group, not each bar.
 */

const BASE = '#e6ded1';

function Sheen({ width }: { width: number }) {
  const x = useSharedValue(-1);
  useEffect(() => {
    x.set(withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.quad) }), -1, false));
    return () => cancelAnimation(x);
  }, [x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() * width }] }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#fffdf9" stopOpacity="0" />
            <Stop offset="0.5" stopColor="#fffdf9" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#fffdf9" stopOpacity="0" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#sheen)" />
      </Svg>
    </Animated.View>
  );
}

/** One placeholder block. */
export function Skeleton({ width = '100%', height = 14, radius = 7, style }: { width?: DimensionValue; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const still = useReduceMotion();
  const [w, setW] = useState(0);
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={[{ width, height, borderRadius: radius, backgroundColor: BASE, overflow: 'hidden' }, style]}>
      {!still && w > 0 ? <Sheen width={w} /> : null}
    </View>
  );
}

/** A few lines of text, the last one shorter. */
export function SkeletonLines({ lines = 3, gap = 9 }: { lines?: number; gap?: number }) {
  return (
    <View style={{ gap }}>
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} width={i === lines - 1 ? '62%' : '100%'} height={12} />)}
    </View>
  );
}

/** A card-shaped placeholder: a title, two lines, optionally a picture on top. */
export function SkeletonCard({ photo, style }: { photo?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.card, style]}>
      {photo ? <Skeleton height={132} radius={18} /> : null}
      <Skeleton width="55%" height={18} radius={9} />
      <SkeletonLines lines={2} />
    </View>
  );
}

/** A list of card placeholders for a screen that's loading. */
export function SkeletonList({ count = 3, photo }: { count?: number; photo?: boolean }) {
  return (
    <View style={{ gap: 12 }} accessible accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, i) => <SkeletonCard key={i} photo={photo && i === 0} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.paper, borderRadius: radii.card, padding: 16, gap: 12 },
});

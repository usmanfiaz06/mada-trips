import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { useReduceMotion } from '@/lib/motion';

/*
 * The crash drawing, told as a holding pattern (prototype ArtHolding): a plane circles the fix while we sort it out,
 * a gold trail following it round, clouds either side. Calm, never stuck. Reduce Motion parks the plane on the top leg.
 * Same 160×120 board as the other state drawings; the plane rides on top as its own view so it can turn smoothly.
 */
const INK = '#1e352d';
const GOLD = '#d9b77a';
const GOLD_INK = '#7d5d27';
const PAPER = '#fffdf9';
const TRACK = '#e3d6bf';

const R = 24, X0 = 44, X1 = 116, CY = 60, TOP = CY - R, BOTTOM = CY + R;
const STRAIGHT = X1 - X0;
const ARC = Math.PI * R;
const LEN = 2 * STRAIGHT + 2 * ARC;
const HOLD = `M${X0} ${TOP} H${X1} A${R} ${R} 0 0 1 ${X1} ${BOTTOM} H${X0} A${R} ${R} 0 0 1 ${X0} ${TOP} Z`;
const TRAIL = 44;
const LAP_MS = 9000;
const PLANE = 'M9.5 0 C9.5 -1.3 8 -1.6 6.5 -1.6 L2.6 -1.6 L-1.4 -8.6 L-3.8 -8.6 L-1.9 -1.6 L-5.8 -1.6 L-7.6 -4.2 L-9.3 -4.2 L-8.3 -0.8 L-8.3 0.8 L-9.3 4.2 L-7.6 4.2 L-5.8 1.6 L-1.9 1.6 L-3.8 8.6 L-1.4 8.6 L2.6 1.6 L6.5 1.6 C8 1.6 9.5 1.3 9.5 0 Z';
const PLANE_BOX = 28; // board units the plane's own canvas covers (it is about 19 long, scaled 1.4)

/** Where the plane is (board units) and which way it points (radians), `d` units round the pattern. */
function at(d: number) {
  'worklet';
  const s = ((d % LEN) + LEN) % LEN;
  if (s < STRAIGHT) return { x: X0 + s, y: TOP, a: 0 };
  if (s < STRAIGHT + ARC) { const t = -Math.PI / 2 + (s - STRAIGHT) / R; return { x: X1 + R * Math.cos(t), y: CY + R * Math.sin(t), a: t + Math.PI / 2 }; }
  if (s < 2 * STRAIGHT + ARC) return { x: X1 - (s - STRAIGHT - ARC), y: BOTTOM, a: Math.PI };
  const t = Math.PI / 2 + (s - 2 * STRAIGHT - ARC) / R;
  return { x: X0 + R * Math.cos(t), y: CY + R * Math.sin(t), a: t + Math.PI / 2 };
}

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function ArtHolding({ width = 176, height = 132 }: { width?: number; height?: number }) {
  const still = useReduceMotion();
  const k = width / 160;
  const d = useSharedValue(54);
  useEffect(() => {
    if (still) { cancelAnimation(d); d.set(54); return; }
    d.set(0);
    d.set(withRepeat(withTiming(LEN, { duration: LAP_MS, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(d);
  }, [still, d]);

  const trail = useAnimatedProps(() => ({ strokeDashoffset: TRAIL - d.get() }));
  const plane = useAnimatedStyle(() => {
    const p = at(d.get());
    return { transform: [{ translateX: (p.x - PLANE_BOX / 2) * k }, { translateY: (p.y - PLANE_BOX / 2) * k }, { rotate: `${p.a}rad` }] };
  });

  return (
    <View style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height} viewBox="0 0 160 120">
        <Path d="M8 18 a7 7 0 0 1 12 -5 a9 9 0 0 1 16 4 a6 6 0 0 1 0 12 h-26 a6 6 0 0 1 -2 -11 z" fill={PAPER} opacity={0.9} />
        <Path d="M120 98 a6 6 0 0 1 10 -4 a8 8 0 0 1 14 3 a5 5 0 0 1 0 10 h-22 a5 5 0 0 1 -2 -9 z" fill={PAPER} opacity={0.75} />
        <Path d={HOLD} fill="none" stroke={TRACK} strokeWidth={1.6} strokeDasharray="2 5" strokeLinecap="round" />
        <Circle cx={80} cy={CY} r={9} fill={GOLD} opacity={0.18} />
        <Circle cx={80} cy={CY} r={3.5} fill={GOLD} stroke={GOLD_INK} strokeWidth={1.4} />
        {still ? null : (
          <AnimatedPath d={HOLD} fill="none" stroke={GOLD} strokeWidth={2.4} strokeLinecap="round" strokeDasharray={[TRAIL, LEN]} opacity={0.75} animatedProps={trail} />
        )}
      </Svg>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: PLANE_BOX * k, height: PLANE_BOX * k }, plane]}>
        <Svg width={PLANE_BOX * k} height={PLANE_BOX * k} viewBox={`${-PLANE_BOX / 2} ${-PLANE_BOX / 2} ${PLANE_BOX} ${PLANE_BOX}`}>
          <G scale={1.4}><Path d={PLANE} fill={INK} stroke={PAPER} strokeWidth={0.8} strokeLinejoin="round" /></G>
        </Svg>
      </Animated.View>
    </View>
  );
}

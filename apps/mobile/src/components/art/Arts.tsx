import { useId } from 'react';
import Svg, { Circle, ClipPath, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

/*
 * The empty-state drawings from the prototype (ui.jsx): one hand, 2-unit strokes on a 160×120 board, paper fills,
 * green ink, gold for the one thing that is alive. Static here; their motion comes with the Reanimated pass.
 */
type ArtProps = { width?: number; height?: number };

function Art({ children, width = 176, height = 132 }: ArtProps & { children: React.ReactNode }) {
  return <Svg width={width} height={height} viewBox="0 0 160 120" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{children}</Svg>;
}

/** Dots that find each other: people, friends, household. The gold one is you. */
export function ArtFriends(p: ArtProps) {
  const pts: [number, number][] = [[80, 62], [34, 34], [124, 28], [132, 88], [32, 92]];
  return (
    <Art {...p}>
      {pts.slice(1).map(([x, y], i) => (
        <Line key={i} x1={80} y1={62} x2={x} y2={y} stroke={i === 3 ? '#b98f4a' : '#c9b48a'} strokeWidth={2} strokeLinecap="round" strokeDasharray={i === 3 ? '2 5' : undefined} />
      ))}
      <Path d="M34 34 Q 80 12 124 28" fill="none" stroke="#e0d1b4" strokeWidth={1.6} strokeLinecap="round" />
      <Path d="M124 28 Q 142 58 132 88" fill="none" stroke="#e0d1b4" strokeWidth={1.6} strokeLinecap="round" />
      {pts.slice(1, 4).map(([x, y], i) => <Circle key={i} cx={x} cy={y} r={i === 1 ? 10 : 9} fill={i === 1 ? '#1e352d' : '#fffdf9'} stroke="#1e352d" strokeWidth={2.2} />)}
      <Circle cx={32} cy={92} r={11} fill="#fffdf9" stroke="#b98f4a" strokeWidth={1.8} strokeDasharray="3.5 3.5" />
      <Path d="M32 87 v10 M27 92 h10" stroke="#b98f4a" strokeWidth={2} strokeLinecap="round" />
      <Circle cx={80} cy={62} r={20} fill="#d9b77a" opacity={0.25} />
      <Circle cx={80} cy={62} r={13} fill="#d9b77a" stroke="#7d5d27" strokeWidth={2.2} />
    </Art>
  );
}

/** Three rings that overlap: a circle of people, planning together. */
export function ArtCircles(p: ArtProps) {
  return (
    <Art {...p}>
      <Circle cx={58} cy={66} r={28} fill="rgba(30,53,45,0.05)" stroke="#1e352d" strokeWidth={2} /><Circle cx={58} cy={66} r={5} fill="#1e352d" />
      <Circle cx={102} cy={66} r={28} fill="rgba(217,183,122,0.12)" stroke="#b98f4a" strokeWidth={2} /><Circle cx={102} cy={66} r={5} fill="#b98f4a" />
      <Circle cx={80} cy={42} r={22} fill="none" stroke="#d9b77a" strokeWidth={2} strokeDasharray="4 5" /><Circle cx={80} cy={42} r={5} fill="#d9b77a" />
    </Art>
  );
}

/** A wallet pocket with a document rising out of it: documents, cards, refunds. */
export function ArtCardSlot({ kind = 'card', ...p }: ArtProps & { kind?: 'card' | 'doc' }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Art {...p}>
      <Defs>
        <ClipPath id={`c${id}`}><Rect x={44} y={18} width={72} height={70} /></ClipPath>
        <LinearGradient id={`g${id}`} x1="0" x2="1" y1="0" y2="0"><Stop offset="0" stopColor="#fff" stopOpacity="0" /><Stop offset="0.5" stopColor="#fff" stopOpacity="0.75" /><Stop offset="1" stopColor="#fff" stopOpacity="0" /></LinearGradient>
      </Defs>
      <G clipPath={`url(#c${id})`}>
        {kind === 'doc' ? (<>
          <Path d="M56 26 h34 l14 14 v52 h-48 z" fill="#fffdf9" stroke="#1e352d" strokeWidth={2} strokeLinejoin="round" />
          <Path d="M90 26 v14 h14" fill="none" stroke="#1e352d" strokeWidth={2} strokeLinejoin="round" />
          <Path d="M64 50 h22 M64 58 h30 M64 66 h26" stroke="#d9b77a" strokeWidth={2.4} strokeLinecap="round" />
        </>) : (<>
          <Rect x={50} y={30} width={60} height={40} rx={7} fill="#d9b77a" stroke="#7d5d27" strokeWidth={1.5} />
          <Rect x={58} y={40} width={12} height={9} rx={2} fill="#f4e2bd" stroke="#7d5d27" strokeWidth={1} />
          <Path d="M58 60 h26" stroke="#7d5d27" strokeWidth={2} strokeLinecap="round" opacity={0.6} />
        </>)}
      </G>
      <Path d="M36 66 h88 v26 a10 10 0 0 1 -10 10 h-68 a10 10 0 0 1 -10 -10 z" fill="#1e352d" />
      <Path d="M42 72 h76" stroke="#d9b77a" strokeWidth={1.2} strokeDasharray="3 4" opacity={0.7} />
      <Circle cx={80} cy={88} r={4} fill="none" stroke="#d9b77a" strokeWidth={1.5} />
    </Art>
  );
}

/** A boarding pass with its stub: passes and tracked flights. */
export function ArtPass(p: ArtProps) {
  return (
    <Art {...p}>
      <Path d="M26 36 h82 a6 6 0 0 0 12 0 h14 a6 6 0 0 1 6 6 v36 a6 6 0 0 1 -6 6 h-14 a6 6 0 0 0 -12 0 h-82 a6 6 0 0 1 -6 -6 v-36 a6 6 0 0 1 6 -6 z" fill="#fffdf9" stroke="#1e352d" strokeWidth={2} strokeLinejoin="round" />
      <Path d="M114 44 v32" stroke="#e3d6bf" strokeWidth={1.5} strokeDasharray="3 4" />
      <Path d="M32 50 h16 M32 70 h30 M124 52 h10 M124 60 h6" stroke="#e3d6bf" strokeWidth={2.4} strokeLinecap="round" />
      <SvgText x={32} y={64} fontSize={10} fontWeight="700" fill="#1e352d" fontFamily="InterTight_700Bold">RUH</SvgText>
      <SvgText x={80} y={64} fontSize={10} fontWeight="700" fill="#b98f4a" fontFamily="InterTight_700Bold">???</SvgText>
      <Path d="M58 60 h18" stroke="#b98f4a" strokeWidth={1.5} strokeDasharray="1 3" strokeLinecap="round" />
      <Path d="M-5 -3 L5 0 L-5 3 L-2.5 0 Z" fill="#1e352d" transform="translate(64 60)" />
    </Art>
  );
}

/** A paper plane on a dotted loop: nothing waiting on Faisal. */
export function ArtPaperPlane({ width = 300, height = 120 }: ArtProps) {
  return (
    <Svg width={width} height={height} viewBox="0 0 300 120" accessibilityElementsHidden>
      <Path d="M10 90 C 70 90, 90 20, 150 30 S 250 110, 290 40" fill="none" stroke="#c9b48a" strokeWidth={2} strokeDasharray="2 8" strokeLinecap="round" />
      <G transform="translate(150 30) rotate(-8)">
        <Path d="M-12 -7 L12 0 L-12 7 L-6 0 Z" fill="#1e352d" />
        <Path d="M-6 0 L12 0 L-9 4 Z" fill="#d9b77a" />
      </G>
    </Svg>
  );
}

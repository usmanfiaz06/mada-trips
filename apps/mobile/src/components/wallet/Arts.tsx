import { useId } from 'react';
import { View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
import { Sun } from '../Sun';

/* The empty-state drawings the Wallet, account and support screens use (prototype ui.jsx), in the same hand as art/Arts.tsx. */

type ArtProps = { width?: number; height?: number };
function Art({ children, width = 176, height = 132 }: ArtProps & { children: React.ReactNode }) {
  return <Svg width={width} height={height} viewBox="0 0 160 120" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{children}</Svg>;
}

/** A receipt printing: money that hasn't moved yet. */
export function ArtReceipt(p: ArtProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <Art {...p}>
      <Defs><ClipPath id={`r${id}`}><Rect x={40} y={34} width={80} height={80} /></ClipPath></Defs>
      <G clipPath={`url(#r${id})`}>
        <Path d="M54 30 h52 v66 l-6.5 5 l-6.5 -5 l-6.5 5 l-6.5 -5 l-6.5 5 l-6.5 -5 l-6.5 5 l-6.5 -5 z" fill="#fffdf9" stroke="#1e352d" strokeWidth={1.8} strokeLinejoin="round" />
        <Path d="M62 48 h26 M62 56 h36 M62 64 h20" stroke="#e3d6bf" strokeWidth={2.4} strokeLinecap="round" />
        <Path d="M62 80 h18" stroke="#1e352d" strokeWidth={2.4} strokeLinecap="round" />
        <Path d="M90 80 h8" stroke="#b98f4a" strokeWidth={2.4} strokeLinecap="round" />
      </G>
      <Rect x={34} y={24} width={92} height={14} rx={7} fill="#1e352d" />
      <Path d="M44 31 h72" stroke="#0f1a16" strokeWidth={3} strokeLinecap="round" />
      <Circle cx={116} cy={31} r={2} fill="#d9b77a" />
    </Art>
  );
}

/** A packed case with a luggage tag: requests, stays, loyalty. */
export function ArtSuitcase(p: ArtProps) {
  return (
    <Art {...p}>
      <Path d="M68 40 v-8 a5 5 0 0 1 5-5 h14 a5 5 0 0 1 5 5 v8" fill="none" stroke="#1e352d" strokeWidth={2.4} strokeLinejoin="round" />
      <Rect x={46} y={40} width={68} height={56} rx={11} fill="#fffdf9" stroke="#1e352d" strokeWidth={2.4} />
      <Path d="M62 40 v56 M98 40 v56" stroke="#d9b77a" strokeWidth={5} />
      <Path d="M46 62 h68" stroke="#e3d6bf" strokeWidth={1.5} />
      <Circle cx={58} cy={100} r={3.2} fill="#1e352d" /><Circle cx={102} cy={100} r={3.2} fill="#1e352d" />
      <Path d="M88 34 C 96 40, 104 44, 110 50" fill="none" stroke="#7d5d27" strokeWidth={1.5} />
      <G transform="rotate(14 116 60)"><Rect x={106} y={50} width={20} height={30} rx={4} fill="#d9b77a" stroke="#7d5d27" strokeWidth={1.5} /><Circle cx={116} cy={56} r={2} fill="#fffdf9" /><Path d="M110 66 h12 M110 72 h8" stroke="#7d5d27" strokeWidth={1.5} strokeLinecap="round" /></G>
    </Art>
  );
}

/** Two bubbles: a conversation that hasn't started. */
export function ArtChat(p: ArtProps) {
  return (
    <Art {...p}>
      <G transform="translate(12 0)">
        <Path d="M30 34 h64 a12 12 0 0 1 12 12 v18 a12 12 0 0 1 -12 12 h-46 l-12 10 v-10 h-6 a12 12 0 0 1 -12 -12 v-18 a12 12 0 0 1 12 -12 z" fill="#fffdf9" stroke="#1e352d" strokeWidth={2} strokeLinejoin="round" />
      </G>
      <Circle cx={62} cy={55} r={3.6} fill="#1e352d" /><Circle cx={74} cy={55} r={3.6} fill="#1e352d" /><Circle cx={86} cy={55} r={3.6} fill="#1e352d" />
      <Path d="M100 74 h28 a10 10 0 0 1 10 10 v4 a10 10 0 0 1 -10 10 h-2 v8 l-10 -8 h-16 a10 10 0 0 1 -10 -10 v-4 a10 10 0 0 1 10 -10 z" fill="#d9b77a" stroke="#7d5d27" strokeWidth={1.5} strokeLinejoin="round" />
      <Path d="M100 86 h18" stroke="#7d5d27" strokeWidth={2} strokeLinecap="round" opacity={0.55} />
    </Art>
  );
}

/** One phone, one quiet check: signed in only here. */
export function ArtPhone(p: ArtProps) {
  return (
    <Art {...p}>
      <Circle cx={80} cy={60} r={34} fill="#d9b77a" opacity={0.18} />
      <Rect x={62} y={22} width={36} height={76} rx={9} fill="#fffdf9" stroke="#1e352d" strokeWidth={2.2} />
      <Path d="M74 28 h12" stroke="#1e352d" strokeWidth={2.2} strokeLinecap="round" />
      <Circle cx={80} cy={60} r={11} fill="#1e352d" />
      <Path d="M75 60 l3.5 3.5 l6.5 -7" fill="none" stroke="#d9b77a" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M40 46 h10 M38 60 h12 M40 74 h10 M110 46 h10 M110 60 h12 M110 74 h10" stroke="#e3d6bf" strokeWidth={2} strokeLinecap="round" strokeDasharray="2 4" />
    </Art>
  );
}

/** An envelope with a letter lifting out: email, invites. */
export function ArtEnvelope(p: ArtProps) {
  return (
    <Art {...p}>
      <Rect x={56} y={32} width={48} height={44} rx={4} fill="#fffdf9" stroke="#1e352d" strokeWidth={1.8} />
      <Path d="M64 44 h24 M64 52 h32 M64 60 h18" stroke="#d9b77a" strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M40 58 l40 28 l40 -28 v38 a6 6 0 0 1 -6 6 h-68 a6 6 0 0 1 -6 -6 z" fill="#f4ecdd" stroke="#1e352d" strokeWidth={2} strokeLinejoin="round" />
      <Path d="M40 102 l30 -24 M120 102 l-30 -24" stroke="#1e352d" strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
      <Circle cx={80} cy={84} r={5.5} fill="#d9b77a" stroke="#7d5d27" strokeWidth={1.2} />
    </Art>
  );
}

/** Rings and a sweep: all quiet, but we're watching (the inbox). */
export function QuietRadar() {
  return (
    <View style={{ width: 150, height: 150, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={150} height={150} viewBox="0 0 150 150" style={{ position: 'absolute' }}>
        <Circle cx={75} cy={75} r={74} fill="none" stroke="rgba(185,143,74,0.35)" />
        <Circle cx={75} cy={75} r={49} fill="none" stroke="rgba(185,143,74,0.35)" />
        <Circle cx={75} cy={75} r={24} fill="none" stroke="rgba(185,143,74,0.35)" />
        <Path d="M75 75 L75 1 A74 74 0 0 1 132 28 Z" fill="rgba(217,183,122,0.28)" />
        <Circle cx={112} cy={31} r={3.5} fill="#4fbf7a" />
      </Svg>
      <Sun width={30} color="#b98f4a" />
    </View>
  );
}

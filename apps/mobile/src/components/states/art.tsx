import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

/*
 * Drawings for when things go wrong, in the empty-state family (components/art/Arts.tsx): one hand, 2-unit strokes on
 * a 160×120 board, paper fills, green ink, gold for the one thing that still works. Never alarming: no red, no
 * warning triangles. Each says what happened at a glance and, where it can, what's still fine.
 */

type P = { width?: number; height?: number };
const INK = '#1e352d';
const GOLD = '#d9b77a';
const GOLD_DEEP = '#b98f4a';
const GOLD_INK = '#7d5d27';
const PAPER = '#fffdf9';
const FAINT = '#e0d1b4';

function Board({ children, width = 176, height = 132 }: P & { children: React.ReactNode }) {
  return <Svg width={width} height={height} viewBox="0 0 160 120" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{children}</Svg>;
}

/** Offline: the phone holds the trip (gold card inside); the signal above it breaks off. */
export function ArtNoSignal(p: P) {
  return (
    <Board {...p}>
      <Rect x={56} y={22} width={48} height={84} rx={10} fill={PAPER} stroke={INK} strokeWidth={2} />
      <Path d="M74 28 h12" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <Rect x={63} y={48} width={34} height={22} rx={5} fill={GOLD} stroke={GOLD_INK} strokeWidth={1.5} />
      <Path d="M68 56 h14 M68 62 h20" stroke={GOLD_INK} strokeWidth={1.8} strokeLinecap="round" opacity={0.7} />
      <Path d="M68 80 h24 M68 88 h16" stroke={FAINT} strokeWidth={2.4} strokeLinecap="round" />
      <G fill="none" strokeLinecap="round" strokeWidth={2}>
        <Path d="M112 34 a10 10 0 0 1 10 -10" stroke={INK} />
        <Path d="M112 24 a20 20 0 0 1 14 -10" stroke={INK} strokeDasharray="3 5" opacity={0.55} />
        <Path d="M134 20 a28 28 0 0 1 6 12" stroke={INK} strokeDasharray="1 6" opacity={0.3} />
      </G>
      <Circle cx={112} cy={34} r={3} fill={INK} />
    </Board>
  );
}

/** Our side didn't answer: a route with a gap in it, the destination still waiting in gold. */
export function ArtRouteGap(p: P) {
  return (
    <Board {...p}>
      <Path d="M24 88 C 44 40, 66 30, 74 32" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" strokeDasharray="4 6" />
      <Path d="M96 34 C 112 38, 128 54, 136 80" fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" strokeDasharray="4 6" opacity={0.45} />
      <Path d="M78 30 l4 -3 M90 34 l-4 3" stroke={GOLD_DEEP} strokeWidth={2} strokeLinecap="round" />
      <Circle cx={24} cy={88} r={7} fill={PAPER} stroke={INK} strokeWidth={2} />
      <Circle cx={24} cy={88} r={2.5} fill={INK} />
      <Circle cx={136} cy={84} r={14} fill={GOLD} opacity={0.22} />
      <Circle cx={136} cy={84} r={8} fill={GOLD} stroke={GOLD_INK} strokeWidth={2} />
      <Path d="M58 52 l8 -3 l-2 5 z" fill={INK} />
    </Board>
  );
}

/** A crash: the cable came apart. The plug (gold) is fine; it just needs joining again. */
export function ArtFrayed(p: P) {
  return (
    <Board {...p}>
      <Path d="M14 74 C 34 74, 40 60, 64 60" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />
      <G stroke={INK} strokeWidth={1.6} strokeLinecap="round">
        <Path d="M64 60 l8 -6" /><Path d="M64 60 l9 1" /><Path d="M64 60 l7 6" />
      </G>
      <Path d="M80 52 l4 -6 M86 60 h7 M80 68 l4 6" stroke={GOLD_DEEP} strokeWidth={1.8} strokeLinecap="round" />
      <Rect x={100} y={48} width={30} height={24} rx={6} fill={GOLD} stroke={GOLD_INK} strokeWidth={2} />
      <Path d="M100 55 h-8 M100 65 h-8" stroke={GOLD_INK} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M130 60 C 140 60, 142 74, 150 76" fill="none" stroke={INK} strokeWidth={4} strokeLinecap="round" />
    </Board>
  );
}

/** Maintenance: a small sign on the door, the sun behind it. */
export function ArtSign(p: P) {
  return (
    <Board {...p}>
      <Circle cx={118} cy={40} r={16} fill={GOLD} opacity={0.3} />
      <Circle cx={118} cy={40} r={9} fill={GOLD} stroke={GOLD_INK} strokeWidth={2} />
      <Path d="M80 18 v12" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <Circle cx={80} cy={18} r={3} fill={INK} />
      <Path d="M80 30 L 54 50 M80 30 L 106 50" stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
      <Rect x={46} y={50} width={68} height={40} rx={8} fill={PAPER} stroke={INK} strokeWidth={2} />
      <Path d="M58 64 h44 M58 76 h28" stroke={FAINT} strokeWidth={2.6} strokeLinecap="round" />
      <Circle cx={96} cy={76} r={5} fill="none" stroke={GOLD_DEEP} strokeWidth={1.8} />
      <Path d="M96 73.5 v2.5 l1.8 1.2" stroke={GOLD_DEEP} strokeWidth={1.5} strokeLinecap="round" />
    </Board>
  );
}

/** Update: a phone with the new version rising into it. */
export function ArtUpdate(p: P) {
  return (
    <Board {...p}>
      <Rect x={56} y={20} width={48} height={86} rx={10} fill={PAPER} stroke={INK} strokeWidth={2} />
      <Path d="M74 26 h12" stroke={INK} strokeWidth={2} strokeLinecap="round" />
      <Circle cx={80} cy={62} r={18} fill={GOLD} opacity={0.25} />
      <Path d="M80 74 V 50 M70 60 l10 -10 l10 10" fill="none" stroke={GOLD_INK} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M68 92 h24" stroke={FAINT} strokeWidth={2.4} strokeLinecap="round" />
    </Board>
  );
}

/** Not there any more: an empty place where a card was, dashed; a pin still marks where you were. */
export function ArtMissing(p: P) {
  return (
    <Board {...p}>
      <Rect x={34} y={34} width={92} height={56} rx={10} fill="none" stroke={INK} strokeWidth={2} strokeDasharray="5 6" opacity={0.5} />
      <Path d="M48 54 h30 M48 66 h44" stroke={FAINT} strokeWidth={2.4} strokeLinecap="round" />
      <Path d="M118 22 c-8 0 -13 6 -13 12 c0 9 13 20 13 20 s13 -11 13 -20 c0 -6 -5 -12 -13 -12 z" fill={GOLD} stroke={GOLD_INK} strokeWidth={2} />
      <Circle cx={118} cy={34} r={4} fill={PAPER} />
    </Board>
  );
}

/** Permission off: a switch, off, with the thing it would open faint behind it. */
export function ArtSwitch({ glyph = 'camera', ...p }: P & { glyph?: 'camera' | 'contacts' | 'location' | 'notifications' | 'photos' }) {
  const behind = {
    camera: <><Rect x={30} y={36} width={40} height={30} rx={6} fill="none" stroke={INK} strokeWidth={2} opacity={0.35} /><Circle cx={50} cy={51} r={8} fill="none" stroke={INK} strokeWidth={2} opacity={0.35} /></>,
    contacts: <><Circle cx={50} cy={44} r={8} fill="none" stroke={INK} strokeWidth={2} opacity={0.35} /><Path d="M36 70 c2 -9 8 -13 14 -13 s12 4 14 13" fill="none" stroke={INK} strokeWidth={2} opacity={0.35} /></>,
    location: <><Path d="M50 72 s-14 -12 -14 -24 a14 14 0 0 1 28 0 c0 12 -14 24 -14 24 z" fill="none" stroke={INK} strokeWidth={2} opacity={0.35} /><Circle cx={50} cy={48} r={4} fill="none" stroke={INK} strokeWidth={2} opacity={0.35} /></>,
    notifications: <Path d="M38 64 v-12 a12 12 0 0 1 24 0 v12 l3 4 h-30 z M46 72 a4 4 0 0 0 8 0" fill="none" stroke={INK} strokeWidth={2} opacity={0.35} />,
    photos: <><Rect x={30} y={36} width={40} height={32} rx={5} fill="none" stroke={INK} strokeWidth={2} opacity={0.35} /><Path d="M32 64 l12 -12 l10 10 l6 -6 l8 8" fill="none" stroke={INK} strokeWidth={2} opacity={0.35} /></>,
  }[glyph];
  return (
    <Board {...p}>
      {behind}
      <Rect x={82} y={44} width={52} height={30} rx={15} fill="#e3dcd1" stroke={INK} strokeWidth={2} />
      <Circle cx={97} cy={59} r={11} fill={PAPER} stroke={INK} strokeWidth={2} />
      <Path d="M116 52 l8 14" stroke={GOLD_DEEP} strokeWidth={2} strokeLinecap="round" opacity={0.6} />
    </Board>
  );
}

/** Slow: the sun, thinking (a ring of dots, one in gold). */
export function ArtWaiting(p: P) {
  const dots = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    return <Circle key={i} cx={80 + Math.cos(a) * 26} cy={60 + Math.sin(a) * 26} r={i === 0 ? 5 : 3.5} fill={i === 0 ? GOLD : INK} opacity={i === 0 ? 1 : 0.15 + i * 0.08} />;
  });
  return <Board {...p}>{dots}<Circle cx={80} cy={60} r={9} fill={GOLD} opacity={0.35} /></Board>;
}

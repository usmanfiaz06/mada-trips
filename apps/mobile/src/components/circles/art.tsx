import { useId, type ReactNode } from 'react';
import Svg, { Circle, Defs, Ellipse, G, Line, Path, RadialGradient, Stop, Text as SvgText } from 'react-native-svg';

/* The prototype's empty-state drawings for Circles and Discover (ui.jsx): lantern, bookmark, compass, map, chat, envelope. */
type P = { width?: number; height?: number };
function Art({ children, width = 176, height = 132 }: P & { children: ReactNode }) {
  return <Svg width={width} height={height} viewBox="0 0 160 120" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{children}</Svg>;
}
const useArtId = () => `a${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

/** A lantern, lit: nothing from friends yet, no requests. */
export function ArtLantern(p: P) {
  const id = useArtId();
  return (
    <Art {...p}>
      <Defs><RadialGradient id={id}><Stop offset="0" stopColor="#f3d79c" stopOpacity={0.95} /><Stop offset="1" stopColor="#f3d79c" stopOpacity={0} /></RadialGradient></Defs>
      <Path d="M40 16 h80" stroke="#d6c9b1" strokeWidth={1.5} strokeLinecap="round" />
      <Path d="M80 16 v14" stroke="#7d5d27" strokeWidth={1.5} />
      <Circle cx={80} cy={66} r={34} fill={`url(#${id})`} />
      <Path d="M70 34 h20 l4 8 h-28 z" fill="#1e352d" />
      <Path d="M66 42 h28 c2 14 2 30 0 44 h-28 c-2-14-2-30 0-44 z" fill="#fff7e6" stroke="#1e352d" strokeWidth={2} strokeLinejoin="round" />
      <Path d="M74 42 c-1 14-1 30 0 44 M86 42 c1 14 1 30 0 44" stroke="#e3c58d" strokeWidth={1.2} fill="none" />
      <Path d="M80 54 c5 6 6 11 0 16 c-6-5-5-10 0-16z" fill="#d9b77a" stroke="#b98f4a" strokeWidth={1} />
      <Path d="M68 86 h24 l-3 6 h-18 z" fill="#1e352d" />
    </Art>
  );
}

/** An open book with a gold ribbon: nothing saved yet. */
export function ArtBookmark(p: P) {
  return (
    <Art {...p}>
      <Path d="M80 44 C 66 36, 46 34, 30 38 v52 c16-4 36-2 50 6 z" fill="#fffdf9" stroke="#1e352d" strokeWidth={2} strokeLinejoin="round" />
      <Path d="M80 44 C 94 36, 114 34, 130 38 v52 c-16-4-36-2-50 6 z" fill="#f7f0e4" stroke="#1e352d" strokeWidth={2} strokeLinejoin="round" />
      <Path d="M40 52 c10-2 22-1 32 3 M40 62 c10-2 22-1 32 3 M40 72 c8-1 16 0 22 2" fill="none" stroke="#e3d6bf" strokeWidth={2} strokeLinecap="round" />
      <Path d="M90 55 c10-4 22-5 30-3 M90 65 c10-4 22-5 30-3" fill="none" stroke="#e3d6bf" strokeWidth={2} strokeLinecap="round" />
      <Path d="M98 14 h14 v46 l-7 -6 l-7 6 z" fill="#d9b77a" stroke="#7d5d27" strokeWidth={1.5} strokeLinejoin="round" />
    </Art>
  );
}

/** A compass: a city we don't cover yet, nobody followed yet. */
export function ArtCompass(p: P) {
  return (
    <Art {...p}>
      <Circle cx={80} cy={60} r={38} fill="#fffdf9" stroke="#1e352d" strokeWidth={2} />
      <Circle cx={80} cy={60} r={30} fill="none" stroke="#e3d6bf" strokeWidth={1.2} />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6;
        const r1 = i % 3 ? 33 : 30;
        return <Line key={i} x1={80 + Math.sin(a) * r1} y1={60 - Math.cos(a) * r1} x2={80 + Math.sin(a) * 36} y2={60 - Math.cos(a) * 36} stroke={i % 3 ? '#d6c9b1' : '#1e352d'} strokeWidth={i % 3 ? 1.2 : 2} strokeLinecap="round" />;
      })}
      <SvgText x={80} y={17} textAnchor="middle" fontSize={9} fontWeight="700" fill="#7d5d27" fontFamily="InterTight_700Bold">N</SvgText>
      <Path d="M80 34 L86 60 L80 86 L74 60 Z" fill="#fffdf9" stroke="#1e352d" strokeWidth={1.6} strokeLinejoin="round" />
      <Path d="M80 34 L86 60 L74 60 Z" fill="#d9b77a" stroke="#7d5d27" strokeWidth={1.4} strokeLinejoin="round" />
      <Circle cx={80} cy={60} r={3.4} fill="#1e352d" />
    </Art>
  );
}

/** A folded map with a gold pin: no tips from this city yet. */
export function ArtMap(p: P) {
  return (
    <Art {...p}>
      <Path d="M30 32 L64 24 L64 94 L30 102 Z" fill="#fffdf9" stroke="#e3d6bf" strokeWidth={1.5} strokeLinejoin="round" />
      <Path d="M64 24 L98 32 L98 102 L64 94 Z" fill="#f4ecdd" stroke="#e3d6bf" strokeWidth={1.5} strokeLinejoin="round" />
      <Path d="M98 32 L132 24 L132 94 L98 102 Z" fill="#fffdf9" stroke="#e3d6bf" strokeWidth={1.5} strokeLinejoin="round" />
      <Path d="M36 50 h14 M36 58 h20 M104 74 h18 M104 82 h12" stroke="#e9dcc4" strokeWidth={2} strokeLinecap="round" />
      <Path d="M44 84 C 56 64, 70 82, 82 62 S 106 40, 118 46" fill="none" stroke="#b98f4a" strokeWidth={2.2} strokeDasharray="0.1 6" strokeLinecap="round" />
      <Circle cx={44} cy={84} r={4} fill="#1e352d" />
      <G><Path d="M118 47 c-6-7-9-11-9-15 a9 9 0 0 1 18 0 c0 4-3 8-9 15z" fill="#d9b77a" stroke="#7d5d27" strokeWidth={1.5} strokeLinejoin="round" /><Circle cx={118} cy={32} r={3} fill="#fffdf9" /></G>
      <Ellipse cx={118} cy={50} rx={5} ry={1.6} fill="#1e352d" opacity={0.15} />
    </Art>
  );
}

/** Two speech bubbles: a circle's chat before anyone has said anything. */
export function ArtChat(p: P) {
  return (
    <Art {...p}>
      <Path d="M30 34 h64 a12 12 0 0 1 12 12 v18 a12 12 0 0 1 -12 12 h-46 l-12 10 v-10 h-6 a12 12 0 0 1 -12 -12 v-18 a12 12 0 0 1 12 -12 z" fill="#fffdf9" stroke="#1e352d" strokeWidth={2} strokeLinejoin="round" transform="translate(12 0)" />
      <Circle cx={62} cy={55} r={3.6} fill="#1e352d" /><Circle cx={74} cy={55} r={3.6} fill="#1e352d" /><Circle cx={86} cy={55} r={3.6} fill="#1e352d" />
      <Path d="M100 74 h28 a10 10 0 0 1 10 10 v4 a10 10 0 0 1 -10 10 h-2 v8 l-10 -8 h-16 a10 10 0 0 1 -10 -10 v-4 a10 10 0 0 1 10 -10 z" fill="#d9b77a" stroke="#7d5d27" strokeWidth={1.5} strokeLinejoin="round" />
      <Path d="M100 86 h18" stroke="#7d5d27" strokeWidth={2} strokeLinecap="round" opacity={0.55} />
    </Art>
  );
}

/** A letter rising out of its envelope: nobody invited yet. */
export function ArtEnvelope(p: P) {
  return (
    <Art {...p}>
      <Path d="M60 32 h40 a4 4 0 0 1 4 4 v36 a4 4 0 0 1 -4 4 h-40 a4 4 0 0 1 -4 -4 v-36 a4 4 0 0 1 4 -4 z" fill="#fffdf9" stroke="#1e352d" strokeWidth={1.8} />
      <Path d="M64 44 h24 M64 52 h32 M64 60 h18" stroke="#d9b77a" strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M40 58 l40 28 l40 -28 v38 a6 6 0 0 1 -6 6 h-68 a6 6 0 0 1 -6 -6 z" fill="#f4ecdd" stroke="#1e352d" strokeWidth={2} strokeLinejoin="round" />
      <Path d="M40 102 l30 -24 M120 102 l-30 -24" stroke="#1e352d" strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
      <Circle cx={80} cy={84} r={5.5} fill="#d9b77a" stroke="#7d5d27" strokeWidth={1.2} />
    </Art>
  );
}

import Svg, { Circle, ClipPath, Defs, G, Path, Rect, Text as SvgText } from 'react-native-svg';

/* The prototype's empty-state drawings for trip screens (ui.jsx ArtCalendar, ArtReceipt, ArtSuitcase, ArtMap, QuietRadar). */
type P = { width?: number; height?: number };
const Art = ({ children, width = 176, height = 132 }: P & { children: React.ReactNode }) => (
  <Svg width={width} height={height} viewBox="0 0 160 120" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{children}</Svg>
);

export function ArtCalendar({ day = '9', ...p }: P & { day?: string }) {
  return (
    <Art {...p}>
      <Rect x={48} y={30} width={64} height={66} rx={10} fill="#fffdf9" stroke="#1e352d" strokeWidth={2} />
      <Path d="M49 49 h62 v37 a9 9 0 0 1 -9 9 h-44 a9 9 0 0 1 -9 -9 z" fill="#fffdf9" stroke="#e3d6bf" strokeWidth={1} />
      <Circle cx={80} cy={72} r={15} fill="#f4e9d3" />
      <SvgText x={80} y={82} textAnchor="middle" fontSize={28} fill="#7d5d27" fontFamily="InstrumentSerif_400Regular">{day}</SvgText>
      <Rect x={48} y={30} width={64} height={18} rx={10} fill="#1e352d" />
      <Rect x={48} y={40} width={64} height={8} fill="#1e352d" />
      <Path d="M62 24 v12 M98 24 v12" stroke="#d9b77a" strokeWidth={3} strokeLinecap="round" />
    </Art>
  );
}

export function ArtReceipt({ stamp, ...p }: P & { stamp?: boolean }) {
  return (
    <Art {...p}>
      <Defs><ClipPath id="rc"><Rect x={40} y={34} width={80} height={80} /></ClipPath></Defs>
      <G clipPath="url(#rc)">
        <Path d="M54 30 h52 v66 l-6.5 5 l-6.5 -5 l-6.5 5 l-6.5 -5 l-6.5 5 l-6.5 -5 l-6.5 5 l-6.5 -5 z" fill="#fffdf9" stroke="#1e352d" strokeWidth={1.8} strokeLinejoin="round" />
        <Path d="M62 48 h26 M62 56 h36 M62 64 h20" stroke="#e3d6bf" strokeWidth={2.4} strokeLinecap="round" />
        <Path d="M62 80 h18" stroke="#1e352d" strokeWidth={2.4} strokeLinecap="round" />
        <Path d="M90 80 h8" stroke="#b98f4a" strokeWidth={2.4} strokeLinecap="round" />
        {stamp ? <G transform="rotate(-12 96 64)"><Circle cx={96} cy={64} r={14} fill="none" stroke="#b98f4a" strokeWidth={2} /><Circle cx={96} cy={64} r={10.5} fill="none" stroke="#b98f4a" strokeWidth={1} strokeDasharray="2 2" /><Path d="M90 64 l4 4 l8 -8" fill="none" stroke="#b98f4a" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></G> : null}
      </G>
      <Rect x={34} y={24} width={92} height={14} rx={7} fill="#1e352d" />
      <Path d="M44 31 h72" stroke="#0f1a16" strokeWidth={3} strokeLinecap="round" />
      <Circle cx={116} cy={31} r={2} fill="#d9b77a" />
    </Art>
  );
}

export function ArtSuitcase(p: P) {
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

export function ArtMap(p: P) {
  return (
    <Art {...p}>
      <Path d="M30 32 L64 24 L64 94 L30 102 Z" fill="#fffdf9" stroke="#e3d6bf" strokeWidth={1.5} strokeLinejoin="round" />
      <Path d="M64 24 L98 32 L98 102 L64 94 Z" fill="#f4ecdd" stroke="#e3d6bf" strokeWidth={1.5} strokeLinejoin="round" />
      <Path d="M98 32 L132 24 L132 94 L98 102 Z" fill="#fffdf9" stroke="#e3d6bf" strokeWidth={1.5} strokeLinejoin="round" />
      <Path d="M44 84 C 56 64, 70 82, 82 62 S 106 40, 118 46" fill="none" stroke="#b98f4a" strokeWidth={2.2} strokeDasharray="0.1 6" strokeLinecap="round" />
      <Circle cx={44} cy={84} r={4} fill="#1e352d" />
      <Path d="M118 47 c-6-7-9-11-9-15 a9 9 0 0 1 18 0 c0 4-3 8-9 15z" fill="#d9b77a" stroke="#7d5d27" strokeWidth={1.5} strokeLinejoin="round" /><Circle cx={118} cy={32} r={3} fill="#fffdf9" />
    </Art>
  );
}

/** Rings around a quiet dot: nothing has happened yet (the inbox). */
export function QuietRadar(p: P) {
  return (
    <Art {...p}>
      <Circle cx={80} cy={62} r={44} fill="none" stroke="#e3d6bf" strokeWidth={1.5} />
      <Circle cx={80} cy={62} r={30} fill="none" stroke="#e3d6bf" strokeWidth={1.5} strokeDasharray="3 5" />
      <Circle cx={80} cy={62} r={16} fill="rgba(217,183,122,0.18)" stroke="#d9b77a" strokeWidth={1.8} />
      <Circle cx={80} cy={62} r={5} fill="#1e352d" />
      <Path d="M80 62 L114 36" stroke="#b98f4a" strokeWidth={2} strokeLinecap="round" />
    </Art>
  );
}

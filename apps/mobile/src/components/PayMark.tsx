import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

/** Payment marks, drawn as small cards so every method reads at a glance (prototype PayMark). */
export type PayBrand = 'visa' | 'mastercard' | 'mada' | 'applepay' | 'tabby' | 'tamara' | 'credit' | 'card';

export function PayMark({ brand, size = 28 }: { brand: PayBrand; size?: number }) {
  const w = Math.round(size * 1.5);
  const box = (bg: string, children: React.ReactNode, border = false) => (
    <Svg width={w} height={size} viewBox="0 0 48 32" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect width={48} height={32} rx={6} fill={bg} stroke={border ? 'rgba(30,53,45,0.14)' : 'none'} strokeWidth={border ? 1 : 0} />
      {children}
    </Svg>
  );
  const text = (x: number, y: number, s: string, size2: number, fill: string, weight = '800', italic = false) => (
    <SvgText x={x} y={y} textAnchor="middle" fontFamily="InterTight_700Bold" fontWeight={weight} fontStyle={italic ? 'italic' : 'normal'} fontSize={size2} fill={fill}>{s}</SvgText>
  );
  switch (brand) {
    case 'visa': return box('#fffdf9', text(24, 21, 'VISA', 15, '#1a1f71', '800', true), true);
    case 'mastercard': return box('#1e1e1e', <><Circle cx={19.5} cy={16} r={8.5} fill="#eb001b" /><Circle cx={28.5} cy={16} r={8.5} fill="#f79e1b" /><Path d="M24 8.8a8.5 8.5 0 0 1 0 14.4 8.5 8.5 0 0 1 0-14.4z" fill="#ff5f00" /></>);
    case 'mada': return box('#fffdf9', <><Rect x={7} y={10} width={13} height={5} rx={1} fill="#84b740" /><Rect x={7} y={17} width={13} height={5} rx={1} fill="#259bd6" />{text(33, 20.5, 'mada', 11, '#1e1e1e', '700')}</>, true);
    case 'applepay': return box('#000', <><Path d="M14.6 11.3c.5-.6.8-1.4.7-2.2-.7 0-1.6.5-2.1 1.1-.5.5-.9 1.4-.8 2.2.8.1 1.6-.4 2.2-1.1zm.7 1.2c-1.2-.1-2.2.7-2.8.7s-1.4-.6-2.4-.6c-1.2 0-2.3.7-2.9 1.8-1.3 2.2-.3 5.4.9 7.2.6.9 1.3 1.8 2.2 1.8.9 0 1.2-.6 2.3-.6s1.4.6 2.3.6c1 0 1.6-.9 2.2-1.8.7-1 1-2 1-2-.1 0-1.9-.7-1.9-2.8 0-1.7 1.4-2.6 1.5-2.6-.8-1.2-2.1-1.4-2.4-1.4z" fill="#fff" />{text(31, 21, 'Pay', 12, '#fff', '600')}</>);
    case 'tabby': return box('#3effc2', text(24, 20.5, 'tabby', 12.5, '#1e1e1e'));
    case 'tamara': return box('#fdebd7', text(24, 20.5, 'tamara', 11.5, '#1e1e1e'));
    case 'credit': return box('#1e352d', <G stroke="#d9b77a" strokeWidth={2.2} strokeLinecap="round">{Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return <Line key={i} x1={24 + Math.cos(a) * 3.5} y1={16 + Math.sin(a) * 3.5} x2={24 + Math.cos(a) * 8} y2={16 + Math.sin(a) * 8} />; })}</G>);
    default: return box('#f6f2ec', <Rect x={8} y={12} width={32} height={4} rx={1} fill="#1e352d" />, true);
  }
}

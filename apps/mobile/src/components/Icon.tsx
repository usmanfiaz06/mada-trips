import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/theme';
import { isRTL } from '@/lib/i18n';

/* The prototype's icon set (docs/app/prototype-app/src/ui.jsx): rounded 1.8-unit line icons on a 24-unit grid. Same glyphs. */
type Shape = { d: string } | { rect: [number, number, number, number, number] } | { circle: [number, number, number] };

const GLYPHS = {
  home: [{ d: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' }],
  trips: [{ rect: [3, 7, 18, 13, 3] }, { d: 'M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18' }],
  circles: [{ circle: [9, 8, 3.5] }, { d: 'M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.5 3.5 5.2' }],
  wallet: [{ rect: [3, 6, 18, 14, 3] }, { d: 'M3 10h18M16 15h2M6 6V5a2 2 0 0 1 2-2h9' }],
  back: [{ d: 'M15 5l-7 7 7 7' }],
  close: [{ d: 'M6 6l12 12M18 6 6 18' }],
  chevron: [{ d: 'M9 6l6 6-6 6' }],
  arrow: [{ d: 'M5 12h14M13 6l6 6-6 6' }],
  up: [{ d: 'M12 19V5M6 11l6-6 6 6' }],
  check: [{ d: 'M5 12.5l4.5 4.5L19 7.5' }],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  mic: [{ rect: [9, 3, 6, 11, 3] }, { d: 'M5 11a7 7 0 0 0 14 0M12 18v3' }],
  flight: [{ d: 'M10.5 13.5 3 11l1.5-1.5 8 1 4-4.5c1-1 2.6-1.3 3.4-.4.8.8.6 2.4-.4 3.4l-4.5 4 1 8L14.5 22.5 12 15z' }],
  stay: [{ d: 'M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5' }, { circle: [7, 11, 1.6] }],
  visa: [{ rect: [5, 3, 14, 18, 2] }, { circle: [12, 10, 3] }, { d: 'M9 17h6' }],
  umrah: [{ d: 'M4 21V10l8-5 8 5v11M9 21v-6h6v6M4 21h16' }],
  car: [{ d: 'M5 16V11l2-5h10l2 5v5M4 16h16v3H4zM5 11h14' }],
  star: [{ d: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7z' }],
  food: [{ d: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 0-3 2.5-3 5.5S14 13 16 13v8' }],
  lock: [{ rect: [5, 11, 14, 10, 2] }, { d: 'M8 11V8a4 4 0 0 1 8 0v3' }],
  bell: [{ d: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0' }],
  pin: [{ d: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z' }, { circle: [12, 9.5, 2.5] }],
  more: [{ circle: [5, 12, 1.3] }, { circle: [12, 12, 1.3] }, { circle: [19, 12, 1.3] }],
  card: [{ rect: [3, 6, 18, 13, 2.5] }, { d: 'M3 10h18M7 15h4' }],
  doc: [{ d: 'M7 3h7l5 5v13H7z' }, { d: 'M14 3v5h5M10 13h6M10 17h6' }],
  scan: [{ d: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10' }],
  wifiOff: [{ d: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.7M14.6 10.5A10 10 0 0 1 19 13M2 9.5a15 15 0 0 1 4.3-2.8M12 20h.01' }],
  link: [{ d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' }],
  gear: [{ circle: [12, 12, 3] }, { d: 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' }],
  rain: [{ d: 'M7 15a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.5 1.5A3.5 3.5 0 0 1 17.5 15M9 18l-1 2M13 18l-1 2M17 18l-1 2' }],
  bag: [{ rect: [5, 7, 14, 13, 2] }, { d: 'M9 7V5h6v2M9 11v5M15 11v5' }],
  globe: [{ circle: [12, 12, 9] }, { d: 'M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18' }],
  refund: [{ d: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2' }],
  user: [{ circle: [12, 8, 4] }, { d: 'M4 21c1-4 4-6 8-6s7 2 8 6' }],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof GLYPHS;

/** Glyphs that point along the reading direction, so they mirror in Arabic. Clocks, planes and logos never do. */
const DIRECTIONAL: ReadonlySet<string> = new Set(['back', 'chevron', 'arrow']);

/** `fixed`: keep the glyph as drawn even in right-to-left (an arrow that points at something physical). */
export function Icon({ name, size = 22, color = colors.green, width = 1.8, fixed }: { name: IconName; size?: number; color?: string; width?: number; fixed?: boolean }) {
  const mirror = !fixed && DIRECTIONAL.has(name) && isRTL();
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={mirror ? { transform: [{ scaleX: -1 }] } : undefined}>
      {(GLYPHS[name] as Shape[]).map((s, i) =>
        'd' in s ? <Path key={i} d={s.d} />
          : 'rect' in s ? <Rect key={i} x={s.rect[0]} y={s.rect[1]} width={s.rect[2]} height={s.rect[3]} rx={s.rect[4]} />
            : <Circle key={i} cx={s.circle[0]} cy={s.circle[1]} r={s.circle[2]} />)}
    </Svg>
  );
}

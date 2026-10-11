import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';
import { toQR } from 'toqr';
import { colors } from '@/theme';

/** A real QR code for a link (toqr, error correction M), drawn as one path. Scans from a phone held next to it. */
export function QrCode({ value, size = 168, label }: { value: string; size?: number; label: string }) {
  const { n, d } = useMemo(() => {
    const cells = toQR(value);
    const n = Math.round(Math.sqrt(cells.length));
    let d = '';
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) if (cells[y * n + x]) d += `M${x} ${y}h1v1h-1z`;
    return { n, d };
  }, [value]);
  const q = 2; // the quiet zone, in modules
  return (
    <Svg width={size} height={size} viewBox={`${-q} ${-q} ${n + 2 * q} ${n + 2 * q}`} accessibilityRole="image" accessibilityLabel={label} testID="invite-qr">
      <Rect x={-q} y={-q} width={n + 2 * q} height={n + 2 * q} fill="#ffffff" rx={1.2} />
      <Path d={d} fill={colors.green} />
    </Svg>
  );
}

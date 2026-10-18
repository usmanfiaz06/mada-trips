import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { T } from '@/components/Text';
import { t } from '@/lib/i18n';
import { colors, ff } from '@/theme';
import { boundsOf, type StaysMapProps } from './types';

/**
 * The map without tiles: the pins where they are relative to each other, on a drawn ground. Used where a tiled map
 * can't load (no Google Maps key on Android, the map library unreachable on the web); the places and prices stay true.
 */
export function DrawnMap({ points, marks = [], onPick, onMapPress, height, fill, testID }: StaysMapProps) {
  const all = [...points, ...marks];
  const size = fill ? { flex: 1 } : { height };
  if (!all.length) return <View style={[s.box, size]} testID={testID} />;
  const b = boundsOf(all);
  const x = (lng: number) => `${((lng - b.west) / (b.east - b.west)) * 100}%` as const;
  const y = (lat: number) => `${((b.north - lat) / (b.north - b.south)) * 100}%` as const;
  return (
    <View style={[s.box, size]} testID={testID} accessibilityLabel={t('stays.map.a11y')}>
      <Svg width="100%" height="100%" viewBox="0 0 320 320" preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={320} height={320} fill="#e6eee6" />
        {Array.from({ length: 9 }, (_, i) => <Line key={`v${i}`} x1={i * 40} y1={0} x2={i * 40} y2={320} stroke="rgba(30,53,45,0.06)" strokeWidth={1} />)}
        {Array.from({ length: 9 }, (_, i) => <Line key={`h${i}`} x1={0} y1={i * 40} x2={320} y2={i * 40} stroke="rgba(30,53,45,0.06)" strokeWidth={1} />)}
        <Path d="M-10 210 C 60 180, 110 238, 170 200 S 280 152, 340 176" stroke="#fffdf9" strokeWidth={9} fill="none" />
      </Svg>
      {onMapPress ? <Pressable style={StyleSheet.absoluteFill} onPress={onMapPress} accessible={false} /> : null}
      {marks.map((m) => (
        <View key={m.id} style={[s.at, { left: x(m.lng), top: y(m.lat) }]} pointerEvents="none">
          <View style={s.mark}><T v="tiny" color={colors.green} style={{ fontFamily: ff.ui600 }} numberOfLines={1}>★ {m.name}</T></View>
        </View>
      ))}
      {points.map((p) => (
        <View key={p.id} style={[s.at, { left: x(p.lng), top: y(p.lat), zIndex: p.selected ? 1000 : 1 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={p.a11y ?? p.label} accessibilityState={{ selected: !!p.selected }} onPress={() => onPick?.(p.id)} style={[s.pin, p.selected ? s.pinOn : null]} testID={`map-pin-${p.id}`}>
            <T v="tiny" color={p.selected ? colors.mist : colors.green} style={{ fontFamily: ff.ui600 }} numberOfLines={1}>{p.label}</T>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#e6eee6' },
  at: { position: 'absolute', transform: [{ translateX: -30 }, { translateY: -14 }] },
  pin: { paddingHorizontal: 8, height: 26, borderRadius: 99, backgroundColor: colors.paper, justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  pinOn: { backgroundColor: colors.green, borderColor: colors.green },
  mark: { paddingHorizontal: 8, height: 24, borderRadius: 99, backgroundColor: colors.goldWash, justifyContent: 'center' },
});

import { useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from 'react-native-maps';
import { formatSar } from '@mada/shared';
import { T } from '@/components/Text';
import { t } from '@/lib/i18n';
import { colors, ff } from '@/theme';
import { DrawnMap } from './DrawnMap';
import { PILL_H, boundsOf, groupPins, lowestOf, type MapPoint, type StaysMapProps } from './types';

/*
 * The stays map on a phone: Apple Maps on iOS (no key), Google Maps on Android when the build has a key
 * (GOOGLE_MAPS_ANDROID_API_KEY in app.config.js); without one, the drawn map. Native maps need a new app build.
 * Pins whose prices would sit on each other at this zoom show as one group ("5 · from SAR 1,903") that zooms in on tap.
 */
const androidKey = !!(Constants.expoConfig?.extra as { mapsAndroid?: boolean } | undefined)?.mapsAndroid;

export function StaysMap(props: StaysMapProps) {
  const { points, marks = [], onPick, onMapPress, height, fill, coverBottom = 0, single, testID } = props;
  const ref = useRef<MapView>(null);
  const region = useMemo(() => {
    const all = [...points, ...marks];
    if (!all.length) return undefined;
    const b = boundsOf(all);
    const span = single ? 0.012 : 0;
    return { latitude: (b.north + b.south) / 2, longitude: (b.east + b.west) / 2, latitudeDelta: Math.max(span, b.north - b.south), longitudeDelta: Math.max(span, b.east - b.west) };
  }, [points, marks, single]);
  const [view, setView] = useState<Region | undefined>(region);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Screen pixels from the visible region (a city's span: flat enough to treat as a plane).
  const groups = useMemo(() => {
    const r = view ?? region;
    if (single || !r || !size.w || !size.h) return points.map((p) => ({ id: p.id, members: [p], lat: p.lat, lng: p.lng, stack: false, dy: 0 }));
    const at = (p: { lat: number; lng: number }) => ({ x: ((p.lng - (r.longitude - r.longitudeDelta / 2)) / r.longitudeDelta) * size.w, y: (((r.latitude + r.latitudeDelta / 2) - p.lat) / r.latitudeDelta) * size.h });
    return groupPins(points, at);
  }, [points, view, region, size, single]);
  const latPerPx = (view ?? region)?.latitudeDelta && size.h ? (view ?? region)!.latitudeDelta / size.h : 0;

  if (Platform.OS === 'android' && !androidKey) return <DrawnMap {...props} />;
  const pin = (p: MapPoint, shift = 0) => (
    <Marker key={`${p.id}${p.selected ? '-on' : ''}-${p.label}-${shift}`} coordinate={{ latitude: p.lat - shift * latPerPx, longitude: p.lng }} onPress={(e) => { e.stopPropagation?.(); onPick?.(p.id); }}
      zIndex={p.selected ? 1000 : 1} tracksViewChanges={false} accessibilityLabel={p.a11y ?? p.label} accessibilityRole="button" testID={`map-pin-${p.id}`}>
      <View style={[s.pin, p.selected ? s.pinOn : null]}>
        <T v="tiny" color={p.selected ? colors.mist : colors.green} style={{ fontFamily: ff.ui600 }}>{p.label}</T>
      </View>
    </Marker>
  );
  return (
    <View style={[s.box, fill ? { flex: 1 } : { height }]} testID={testID} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <MapView ref={ref} style={StyleSheet.absoluteFill} provider={PROVIDER_DEFAULT} initialRegion={region} scrollEnabled={!single} zoomEnabled={!single} rotateEnabled={false} pitchEnabled={false}
        accessibilityLabel={t('stays.map.a11y')} onRegionChangeComplete={(r) => setView(r)} onPress={(e) => { if ((e.nativeEvent as { action?: string }).action !== 'marker-press') onMapPress?.(); }} mapPadding={{ top: 0, left: 0, right: 0, bottom: coverBottom }}>
        {marks.map((m) => (
          <Marker key={m.id} coordinate={{ latitude: m.lat, longitude: m.lng }} tracksViewChanges={false} zIndex={900}>
            <View style={s.mark}><T v="tiny" color={colors.green} style={{ fontFamily: ff.ui600 }}>★ {m.name}</T></View>
          </Marker>
        ))}
        {groups.flatMap((g) => {
          if (g.members.length === 1) return [pin(g.members[0]!, g.dy)];
          // The same spot (one building): one above the other, every price its own pill.
          if (g.stack) return g.members.map((p, i) => pin(p, (i - (g.members.length - 1) / 2) * (PILL_H + 4)));
          const low = lowestOf(g.members);
          const price = low.price != null ? formatSar(low.price) : low.label;
          const label = t('stays.map.group', { count: g.members.length, price });
          return [(
            <Marker key={`${g.id}-${g.members.length}-${g.dy}`} coordinate={{ latitude: g.lat - g.dy * latPerPx, longitude: g.lng }} zIndex={800} tracksViewChanges={false} accessibilityRole="button"
              accessibilityLabel={t('stays.map.groupA11y', { count: g.members.length, price })} testID={`map-group-${g.members.length}`}
              onPress={(e) => { e.stopPropagation?.(); ref.current?.fitToCoordinates(g.members.map((p) => ({ latitude: p.lat, longitude: p.lng })), { edgePadding: { top: 80, left: 60, right: 60, bottom: 80 + coverBottom }, animated: true }); }}>
              <View style={[s.pin, s.group]}><T v="tiny" color={colors.green} style={{ fontFamily: ff.ui700 }}>{label}</T></View>
            </Marker>
          )];
        })}
      </MapView>
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#e6eee6' },
  pin: { paddingHorizontal: 8, height: 26, borderRadius: 99, backgroundColor: colors.paper, justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  pinOn: { backgroundColor: colors.green, borderColor: colors.gold, borderWidth: 2 },
  group: { backgroundColor: colors.mist, borderColor: colors.green, borderWidth: 1.5 },
  mark: { paddingHorizontal: 8, height: 24, borderRadius: 99, backgroundColor: colors.goldWash, justifyContent: 'center' },
});

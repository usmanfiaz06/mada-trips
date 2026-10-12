import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { T } from '@/components/Text';
import { t } from '@/lib/i18n';
import { colors, ff } from '@/theme';
import { DrawnMap } from './DrawnMap';
import { boundsOf, type StaysMapProps } from './types';

/*
 * The stays map on a phone: Apple Maps on iOS (no key), Google Maps on Android when the build has a key
 * (GOOGLE_MAPS_ANDROID_API_KEY in app.config.js); without one, the drawn map. Native maps need a new app build.
 */
const androidKey = !!(Constants.expoConfig?.extra as { mapsAndroid?: boolean } | undefined)?.mapsAndroid;

export function StaysMap(props: StaysMapProps) {
  const { points, marks = [], onPick, height, single, testID } = props;
  const region = useMemo(() => {
    const all = [...points, ...marks];
    if (!all.length) return undefined;
    const b = boundsOf(all);
    const span = single ? 0.012 : 0;
    return { latitude: (b.north + b.south) / 2, longitude: (b.east + b.west) / 2, latitudeDelta: Math.max(span, b.north - b.south), longitudeDelta: Math.max(span, b.east - b.west) };
  }, [points, marks, single]);
  if (Platform.OS === 'android' && !androidKey) return <DrawnMap {...props} />;
  return (
    <View style={[s.box, { height }]} testID={testID}>
      <MapView style={StyleSheet.absoluteFill} provider={PROVIDER_DEFAULT} initialRegion={region} scrollEnabled={!single} zoomEnabled={!single} rotateEnabled={false} pitchEnabled={false} accessibilityLabel={t('stays.map.a11y')}>
        {marks.map((m) => (
          <Marker key={m.id} coordinate={{ latitude: m.lat, longitude: m.lng }} tracksViewChanges={false}>
            <View style={s.mark}><T v="tiny" color={colors.green} style={{ fontFamily: ff.ui600 }}>★ {m.name}</T></View>
          </Marker>
        ))}
        {points.map((p) => (
          <Marker key={`${p.id}${p.selected ? '-on' : ''}`} coordinate={{ latitude: p.lat, longitude: p.lng }} onPress={() => onPick?.(p.id)} zIndex={p.selected ? 2 : 1} tracksViewChanges={false}>
            <Pressable accessibilityRole="button" accessibilityLabel={p.label} style={[s.pin, p.selected ? s.pinOn : null]}>
              <T v="tiny" color={p.selected ? colors.mist : colors.green} style={{ fontFamily: ff.ui600 }}>{p.label}</T>
            </Pressable>
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#e6eee6' },
  pin: { paddingHorizontal: 8, height: 26, borderRadius: 99, backgroundColor: colors.paper, justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  pinOn: { backgroundColor: colors.green, borderColor: colors.green },
  mark: { paddingHorizontal: 8, height: 24, borderRadius: 99, backgroundColor: colors.goldWash, justifyContent: 'center' },
});

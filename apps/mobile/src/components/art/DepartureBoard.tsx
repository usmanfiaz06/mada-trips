import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { fontFamilies } from '@mada/shared';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { colors } from '@/theme';
import { T } from '../Text';

const BOARD: [string, string, string][] = [
  ['ISTANBUL', 'IST', '4H 15M'], ['ALULA', 'ULH', '1H 20M'], ['BAKU', 'GYD', '3H 05M'], ['DUBAI', 'DXB', '1H 55M'],
  ['LONDON', 'LHR', '6H 50M'], ['TBILISI', 'TBS', '3H 30M'], ['ABHA', 'AHB', '1H 35M'], ['CAIRO', 'CAI', '2H 25M'],
];

function Flaps({ word, gold }: { word: string; gold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {word.padEnd(9, ' ').split('').map((ch, j) => (
        <View key={j} style={styles.flap}>
          <View style={styles.flapTop} />
          <T style={[styles.flapText, gold ? { color: colors.gold } : null]}>{ch}</T>
        </View>
      ))}
    </View>
  );
}

/** A split-flap departures board that keeps turning through places: the empty Upcoming tab (prototype DepartureBoard). */
export function DepartureBoard({ from = 'Riyadh', onPick }: { from?: string; onPick?: (city: string) => void }) {
  const [i, setI] = useState(0);
  useEffect(() => { const id = setInterval(() => setI((n) => n + 1), 2200); return () => clearInterval(id); }, []);
  const rows = [0, 1, 2].map((k) => BOARD[(i + k * 3) % BOARD.length]!);
  return (
    <View style={styles.board} accessibilityLabel={t('trips.empty.board', { city: from })}>
      <View style={styles.head}>
        <T style={styles.headText}>{t('trips.empty.board', { city: from })}</T>
        <View style={styles.dot} />
      </View>
      {rows.map(([city, code, dur], k) => (
        <Pressable key={k} style={styles.row} onPress={() => { buzz('tap'); onPick?.(city); }} accessibilityRole="button" accessibilityLabel={city}>
          <Flaps word={city} />
          <T style={styles.code}>{code}</T>
          <T style={styles.code}>{dur}</T>
        </Pressable>
      ))}
      <View style={styles.row}>
        <Flaps word="YOUR TRIP" gold />
        <T style={styles.code}>???</T>
        <T style={[styles.code, { color: colors.gold }]}>SOON</T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  board: { backgroundColor: '#121c18', borderRadius: 22, paddingTop: 12, paddingHorizontal: 12, paddingBottom: 10, gap: 6 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2, paddingBottom: 4 },
  headText: { color: colors.gold, fontSize: 10, lineHeight: 14, fontFamily: fontFamilies.ui700, letterSpacing: 1.4, textTransform: 'uppercase' },
  dot: { width: 7, height: 7, borderRadius: 9, backgroundColor: colors.live },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flap: { width: 17, height: 24, borderRadius: 3, backgroundColor: '#1c2723', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  flapTop: { position: 'absolute', top: 0, start: 0, end: 0, height: 12, backgroundColor: '#24312c' },
  flapText: { color: '#f4ead6', fontFamily: fontFamilies.mono, fontSize: 13, lineHeight: 16 },
  code: { flex: 1, textAlign: 'right', fontFamily: fontFamilies.mono, fontSize: 11, lineHeight: 14, color: '#9bb0a6', letterSpacing: 0.66 },
});

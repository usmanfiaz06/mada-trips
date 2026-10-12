import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { CITY_CENTRES, anchorName, anchorOfLandmark, landmarksIn, normalizeArabic, type DistanceAnchor } from '@mada/shared';
import { bookingApi } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { whereAmI } from '@/lib/where-am-i';
import { colors, ff, radii } from '@/theme';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { T } from '../Text';

/*
 * "Distance from": the city's landmarks, its centre, where the traveller is now (asked once, kept nowhere), or a place
 * they type (our landmarks first, then the address finder). Every card and pin then says "About 1.2 km from …".
 */
export function DistanceSheet({ visible, city, cityName, value, onPick, onClose }: {
  visible: boolean; city: string; cityName: string; value: DistanceAnchor | null; onPick: (a: DistanceAnchor) => void; onClose: () => void;
}) {
  const lang = getLocale();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const marks = landmarksIn(city);
  const centre = CITY_CENTRES[city];
  const choose = (a: DistanceAnchor) => { buzz('select'); setNote(null); onPick(a); };
  const me = async () => {
    setBusy(true);
    const at = await whereAmI();
    setBusy(false);
    if (!at) { setNote(t('dist.meNo')); return; }
    choose({ id: 'me', kind: 'me', name: t('dist.me'), lat: at.lat, lng: at.lng });
  };
  const find = async () => {
    const typed = q.trim();
    if (typed.length < 2) return;
    // Our own landmarks first ("Dubai Mall", "دبي مول"), then the address finder.
    const known = marks.find((l) => l.en.test(typed.toLowerCase()) || l.ar.test(normalizeArabic(typed)));
    if (known) { choose(anchorOfLandmark(known)); setQ(''); return; }
    setBusy(true);
    try {
      const r = await bookingApi.geocode(typed, city);
      if (r.point) { choose({ id: `place:${typed}`, kind: 'place', name: typed, lat: r.point.lat, lng: r.point.lng }); setQ(''); }
      else setNote(t('dist.notFound', { city: cityName }));
    } catch { setNote(t('dist.notFound', { city: cityName })); } finally { setBusy(false); }
  };
  const row = (a: DistanceAnchor, icon: 'pin' | 'star' | 'home', testID: string) => {
    const on = value?.id === a.id;
    return (
      <Pressable key={a.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => choose(a)} style={[s.row, on ? s.rowOn : null]} testID={testID}>
        <Icon name={icon} size={18} color={on ? colors.mist : colors.green} />
        <T v="h3" style={{ fontSize: 15, flex: 1 }} color={on ? colors.mist : colors.green}>{anchorName(a, lang)}</T>
        {on ? <Icon name="check" size={18} color={colors.mist} /> : null}
      </Pressable>
    );
  };
  return (
    <Sheet visible={visible} label={t('dist.title')} onClose={onClose}>
      <T v="h2">{t('dist.title')}</T>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={{ gap: 8 }}>
        {marks.length ? <T v="eyebrow">{t('dist.landmarks')}</T> : null}
        {marks.map((l) => row(anchorOfLandmark(l), 'star', `dist-${l.id}`))}
        {centre ? row({ id: 'centre', kind: 'centre', name: t('dist.centre'), lat: centre.lat, lng: centre.lng }, 'pin', 'dist-centre') : null}
        <Pressable accessibilityRole="button" onPress={me} style={s.row} testID="dist-me">
          <Icon name="user" size={18} />
          <View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 15 }}>{t('dist.me')}</T><T v="tiny">{t('dist.meWhy')}</T></View>
        </Pressable>
      </View>
      <View style={{ gap: 6 }}>
        <T v="eyebrow">{t('dist.place')}</T>
        <View style={s.search}>
          <TextInput value={q} onChangeText={(v) => { setQ(v); setNote(null); }} placeholder={t('dist.placeHint')} placeholderTextColor={colors.muted} accessibilityLabel={t('dist.place')}
            returnKeyType="search" onSubmitEditing={find} style={[s.input, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]} testID="dist-input" />
          <Button size="small" block={false} variant="secondary" label={t('dist.find')} onPress={find} disabled={busy} testID="dist-find" />
        </View>
        {note ? <T v="small" color={colors.goldInk} accessibilityRole="alert">{note}</T> : null}
      </View>
      </ScrollView>
    </Sheet>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.mist },
  rowOn: { backgroundColor: colors.green },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, height: 48, borderRadius: radii.input, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: 14, fontFamily: ff.ui400, fontSize: 16, color: colors.green },
});

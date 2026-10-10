import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AIRPORT_NAMES, MONTHS, addDays, calendarMonths, daysBetween, quickDates, type Cabin } from '@mada/shared';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { colors, font, ff } from '@/theme';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { T } from '../Text';
import { ChipWrap, Seg, Toggle } from './parts';
import { dayName } from './format';

/* Edit a search in one place: where from, return or one way, quick picks, 12 months from today, cabin, babies. */

export type TripSearch = { from: 'RUH' | 'JED' | 'DMM'; type: 'return' | 'oneway'; dep: string | null; ret: string | null; cabin: Cabin; infants: number; flex: boolean };

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function SearchSheet({ visible, value, today, month, adults, onClose, onDone }: {
  visible: boolean; value: TripSearch; today: string; month?: { month: number; year: number } | null; adults: number; onClose: () => void; onDone: (v: TripSearch) => void;
}) {
  const { height } = useWindowDimensions();
  const [s, setS] = useState(value);
  const [pickRet, setPickRet] = useState(value.type === 'return' && !!value.dep && !value.ret);
  const months = useMemo(() => calendarMonths(today), [today]);
  const idxOf = (iso: string) => months.findIndex((m) => iso.startsWith(m.first.slice(0, 7)));
  const initial = value.dep ? idxOf(value.dep) : month ? months.findIndex((m) => m.month0 === month.month - 1 && m.year === month.year) : 0;
  const [page, setPage] = useState(Math.max(0, initial));
  const strip = useRef<ScrollView>(null);
  useEffect(() => { if (visible) { setS(value); setPickRet(value.type === 'return' && !!value.dep && !value.ret); } }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { strip.current?.scrollTo({ x: Math.max(0, page * 62 - 120), animated: true }); }, [page]);
  const pm = months[page]!;
  const daysIn = new Date(Date.UTC(pm.year, pm.month0 + 1, 0)).getUTCDate();
  const lead = new Date(Date.UTC(pm.year, pm.month0, 1)).getUTCDay();

  const pickDay = (x: string) => {
    buzz('select');
    if (s.type === 'oneway') { setS({ ...s, dep: x, ret: null }); return; }
    if (!pickRet || !s.dep || x <= s.dep) { setS({ ...s, dep: x, ret: null }); setPickRet(true); return; }
    setS({ ...s, ret: x }); setPickRet(false);
  };
  const n = s.dep && s.ret ? daysBetween(s.dep, s.ret) : 0;
  const status = !s.dep ? (s.type === 'oneway' ? t('cal.pickOut') : t('cal.pickBoth'))
    : s.type === 'oneway' ? t('cal.leaving', { day: dayName(s.dep, today) })
      : !s.ret ? t('cal.pickReturn', { day: dayName(s.dep, today) })
        : tn('cal.range', n, { from: dayName(s.dep, today), to: dayName(s.ret, today) });
  const canSearch = !!s.dep && (s.type === 'oneway' || !!s.ret);

  return (
    <Sheet visible={visible} onClose={onClose} label={t('cal.title')}>
      <ScrollView style={{ maxHeight: height * 0.78 }} contentContainerStyle={{ gap: 12, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        <T v="h2">{t('cal.title')}</T>
        <Seg label={t('cal.from')} value={s.from} options={(['RUH', 'JED', 'DMM'] as const).map((c) => [c, AIRPORT_NAMES[c]!])} onChange={(from) => setS({ ...s, from })} />
        <Seg label={t('cal.type')} value={s.type} options={[['return', t('cal.return')], ['oneway', t('cal.oneway')]]} onChange={(type) => { setS({ ...s, type, ret: type === 'oneway' ? null : s.ret }); setPickRet(type === 'return' && !!s.dep && !s.ret); }} />
        <ChipWrap>
          {quickDates(today).map((q) => (
            <Toggle key={q.id} small label={q.label} on={s.dep === q.dates[0] && s.ret === q.dates[1]} onPress={() => { setS({ ...s, type: 'return', dep: q.dates[0], ret: q.dates[1] }); setPickRet(false); setPage(Math.max(0, idxOf(q.dates[0]))); }} />
          ))}
        </ChipWrap>
        <T v="h3" style={{ fontSize: 15 }} accessibilityLiveRegion="polite">{status}</T>
        <ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityLabel={t('cal.months')}>
          {months.map((m, i) => (
            <Pressable key={m.first} accessibilityRole="button" accessibilityState={{ selected: page === i }} onPress={() => setPage(i)} style={[styles.month, page === i ? { backgroundColor: colors.green } : null]}>
              <T style={[font('h3', page === i ? colors.mist : colors.ink2), { fontSize: 13 }]}>{MONTHS[m.month0]}{m.month0 === 0 || i === 0 ? ` ${m.year}` : ''}</T>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.head}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('cal.prev')} disabled={page === 0} onPress={() => setPage(page - 1)} style={[styles.nav, page === 0 ? { opacity: 0.35 } : null]}><Icon name="back" size={18} /></Pressable>
          <T v="h3" style={{ fontSize: 16 }}>{MONTH_LONG[pm.month0]} {pm.year}</T>
          <Pressable accessibilityRole="button" accessibilityLabel={t('cal.next')} disabled={page === 11} onPress={() => setPage(page + 1)} style={[styles.nav, page === 11 ? { opacity: 0.35 } : null]}><Icon name="chevron" size={18} /></Pressable>
        </View>
        <View style={styles.grid}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((x, i) => <View key={i} style={styles.cell}><T style={styles.wd}>{x}</T></View>)}
          {Array.from({ length: lead }, (_, i) => <View key={`b${i}`} style={styles.cell} />)}
          {Array.from({ length: daysIn }, (_, i) => i + 1).map((dn) => {
            const x = `${pm.year}-${String(pm.month0 + 1).padStart(2, '0')}-${String(dn).padStart(2, '0')}`;
            const past = x < today;
            const end = x === s.dep || (s.type === 'return' && x === s.ret);
            const inRange = s.type === 'return' && !!s.dep && !!s.ret && x > s.dep && x < s.ret;
            const flex = s.flex && !!s.dep && !end && Math.abs(daysBetween(s.dep, x)) <= 2;
            return (
              <View key={dn} style={[styles.cell, inRange ? { backgroundColor: '#f3ead8' } : flex ? { backgroundColor: '#f8f1e3' } : null]}>
                <Pressable accessibilityRole="button" accessibilityLabel={dayName(x, today)} accessibilityState={{ disabled: past, selected: end }} disabled={past} onPress={() => pickDay(x)}
                  style={[styles.day, end ? { backgroundColor: colors.green } : null, x === today && !end ? styles.today : null]}>
                  <T style={[styles.dayText, past ? styles.past : null, end ? { color: colors.mist, fontFamily: ff.ui700 } : null]}>{dn}</T>
                </Pressable>
              </View>
            );
          })}
        </View>
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: s.flex }} onPress={() => { buzz('select'); setS({ ...s, flex: !s.flex }); }} style={styles.rowBetween}>
          <T v="small" color={colors.green}>{t('cal.flexible')}</T>
          <View style={[styles.check, s.flex ? { backgroundColor: colors.green } : null]}>{s.flex ? <Icon name="check" size={14} color={colors.mist} width={2.4} /> : null}</View>
        </Pressable>
        <T v="eyebrow">{t('cal.cabin')}</T>
        <Seg label={t('cal.cabin')} value={s.cabin === 'first' ? 'business' : s.cabin} options={[['economy', t('cal.cabin.economy')], ['premium', t('cal.cabin.premium')], ['business', t('cal.cabin.business')]]} onChange={(cabin) => setS({ ...s, cabin })} />
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 15 }}>{t('cal.babies')}</T><T v="tiny">{t('cal.babiesNote')}</T></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('cal.fewer')} disabled={!s.infants} onPress={() => setS({ ...s, infants: s.infants - 1 })} style={[styles.nav, !s.infants ? { opacity: 0.35 } : null]}><T v="h3">−</T></Pressable>
            <T v="h3" accessibilityLiveRegion="polite">{s.infants}</T>
            <Pressable accessibilityRole="button" accessibilityLabel={t('cal.more')} disabled={s.infants >= Math.max(1, adults)} onPress={() => setS({ ...s, infants: s.infants + 1 })} style={[styles.nav, s.infants >= Math.max(1, adults) ? { opacity: 0.35 } : null]}><T v="h3">+</T></Pressable>
          </View>
        </View>
        <Button label={canSearch ? t('cal.search') : !s.dep ? t('cal.pickDate') : t('cal.pickReturnDate')} disabled={!canSearch} onPress={() => onDone(s)} testID="search-go" />
      </ScrollView>
    </Sheet>
  );
}

export const defaultReturn = (dep: string, nights: number) => addDays(dep, nights);

const styles = StyleSheet.create({
  month: { height: 32, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.mist, justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nav: { width: 36, height: 36, borderRadius: 999, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: 40, alignItems: 'center', justifyContent: 'center', marginVertical: 1 },
  wd: { fontFamily: ff.ui600, fontSize: 11, color: colors.muted },
  day: { width: 36, height: 36, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontFamily: ff.ui500, fontSize: 14, color: colors.green, fontVariant: ['tabular-nums'] },
  past: { color: '#b9c0bc', textDecorationLine: 'line-through' },
  today: { borderWidth: 1.5, borderColor: 'rgba(30,53,45,0.25)' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.green, alignItems: 'center', justifyContent: 'center' },
});

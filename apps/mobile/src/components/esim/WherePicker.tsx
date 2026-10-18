import { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { ESIM_COUNTRIES, ESIM_REGION_WORDS, esimFlag, findEsimPlace, foldPlace, type EsimPlace } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { Box, Rise, Small, Tiny } from '@/components/trips/ui';
import { ChipWrap } from '@/components/booking/parts';
import { useGiveUp } from '@/lib/net/give-up';
import { useEsimPlaces } from '@/lib/esim';
import { buzz } from '@/lib/haptics';
import { getLocale, t, tn } from '@/lib/i18n';
import { colors, ff, font, radii } from '@/theme';
import { FlagDisc } from './look';

/*
 * The eSIM planner's "Where to?" and "How many days?". Where is any country or region the supplier sells (GET
 * /esim/places): type-ahead over their names in English and Arabic, a city giving its country (Lahore → Pakistan),
 * and chips for the trips' countries and the places people go most. A place the supplier doesn't sell is said plainly.
 */

/** The places people go most, after their own trips' countries. `europe` is the supplier's widest Europe region. */
const POPULAR = ['TR', 'AE', 'GB', 'EG', 'europe', 'GE', 'AZ', 'MY'];
export const DAY_CHOICES = [3, 5, 7, 10, 14, 30];
export type WherePick = { kind: 'country' | 'region'; code: string };

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

/** Before the supplier's list arrives (or offline): every country Mada can name, so the search still answers. */
const FALLBACK: EsimPlace[] = ESIM_COUNTRIES.map((c) => ({ code: c.code, kind: 'country', en: c.en, ar: c.ar, flag: esimFlag(c.code) }));

export const placeLabel = (p: Pick<EsimPlace, 'en' | 'ar'>) => (getLocale() === 'ar' ? p.ar : p.en);

/** The region in the list a word names ("europe" → the widest Europe region the supplier sells). */
function regionFor(places: readonly EsimPlace[], key: string): EsimPlace | null {
  const own = places.find((p) => p.kind === 'region' && p.code.toLowerCase() === key.toLowerCase());
  if (own) return own;
  const w = ESIM_REGION_WORDS.find((x) => x.key === key);
  if (!w) return null;
  return places.filter((p) => p.kind === 'region' && (w.key === 'world' ? /^(world|gl)/i.test(p.code) || /global/i.test(p.en) : w.match.test(p.code) || w.match.test(p.en)))
    .sort((a, b) => (b.countries?.length ?? 0) - (a.countries?.length ?? 0))[0] ?? null;
}

/** Places matching what's typed: names starting with it first, then containing it; a city's country on top. */
export function matchPlaces(places: readonly EsimPlace[], q: string): EsimPlace[] {
  const f = foldPlace(q).trim();
  if (f.length < 2) return [];
  const hit = findEsimPlace(q);
  const top = hit ? (hit.kind === 'country' ? places.find((p) => p.kind === 'country' && p.code === hit.code) : regionFor(places, hit.code)) ?? null : null;
  const scored = places.map((p) => {
    const names = [foldPlace(p.en).trim(), foldPlace(p.ar).trim()];
    const score = names.some((n) => n.startsWith(f)) ? 2 : names.some((n) => n.includes(f) || n.split(' ').some((w) => w.startsWith(f))) ? 1 : 0;
    return { p, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || placeLabel(a.p).localeCompare(placeLabel(b.p)));
  const out = scored.map((x) => x.p).filter((p) => p !== top);
  return (top ? [top, ...out] : out).slice(0, 6);
}

export function EsimWhere({ tripCountries, onPick, onUnknown }: { tripCountries: string[]; onPick: (p: WherePick) => void; onUnknown: (text: string) => void }) {
  const router = useRouter();
  const q = useEsimPlaces();
  // The list is here already (FALLBACK); the small spinner for the full one stops after GIVE_UP_MS either way.
  const wait = useGiveUp(q);
  const places = q.data?.length ? q.data : FALLBACK;
  const [text, setText] = useState('');
  const matches = useMemo(() => matchPlaces(places, text), [places, text]);
  const suggested = useMemo(() => {
    const seen = new Set<string>();
    const out: EsimPlace[] = [];
    for (const code of [...tripCountries, ...POPULAR]) {
      const p = code === code.toUpperCase() && code.length === 2 ? places.find((x) => x.kind === 'country' && x.code === code) : regionFor(places, code);
      if (p && !seen.has(p.code)) { seen.add(p.code); out.push(p); }
    }
    return out.slice(0, 8);
  }, [places, tripCountries]);
  const pick = (p: EsimPlace) => { buzz('select'); onPick({ kind: p.kind, code: p.code }); };
  const typed = text.trim();
  const none = foldPlace(typed).trim().length >= 2 && !matches.length && !q.isLoading;

  return (
    <View style={{ gap: 14 }} testID="esim-where">
      <Rise><T style={font('displaySmall')} accessibilityRole="header">{t('es.which.where')}</T></Rise>
      <Rise step={1}>
        <View style={styles.search}>
          <Icon name="globe" size={18} color={colors.ink3} />
          <TextInput value={text} onChangeText={setText} placeholder={t('es.where.search')} placeholderTextColor={colors.muted} accessibilityLabel={t('es.where.searchA11y')}
            autoCorrect={false} autoCapitalize="words" returnKeyType="search"
            onSubmitEditing={() => { if (matches[0]) pick(matches[0]); else if (typed.length > 1) onUnknown(typed); }}
            style={[styles.input, webNoOutline]} testID="esim-where-input" />
          {q.isLoading && wait.view === 'loading' ? <ActivityIndicator size="small" color={colors.ink3} /> : null}
        </View>
      </Rise>
      {matches.length ? (
        <View style={{ gap: 6 }} testID="esim-where-matches">
          {matches.map((p) => (
            <Pressable key={`${p.kind}-${p.code}`} accessibilityRole="button" accessibilityLabel={placeLabel(p)} onPress={() => pick(p)}
              style={({ pressed }) => [styles.row, pressed ? { opacity: 0.75 } : null]} testID={`esim-match-${p.code}`}>
              <FlagDisc country={p.kind === 'country' ? p.code : null} size={34} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T v="callout" color={colors.green} style={{ fontFamily: ff.ui600 }} numberOfLines={1}>{placeLabel(p)}</T>
                {p.kind === 'region' && p.countries?.length ? <Tiny lines={1}>{tn('es.where.region', p.countries.length)}</Tiny> : null}
              </View>
              <Icon name="chevron" size={16} color={colors.ink3} />
            </Pressable>
          ))}
        </View>
      ) : none ? (
        <Box tone="cream" testID="esim-where-none" gap={8}>
          <T v="h3">{t('es.where.noMatch', { q: typed })}</T>
          <Small>{t('es.where.noMatchBody')}</Small>
          <Button variant="secondary" label={t('es.tr.talk')} onPress={() => router.push('/support?topic=other' as Href)} testID="esim-where-talk" />
        </Box>
      ) : (
        <Rise step={2}>
          <ChipWrap>
            {suggested.map((p) => (
              <Chip key={p.code} label={placeLabel(p)} background={colors.paper} onPress={() => pick(p)} testID={`esim-place-${p.code}`}
                icon={() => (p.flag ? <T style={{ fontSize: 15, lineHeight: 19 }}>{p.flag}</T> : <Icon name="globe" size={16} color={colors.green} />)} />
            ))}
          </ChipWrap>
        </Rise>
      )}
    </View>
  );
}

/** "How many days?": the usual lengths, or a number typed. */
export function EsimDays({ where, flag, onDays, onChangePlace }: { where: string; flag: string | null; onDays: (n: number) => void; onChangePlace: () => void }) {
  const [typed, setTyped] = useState('');
  const n = Number(typed.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)));
  const ok = Number.isInteger(n) && n >= 1 && n <= 90;
  return (
    <View style={{ gap: 14 }} testID="esim-days">
      <Rise>
        <Pressable accessibilityRole="button" accessibilityLabel={t('es.days.change')} onPress={onChangePlace} style={styles.placeLine} testID="esim-days-place">
          {flag ? <T style={{ fontSize: 15, lineHeight: 19 }}>{flag}</T> : <Icon name="globe" size={16} color={colors.green} />}
          <T v="callout" color={colors.green} style={{ fontFamily: ff.ui600, flexShrink: 1 }} numberOfLines={1}>{where}</T>
          <T v="tiny" color={colors.ink3}>· {t('es.days.change')}</T>
        </Pressable>
      </Rise>
      <Rise step={1}><T style={font('displaySmall')} accessibilityRole="header">{t('es.which.days')}</T></Rise>
      <Rise step={2}>
        <ChipWrap>{DAY_CHOICES.map((d) => <Chip key={d} label={t('es.days.n', { n: d })} background={colors.paper} onPress={() => onDays(d)} testID={`esim-days-${d}`} />)}</ChipWrap>
      </Rise>
      <Rise step={3}>
        <View style={[styles.search, { paddingEnd: 6 }]}>
          <Icon name="calendar" size={18} color={colors.ink3} />
          <TextInput value={typed} onChangeText={(v) => setTyped(v.replace(/[^\d٠-٩]/g, '').slice(0, 2))} placeholder={t('es.days.typed')} placeholderTextColor={colors.muted}
            accessibilityLabel={t('es.which.days')} keyboardType="number-pad" returnKeyType="done" onSubmitEditing={() => { if (ok) onDays(n); }}
            style={[styles.input, webNoOutline]} testID="esim-days-input" />
          {ok ? <Pressable accessibilityRole="button" accessibilityLabel={t('es.days.go')} onPress={() => onDays(n)} style={styles.go} testID="esim-days-go"><Icon name="arrow" size={18} color={colors.mist} /></Pressable> : null}
        </View>
      </Rise>
    </View>
  );
}

const styles = StyleSheet.create({
  search: { height: 52, borderRadius: radii.input, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, minWidth: 0, fontFamily: ff.ui400, fontSize: 16, color: colors.green },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.paper },
  placeLine: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.paper },
  go: { width: 40, height: 40, borderRadius: 99, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
});

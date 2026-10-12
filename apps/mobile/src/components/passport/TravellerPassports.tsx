import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { needsPassports, passportReady, personName, type Person, type PassportReady } from '@mada/shared';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { fullDay, fullNameOf, todayIso } from '@/lib/wallet-model';
import { colors, ff } from '@/theme';
import { Icon } from '../Icon';
import { T } from '../Text';

/*
 * Passports inside a booking (pay, visa, Umrah, flight requests): each traveller with where their passport stands.
 *   Missing   "Add passport"
 *   Expiring  "Needs a look", with why (expired, or under 6 months left after they're back)
 *   Ready     a check mark
 * A tap opens the passport flow as a sheet over this screen (scan, a photo or PDF from files, or by hand) and comes
 * straight back here when it's saved. Nobody is sent out of the booking to the Wallet.
 */

export function openPassport(router: ReturnType<typeof useRouter>, p: Pick<Person, 'id' | 'isSelf'>) {
  buzz('tap');
  router.push({ pathname: '/passport', params: p.isSelf ? {} : { person: p.id } });
}

export function readinessLine(r: PassportReady, travelEnds: string | null | undefined): string {
  if (r.state === 'missing') return t('pp.book.missing');
  if (r.state === 'ready') return t('pp.book.valid', { date: fullDay(r.expiry) });
  if (r.reason === 'expired') return t('pp.book.expired', { date: fullDay(r.expiry) });
  return travelEnds && travelEnds > todayIso() ? t('pp.book.short', { date: fullDay(r.expiry), until: fullDay(r.needUntil) }) : t('pp.book.shortNow', { date: fullDay(r.expiry) });
}

export function TravellerPassports({ kind, people, travellerIds, travelEnds, selfName = '', note, testID = 'booking-passports' }: {
  /** What's being booked (trip, package, flight, visa, umrah…): nothing shows for one that doesn't need passports. */
  kind: string | null | undefined;
  people: Person[]; travellerIds: string[]; travelEnds?: string | null; selfName?: string;
  /** A line under the list while a passport is missing (the order sheet's "book now, add them within 48 hours"). */
  note?: string | null; testID?: string;
}) {
  const router = useRouter();
  const today = todayIso();
  const rows = travellerIds.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p)
    .map((p) => ({ p, r: passportReady(p, { today, travelEnds }) }));
  if (!needsPassports(kind) || !rows.length) return null;
  const allReady = rows.every((x) => x.r.state === 'ready');
  const anyMissing = rows.some((x) => x.r.state === 'missing');
  return (
    <View style={styles.box} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="visa" size={20} color={allReady ? colors.ok : colors.goldInk} />
        <T v="h3" style={{ flex: 1, fontSize: 15 }} accessibilityRole="header">{t('pp.book.title')}</T>
      </View>
      <T v="small">{allReady ? t('pp.book.allReady') : t('pp.book.body')}</T>
      {rows.map(({ p, r }) => {
        const name = p.passport ? fullNameOf(p) : personName(p, selfName);
        const status = r.state === 'missing' ? t('pp.book.add') : r.state === 'expiring' ? t('pp.book.look') : t('pp.book.ready');
        const line = readinessLine(r, travelEnds);
        return (
          <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={`${t('pp.book.status', { name, status })}. ${line}`} onPress={() => openPassport(router, p)}
            style={({ pressed }) => [styles.row, pressed ? { opacity: 0.85 } : null]} testID={`pp-row-${p.id}`}>
            <View style={[styles.avatar, r.state === 'ready' ? null : { backgroundColor: colors.warnWash }]}><T style={styles.initial}>{(p.firstName || name || '?').charAt(0).toUpperCase()}</T></View>
            <View style={{ flex: 1, gap: 1 }}>
              <T v="callout" color={colors.green} style={{ fontFamily: ff.ui600, fontSize: 15 }} numberOfLines={1}>{name}</T>
              <T v="tiny" color={r.state === 'expiring' ? colors.goldInk : colors.ink2} testID={`pp-line-${p.id}`}>{line}</T>
            </View>
            {r.state === 'ready'
              ? <View style={styles.tick} accessibilityElementsHidden testID={`pp-state-${p.id}`}><Icon name="check" size={14} color={colors.paper} width={2.6} /></View>
              : <View style={[styles.pill, r.state === 'missing' ? styles.pillAdd : styles.pillLook]} testID={`pp-state-${p.id}`}>
                  <T v="caption" color={r.state === 'missing' ? colors.green : colors.goldInk} style={{ fontFamily: ff.ui600 }} numberOfLines={1}>{status}</T>
                </View>}
          </Pressable>
        );
      })}
      {anyMissing && note ? <T v="tiny">{note}</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10, padding: 14, borderRadius: 18, backgroundColor: colors.mist },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: colors.paper, minHeight: 56 },
  avatar: { width: 36, height: 36, borderRadius: 999, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: ff.ui600, fontSize: 15, color: colors.green },
  tick: { width: 26, height: 26, borderRadius: 999, backgroundColor: colors.ok, alignItems: 'center', justifyContent: 'center' },
  pill: { height: 30, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center', maxWidth: 140 },
  pillAdd: { backgroundColor: colors.gold },
  pillLook: { backgroundColor: colors.warnWash, borderWidth: 1, borderColor: '#e6cf9f' },
});

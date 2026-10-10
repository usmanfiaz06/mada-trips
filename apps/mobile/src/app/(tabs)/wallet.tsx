import { useEffect, useMemo, useState } from 'react';
import { API_MODE } from '@/lib/config';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatSar, type Person, type WalletDocument } from '@mada/shared';
import { ArtCardSlot, ArtPass } from '@/components/art/Arts';
import { Button, LinkButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Scroll, Screen, useTopInset } from '@/components/Layout';
import { PayMark } from '@/components/PayMark';
import { T } from '@/components/Text';
import { LockScreen } from '@/components/wallet/LockScreen';
import { PassportCard } from '@/components/wallet/PassportCard';
import { AddDocSheet, CardsSheet, CreditSheet, DocSheet, PassSheet, UploadSheet, copyMasked, type AddKind } from '@/components/wallet/sheets';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { usePeople } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useAccount, useCards, useCredit, useDocuments, useRefreshHousehold, useTrips, walletApi } from '@/lib/wallet';
import { useWalletLock } from '@/lib/wallet-lock';
import { useNow, fullDay, isHelper, nextTrip, shortDay, validity, type NextTrip, type Validity } from '@/lib/wallet-model';
import { colors, ff, shadow } from '@/theme';

/** The Wallet (prototype Wallet.jsx): locked with Face ID, passports for the whole household, documents, passes, money. */
export default function Wallet() {
  const router = useRouter();
  // Mock builds only: lets the web e2e open the account screens, which Today's avatar links to.
  useEffect(() => { if (API_MODE === 'mock') (globalThis as { __madaGo?: (p: string) => void }).__madaGo = (p) => router.push(p as '/profile'); }, [router]);
  const status = useSession((s) => s.status);
  const account = useAccount();
  const unlocked = useWalletLock((s) => s.unlocked);
  if (status !== 'signedIn') return <SignedOut />;
  if (account.data?.faceId !== false && !unlocked) return <LockScreen />;
  return <Unlocked />;
}

function SignedOut() {
  const router = useRouter();
  const top = useTopInset();
  return (
    <Screen>
      <Scroll top={top + 10}>
        <T v="h1" style={{ fontSize: 34, lineHeight: 38 }} accessibilityRole="header">{t('wallet.title')}</T>
        <EmptyState art={<ArtCardSlot kind="doc" />} title={t('wallet.signedOut.title')} body={t('wallet.signedOut.body')}
          action={<Button label={t('wallet.signedOut.action')} onPress={() => router.push('/welcome')} />} />
      </Scroll>
    </Screen>
  );
}

const DOT = { none: colors.onDark3, warn: colors.gold, ok: colors.okBright };

function Unlocked() {
  const router = useRouter();
  const top = useTopInset();
  const me = useSession((s) => s.user);
  const people = usePeople();
  const docs = useDocuments();
  const trips = useTrips();
  const credit = useCredit();
  const cards = useCards();
  const account = useAccount();
  const refresh = useRefreshHousehold();
  const now = useNow();
  const list = people.data ?? [];
  const [whoId, setWho] = useState<string | null>(null);
  const who: Person | undefined = list.find((p) => p.id === whoId) ?? list[0];
  const trip = useMemo(() => nextTrip(trips.data), [trips.data]);
  const v = validity(who, trip);
  const [sheet, setSheet] = useState<null | 'add' | 'credit' | 'cards' | 'pass'>(null);
  const [upload, setUpload] = useState<{ kind: Exclude<AddKind, 'passport'>; replaces?: WalletDocument | null } | null>(null);
  const [docOpen, setDocOpen] = useState<WalletDocument | null>(null);
  const [askOpen, setAskOpen] = useState<{ title: string; sub: string } | null>(null);
  const name = (p?: Person) => (p?.isSelf ? (me?.name || p.firstName || t('household.youPlain')) : p?.firstName ?? '');

  const scan = (p = who) => router.push({ pathname: '/passport', params: p && !p.isSelf ? { person: p.id } : {} });
  const pickKind = (k: AddKind) => { setSheet(null); if (k === 'passport') scan(); else setUpload({ kind: k }); };
  const renew = async () => {
    try {
      const { thread } = await walletApi.openThread(trip ? { tripId: trip.id } : {});
      await walletApi.sendMessage(thread.id, { body: t('wallet.renew.message', { name: name(who) }) });
    } catch { /* the toast still tells them; the desk sees it when the connection is back */ }
    buzz('success');
    toast(t('wallet.renew.sent', { name: name(who) }));
  };

  const myDocs = (docs.data ?? []).filter((d) => d.personId === who?.id);
  const helper = who ? isHelper(who) : false;
  const asks = helper ? [[t('wallet.docs.iqama'), t('wallet.docs.notAdded')], [t('wallet.docs.exitVisa'), t('wallet.docs.exitNeeded')]].filter(([title]) => !myDocs.some((d) => d.title === title)) : [];
  const outSeg = trip?.trip.segments.find((s) => s.direction === 'out') ?? null;
  const departs = outSeg ? Date.parse(`${outSeg.departLocal}:00+03:00`) : 0;
  const passesOpen = outSeg ? departs - now < 24 * 3_600_000 && departs > now - 6 * 3_600_000 : false;
  const travellers = trip ? list.filter((p) => trip.travellerIds.includes(p.id)) : [];
  const bal = credit.data?.balance.amount ?? 0;
  const savedCards = cards.data?.cards ?? [];
  const defaultLabel = cards.data?.defaultId === 'applepay' ? t('cards.applePay') : savedCards.find((c) => c.id === cards.data?.defaultId)?.label ?? t('cards.applePay');

  return (
    <Screen>
      <Scroll top={top + 10}>
        <View style={styles.header}>
          <View style={{ gap: 2 }}>
            <T v="h1" style={{ fontSize: 34, lineHeight: 38 }} accessibilityRole="header">{t('wallet.title')}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="lock" size={14} color={colors.ink3} /><T v="tiny">{account.data?.faceId === false ? t('wallet.lock.notLocked') : t('wallet.lock.lockedWith')}</T></View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('wallet.add')} onPress={() => { buzz('tap'); setSheet('add'); }} style={styles.plus} testID="wallet-add"><Icon name="plus" color={colors.mist} /></Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }} accessibilityLabel={t('wallet.whose')}>
          {list.map((p) => {
            const pv = validity(p, trip);
            const dot = !p.passport ? DOT.none : pv.kind === 'blocked' || pv.kind === 'expired' || pv.kind === 'spare' ? DOT.warn : DOT.ok;
            return <Chip key={p.id} on={who?.id === p.id} label={name(p)} onPress={() => setWho(p.id)} icon={() => <View style={[styles.dot, { backgroundColor: dot }]} />} />;
          })}
        </ScrollView>

        <PassportCard person={who} validity={v} isSelf={!!who?.isSelf} name={name(who)} onScan={() => scan()} />

        {who?.passport ? <ValidityCard v={v} who={who} name={name(who)} trip={trip} onRenew={renew} /> : null}

        <T v="eyebrow">{who?.isSelf ? t('wallet.docs.eyebrow') : t('wallet.docs.eyebrowOther', { name: name(who) })}</T>
        {myDocs.length || asks.length ? (
          <>
            {myDocs.map((d) => (
              <Card key={d.id} onPress={() => setDocOpen(d)} accessibilityLabel={d.title} style={styles.rowCard}>
                <Icon name={d.kind === 'visa' || /visa/i.test(d.title) ? 'visa' : 'doc'} />
                <View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 15 }}>{d.title}</T><T v="tiny">{d.detail}</T></View>
                <Icon name="chevron" />
              </Card>
            ))}
            {asks.map(([title, sub]) => (
              <Card key={title} onPress={() => setAskOpen({ title: title!, sub: sub! })} accessibilityLabel={title} style={styles.rowCard}>
                <Icon name="doc" /><View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 15 }}>{title}</T><T v="tiny">{sub}</T></View><Icon name="chevron" />
              </Card>
            ))}
          </>
        ) : (
          <View style={styles.dashed}>
            <EmptyState compact art={<ArtCardSlot kind="doc" width={100} height={75} />} onPress={() => setSheet('add')}
              title={t('wallet.docs.emptyTitle')} body={who?.isSelf ? t('wallet.docs.emptyBody') : t('wallet.docs.emptyBodyOther', { name: name(who) })} />
          </View>
        )}

        <T v="eyebrow">{t('wallet.passes.eyebrow')}</T>
        {trip && outSeg && passesOpen ? (
          <Card onPress={() => setSheet('pass')} accessibilityLabel={t('wallet.passes.title')} style={styles.rowCard}>
            <View style={styles.airline}><T style={{ fontFamily: ff.ui600, color: colors.mist, fontSize: 12 }}>{outSeg.carrier}</T></View>
            <View style={{ flex: 1 }}>
              <T v="h3" style={{ fontSize: 15 }}>{travellers.length === 1 ? t('wallet.passes.rowOne', { flight: outSeg.flightNumber }) : t('wallet.passes.row', { flight: outSeg.flightNumber, count: travellers.length })}</T>
              <T v="tiny">{t(travellers.length === 1 ? 'wallet.passes.rowSubOne' : 'wallet.passes.rowSub', { date: fullDay(outSeg.departLocal.slice(0, 10)), terminal: outSeg.terminal ?? '', seats: outSeg.seats.length > 1 ? `${outSeg.seats[0]}–${outSeg.seats[outSeg.seats.length - 1]}` : outSeg.seats[0] ?? '' })}</T>
            </View>
            <Icon name="chevron" />
          </Card>
        ) : trip ? (
          <Card variant="well" style={{ gap: 4 }}>
            <T v="h3" style={{ fontSize: 15 }}>{t('wallet.passes.title')}</T>
            <T v="tiny">{outSeg ? t('wallet.passes.notYet', { flight: outSeg.flightNumber, date: fullDay(outSeg.departLocal.slice(0, 10)) }) : t('wallet.passes.noFlights')}</T>
          </Card>
        ) : (
          <EmptyState compact art={<ArtPass width={100} height={75} />} title={t('wallet.passes.emptyTitle')} body={t('wallet.passes.emptyBody')}
            action={<LinkButton label={t('wallet.passes.plan')} onPress={() => router.push('/ask')} />} />
        )}

        {trip?.trip.vouchers.length ? (
          <>
            <T v="eyebrow">{t('wallet.vouchers')}</T>
            {trip.trip.vouchers.map((vo) => (
              <Card key={vo.id} style={styles.rowCard}>
                <Icon name={vo.kind === 'hotel' ? 'stay' : 'food'} />
                <View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 15 }}>{vo.title}</T><T v="tiny">{vo.body}</T></View>
                <T v="tiny" style={{ fontFamily: ff.ui600, color: colors.green, letterSpacing: 0.5, fontVariant: ['tabular-nums'] }}>{vo.code}</T>
              </Card>
            ))}
          </>
        ) : null}

        <T v="eyebrow">{t('money.eyebrow')}</T>
        <View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('money.credit')} onPress={() => { buzz('tap'); setSheet('credit'); }} style={[styles.credit, shadow('focal')]} testID="wallet-credit">
            <View style={styles.spread}><T v="eyebrow" color={colors.gold}>{t('money.credit')}</T><PayMark brand="credit" size={22} /></View>
            <T style={{ fontFamily: ff.ui600, fontSize: 34, lineHeight: 40, letterSpacing: -1, color: colors.mist, fontVariant: ['tabular-nums'] }}>{formatSar(bal)}</T>
            <T v="tiny" color={colors.onDark2}>{bal ? t('money.credit.used') : t('money.credit.zero')}</T>
          </Pressable>
        </View>
        <Card onPress={() => setSheet('cards')} accessibilityLabel={t('money.cards')} style={styles.rowCard}>
          <View style={{ flexDirection: 'row' }}>{(savedCards.length ? savedCards.slice(0, 3) : [{ id: 'applepay', brand: 'applepay' as const }]).map((c, i) => <View key={c.id} style={{ marginStart: i ? -8 : 0 }}><PayMark brand={c.brand} size={24} /></View>)}</View>
          <View style={{ flex: 1, marginStart: 8 }}>
            <T v="h3" style={{ fontSize: 15 }}>{t('money.cards')}</T>
            <T v="tiny">{savedCards.length ? t(savedCards.length === 1 ? 'money.cards.subOne' : 'money.cards.sub', { count: savedCards.length, label: defaultLabel }) : t('money.cards.none')}</T>
          </View>
          <Icon name="chevron" />
        </Card>
      </Scroll>

      <AddDocSheet visible={sheet === 'add'} onClose={() => setSheet(null)} onPick={pickKind} />
      {who && upload ? <UploadSheet visible={!!upload} kind={upload.kind} person={who} replaces={upload.replaces} onClose={() => setUpload(null)} onSaved={() => { setUpload(null); refresh(); }} /> : null}
      <DocSheet doc={docOpen} ask={askOpen} tripId={trip?.id} onClose={() => { setDocOpen(null); setAskOpen(null); }}
        onAdd={() => (askOpen && who ? router.push({ pathname: '/household/[id]', params: { id: who.id } }) : setSheet('add'))}
        onReplace={(d) => setUpload({ kind: d.kind === 'visa' ? 'visa' : d.kind === 'insurance' ? 'insurance' : d.kind === 'national_id' || d.kind === 'iqama' ? 'id' : 'other', replaces: d })}
        onChanged={() => refresh()} />
      <CreditSheet visible={sheet === 'credit'} onClose={() => setSheet(null)} />
      <CardsSheet visible={sheet === 'cards'} onClose={() => setSheet(null)} onPicked={(label, changed) => toast(changed ? (label === t('cards.applePay') ? t('cards.default.applePay') : t('cards.default.updated')) : t('cards.default.same'))} />
      <PassSheet visible={sheet === 'pass'} onClose={() => setSheet(null)} seg={outSeg} people={travellers} />
    </Screen>
  );
}

/** Valid for the trip, with the bar from landing to the day it must still be valid (prototype Wallet card). */
function ValidityCard({ v, who, name, trip, onRenew }: { v: Validity; who: Person; name: string; trip: NextTrip | null; onRenew: () => void }) {
  const onTrip = trip && trip.travellerIds.includes(who.id);
  const issue = v.kind === 'blocked' || v.kind === 'spare';
  let head = ''; let body = '';
  switch (v.kind) {
    case 'expired': head = t('wallet.validity.expired', { date: fullDay(v.expiry) }); body = t('wallet.validity.expiredBody'); break;
    case 'valid': head = t('wallet.validity.validUntil', { date: fullDay(v.expiry) }); body = t('wallet.validity.validUntilBody'); break;
    case 'notOnTrip': head = t('wallet.validity.notOnTrip', { name, city: v.trip.city }); break;
    case 'ready': head = t('wallet.validity.ready', { city: v.trip.city }); body = t('wallet.validity.readyBody', { days: v.need, country: v.trip.country }); break;
    case 'spare': head = t('wallet.validity.spare', { city: v.trip.city, days: v.left - v.need }); body = t('wallet.validity.spareBody', { city: v.trip.city, country: v.trip.country, need: v.need, name, left: v.left }); break;
    case 'blocked': head = who.isSelf ? t('wallet.validity.blockedYou', { city: v.trip.city }) : t('wallet.validity.blocked', { name, city: v.trip.city }); body = t('wallet.validity.blockedBody', { name, date: fullDay(v.expiry), country: v.trip.country, need: v.need, until: shortDay(v.until) }); break;
    default: break;
  }
  return (
    <View>
      <Card style={{ gap: 10 }}>
        <T v="h3" testID="validity-head">{head}</T>
        {body ? <T v="small">{body}</T> : null}
        {onTrip && (v.kind === 'ready' || v.kind === 'spare' || v.kind === 'blocked') ? (
          <View style={{ height: 40, marginHorizontal: 4 }} accessibilityElementsHidden>
            <View style={[styles.track, { backgroundColor: colors.mist }]} />
            <View style={[styles.track, { width: v.kind === 'blocked' ? '78%' : '100%', backgroundColor: v.kind === 'blocked' ? colors.gold : v.kind === 'spare' ? colors.okBright : colors.okBright }]} />
            {v.kind === 'spare' ? <View style={[styles.track, { start: '80%', width: '20%', backgroundColor: colors.gold }]} /> : null}
            <View style={[styles.tick, { start: issue ? '36%' : '14%', backgroundColor: colors.green }]} />
            <T v="tiny" style={[styles.tickLabel, { start: issue ? '26%' : '4%', color: colors.green }]}>{t('wallet.validity.trip', { date: shortDay(v.trip.land) })}</T>
            <View style={[styles.tick, { start: issue ? '95%' : '38%', backgroundColor: colors.goldDeep }]} />
            <T v="tiny" style={[styles.tickLabel, issue ? { end: 0 } : { start: '28%' }, { color: colors.goldInk }]}>{t('wallet.validity.until', { date: shortDay(v.until) })}</T>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {issue || v.kind === 'expired' ? <Button size="small" block={false} label={t('wallet.renew')} onPress={onRenew} testID="wallet-renew" /> : null}
          <Button variant="secondary" size="small" block={false} label={t('wallet.copyNumber')} onPress={() => copyMasked(who.passport!.numberMasked)} style={{ backgroundColor: colors.mist }} />
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  plus: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 99 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dashed: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(30,53,45,0.18)', borderRadius: 22 },
  airline: { width: 32, height: 32, borderRadius: 9, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  credit: { borderRadius: 24, padding: 18, gap: 6, backgroundColor: colors.green },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  track: { position: 'absolute', start: 0, top: 8, height: 6, borderRadius: 999 },
  tick: { position: 'absolute', top: 4, width: 2, height: 14 },
  tickLabel: { position: 'absolute', top: 22, fontFamily: ff.ui600, fontSize: 11 },
});

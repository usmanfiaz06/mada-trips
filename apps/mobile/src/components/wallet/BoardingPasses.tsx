import { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import * as Brightness from 'expo-brightness';
import { SvgXml } from 'react-native-svg';
import { dayLabel, todayIn, type BoardingPassView, type CheckInWindow, type FlightSegment, type Person, type Trip } from '@mada/shared';
import { ApiError } from '@/lib/api';
import { addToAppleWallet, boardingApi, canAddToAppleWallet, chooseBoardingPass, passesFor, useBoardingPasses, useRefreshPasses } from '@/lib/boarding';
import { buzz } from '@/lib/haptics';
import { getLocale, t, tn } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { fullDay, fullNameOf } from '@/lib/wallet-model';
import { colors, ff, radii } from '@/theme';
import { Button, LinkButton } from '../Button';
import { Card } from '../Card';
import { Icon } from '../Icon';
import { Sheet } from '../Sheet';
import { T } from '../Text';

/*
 * The Wallet's boarding passes for the next trip (docs/app/NATIVE.md). Before check-in: when it opens and the airline's
 * page. After: the airline's own passes, one per traveller, with the barcode drawn again at full size and the screen
 * at full brightness. Never a barcode the airline didn't issue.
 */

const boardsAt = (seg: FlightSegment) => { const [h, m] = seg.departLocal.slice(11, 16).split(':').map(Number) as [number, number]; const x = h * 60 + m - 45; return `${String(Math.floor(((x + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((x % 60) + 60) % 60).padStart(2, '0')}`; };

/** zxing draws a fixed-size SVG; a viewBox lets it fill the width at any size. */
const scalable = (svg: string) => (/viewBox=/.test(svg) ? svg : svg.replace(/<svg([^>]*?)\swidth="(\d+(?:\.\d+)?)"\s+height="(\d+(?:\.\d+)?)"/, '<svg$1 viewBox="0 0 $2 $3" width="$2" height="$3"'));
/** "ALHARBI/HESSA MRS" as people write it: "Hessa Alharbi". */
const nameFromPass = (printed: string) => {
  const [sur = '', rest = ''] = printed.split('/');
  const given = rest.replace(/\s+(MR|MRS|MS|MISS|MSTR|DR|CHD|INF)$/i, '');
  return `${given} ${sur}`.trim().toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
};
const svgSize = (svg: string) => { const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg) ?? /width="([\d.]+)"\s+height="([\d.]+)"/.exec(svg); return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 3, h: 1 }; };

function opensLine(w: CheckInWindow, seg: FlightSegment): string {
  const day = todayIn(seg.departTz, new Date(w.opensAt));
  const today = todayIn(seg.departTz, new Date());
  return day === today ? t('bp.checkIn.opens', { time: w.opensLocal }) : t('bp.checkIn.opensDay', { day: dayLabel(day, { today, locale: getLocale() }), time: w.opensLocal });
}

export function BoardingPasses({ trip, people, nameOf }: { trip: Trip; people: Person[]; nameOf: (p?: Person) => string }) {
  const q = useBoardingPasses(trip.id);
  const refresh = useRefreshPasses();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = q.data;
  // The next flight still to come (the server lists check-in for those only); before it answers, the outbound.
  const segId = data?.checkIn[0]?.segmentId ?? trip.segments.find((s) => s.direction === 'out')?.id;
  const seg = trip.segments.find((s) => s.id === segId) ?? null;
  if (!seg) return <Card variant="well" style={{ gap: 4 }}><T v="h3" style={{ fontSize: 15 }}>{t('wallet.passes.title')}</T><T v="tiny">{t('wallet.passes.noFlights')}</T></Card>;
  const win = data?.checkIn.find((w) => w.segmentId === seg.id) ?? null;
  const list = passesFor(data?.passes ?? [], seg.id, trip.travellerIds);
  const missing = people.filter((p) => !list.some((x) => x.travellerId === p.id));
  const airline = win?.airline ?? seg.carrierName;
  const stay = trip.stays.find((s) => s.status !== 'cancelled');
  const wallet = canAddToAppleWallet(data?.appleWallet);

  const add = async () => {
    const file = await chooseBoardingPass().catch(() => null);
    if (!file) return;
    setBusy(true);
    toast(t('bp.reading'));
    try {
      const r = await boardingApi.add(trip.id, file);
      await refresh(trip.id);
      buzz('success');
      const first = r.added[0];
      const who = first?.travellerId ? people.find((p) => p.id === first.travellerId) : undefined;
      toast(r.added.length === 1 ? t('bp.added.one', { name: who ? nameOf(who) : nameFromPass(first!.name) }) : tn('bp.added', r.added.length, { count: r.added.length }));
      if (r.added.length) setOpen(true);
    } catch (e) {
      buzz('warn');
      toast(e instanceof ApiError ? e.message : t('bp.unreadable'));
    } finally { setBusy(false); }
  };

  return (
    <>
      {list.length ? (
        <View testID="bp-row"><Card onPress={() => setOpen(true)} accessibilityLabel={t('wallet.passes.title')} style={styles.rowCard}>
          <View style={styles.airline}><T style={{ fontFamily: ff.ui600, color: colors.mist, fontSize: 12 }}>{seg.carrier}</T></View>
          <View style={{ flex: 1 }}>
            <T v="h3" style={{ fontSize: 15 }}>{tn('bp.row', list.length, { flight: seg.flightNumber, count: list.length })}</T>
            <T v="tiny">{t(list.length === 1 ? 'wallet.passes.rowSubOne' : 'wallet.passes.rowSub', { date: fullDay(seg.departLocal.slice(0, 10)), terminal: seg.terminal ?? '', seats: list.length > 1 ? `${list[0]!.seat}–${list[list.length - 1]!.seat}` : list[0]!.seat })}</T>
          </View>
          <Icon name="chevron" />
        </Card></View>
      ) : (
        <View testID="bp-checkin"><Card variant="well" style={{ gap: 10 }}>
          <View style={{ gap: 4 }}>
            <T v="h3" style={{ fontSize: 15 }}>{win?.open ? t('bp.checkIn.open') : win ? opensLine(win, seg) : t('wallet.passes.title')}</T>
            <T v="tiny">{t('bp.checkIn.sub', { airline })}</T>
          </View>
          {win?.url && win.open ? <Button size="small" block={false} label={t('bp.checkIn.go', { airline })} onPress={() => void Linking.openURL(win.url!)} testID="bp-checkin-go" /> : null}
        </Card></View>
      )}
      {list.length && missing.length ? <T v="tiny" style={{ marginTop: -6 }}>{missing.map((p) => t('bp.missing', { name: nameOf(p) })).join(' ')}</T> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        {list.length < Math.max(1, people.length) ? <LinkButton label={busy ? t('bp.reading') : t('bp.add')} onPress={() => { if (!busy) void add(); }} testID="bp-add" /> : null}
        {list.length && win?.url && missing.length ? <LinkButton label={t('bp.checkIn.go', { airline })} onPress={() => void Linking.openURL(win.url!)} /> : null}
        {wallet && stay ? <LinkButton label={t('bp.wallet.hotel')} onPress={() => { toast(t('bp.wallet.opening')); void addToAppleWallet(trip.id, { stayId: stay.id }).catch(() => toast(t('error.notConfigured'))); }} /> : null}
      </View>
      {!list.length ? <T v="tiny" style={{ marginTop: -6 }}>{t('bp.add.sub', { airline })}</T> : null}
      <PassSheet visible={open} onClose={() => setOpen(false)} tripId={trip.id} seg={seg} passes={list} people={people} wallet={wallet} onRemoved={() => { void refresh(trip.id); }} />
    </>
  );
}

/** The passes, one at a time: the airline's barcode at full width, the screen at full brightness. */
export function PassSheet({ visible, onClose, tripId, seg, passes, people, wallet, onRemoved }: {
  visible: boolean; onClose: () => void; tripId: string; seg: FlightSegment; passes: BoardingPassView[]; people: Person[]; wallet: boolean; onRemoved: () => void;
}) {
  const [i, setI] = useState(0);
  const [width, setWidth] = useState(300);
  useBrightUp(visible);
  const n = passes.length;
  const k = Math.min(i, Math.max(0, n - 1));
  const p = passes[k];
  if (!p) return null;
  const person = people.find((x) => x.id === p.travellerId);
  const svg = p.svg ? scalable(p.svg) : null;
  const size = svg ? svgSize(svg) : { w: 3, h: 1 };
  const remove = async () => {
    try { await boardingApi.remove(tripId, p.id); toast(t('bp.removed')); onRemoved(); if (n <= 1) onClose(); } catch (e) { toast(e instanceof ApiError ? e.message : t('error.internal')); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} label={t('wallet.passes.title')}>
      <View style={styles.spread}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={styles.airline}><T style={{ fontFamily: ff.ui600, color: colors.mist, fontSize: 12 }}>{seg.carrier}</T></View>
          <View><T v="h3">{seg.flightNumber}</T><T v="tiny">{`${fullDay(seg.departLocal.slice(0, 10))} · ${seg.from} → ${seg.to}`}</T></View>
        </View>
        <View style={styles.pill}><T v="caption" style={{ fontFamily: ff.ui600 }}>{t('wallet.pass.seat', { seat: p.seat || '–' })}</T></View>
      </View>
      <View style={{ gap: 2 }}>
        <T style={{ fontFamily: ff.display, fontSize: 30, lineHeight: 32, color: colors.green }} testID="bp-name">{person ? fullNameOf(person) || person.firstName : nameFromPass(p.name)}</T>
        {!p.travellerId ? <T v="tiny">{t('bp.whose', { name: p.name })}</T> : null}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[[t('wallet.pass.terminal'), (seg.terminal ?? '').replace('Terminal ', '') || '–'], [t('wallet.pass.gate'), seg.gate ?? '–'], [t('wallet.pass.boards'), boardsAt(seg)]].map(([kk, v]) => (
          <View key={kk} style={styles.cell}><T v="caption" color={colors.ink3}>{kk}</T><T style={{ fontFamily: ff.ui600, fontSize: 20, lineHeight: 24, color: colors.green, fontVariant: ['tabular-nums'] }}>{v}</T></View>
        ))}
      </View>
      {n > 1 ? (
        <View style={styles.spread}>
          <Button variant="secondary" style={well} size="small" block={false} label={t('wallet.pass.previous')} disabled={k === 0} onPress={() => setI(k - 1)} />
          <T v="tiny">{t('wallet.pass.of', { n: k + 1, count: n })}</T>
          <Button variant="secondary" style={well} size="small" block={false} label={t('wallet.pass.next')} disabled={k === n - 1} onPress={() => setI(k + 1)} testID="bp-next" />
        </View>
      ) : null}
      <View style={styles.code} accessibilityRole="image" accessibilityLabel={t('wallet.pass.code')} onLayout={(e) => setWidth(e.nativeEvent.layout.width - 24)} testID="bp-code">
        {svg ? <SvgXml xml={svg} width={width} height={Math.round((width * size.h) / size.w)} /> : <T v="small" style={{ textAlign: 'center', color: colors.ink2 }}>{p.message}</T>}
      </View>
      <View style={styles.spread}>
        <T v="tiny">{[t('bp.seq', { n: p.sequence }), p.pnr, p.source === 'desk' ? t('bp.fromDesk') : t('bp.fromYou')].join(' · ')}</T>
      </View>
      <T v="small" style={{ textAlign: 'center' }}>{t('bp.saved')}</T>
      {wallet ? <Button variant="secondary" style={well} label={t('bp.wallet.add')} onPress={() => { toast(t('bp.wallet.opening')); void addToAppleWallet(tripId, { passId: p.id }).catch(() => toast(t('error.notConfigured'))); }} testID="bp-apple-wallet" /> : null}
      <LinkButton label={t('bp.remove')} color={colors.ink2} onPress={() => void remove()} />
    </Sheet>
  );
}

/** Full brightness while a barcode is on screen, back to what it was after. */
function useBrightUp(on: boolean) {
  useEffect(() => {
    if (!on || Platform.OS === 'web') return;
    let before: number | null = null;
    void (async () => {
      try {
        if (!(await Brightness.isAvailableAsync())) return;
        before = await Brightness.getBrightnessAsync();
        await Brightness.setBrightnessAsync(1);
      } catch { /* the barcode still shows */ }
    })();
    return () => { if (before !== null) void Brightness.setBrightnessAsync(before).catch(() => {}); };
  }, [on]);
}

const well = { backgroundColor: colors.mist };
const styles = StyleSheet.create({
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  airline: { width: 32, height: 32, borderRadius: 9, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  pill: { height: 26, borderRadius: 999, paddingHorizontal: 10, backgroundColor: colors.mist, justifyContent: 'center' },
  cell: { flex: 1, borderRadius: 16, backgroundColor: colors.sand, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  code: { padding: 12, borderRadius: radii.input, backgroundColor: colors.white, alignItems: 'center' },
});

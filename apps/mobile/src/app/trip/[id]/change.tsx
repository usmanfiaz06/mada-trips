import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { CHANGE_KINDS, SWITCH_OFFERS, dayLabel, formatSar, liveStay, moveNeeded, nameDistance, outSegment, backSegment, switchCredit, timing, type ChangeFlightRequest, type ChangeKind, type TripDetail } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon, type IconName } from '@/components/Icon';
import { SlideToConfirm } from '@/components/SlideToConfirm';
import { T } from '@/components/Text';
import { MoveNotice, MoveSheet } from '@/components/trips/MoveNotice';
import { AgentNote, AirlineMark, BigCheck, Box, Divider, Grow, H3, ListRow, Num, PickCard, Rise, Row, Small, Spread, Steps, TextLink, Tiny, TripScreen } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { newKey, tripsApi, useChangeOptions, useTrip, useTripMutation } from '@/lib/trips';
import { colors, ff } from '@/theme';

const dl = (d: string) => dayLabel(d, { today: d });
const sar = (h: number) => formatSar(Math.abs(h), { bare: true });

/** Change a flight (prototype ChangeFlight): the fee and the price difference are shown before anything changes. */
export default function ChangeFlight() {
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const router = useRouter();
  const q = useTrip(id);
  const trip = q.data?.trip;
  const [kind, setKind] = useState<ChangeKind | null>(focus === 'return' ? 'return' : null);
  const [who, setWho] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [stage, setStage] = useState<'choose' | 'working' | 'done'>('choose');
  const [result, setResult] = useState<{ say: string; total: number; trip: TripDetail } | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const opts = useChangeOptions(id, kind);
  const change = useTripMutation((b: ChangeFlightRequest) => tripsApi.change(id, b));
  const call = useTripMutation(() => tripsApi.ask(id, { area: 'other', kind: 'call', clientKey: newKey() }));
  const wider = useTripMutation(() => tripsApi.ask(id, { area: 'other', kind: 'wider', clientKey: newKey() }));
  if (!trip) return <TripScreen title={t('cf.title')}>{null}</TripScreen>;
  const out = outSegment(trip);
  const back = backSegment(trip);
  const tm = timing(trip.clock.phase);
  const n = trip.travellers.length;
  if (!out) {
    return (
      <TripScreen title={t('cf.title')}>
        <Box tone="well"><H3>{t('cf.noFlights')}</H3><Small>{t('cf.noFlightsBody')}</Small><Button label={t('td.ready.findFlights')} size="small" block={false} onPress={() => router.push(`/ask?prefill=${encodeURIComponent(`Flights to ${trip.city}`)}` as Href)} /></Box>
      </TripScreen>
    );
  }
  const R = trip.fare!;
  if (tm.airlineCancelled) {
    return (
      <TripScreen title={t('cf.title')}>
        <Box tone="focal"><H3 color={colors.mist}>{t('rf.cancelled', { airline: out.carrierName, code: out.flightNumber })}</H3><Small color={colors.onDark2}>{t('cf.cancelledBody', { n })}</Small>
          <Button variant="gold" label={t('td.cx.options')} onPress={() => router.push(`/disruption/${id}?kind=cancel` as Href)} /></Box>
      </TripScreen>
    );
  }
  if (tm.allUsed) return <TripScreen title={t('cf.title')}><T v="h1">{t('cf.flown')}</T><T v="body">{t('cf.flownBody')}</T></TripScreen>;
  if (tm.within24) {
    return (
      <TripScreen title={t('cf.title')} act={<Button testID="call-me" label={t('cf.callMe')} busy={call.isPending} onPress={() => call.mutate(undefined, { onSuccess: () => { buzz('success'); router.push('/support?topic=change' as Href); } })} />}>
        <Small>{out.flightNumber} · {dl(out.departLocal.slice(0, 10))} · {out.departLocal.slice(11, 16)}</Small>
        <Rise><T v="h1">{t('cf.within24')}</T></Rise>
        <Rise step={1}><T v="body">{t('cf.within24Body', { airline: out.carrierName, agent: trip.agent.name })}</T></Rise>
        <Box tone="well"><H3 size={15}>{t('cf.rulesApply')}</H3><Small>{t('cf.rulesBody', { fee: R.changeFee ? t('cf.feePp', { fee: sar(R.changeFee) }) : t('cf.free') })}</Small></Box>
      </TripScreen>
    );
  }

  if (stage === 'working') {
    return (
      <TripScreen title="">
        <View style={{ gap: 24, paddingTop: 30 }}>
          <View style={styles.bigFace}><T style={{ color: colors.sand, fontSize: 28, fontFamily: ff.ui600 }}>{trip.agent.initial}</T></View>
          <T v="h1">{t('cf.working', { agent: trip.agent.name })}</T>
          <Steps items={[{ text: t('cf.step.held'), state: 'done' }, { text: t('cf.step.changing', { airline: out.carrierName }), state: 'now' }, { text: t('cf.step.pickups'), state: 'todo' }]} />
        </View>
      </TripScreen>
    );
  }
  if (stage === 'done' && result) {
    const after = result.trip;
    return (
      <TripScreen title="" act={<Button testID="back-to-trip" label={t('cf.backToTrip')} onPress={() => router.back()} />}>
        <Rise style={{ marginTop: 30 }}><BigCheck /></Rise>
        <Rise step={1}><T v="h1">{t('cf.done', { say: result.say })}</T></Rise>
        <Rise step={2}><T v="body">{result.total < 0 ? t('cf.doneCredit', { amount: formatSar(-result.total) }) : t('cf.doneNoCost')} {t('cf.donePasses')}</T></Rise>
        <MoveNotice trip={after} />
        <AgentNote initial={trip.agent.initial}>{t('cf.doneLine', { airline: out.carrierName, seats: n > 1 ? t('cf.sameSeats') : t('cf.sameSeat') })}</AgentNote>
        {moveNeeded(after) ? <MoveSheet trip={after} open={moveOpen} onClose={() => setMoveOpen(false)} /> : null}
      </TripScreen>
    );
  }

  const count = kind === 'one' ? 1 : n;
  const options = opts.data?.options ?? [];
  const cur = options.find((o) => o.id === pick);
  const fee = R.changeFee * count;
  const whoP = trip.travellers.find((p) => p.id === who);
  const escort = kind === 'one' && whoP?.birthYear && whoP.birthYear > new Date(trip.clock.now).getUTCFullYear() - 12 ? 35000 : 0;
  const fareDiff = cur ? cur.diffPerPerson * count : 0;
  const total = fee + fareDiff + escort;
  const ready = kind === 'one' ? !!(who && cur) : !!cur;
  const send = () => {
    if (!kind || !cur) return;
    const body: ChangeFlightRequest = kind === 'one' ? { kind, optionId: cur.id, travellerId: who!, clientKey: newKey() } : { kind: kind as 'date' | 'time' | 'return', optionId: cur.id, clientKey: newKey() };
    if (total <= 0) { setStage('working'); buzz('knock'); }
    change.mutate(body, {
      onSuccess: (r) => {
        if (r.result === 'done') { setResult({ say: r.say, total: r.total, trip: r.trip }); setTimeout(() => { setStage('done'); buzz('success'); if (cur.movesOutDate && r.move) setMoveOpen(true); }, 1200); }
        else { setStage('choose'); toast(r.result === 'quoted' ? t('cf.quoted') : t('cf.sent')); router.replace('/trips?tab=requests' as Href); }
      },
      onError: (e) => { setStage('choose'); toast(e.message); },
    });
  };
  const allowed = (side: string) => !(tm.outUsed && side === 'out');
  const act = kind && kind !== 'airline' && kind !== 'name' && options.length > 0 ? (
    total > 0
      ? <Button testID="change-review" label={ready ? t('cf.review', { amount: formatSar(total) }) : t('cf.pickFlight')} disabled={!ready} busy={change.isPending} onPress={send} />
      : <SlideToConfirm disabled={!ready} label={!ready ? t('cf.pickFlight') : total < 0 ? t('cf.slideBack', { amount: formatSar(-total) }) : t('cf.slideFree')} onConfirm={send} />
  ) : null;
  const ICON: Record<ChangeKind, IconName> = { date: 'flight', time: 'flight', return: 'flight', one: 'flight', airline: 'globe', name: 'user' };
  return (
    <TripScreen title={t('cf.title')} act={act}>
      <Box style={{ flexDirection: 'row', alignItems: 'center' }}>
        <AirlineMark code={out.carrier} brand={out.brand} size={36} name={out.carrierName} />
        <Grow gap={0}><H3 size={15}>{out.flightNumber} · {dl(out.departLocal.slice(0, 10))} · {out.departLocal.slice(11, 16)}</H3><Tiny>{back ? t('cf.backLine', { code: back.flightNumber, day: dl(back.departLocal.slice(0, 10)), time: back.departLocal.slice(11, 16) }) : t('cf.oneWayLine')} · {t(n === 1 ? 'cf.travellers.one' : 'cf.travellers.other', { n })}</Tiny></Grow>
      </Box>
      <Row gap={8}>
        {[[t('cf.r.fee'), R.changeFee ? t('cf.feePpShort', { fee: sar(R.changeFee) }) : t('cf.free')], [t('cf.r.refund'), R.refundable && R.refundFee !== null ? t('cf.minusPp', { fee: sar(R.refundFee) }) : t('cf.taxesOnly')], [t('cf.r.bags'), R.bags]].map(([k, v]) => (
          <View key={k} style={styles.rule}><T style={{ fontSize: 11, color: colors.ink3, fontFamily: ff.ui500 }}>{k}</T><T style={{ fontSize: 13, fontFamily: ff.ui600, color: colors.green }}>{v}</T></View>
        ))}
      </Row>
      {!kind ? (<>
        <T v="h2">{t('cf.whatChange')}</T>
        <Box padding={6} gap={0}>
          {CHANGE_KINDS.filter((k) => back || k.side !== 'back').map((k, i) => (
            allowed(k.side)
              ? <ListRow key={k.id} testID={`kind-${k.id}`} first={i === 0} icon={ICON[k.id]} title={t(`cf.k.${k.id}`)} sub={k.id === 'time' ? t('cf.k.timeSub', { day: dl(out.departLocal.slice(0, 10)) }) : t(`cf.k.${k.id}Sub`)} onPress={() => { setKind(k.id); setPick(null); }} />
              : <ListRow key={k.id} first={i === 0} icon="flight" tone="muted" title={t(`cf.k.${k.id}`)} sub={t('cf.flownOne')} />
          ))}
        </Box>
        {tm.outUsed ? <Small>{t('cf.onlyHome', { city: trip.city })}</Small> : null}
      </>) : <TextLink label={t('cf.else')} onPress={() => { setKind(null); setPick(null); setWho(null); }} />}
      {kind === 'one' ? (<>
        <T v="h2">{t('cf.whoHome')}</T>
        <Row gap={8} style={{ flexWrap: 'wrap' }}>{trip.travellers.map((p) => <Chip key={p.id} label={p.firstName} on={who === p.id} onPress={() => setWho(p.id)} />)}</Row>
        {escort ? <Box tone="warn"><H3 size={15}>{t('cf.under12', { name: whoP!.firstName })}</H3><Small>{t('cf.escort', { airline: out.carrierName })}</Small></Box> : null}
      </>) : null}
      {kind && kind !== 'airline' && kind !== 'name' && (kind !== 'one' || who) ? (<>
        <T v="h2">{kind === 'return' || kind === 'one' ? t('cf.pickHome') : t('cf.pickNew')}</T>
        {opts.data && options.length === 0 ? (
          <Box tone="well">
            <H3>{t('cf.noSeats', { who: count === 1 ? t('cf.one') : t('cf.allN', { n: count }) })}</H3>
            <Small>{t('cf.wider', { agent: trip.agent.name })}</Small>
            <Button label={t('cf.askWider')} size="small" block={false} busy={wider.isPending} onPress={() => wider.mutate(undefined, { onSuccess: () => { toast(t('cf.sent')); router.back(); } })} />
          </Box>
        ) : options.map((o) => {
          const tot = fee + o.diffPerPerson * count + escort;
          return <PickCard radio key={o.id} testID={`opt-${o.id}`} on={pick === o.id} disabled={o.soldOut} onPress={() => setPick(o.id)} title={o.title} sub={o.sub} right={o.soldOut ? t('cf.full') : tot > 0 ? `+${sar(tot)}` : tot < 0 ? `−${sar(tot)}` : t('mv.noCost')} />;
        })}
        {cur ? (
          <Box gap={8} testID="breakdown">
            <Spread><Small>{t('cf.b.fee')} · {R.changeFee ? `SAR ${sar(R.changeFee)} × ${count}` : t('cf.b.freeFare')}</Small><Num size={13} weight={500}>{fee ? `+${sar(fee)}` : '0'}</Num></Spread>
            {escort ? <Spread><Small>{t('cf.b.escort', { name: whoP!.firstName })}</Small><Num size={13} weight={500}>{`+${sar(escort)}`}</Num></Spread> : null}
            <Spread><Small>{t('cf.b.diff')}</Small><Num size={13} weight={500}>{fareDiff > 0 ? `+${sar(fareDiff)}` : fareDiff < 0 ? `−${sar(fareDiff)}` : t('cf.b.same')}</Num></Spread>
            <Divider />
            <Spread><H3>{total > 0 ? t('cf.b.pay') : total < 0 ? t('cf.b.back') : t('cf.b.total')}</H3><Num size={16}>{total === 0 ? t('mv.noCost') : formatSar(Math.abs(total))}</Num></Spread>
            {total < 0 ? <Tiny>{t('cf.b.creditNote')}</Tiny> : null}
            {kind === 'date' && (liveStay(trip) || trip.pickups.length) ? <Tiny>{t('cf.b.nextMove')}</Tiny> : null}
            {kind === 'return' && cur.longer && liveStay(trip) ? <Tiny>{t('cf.b.oneMore')}</Tiny> : null}
            <Tiny>{t('cf.b.rules', { agent: trip.agent.name, airline: out.carrierName })}</Tiny>
          </Box>
        ) : null}
      </>) : null}
      {kind === 'airline' ? <SwitchAirline trip={trip} onDone={() => router.replace('/trips?tab=requests' as Href)} /> : null}
      {kind === 'name' ? <NameFix trip={trip} onDone={() => router.replace('/trips?tab=requests' as Href)} /> : null}
    </TripScreen>
  );
}

function SwitchAirline({ trip, onDone }: { trip: TripDetail; onDone: () => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const out = outSegment(trip)!;
  const n = trip.travellers.length;
  const R = trip.fare!;
  const back = switchCredit(trip);
  const others = SWITCH_OFFERS.filter((o) => o.carrier !== out.carrier);
  const change = useTripMutation((offerKey: string) => tripsApi.change(trip.id, { kind: 'airline', offerKey, clientKey: newKey() }));
  return (<>
    <Box tone="warn" gap={4}>
      <H3 size={15}>{t('cf.sw.cant')}</H3>
      <Small>{t('cf.sw.body', { airline: out.carrierName })} {R.refundable ? t('cf.sw.back', { amount: formatSar(back) }) : t('cf.sw.taxes', { amount: formatSar(back), airline: out.carrierName, fee: sar(R.changeFee) })}</Small>
    </Box>
    {others.map((o) => {
      const net = o.perPerson * n - back;
      return <PickCard radio key={o.key} testID={`sw-${o.key}`} on={pick === o.key} onPress={() => setPick(o.key)} title={`${o.carrierName} · ${o.code} · ${o.depart}`} sub={`${o.from} → ${o.to} · ${o.bags} · ${o.refund}`} right={net > 0 ? `+${sar(net)}` : `−${sar(net)}`} />;
    })}
    <Tiny>{t('cf.sw.foot', { n, agent: trip.agent.name })}</Tiny>
    <Button testID="sw-send" label={t('cf.sw.ask')} disabled={!pick} busy={change.isPending} onPress={() => change.mutate(pick!, { onSuccess: () => { toast(t('cf.sent')); onDone(); }, onError: (e) => toast(e.message) })} />
  </>);
}

function NameFix({ trip, onDone }: { trip: TripDetail; onDone: () => void }) {
  const [who, setWho] = useState(trip.travellers[0]?.id ?? '');
  const p = trip.travellers.find((x) => x.id === who);
  const split = (full: string) => ({ given: full.split(' ').slice(0, -1).join(' ').toUpperCase(), sur: (full.split(' ').slice(-1)[0] ?? '').toUpperCase() });
  const [given, setGiven] = useState(split(p?.fullName ?? '').given);
  const [sur, setSur] = useState(split(p?.fullName ?? '').sur);
  const change = useTripMutation(() => tripsApi.change(trip.id, { kind: 'name', travellerId: who, givenNames: given, surname: sur, clientKey: newKey() }));
  const before = (p?.fullName ?? '').toUpperCase();
  const after = `${given} ${sur}`.toUpperCase().replace(/\s+/g, ' ').trim();
  const d = nameDistance(before, after);
  const state = !after || d === 0 ? 'same' : d <= 3 ? 'ok' : 'too';
  const out = outSegment(trip)!;
  return (<>
    <T v="h2">{t('cf.n.whose')}</T>
    <Row gap={8} style={{ flexWrap: 'wrap' }}>{trip.travellers.map((x) => <Chip key={x.id} label={x.firstName} on={who === x.id} onPress={() => { setWho(x.id); const s = split(x.fullName); setGiven(s.given); setSur(s.sur); }} />)}</Row>
    <Box tone="well" gap={4}><Tiny>{t('cf.n.now')}</Tiny><T style={{ fontFamily: ff.ui600, fontSize: 15, letterSpacing: 0.9, color: colors.green }}>{`${split(p?.fullName ?? '').sur}/${split(p?.fullName ?? '').given}`}</T></Box>
    <Row gap={10} align="flex-start">
      <View style={{ flex: 1, gap: 6 }}><T style={styles.label}>{t('cf.n.given')}</T><TextInput testID="nf-given" value={given} onChangeText={(v) => setGiven(v.toUpperCase())} autoCapitalize="characters" style={[styles.input, state === 'too' ? { borderColor: colors.bad } : null]} /></View>
      <View style={{ flex: 1, gap: 6 }}><T style={styles.label}>{t('cf.n.sur')}</T><TextInput testID="nf-sur" value={sur} onChangeText={(v) => setSur(v.toUpperCase())} autoCapitalize="characters" style={[styles.input, state === 'too' ? { borderColor: colors.bad } : null]} /></View>
    </Row>
    {state === 'same' ? <Small>{t('cf.n.same')}</Small> : null}
    {state === 'ok' ? <T v="small" color={colors.ok} style={{ fontFamily: ff.ui600 }}>{t(d === 1 ? 'cf.n.ok.one' : 'cf.n.ok.other', { n: d, airline: out.carrierName })}</T> : null}
    {state === 'too' ? <T v="small" color={colors.bad}>{t('cf.n.too')}</T> : null}
    <Button testID="nf-send" label={state === 'too' ? t('cf.n.askCost') : t('action.send')} disabled={state === 'same'} busy={change.isPending} onPress={() => change.mutate(undefined, { onSuccess: () => { toast(t('cf.sent')); onDone(); }, onError: (e) => toast(e.message) })} />
  </>);
}

const styles = StyleSheet.create({
  rule: { flex: 1, backgroundColor: colors.paper, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  bigFace: { width: 72, height: 72, borderRadius: 99, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: ff.ui600, fontSize: 13, lineHeight: 17, color: colors.ink2 },
  input: { height: 52, borderRadius: 16, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.mist, paddingHorizontal: 14, fontSize: 16, fontFamily: ff.ui600, color: colors.green },
});

void Icon;

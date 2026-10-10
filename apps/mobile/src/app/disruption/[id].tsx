import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { DESK_PHONE, DisruptionKind, type DisruptionChoiceResponse, type DisruptionOption } from '@mada/shared';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { Act, Screen, Scroll, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { AgentFace, AirlineMark, BigCheck, Box, Eyebrow, Grow, H3, Rise, Row, Small, Steps, Tiny } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { isOfflineError, newKey, type Queued, tripsApi, useDemo, useDisruption, useOutbox, useTripMutation } from '@/lib/trips';
import { colors, radii } from '@/theme';

const TEL = `tel:${DESK_PHONE.replace(/\s/g, '')}`;
const call = () => { buzz('tap'); void Linking.openURL(TEL).catch(() => toast(t('dz.callNumber', { phone: DESK_PHONE }))); };

function CallLink() {
  return (
    <Pressable testID="dz-call" accessibilityRole="link" accessibilityLabel={t('dz.callA11y', { phone: DESK_PHONE })} onPress={call} hitSlop={8} style={styles.call}>
      <Icon name="bell" size={16} /><T v="small" color={colors.green}>{t('dz.call')}</T>
    </Pressable>
  );
}

type Stage = 'choose' | 'working' | 'queued' | 'done';

/** A delay, a cancellation, or a cancellation late at night (prototype Disruption). Offline choices wait in the outbox. */
export default function Disruption() {
  const { id, kind: kindParam } = useLocalSearchParams<{ id: string; kind?: string }>();
  const router = useRouter();
  const kindQ = DisruptionKind.safeParse(kindParam);
  const q = useDisruption(id, kindQ.success ? kindQ.data : undefined);
  const offline = useOffline();
  const queued = useOutbox((s) => s.items.find((x): x is Extract<Queued, { kind: 'disruption' }> => x.kind === 'disruption' && x.tripId === id));
  const [pick, setPick] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>(queued ? 'queued' : 'choose');
  const [result, setResult] = useState<DisruptionChoiceResponse | null>(null);
  const [clientKey] = useState(newKey);
  const choose = useTripMutation((b: { kind: DisruptionKind; optionId: string }) => tripsApi.choose(id, { ...b, clientKey }));
  const home = () => router.replace('/today' as Href);
  const d = q.data;
  /* The outbox sent the queued choice once the phone reconnected: show it as done. */
  const shown: Stage = stage === 'queued' && !queued ? 'done' : stage;


  if (!d) {
    return <Screen><TopBar onBack={() => router.back()} right={<CallLink />} />{q.isError ? <Box style={{ margin: 16 }}><H3>{t('dz.offTitle')}</H3><Small>{t('dz.offBody', { phone: DESK_PHONE })}</Small><Button label={t('dz.callDesk')} onPress={call} /></Box> : null}</Screen>;
  }
  const night = d.kind === 'night';
  const cur: DisruptionOption = d.options.find((o) => o.id === (pick ?? queued?.body.optionId)) ?? d.options[0]!;

  const send = () => {
    buzz('knock');
    setStage('working');
    choose.mutate({ kind: d.kind, optionId: cur.id }, {
      onSuccess: (r) => { setTimeout(() => { setResult(r); setStage('done'); buzz('success'); }, 1600); },
      onError: (e) => {
        if (isOfflineError(e)) { queue(); return; }
        setStage('choose'); toast(e.message);
      },
    });
  };
  const queue = () => {
    useOutbox.getState().add({ id: newKey(), kind: 'disruption', tripId: id, body: { kind: d.kind, optionId: cur.id, clientKey }, at: Date.now() });
    setStage('queued');
    buzz('soft');
  };
  const confirm = () => (offline ? queue() : send());

  if (shown === 'working') {
    return (
      <Screen>
        <TopBar right={<CallLink />} />
        <View style={styles.pad}>
          <AgentFace initial={d.agent.initial} size={72} />
          <T v="h1" accessibilityRole="header">{t('dz.working')}</T>
          <Steps items={[
            { text: t('dz.step.held'), state: 'done' },
            { text: cur.kind === 'refund' ? t('dz.step.refund', { airline: cur.carrierName ?? t('dz.theAirline') }) : t('dz.step.tickets'), state: 'now' },
            { text: night && cur.kind !== 'refund' ? t('dz.step.vouchers') : t('dz.step.pickup'), state: 'todo' },
          ]} />
        </View>
      </Screen>
    );
  }

  if (shown === 'queued') {
    return (
      <Screen>
        <TopBar onBack={() => { if (queued) useOutbox.getState().remove(queued.id); setStage('choose'); }} backLabel={t('dz.chooseAgain')} right={<CallLink />} />
        <Scroll top={8} bottomPad={200}>
          <View style={styles.wait}><Icon name="wifiOff" size={28} /></View>
          <T v="h1" accessibilityRole="header">{t('dz.q.title')}</T>
          <T v="body">{t('dz.q.body', { choice: cur.title, who: night ? t('dz.q.nightDesk') : d.agent.name, until: d.heldUntil })}</T>
          <Row gap={8}><Tiny>{t('dz.q.waiting')}</Tiny></Row>
          <T v="body">{t('dz.q.hurry', { phone: DESK_PHONE })}</T>
        </Scroll>
        <Act>
          <Button testID="dz-call-desk" label={t('dz.callDesk')} onPress={call} />
          <Button variant="ghost" label={t('dz.backToday')} onPress={home} />
        </Act>
      </Screen>
    );
  }

  if (shown === 'done') {
    return (
      <Screen>
        <Scroll top={110} bottomPad={160}>
          <Rise><BigCheck /></Rise>
          <Rise step={1}><T v="h1" accessibilityRole="header" testID="dz-done">{result?.headline ?? t('dz.sentTitle')}</T></Rise>
          <Rise step={2}><T v="body">{result?.body ?? t('dz.sentBody')}</T></Rise>
          {result ? <Rise step={3}><Row align="flex-start"><AgentFace initial={d.agent.initial} /><T v="body" color={colors.green} style={{ flex: 1 }}>{`“${result.agentLine}”`}</T></Row></Rise> : null}
        </Scroll>
        <Act><Button testID="dz-home" label={t('dz.backToday')} onPress={home} /></Act>
      </Screen>
    );
  }

  return (
    <Screen>
      <TopBar onBack={() => router.back()} backLabel={t('dz.today')} right={<CallLink />} />
      <Scroll top={4} bottomPad={220}>
        <View style={{ gap: 12 }}>
          <T v="h1" accessibilityRole="header" style={{ fontSize: 32, lineHeight: 38 }}>{d.headline}</T>
          <T v="body" color={colors.inkSoft} style={{ fontSize: 17 }}>{d.sub}</T>
        </View>
        {d.tonight.length ? (
          <Rise><Box tone="well" label={t('dz.tonight')}>
            <Eyebrow>{t('dz.tonight')}</Eyebrow>
            {d.tonight.map((x) => (
              <Row key={x.title} gap={12} align="flex-start">
                <View style={styles.ic}><Icon name={x.icon as IconName} size={18} /></View>
                <Grow><H3 size={15}>{x.title}</H3><Small>{x.body}</Small></Grow>
              </Row>
            ))}
          </Box></Rise>
        ) : null}
        <View accessibilityRole="radiogroup" accessibilityLabel={t('dz.chooseA11y')} style={{ gap: 10 }}>
          {d.options.map((o) => {
            const on = cur.id === o.id;
            return (
              <Pressable key={o.id} testID={`dz-opt-${o.id}`} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => { setPick(o.id); buzz('select'); }} style={[styles.opt, on && styles.optOn]}>
                <View style={styles.radio}>{on ? <View style={styles.radioDot} /> : null}</View>
                <Grow gap={4}>
                  <Row gap={8}>{o.carrier ? <AirlineMark code={o.carrier} size={26} name={o.carrierName ?? undefined} /> : null}<H3 size={17} style={{ flex: 1 }}>{o.title}</H3></Row>
                  <T v="body" style={{ fontSize: 15, fontWeight: '500', fontVariant: ['tabular-nums'] }}>{o.times}</T>
                  <Small>{o.note}</Small>
                </Grow>
              </Pressable>
            );
          })}
        </View>
        {night ? (
          <Rise><Box>
            <H3 size={16}>{t('dz.rights.title')}</H3>
            <Tiny>{t('dz.rights.sub')}</Tiny>
            {(['care', 'choice', 'comp'] as const).map((k) => <Small key={k}><Small color={colors.green}>{t(`dz.rights.${k}`)} </Small>{t(`dz.rights.${k}Body`)}</Small>)}
          </Box></Rise>
        ) : null}
        <Row>
          <AgentFace initial={d.agent.initial} />
          <Grow><H3 size={15}>{d.agent.line}</H3><Tiny>{d.source}</Tiny></Grow>
        </Row>
        <Button testID="dz-call-row" variant="secondary" label={t('dz.rather', { phone: DESK_PHONE })} onPress={call} />
      </Scroll>
      <Act>
        {offline ? <Small style={{ textAlign: 'center' }}>{t('dz.offlineNote')}</Small> : null}
        <Button testID="dz-confirm" label={cur.kind === 'refund' ? t('dz.getRefund') : cur.kind === 'stay' ? t('dz.stayOn', { code: cur.title.replace(/^.* /, '') }) : t('dz.take', { time: cur.departs ?? '' })} onPress={confirm} busy={choose.isPending} />
      </Act>
    </Screen>
  );
}

const styles = StyleSheet.create({
  call: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.paper },
  pad: { paddingHorizontal: 20, paddingTop: 40, gap: 18 },
  wait: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' },
  ic: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  opt: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: 16, borderRadius: radii.card, backgroundColor: colors.paper, borderWidth: 2, borderColor: 'transparent' },
  optOn: { borderColor: colors.green },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.green, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.green },
});

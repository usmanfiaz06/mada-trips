import { useState } from 'react';
import { ActivityIndicator, Linking, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { formatSar, shortDay, timeLabel, type CopyKey } from '@mada/shared';
import { EsimStatusTag, usageLine } from '@/components/esim/parts';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { QrCode } from '@/components/circles/QrCode';
import { OutcomeCard } from '@/components/outcome/Outcome';
import { ArtSuitcase } from '@/components/trips/Arts';
import { Box, Divider, H3, PickCard, Ring, Rise, Row, Small, SmallButton, Spread, Steps, TextLink, Tiny, TripScreen } from '@/components/trips/ui';
import { usePayDraft } from '@/lib/booking';
import { DEVICE } from '@/lib/device';
import { esimApi, esimKeys, planLabel, useEsim, useEsimTopups } from '@/lib/esim';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { walletApi } from '@/lib/wallet';
import { colors } from '@/theme';

/*
 * One eSIM: install it now (iPhone: one tap; Android: the QR code and the codes to type), "it switches on when you
 * land", the steps for each phone and its APN; then on the trip what's left, until when, Top up, and "Not connecting?"
 * with the checks before Talk to Mada. Bought but not delivered: the refund, as an outcome.
 */

const LTR = { writingDirection: 'ltr' as const, textAlign: 'left' as const };
export default function EsimScreen() {
  const { id, open } = useLocalSearchParams<{ id: string; open?: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const q = useEsim(id);
  const e = q.data?.esim;
  const [tab, setTab] = useState<'ios' | 'android'>(DEVICE === 'android' ? 'android' : 'ios');
  const [manual, setManual] = useState(DEVICE === 'web');
  const [trouble, setTrouble] = useState(open === 'trouble');
  // "Not connecting?" one check at a time: the step shown, and whether it worked.
  const [check, setCheck] = useState(0);
  const [online, setOnline] = useState(false);
  const [topup, setTopup] = useState(open === 'topup');
  const [busy, setBusy] = useState(false);
  const tops = useEsimTopups(id, topup);

  if (!e) {
    return <TripScreen title={t('es.list.title')}>{q.isPending ? <View style={{ paddingTop: 40 }}><ActivityIndicator color={colors.green} /></View> : <EmptyState art={<ArtSuitcase />} title={t('error.notFound')} body="" />}</TripScreen>;
  }
  const ins = e.install;
  const delivered = !!ins && !['refunded', 'ordering', 'stuck'].includes(e.status);
  const onTrip = delivered && (e.status === 'active' || e.status === 'used_up' || e.status === 'expired' || !!e.installedAt);
  const copy = async (v: string) => { await Clipboard.setStringAsync(v); buzz('success'); toast(t('es.ins.copied')); };

  async function installed() {
    setBusy(true);
    try {
      const r = await esimApi.installed(id);
      qc.setQueryData(esimKeys.one(id), r);
      void qc.invalidateQueries({ queryKey: ['esim', 'list'] });
      buzz('success');
      toast(t('es.ins.doneToast'));
    } catch (err) { toast(err instanceof Error ? err.message : t('error.internal')); } finally { setBusy(false); }
  }
  async function talk() {
    setTrouble(false);
    try {
      const { thread } = await walletApi.openThread(e!.tripId ? { tripId: e!.tripId } : {});
      await walletApi.sendMessage(thread.id, { body: t('es.tr.message', { where: e!.where, iccid: e!.iccid ?? '' }), topic: 'other' });
      router.push(`/support?thread=${thread.id}` as Href);
    } catch { router.push('/support?topic=other' as Href); }
  }

  const os = DEVICE === 'android' ? 'android' : 'ios';
  const apn = ins?.apn.value ?? null;
  const checks: { text: string; how?: string }[] = [
    { text: t('es.tr.1'), how: t(`es.tr.1.${os}` as CopyKey) },
    { text: t('es.tr.2'), how: t(`es.tr.2.${os}` as CopyKey) },
    ...(apn ? [{ text: t('es.tr.apn', { apn }), how: t(`es.tr.apn.${os}` as CopyKey) }] : []),
    { text: t('es.tr.3') },
    { text: t('es.tr.4') },
  ];
  const lastCheck = check >= checks.length;
  const openTrouble = () => { setCheck(0); setOnline(false); setTrouble(true); };

  const usage = usageLine(e);
  const u = e.usage;
  return (
    <TripScreen title={t('es.card.title', { where: e.where })}>
      <Rise>
        <Spread><T v="h1" accessibilityRole="header" style={{ flex: 1 }}>{t('es.card.title', { where: e.where })}</T><EsimStatusTag e={e} /></Spread>
      </Rise>
      <Rise step={1}><Small style={{ marginTop: -8 }}>{[e.travellerName ? t('es.list.for', { name: e.travellerName }) : t('es.list.forYou'), planLabel(e.plan, t)].join(' · ')}</Small></Rise>

      {e.status === 'refunded' && e.result ? <><Box tone="cream"><H3>{t('es.refunded.title')}</H3></Box><OutcomeCard result={e.result} tripId={e.tripId} testID="esim-outcome" /></> : null}
      {e.status === 'ordering' ? <Box testID="esim-ordering"><Row><ActivityIndicator color={colors.green} /><Small>{t('es.ordering')}</Small></Row></Box> : null}
      {e.status === 'stuck' ? <Box tone="cream" testID="esim-stuck"><Small>{e.readyBy ? t('es.sorting', { time: timeLabel(e.readyBy, { locale: getLocale() }) }) : t('es.stuck')}</Small></Box> : null}

      {onTrip ? (
        <Box testID="esim-usage">
          <Spread align="center">
            <View style={{ flex: 1, gap: 4 }}>
              {usage ? <H3 size={17}>{usage}</H3> : null}
              {u?.expiresAt ? <Tiny>{t('es.ends', { date: shortDay(u.expiresAt.slice(0, 10), getLocale()) })}</Tiny> : null}
              {e.topups.length ? <Tiny>{e.topups.map((x) => planLabel(x, t)).join(' · ')}</Tiny> : null}
            </View>
            {u && !u.unlimited && u.totalMb ? <Ring done={u.leftMb ?? 0} total={u.totalMb} label={`${Math.round(((u.leftMb ?? 0) / u.totalMb) * 100)}%`} /> : null}
          </Spread>
          <Row gap={8}>
            {e.plan.topup ? <SmallButton testID="esim-topup" label={t('es.topup')} tone="primary" onPress={() => setTopup(true)} grow /> : null}
            <SmallButton testID="esim-trouble" label={t('es.trouble')} onPress={openTrouble} grow />
          </Row>
        </Box>
      ) : null}

      {delivered && ins ? (
        <>
          {!e.installedAt ? <Rise step={2}><H3 size={17}>{t('es.ins.title')}</H3></Rise> : null}
          <Row gap={8}>
            <SmallButton testID="esim-tab-ios" label={t('es.ins.iphoneTab')} tone={tab === 'ios' ? 'primary' : 'secondary'} onPress={() => setTab('ios')} grow />
            <SmallButton testID="esim-tab-android" label={t('es.ins.androidTab')} tone={tab === 'android' ? 'primary' : 'secondary'} onPress={() => setTab('android')} grow />
          </Row>
          {tab === 'ios' ? (
            <Box testID="esim-ios" gap={10}>
              <Button testID="esim-ios-install" label={t('es.ins.ios')} onPress={() => { buzz('tap'); void Linking.openURL(ins.iosLink); }} />
              <Tiny>{t('es.ins.iosNote')}</Tiny>
            </Box>
          ) : (
            <Box testID="esim-android" gap={10}>
              <View style={{ alignItems: 'center' }}><QrCode value={ins.lpa} size={200} label={t('es.ins.qrA11y')} testID="esim-qr" /></View>
              <Small>{t('es.ins.qr')}</Small>
              <Tiny>{t('es.ins.qrHow')}</Tiny>
            </Box>
          )}
          {manual ? (
            <Box testID="esim-codes" gap={10}>
              <H3 size={15}>{t('es.ins.manual')}</H3>
              {[[t('es.ins.smdp'), ins.smdp, 'esim-smdp'], [t('es.ins.code'), ins.matchingId, 'esim-code']].map(([k, v, tid]) => (
                <Spread key={tid}>
                  <View style={{ flex: 1, gap: 2 }}><Tiny>{k}</Tiny><T selectable style={[{ fontSize: 15, color: colors.green, fontVariant: ['tabular-nums'] }, LTR]} testID={tid}>{v}</T></View>
                  <SmallButton label={t('es.ins.copy')} onPress={() => void copy(v!)} />
                </Spread>
              ))}
            </Box>
          ) : <TextLink testID="esim-manual" label={t('es.ins.manual')} onPress={() => setManual(true)} />}
          <Tiny>{t('es.ins.wifi')}</Tiny>
          <Box testID="esim-steps">
            <H3 size={15}>{t('es.steps.title')}</H3>
            <Steps items={(tab === 'ios' ? ['es.steps.ios1', 'es.steps.ios2'] : ['es.steps.android1', 'es.steps.android2']).map((k) => ({ text: t(k as CopyKey), state: 'todo' as const }))} />
            <Divider />
            <Tiny>{ins.apn.type === 'manual' && ins.apn.value ? t('es.apn.manual', { apn: ins.apn.value }) : t('es.apn.auto')}</Tiny>
          </Box>
          {!e.installedAt ? <Button testID="esim-installed" label={t('es.ins.done')} busy={busy} onPress={() => void installed()} /> : null}
        </>
      ) : null}

      <Sheet visible={trouble} onClose={() => setTrouble(false)} label={t('es.tr.title')}>
        <View style={{ gap: 12 }} testID="esim-trouble-sheet">
          <T v="h2">{t('es.tr.title')}</T>
          {online ? (
            <Box testID="esim-tr-online"><H3 size={17}>{t('es.tr.online')}</H3></Box>
          ) : (
            <>
              <Steps items={checks.map((c, i) => ({ text: c.text, state: i < check ? 'done' as const : i === check ? 'now' as const : 'todo' as const }))} />
              {!lastCheck ? (
                <Box testID="esim-tr-step" gap={8}>
                  <Tiny>{t('es.tr.step', { n: check + 1, total: checks.length })}</Tiny>
                  <H3 size={17}>{checks[check]!.text}</H3>
                  {checks[check]!.how ? <Small>{checks[check]!.how}</Small> : null}
                  <Row gap={8}>
                    <SmallButton testID="esim-tr-works" label={t('es.tr.works')} tone="primary" onPress={() => { buzz('success'); setOnline(true); }} grow />
                    <SmallButton testID="esim-tr-next" label={t('es.tr.next')} onPress={() => { buzz('tap'); setCheck(check + 1); }} grow />
                  </Row>
                </Box>
              ) : (
                <>
                  <Small>{t('es.tr.still')}</Small>
                  <Button testID="esim-talk" label={t('es.tr.talk')} onPress={() => void talk()} />
                </>
              )}
            </>
          )}
        </View>
      </Sheet>

      <Sheet visible={topup} onClose={() => setTopup(false)} label={t('es.topup.title', { where: e.where })}>
        <View style={{ gap: 10 }} testID="esim-topup-sheet">
          <T v="h2">{t('es.topup.title', { where: e.where })}</T>
          <Tiny>{t('es.topup.sub')}</Tiny>
          {tops.isPending ? <ActivityIndicator color={colors.green} /> : !tops.data?.plans.length ? <Small>{t('es.topup.none')}</Small> : tops.data.plans.map((p) => (
            <PickCard key={p.id} inSheet radio on={false} title={planLabel(p, t)} right={formatSar(p.price.amount)} testID={`esim-topup-${p.size}`}
              onPress={() => {
                setTopup(false);
                usePayDraft.getState().set({ draft: { kind: 'esim', count: 1, packageId: p.id, topupOf: e.id }, title: t('pay.title.esimTopup', { where: e.where }) });
                router.push('/pay');
              }} />
          ))}
        </View>
      </Sheet>
    </TripScreen>
  );
}

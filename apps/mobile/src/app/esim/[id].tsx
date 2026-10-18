import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { formatSar, shortDay, timeLabel, type CopyKey } from '@mada/shared';
import { usageLine } from '@/components/esim/parts';
import { EsimPass, FlagDisc, FlowSteps, SetMoment, countryOf } from '@/components/esim/look';
import { Icon } from '@/components/Icon';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { QrCode } from '@/components/circles/QrCode';
import { OutcomeCard } from '@/components/outcome/Outcome';
import { ArtSuitcase } from '@/components/trips/Arts';
import { Box, Divider, H3, IconTile, PickCard, Rise, Row, Small, SmallButton, Steps, Tag, TextLink, Tiny, TripScreen } from '@/components/trips/ui';
import { usePayDraft } from '@/lib/booking';
import { DEVICE } from '@/lib/device';
import { esimApi, esimKeys, planLabel, useEsim, useEsimTopups } from '@/lib/esim';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { walletApi } from '@/lib/wallet';
import { colors, ff, font, radii, shadow } from '@/theme';

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
  const [justSet, setJustSet] = useState(false);
  // Once installed, how it was installed folds away behind "Install details".
  const [details, setDetails] = useState(false);
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
      setJustSet(true);
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
  const ringable = !!u && u.state !== 'not_active' && (u.unlimited || !!u.totalMb);
  const flowNow = !e.installedAt ? 0 : e.status === 'active' || e.status === 'used_up' || e.status === 'expired' ? 3 : 1;
  return (
    <TripScreen title={t('es.card.title', { where: e.where })}>
      <Rise><EsimPass e={e} testID="esim-card" until={onTrip && u?.expiresAt ? shortDay(u.expiresAt.slice(0, 10), getLocale()) : null} onTopup={onTrip && e.plan.topup ? () => setTopup(true) : null} /></Rise>

      {e.status === 'refunded' && e.result ? <><Box tone="cream"><H3>{t('es.refunded.title')}</H3></Box><OutcomeCard result={e.result} tripId={e.tripId} testID="esim-outcome" /></> : null}
      {e.status === 'ordering' ? <Box testID="esim-ordering"><Row><ActivityIndicator color={colors.green} /><Small>{t('es.ordering')}</Small></Row></Box> : null}
      {e.status === 'stuck' ? <Box tone="cream" testID="esim-stuck"><Small>{e.readyBy ? t('es.sorting', { time: timeLabel(e.readyBy, { locale: getLocale() }) }) : t('es.stuck')}</Small></Box> : null}

      {justSet ? <SetMoment where={e.where} /> : null}

      {onTrip ? (
        <Rise step={1}>
          <View testID="esim-usage" style={{ gap: 10 }}>
            {!ringable && usage ? <H3 size={17}>{usage}</H3> : null}
            {e.topups.length ? <Row gap={6} style={{ flexWrap: 'wrap' }}>{e.topups.map((x) => <Tag key={x.at} tone="ok" label={`+ ${planLabel(x, t)}`} />)}</Row> : null}
            <Button testID="esim-trouble" variant="secondary" label={t('es.trouble')} icon={<Icon name="wifi" size={20} />} onPress={openTrouble} />
          </View>
        </Rise>
      ) : null}

      {delivered && ins && e.installedAt && !details ? <TextLink testID="esim-details" label={t('es.ins.show')} onPress={() => setDetails(true)} /> : null}
      {delivered && ins && (!e.installedAt || details) ? (
        <>
          {flowNow < 3 ? <Rise step={2}><FlowSteps now={flowNow} /></Rise> : null}
          {!e.installedAt ? <Rise step={2}><T style={[font('displaySmall'), { fontSize: 26, lineHeight: 30 }]} accessibilityRole="header">{t('es.ins.title')}</T></Rise> : null}
          <View style={styles.seg} accessibilityRole="tablist">
            {(['ios', 'android'] as const).map((k) => (
              <Pressable key={k} testID={`esim-tab-${k}`} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => { buzz('select'); setTab(k); }}
                style={[styles.segBtn, tab === k ? styles.segOn : null]}>
                <T style={[font('h3', colors.green), { fontSize: 14 }]}>{t(k === 'ios' ? 'es.ins.iphoneTab' : 'es.ins.androidTab')}</T>
              </Pressable>
            ))}
          </View>
          {tab === 'ios' ? (
            <Box testID="esim-ios" gap={14} padding={18}>
              <Row gap={12}>
                <IconTile name="phone" tone="gold" size={44} icon={22} />
                <Tiny style={{ flex: 1 }}>{t('es.ins.iosNote')}</Tiny>
              </Row>
              <Button testID="esim-ios-install" label={t('es.ins.ios')} icon={<Icon name="sim" size={20} color={colors.mist} />} onPress={() => { buzz('tap'); void Linking.openURL(ins.iosLink); }} />
            </Box>
          ) : (
            <View testID="esim-android" style={[styles.pass, shadow('card')]}>
              <Row style={{ justifyContent: 'space-between', padding: 16, paddingBottom: 0 }}>
                <Row gap={8}><FlagDisc country={countryOf(e.plan.coverage.countries)} size={28} /><H3 size={15}>{e.where}</H3></Row>
                <T v="eyebrow">QR</T>
              </Row>
              <View style={{ alignItems: 'center', paddingVertical: 14 }}><QrCode value={ins.lpa} size={196} label={t('es.ins.qrA11y')} testID="esim-qr" /></View>
              <View style={styles.perf}>
                <View style={[styles.notch, { start: -11 }]} />
                <View style={styles.dash} />
                <View style={[styles.notch, { end: -11 }]} />
              </View>
              <View style={{ padding: 16, paddingTop: 12, gap: 4 }}>
                <Small color={colors.green} style={{ fontFamily: ff.ui600 }}>{t('es.ins.qr')}</Small>
                <Tiny>{t('es.ins.qrHow')}</Tiny>
              </View>
            </View>
          )}
          {manual ? (
            <Box testID="esim-codes" gap={12}>
              <H3 size={15}>{t('es.ins.manual')}</H3>
              {[[t('es.ins.smdp'), ins.smdp, 'esim-smdp'], [t('es.ins.code'), ins.matchingId, 'esim-code']].map(([k, v, tid]) => (
                <View key={tid} style={styles.code}>
                  <View style={{ flex: 1, gap: 2 }}><Tiny>{k}</Tiny><T selectable style={[{ fontSize: 15, color: colors.green, fontFamily: ff.ui500, fontVariant: ['tabular-nums'] }, LTR]} testID={tid}>{v}</T></View>
                  <SmallButton label={t('es.ins.copy')} tone="paper" onPress={() => void copy(v!)} />
                </View>
              ))}
            </Box>
          ) : <TextLink testID="esim-manual" label={t('es.ins.manual')} onPress={() => setManual(true)} />}
          <Row gap={10} align="flex-start"><Icon name="wifi" size={18} color={colors.ink3} /><Tiny style={{ flex: 1 }}>{t('es.ins.wifi')}</Tiny></Row>
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

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', backgroundColor: colors.grab, borderRadius: 999, padding: 4, gap: 4 },
  segBtn: { flex: 1, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.paper, boxShadow: '0px 4px 10px -6px rgba(30,53,45,0.4)' },
  pass: { backgroundColor: colors.paper, borderRadius: radii.card },
  perf: { height: 22, justifyContent: 'center' },
  notch: { position: 'absolute', width: 22, height: 22, borderRadius: 99, backgroundColor: colors.sand },
  dash: { marginHorizontal: 18, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: colors.grab },
  code: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.mist, borderRadius: 16, paddingVertical: 10, paddingStart: 14, paddingEnd: 8 },
});

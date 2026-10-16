import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  canNudge, dayLabel, dueLabel, DESK_PHONE, formatSar, isLate, onItCost, onItStep, outcomeHead, outcomeMoney, outcomeWhy,
  type CopyKey, type OutcomeKind, type OutcomeNext, type RequestProgress, type RequestResult, type Vars,
} from '@mada/shared';
import { T } from '@/components/Text';
import { Box, Eyebrow, Row, Small, SmallButton, Tag, Tiny } from '@/components/trips/ui';
import { bookingApi, bookingKeys } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { useNow } from '@/components/booking/parts';
import { toast } from '@/lib/toast';
import { colors, font } from '@/theme';

/*
 * How a request ended, and what Mada is doing until it does (shared schemas/outcomes.ts). The words come from copy
 * keys, so they follow the reader's language; the agent's own note is shown as theirs. Used on the request thread,
 * Trips › Requests, the With Mada screen and a booking that won't go ahead.
 */

const say = ([k, v]: [CopyKey, Vars?]) => t(k, v);
const fmt = { amount: (h: number) => formatSar(h), day: (d: string) => dayLabel(d) };

export const outcomeTone = (k: OutcomeKind): 'ok' | 'warn' | 'default' => (k === 'issued' ? 'ok' : k === 'refused' || k === 'partial' ? 'warn' : 'default');

/** The pill on a closed request: "Done", "Couldn’t be done", "Partly done". */
export const OutcomePill = ({ r }: { r: Pick<RequestResult, 'kind'> }) => <Tag label={t(`oc.pill.${r.kind}` as CopyKey)} tone={outcomeTone(r.kind)} style={{ flexShrink: 0 }} />;

/**
 * The outcome: the headline, why in plain words, what happens to the money, and the buttons on. `again` is what Ask
 * opens with for "Book another" and "Try other dates" ("Flights to Istanbul").
 */
export function OutcomeCard({ result, tripId, again, compact, testID = 'outcome' }: { result: RequestResult; tripId?: string | null; again?: string | null; compact?: boolean; testID?: string }) {
  const router = useRouter();
  const go = (n: OutcomeNext) => {
    buzz('tap');
    if (n === 'talk') router.push('/support' as Href);
    else if (n === 'see_trip' && tripId) router.push({ pathname: '/trip/[id]', params: { id: tripId } });
    else router.push((again ? { pathname: '/ask', params: { prefill: again } } : '/ask') as Href);
  };
  const next = result.next.filter((n) => n !== 'see_trip' || !!tripId);
  return (
    <Box tone={result.kind === 'issued' ? 'paper' : 'well'} gap={10} testID={`${testID}-${result.kind}`}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T style={font(compact ? 'h3' : 'displaySmall')} accessibilityRole="header">{say(outcomeHead(result))}</T>
        {compact ? null : <OutcomePill r={result} />}
      </Row>
      {result.kind !== 'issued' || result.reason !== 'done' ? (
        <View style={{ gap: 2 }}>
          {compact ? null : <Eyebrow>{t('oc.label.why')}</Eyebrow>}
          <Small color={colors.green}>{say(outcomeWhy(result))}</Small>
        </View>
      ) : null}
      {result.note ? (
        <View style={{ gap: 2 }} testID={`${testID}-note`}>
          <Tiny>{t('oc.note', { agent: result.by ?? t('presence.title') })}</Tiny>
          <Small color={colors.green}>“{result.note}”</Small>
        </View>
      ) : null}
      <View style={{ gap: 2 }}>
        {compact ? null : <Eyebrow>{t('oc.label.money')}</Eyebrow>}
        <T v="small" color={colors.green} testID={`${testID}-money`}>{say(outcomeMoney(result.money, fmt))}</T>
      </View>
      {next.length ? (
        <Row gap={8} style={{ flexWrap: 'wrap' }}>
          {next.map((n, i) => <SmallButton key={n} tone={i === 0 ? 'primary' : 'paper'} label={t(`oc.next.${n}` as CopyKey)} onPress={() => go(n)} testID={`${testID}-next-${n}`} />)}
        </Row>
      ) : null}
      {result.by ? <Tiny>{t('oc.by', { agent: result.by, time: dueLabel(result.at, { locale: getLocale() }) })}</Tiny> : null}
    </Box>
  );
}

/** One line for Today: "Asking Bereketzade Hotel · answer by 14:30", or that the time has passed. */
export function onItLine(p: RequestProgress, now = Date.now()): string {
  const time = dueLabel(p.dueAt, { locale: getLocale() });
  return isLate(p, now) ? t('oi.late', { time }) : `${say(onItStep(p))} · ${t(p.promised ? 'oi.by.promised' : 'oi.by.usual', { time })}`;
}

/**
 * Mada is on it, never vague: what's being done, by when (the time the desk gave, or Mada's usual one), the cost. Once
 * that time has passed it says so, with a nudge (to the desk) and a call.
 */
export function OnItCard({ progress, requestId, testID = 'on-it' }: { progress: RequestProgress; requestId: string; testID?: string }) {
  const qc = useQueryClient();
  const now = useNow(30_000);
  // The nudge answers before the request refetches: keep its time so the button doesn't come back meanwhile.
  const [nudgedAt, setNudgedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cur = nudgedAt && (!progress.nudgedAt || nudgedAt > progress.nudgedAt) ? { ...progress, nudgedAt } : progress;
  const late = isLate(cur, now);
  const by = dueLabel(cur.dueAt, { locale: getLocale() });
  const nudge = async () => {
    setBusy(true); buzz('tap');
    try {
      const r = await bookingApi.nudge(requestId);
      setNudgedAt(r.progress.nudgedAt); buzz('success'); toast(t('oi.nudged'));
      void qc.invalidateQueries({ queryKey: bookingKeys.request(requestId) });
      void qc.invalidateQueries({ queryKey: bookingKeys.messages(requestId) });
      void qc.invalidateQueries({ queryKey: ['trips'] });
    } catch (e) { toast(e instanceof Error ? e.message : t('error.internal')); } finally { setBusy(false); }
  };
  return (
    <Box tone={late ? 'warn' : 'well'} gap={6} testID={testID}>
      <Eyebrow>{t('oi.title')}</Eyebrow>
      <T v="h3" style={{ fontSize: 15 }} testID={`${testID}-step`}>{say(onItStep(cur))}</T>
      {late
        ? <T v="small" color={colors.green} testID={`${testID}-late`}>{t('oi.late', { time: by })}</T>
        : <T v="small" color={colors.green} testID={`${testID}-by`}>{t(cur.promised ? 'oi.by.promised' : 'oi.by.usual', { time: by })}</T>}
      <Tiny>{say(onItCost(cur, fmt))}</Tiny>
      {late ? (
        <Row gap={8} style={{ flexWrap: 'wrap', marginTop: 4 }}>
          {canNudge(cur, now)
            ? <SmallButton tone="primary" busy={busy} label={t('oi.nudge')} onPress={() => void nudge()} testID={`${testID}-nudge`} />
            : <Tiny style={{ alignSelf: 'center' }}>{t('oi.nudged')}</Tiny>}
          <SmallButton tone="paper" icon="phone" label={t('oi.call')} onPress={() => { buzz('tap'); void Linking.openURL(`tel:${DESK_PHONE.replace(/\s/g, '')}`).catch(() => {}); }} testID={`${testID}-call`} />
        </Row>
      ) : null}
    </Box>
  );
}

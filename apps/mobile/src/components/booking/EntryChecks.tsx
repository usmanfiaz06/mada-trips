import { useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { RENEWAL_DAYS, addDays, formatSar, nameIn, shortDay, type EntryCheck, type EntryCheckResponse } from '@mada/shared';
import { sendRequest } from '@/lib/booking';
import { buzz } from '@/lib/haptics';
import { getLocale, joinAnd, t } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { colors } from '@/theme';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { T } from '../Text';
import { Notice, enter } from './parts';
import { Box, Eyebrow, Tiny } from '../trips/ui';
import { ASK_RESUME, requireAccount } from '@/lib/signin-ask';

/*
 * Everything that could stop someone boarding, before anyone pays (FLOWS.md §2). Blocking checks hold the review.
 * A passport too short for the trip is never a dead end: Mada renews it in time and the booking goes ahead
 * (step · ready by · cost), or that person is left off, the account holder too.
 */

/** What Mada does about a short passport, as the outcome card: the step, ready by when, the cost. */
function RenewalCard({ c, testID }: { c: EntryCheck; testID: string }) {
  const r = c.renewal!;
  return (
    <Box tone={c.done ? 'well' : 'paper'} gap={4} padding={12} testID={testID}>
      <Eyebrow>{c.done ? t('rn.onIt') : t('rn.eyebrow')}</Eyebrow>
      <T v="h3" style={{ fontSize: 15 }} testID={`${testID}-step`}>{t('rn.step', { name: c.name ?? '' })}</T>
      <T v="small" color={r.inTime ? colors.green : colors.goldInk} testID={`${testID}-by`}>
        {r.inTime ? t('rn.by', { date: shortDay(r.by) }) : t('rn.late', { days: RENEWAL_DAYS, date: shortDay(r.by) })}
      </T>
      {r.inTime ? <T v="tiny" testID={`${testID}-cost`}>{t('rn.cost', { price: formatSar(r.fee) })}</T> : <Tiny>{t('rn.lateNext', { name: c.name ?? '' })}</Tiny>}
      {c.done ? <Tiny>{t('rn.alongside')}</Tiny> : null}
    </Box>
  );
}

export function EntryChecks({ result, destination, travellerIds, depart, ret, answer, remove }: {
  result: EntryCheckResponse | undefined; destination: string; travellerIds: string[]; depart: string; ret: string | null;
  answer: (key: string, value: string) => void; remove: (personId: string) => void;
}) {
  const [asked, setAsked] = useState<Record<string, boolean>>({});
  if (!result) return null;
  const what = result.domestic ? t('entry.domestic') : result.nationalities.length ? t('entry.for', { country: result.countryName, nationalities: joinAnd(result.nationalities) }) : t('entry.forYour', { country: result.countryName });
  const ask = async (key: string, service: 'uk_eta' | 'evisa' | 'reentry' | 'passport_renewal', personId: string | null, need: string | null, answerKey: string | null) => {
    if (!requireAccount('chat', ASK_RESUME)) return;
    setAsked((a) => ({ ...a, [key]: true }));
    buzz('success');
    try {
      await sendRequest({ kind: 'visa', travellerIds: personId ? [personId] : travellerIds, service, serviceFor: { personId, need, destination } });
      if (answerKey) answer(answerKey, 'asked');
    } catch (e) { setAsked((a) => ({ ...a, [key]: false })); toast(e instanceof Error ? e.message : t('error.internal')); }
  };
  return (
    <View style={{ gap: 10 }}>
      <Animated.View entering={enter(0)} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <Icon name="check" color={colors.ok} size={14} width={2.4} />
        <T v="tiny" style={{ flex: 1 }}>{t('entry.checked', { what })}{!result.checks.length && result.okText ? ` · ${nameIn(result.okText, getLocale())}` : ''}</T>
      </Animated.View>
      {result.checks.map((c) => {
        const k = `${c.personId ?? 'all'}:${c.key}`;
        if (c.key === 'passport' && c.done && c.renewal) {
          return <Animated.View key={k} entering={enter(0)}><RenewalCard c={c} testID={`renewal-${c.personId}`} /></Animated.View>;
        }
        if (c.done || (c.info && c.key !== 'eta')) {
          return (
            <Animated.View key={k} entering={enter(0)} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Icon name={c.done ? 'check' : 'doc'} size={16} color={c.done ? colors.ok : colors.goldInk} width={2.2} />
              <T v="small" color={colors.green} style={{ flex: 1 }}>{c.text}</T>
            </Animated.View>
          );
        }
        if (c.key === 'eta') {
          return (
            <Animated.View key={k} entering={enter(0)}>
              <Notice icon="visa">
                <T v="small" color={colors.green}>{c.text}</T>
                <Button size="small" block={false} variant="secondary" style={{ alignSelf: 'flex-start', marginTop: 4, backgroundColor: colors.mist }} label={t('entry.eta.ask')} disabled={asked[k]} onPress={() => ask(k, 'uk_eta', null, null, c.answerKey)} />
              </Notice>
            </Animated.View>
          );
        }
        return (
          <Animated.View key={k} entering={enter(0)}>
            <Notice icon="visa" warn title={c.title ?? undefined}>
              <T v="small">{c.text}</T>
              {c.key === 'passport' && c.renewal ? <RenewalCard c={c} testID={`renewal-${c.personId}`} /> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {c.key === 'visa' ? <Button size="small" block={false} label={t('entry.visa.ask')} disabled={asked[k]} onPress={() => ask(k, 'evisa', c.personId, c.need, c.answerKey)} /> : null}
                {c.key === 'reentry' ? <Button size="small" block={false} label={t('entry.reentry.ask')} disabled={asked[k]} onPress={() => ask(k, 'reentry', c.personId, null, c.answerKey)} /> : null}
                {c.key === 'reentry' && c.answerKey ? <Button size="small" block={false} variant="secondary" label={t('entry.reentry.hasOne', { name: c.name ?? '' })} onPress={() => answer(c.answerKey!, 'has')} /> : null}
                {c.key === 'iqama' && c.answerKey ? <Button size="small" block={false} variant="secondary" label={t('entry.iqama.renewed')} onPress={() => answer(c.answerKey!, addDays(ret ?? depart, 365))} /> : null}
                {c.key === 'passport' && c.renewal?.inTime ? (
                  <Button size="small" label={asked[k] ? t('rn.asking') : t('rn.book', { date: shortDay(c.renewal.by), price: formatSar(c.renewal.fee) })} busy={asked[k]} disabled={asked[k]}
                    onPress={() => ask(k, 'passport_renewal', c.personId, null, c.answerKey)} testID={`renew-book-${c.personId}`} />
                ) : null}
                {c.key === 'passport' && !c.renewal ? <Button size="small" block={false} variant="secondary" label={asked[k] ? t('entry.passport.onIt') : t('entry.passport.renew')} disabled={asked[k]} onPress={() => ask(k, 'passport_renewal', c.personId, null, null)} /> : null}
                {c.removable && c.personId ? <Button size="small" block={false} variant={c.key === 'passport' && !c.renewal?.inTime ? 'primary' : 'secondary'} label={t('entry.without', { name: c.name ?? '' })} onPress={() => { buzz('select'); remove(c.personId!); }} testID={`without-${c.personId}`} /> : null}
              </View>
            </Notice>
          </Animated.View>
        );
      })}
    </View>
  );
}

/**
 * What holds the review button, if anything. A passport Mada can renew in time holds nothing: the order sheet books
 * with the renewal on it. One that can't be renewed in time names the way on.
 */
export const blockLabel = (r: EntryCheckResponse | undefined) => {
  const b = r?.checks.find((c) => c.blocking && !(c.key === 'passport' && c.renewal?.inTime));
  if (!b) return null;
  if (b.key === 'passport' && b.renewal) return t('rn.lateNext', { name: b.name ?? '' });
  const thing = t(b.key === 'passport' ? 'entry.thing.passport' : b.key === 'visa' ? 'entry.thing.visa' : b.key === 'iqama' ? 'entry.thing.iqama' : 'entry.thing.reentry');
  return t('search.sortOut', { name: b.name ?? '', thing });
};

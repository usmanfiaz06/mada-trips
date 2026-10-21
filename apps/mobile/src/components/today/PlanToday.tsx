import { useCallback } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { durationLabel, nameIn, type TodayPlanCard } from '@mada/shared';
import { Icon, type IconName } from '@/components/Icon';
import { routeTitle } from '@/components/booking/PlanCards';
import { Box, Eyebrow, Grow, H3, Rise, Row, Small, TextLink } from '@/components/trips/ui';
import { buzz } from '@/lib/haptics';
import { getLocale, t } from '@/lib/i18n';
import { useTodayPlan } from '@/lib/plans';
import { colors } from '@/theme';

/*
 * Today from the plan (docs/app/ASK-INTEGRATED.md §1.3, U9): when a trip is near, what its plan says for today and
 * tomorrow (the pickup, the check-in, a drive with the time it takes) and what's left before it. They sit above the
 * ideas. Every time and distance comes from the server's card (a booking, or the drive U4 measured), never from here.
 */

const name = (s: string | null) => (s ? nameIn(s, getLocale()) : '');
const lri = (s: string) => `⁦${s}⁩`;

function line(c: TodayPlanCard): { icon: IconName; text: string } {
  switch (c.kind) {
    case 'pickup':
      if (c.car) return { icon: 'car', text: c.time && c.place ? t('tp.carCollect', { time: lri(c.time), place: name(c.place) }) : c.place ? t('tp.carCollectPlace', { place: name(c.place) }) : t('tp.carCollectAny') };
      return { icon: 'car', text: c.time && c.place ? t('tp.pickup', { time: lri(c.time), place: c.place }) : c.time ? t('tp.pickupTime', { time: lri(c.time) }) : t('tp.pickupPlace', { place: c.place ?? '' }) };
    case 'checkin':
      return { icon: 'stay', text: t('tp.checkin', { hotel: c.hotel }) };
    case 'drive': {
      const duration = durationLabel(c.minutes, getLocale());
      return { icon: 'map', text: c.leaveBy ? t('tp.drive', { duration, place: name(c.to), time: lri(c.leaveBy) }) : t('tp.driveNoTime', { duration, place: name(c.to) }) };
    }
    case 'todo': {
      const days = c.days.map((d) => d + 1);
      const range = days.length ? (days.length > 1 ? `${days[0]}–${days[days.length - 1]}` : String(days[0])) : '';
      const names = c.names.join('، ');
      if (c.check === 'passports') return { icon: 'doc', text: names ? t(c.state === 'warn' ? 'tp.todo.passportsWarn' : 'tp.todo.passportsMissing', { names: getLocale() === 'ar' ? names : c.names.join(', ') }) : t('chat.plan.check.passports') };
      if (c.check === 'stays') return { icon: 'stay', text: range ? t('chat.plan.check.stays', { days: lri(range) }) : t('chat.plan.check.staysAny') };
      if (c.check === 'car') return { icon: 'car', text: range ? t('chat.plan.check.car', { days: lri(range) }) : t('chat.plan.check.carAny') };
      return { icon: c.check === 'visa' ? 'visa' : c.check === 'esim' ? 'sim' : 'check', text: t(`chat.plan.check.${c.check}` as 'chat.plan.check.visa') };
    }
  }
}

/** The near trip's cards: today's and tomorrow's in one box, what's left in another. Nothing near, nothing shown. */
export function PlanToday() {
  const router = useRouter();
  const q = useTodayPlan();
  const { refetch } = q;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  const data = q.data;
  if (!data?.trip || !data.cards.length) return null;
  const go = (href: string) => { buzz('tap'); router.push(href as Href); };
  const days = data.cards.filter((c) => c.kind !== 'todo');
  const todo = data.cards.filter((c) => c.kind === 'todo');
  const when = (w: 'today' | 'tomorrow') => t(w === 'today' ? 'tp.when.today' : 'tp.when.tomorrow');
  const lead = data.trip.startsIn > 1 ? t('tp.when.inDays', { n: data.trip.startsIn }) : null;
  return (
    <View style={{ gap: 12 }} testID="today-plan">
      {days.length ? (
        <Rise>
          <Box padding={18} gap={12} testID="today-plan-days" onPress={() => go(days[0]!.href)} label={routeTitle(data.trip.title)}>
            <Eyebrow>{routeTitle(data.trip.title)}</Eyebrow>
            {days.map((c, i) => {
              const l = line(c);
              return (
                <View key={i} testID={`today-plan-${c.kind}`}><Row gap={12} align="flex-start">
                  <View style={{ width: 34, height: 34, borderRadius: 99, backgroundColor: colors.mist, alignItems: 'center', justifyContent: 'center' }}><Icon name={l.icon} size={18} /></View>
                  <Grow>
                    <Small color={colors.goldInk}>{when(c.when)}</Small>
                    <H3 size={16}>{l.text}</H3>
                    {c.kind === 'checkin' && c.city ? <Small>{name(c.city)}</Small> : null}
                  </Grow>
                </Row></View>
              );
            })}
          </Box>
        </Rise>
      ) : null}
      {todo.length ? (
        <Rise step={1}>
          <Box padding={18} gap={10} testID="today-plan-todo">
            <Row gap={8}><Eyebrow>{t('tp.todo.title')}</Eyebrow>{lead ? <Small>{`· ${lead}`}</Small> : null}</Row>
            <H3 size={16}>{routeTitle(data.trip.title)}</H3>
            {todo.map((c, i) => {
              const l = line(c);
              return (
                <Row key={i} gap={10}>
                  <View style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: c.kind === 'todo' && c.state === 'warn' ? colors.bad : colors.gold }} />
                  <Small style={{ flex: 1 }}>{l.text}</Small>
                </Row>
              );
            })}
            <TextLink label={t('tp.open')} onPress={() => go(todo[0]!.href)} testID="today-plan-open" />
          </Box>
        </Rise>
      ) : null}
    </View>
  );
}

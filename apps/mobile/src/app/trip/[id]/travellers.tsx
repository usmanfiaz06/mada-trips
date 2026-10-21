import { Pressable, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { TRAVELLER_ROLES, type TravellerRole, type TripCompanion } from '@mada/shared';
import { EmptyState } from '@/components/EmptyState';
import { Box, Eyebrow, Grow, H3, Rise, Row, Small, SmallButton, Tag, Tiny, TripScreen } from '@/components/trips/ui';
import { Initial } from '@/components/booking/PeopleFrame';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { peopleApi, useTravellers, useTravellersWrite } from '@/lib/trip-people';
import { colors, ff } from '@/theme';

/*
 * Travellers (ASK-INTEGRATED.md §5.5, owner only): who goes on the trip, and what each person on Mada may do with
 * the plan: Can view, Can suggest (the default: changes come to you to approve in the chat) or Can edit (ideas change
 * at once; bookings and payments still come to you). A household person with no account has nothing to set. Prices
 * stay hidden from companions unless the owner shows them to those who can edit.
 */

export default function Travellers() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useTravellers(id);
  const write = useTravellersWrite(id);
  const data = q.data;
  if (q.isError && !data) {
    return (
      <TripScreen title={t('people.screen.title')}>
        <EmptyState title={t('people.screen.notYours')} />
      </TripScreen>
    );
  }
  const setRole = (p: TripCompanion, role: TravellerRole) => { if (p.role === role) return; buzz('select'); write.mutate(() => peopleApi.role(id, p.id, role)); };
  return (
    <TripScreen title={t('people.screen.title')}>
      <Rise style={{ gap: 6 }}>
        {data ? <Eyebrow>{data.title}</Eyebrow> : null}
        <Small>{t('people.screen.lead')}</Small>
        {data?.pending ? <Tag tone="gold" label={t('people.screen.pending', { n: data.pending })} style={{ alignSelf: 'flex-start' }} /> : null}
      </Rise>
      {(data?.travellers ?? []).map((p, i) => (
        <Rise key={p.id} step={i + 1}>
          <Box testID={p.owner ? 'travellers-owner' : `traveller-${p.kind}`}>
            <Row align="flex-start">
              <Initial letter={p.initial} gold={p.onMada && !p.owner} size={40} />
              <Grow gap={3}>
                <Row gap={8}>
                  <H3 size={16}>{p.name}</H3>
                  {p.status !== 'going' ? <Tag tone={p.status === 'invited' ? 'when' : 'warn'} label={t(`people.status.${p.status}`)} /> : null}
                </Row>
                <Tiny>{p.owner ? t('people.screen.owner') : p.how}</Tiny>
              </Grow>
              {!p.owner ? <SmallButton tone="ghost" label={t('people.screen.remove')} onPress={() => write.mutate(() => peopleApi.remove(id, p.id))} testID={`traveller-remove-${i}`} /> : null}
            </Row>
            {!p.owner && p.onMada ? (
              <View style={{ gap: 6 }} accessibilityRole="radiogroup" testID={`traveller-roles-${i}`}>
                {TRAVELLER_ROLES.map((r) => {
                  const on = p.role === r;
                  return (
                    <Pressable key={r} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} accessibilityLabel={`${t(`people.role.${r}`)}, ${t(`people.role.${r}.sub`)}`} testID={`traveller-role-${i}-${r}`}
                      onPress={() => setRole(p, r)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: on ? colors.green : colors.line, backgroundColor: on ? colors.mist : 'transparent' }, pressed ? { opacity: 0.85 } : null]}>
                      <View style={{ width: 20, height: 20, borderRadius: 99, borderWidth: 2, borderColor: on ? colors.green : colors.ink3, alignItems: 'center', justifyContent: 'center' }}>
                        {on ? <View style={{ width: 10, height: 10, borderRadius: 99, backgroundColor: colors.green }} /> : null}
                      </View>
                      <View style={{ flex: 1, gap: 1 }}>
                        <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{t(`people.role.${r}`)}</T>
                        <T v="tiny" color={colors.ink2}>{t(`people.role.${r}.sub`)}</T>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : !p.owner ? <Tiny color={colors.muted}>{t('people.screen.noAccount')}</Tiny> : null}
          </Box>
        </Rise>
      ))}
      {data ? (
        <Box tone="well">
          <Row>
            <Small color={colors.green} style={{ flex: 1 }}>{t('people.screen.sharePrices')}</Small>
            <Switch value={data.sharePrices} onValueChange={(v) => { buzz('select'); write.mutate(() => peopleApi.sharePrices(id, v)); }} accessibilityLabel={t('people.screen.sharePrices')} testID="travellers-share-prices"
              trackColor={{ true: colors.green, false: colors.line }} thumbColor={colors.paper} />
          </Row>
        </Box>
      ) : null}
      <SmallButton tone="soft" icon="plus" label={t('people.screen.add')} onPress={() => router.push(`/ask?tripId=${id}` as Href)} testID="travellers-add" />
    </TripScreen>
  );
}

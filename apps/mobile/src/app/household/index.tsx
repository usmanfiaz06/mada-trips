import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueries } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ArtFriends } from '@/components/art/Arts';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { AccountScreen } from '@/components/wallet/AccountScreen';
import { AddPersonSheet } from '@/components/wallet/AddPersonSheet';
import { Group, PersonAvatar, Row, StatusPill, UserAvatar } from '@/components/wallet/ui';
import { t } from '@/lib/i18n';
import { usePeople } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useAccount, useTrips, walletApi, walletKeys } from '@/lib/wallet';
import { ageBand, isHelper, nextTrip, passportStatus, relationOf } from '@/lib/wallet-model';
import { colors } from '@/theme';

/** Household (Account.jsx Household): everyone you book for, with their passport status. */
export default function Household() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const account = useAccount();
  const people = usePeople();
  const trips = useTrips();
  const [adding, setAdding] = useState(false);
  const list = people.data ?? [];
  const details = useQueries({ queries: list.filter((p) => !p.isSelf).map((p) => ({ queryKey: walletKeys.person(p.id), queryFn: () => walletApi.person(p.id) })) });
  const detailOf = (id: string) => details.find((d) => d.data?.person.id === id)?.data?.details ?? null;
  const trip = nextTrip(trips.data);
  const display = account.data?.preferredName || user?.name || '';
  return (
    <AccountScreen title={t('household.title')} testID="household"
      act={<Button label={t('household.add')} icon={<Icon name="plus" color={colors.mist} />} onPress={() => setAdding(true)} testID="household-add" />}>
      <T v="body">{t('household.body')}</T>
      <Group>
        {list.map((p) => {
          const st = passportStatus(p, trip);
          const band = p.passport ? ageBand(p.dateOfBirth) : null;
          const d = detailOf(p.id);
          const rel = relationOf(p, d);
          return (
            <Row key={p.id} testID={`person-${p.firstName || 'you'}`}
              lead={p.isSelf ? <UserAvatar size={44} initial={display.charAt(0)} hasPhoto={!!account.data?.photo} photoKey={account.data?.photo?.updatedAt} /> : <PersonAvatar initial={p.firstName.charAt(0)} helper={isHelper(p, d)} />}
              value={p.isSelf ? (display ? t('household.you', { name: display }) : t('household.youPlain')) : p.firstName}
              sub={[p.isSelf ? null : rel, band?.label].filter(Boolean).join(' · ') || t('household.holder')}
              onPress={() => router.push({ pathname: '/household/[id]', params: { id: p.id } })}
              right={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><StatusPill label={st.label} tone={st.tone} /><Icon name="chevron" size={18} color={colors.muted} /></View>} />
          );
        })}
      </Group>
      {list.length <= 1 ? <EmptyState art={<ArtFriends />} title={t('household.emptyTitle')} body={t('household.emptyBody')} /> : null}
      <T v="tiny" style={{ paddingHorizontal: 4 }}>{t('household.note')}</T>
      <AddPersonSheet visible={adding} onClose={() => setAdding(false)} />
    </AccountScreen>
  );
}

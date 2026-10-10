import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { RELATION_LABELS, dmyToIso, isoToDmy, type UpdatePersonRequest } from '@mada/shared';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { AccountScreen } from '@/components/wallet/AccountScreen';
import { Group, PersonAvatar, Row, Source, StatusPill, UserAvatar } from '@/components/wallet/ui';
import { ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useAccount, usePersonDetail, useRefreshHousehold, useTrips, walletApi, walletKeys } from '@/lib/wallet';
import { useOnChange, ageBand, daysBetween, fullDay, fullNameOf, isHelper, nextTrip, passportStatus, relationOf, todayIso } from '@/lib/wallet-model';
import { colors, ff } from '@/theme';

const MEALS = ['halal', 'veg', 'vegan', 'child', 'diabetic', 'gluten', 'lowsalt'] as const;

/** One person (Account.jsx HouseholdPerson): passport, relation, meal, and for a helper the iqama and exit visa. */
export default function HouseholdPerson() {
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const user = useSession((s) => s.user);
  const account = useAccount();
  const detail = usePersonDetail(id);
  const trips = useTrips();
  const refresh = useRefreshHousehold();
  const [sheet, setSheet] = useState<null | 'relation' | 'remove'>(null);
  const [iqama, setIqama] = useState('');
  const [iqTouched, setIqTouched] = useState(false);
  const [until, setUntil] = useState('');
  const d = detail.data?.details;
  useOnChange(d?.exitVisa.until ?? null, (u) => setUntil(u ? isoToDmy(u) : ''));

  if (detail.isError) {
    return (
      <AccountScreen>
        <T v="h1">{t('household.gone')}</T>
        <Button variant="secondary" block={false} label={t('common.back')} onPress={() => router.back()} />
      </AccountScreen>
    );
  }
  const p = detail.data?.person;
  if (!p || !d) return <AccountScreen backLabel={t('household.title')}><View /></AccountScreen>;
  const me = p.isSelf;
  const trip = nextTrip(trips.data);
  const st = passportStatus(p, trip);
  const band = p.passport ? ageBand(p.dateOfBirth) : null;
  const display = me ? account.data?.preferredName || user?.name || t('household.youPlain') : p.firstName;
  const meal = d.meal ?? (band?.short === 'Child' ? 'child' : 'halal');
  const helper = isHelper(p, d);
  const save = async (patch: UpdatePersonRequest, done?: string) => {
    try { qc.setQueryData(walletKeys.person(p.id), await walletApi.updatePerson(p.id, patch)); if (done) toast(done); } catch (e) { toast(e instanceof ApiError ? e.message : t('error.internal')); }
  };
  const iqD = iqama.replace(/\D/g, '');
  const iqErr = !iqD ? null : iqD.length !== 10 ? t('household.iqamaLength', { count: iqD.length }) : !iqD.startsWith('2') ? t('household.iqamaPrefix') : null;
  const exit = d.exitVisa;
  const untilIso = until ? dmyToIso(until) : null;
  const exitLeft = exit.until ? daysBetween(todayIso(), exit.until) : null;
  const exitLine = exit.kind === 'none' ? t('household.exit.needed', { name: p.firstName })
    : !exit.until ? t('household.exit.addDate')
      : exitLeft! < 0 ? t('household.exit.expired', { date: fullDay(exit.until) })
        : t('household.exit.valid', { date: fullDay(exit.until), days: exitLeft! });
  const scan = () => router.push({ pathname: '/passport', params: me ? {} : { person: p.id } });

  return (
    <AccountScreen backLabel={t('household.title')} testID="household-person">
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        {me ? <UserAvatar size={64} initial={display.charAt(0)} hasPhoto={!!account.data?.photo} photoKey={account.data?.photo?.updatedAt} /> : <PersonAvatar size={64} initial={p.firstName.charAt(0)} helper={helper} />}
        <View style={{ gap: 2, flex: 1 }}>
          <T v="h1" style={{ fontSize: 26, lineHeight: 30 }}>{display}</T>
          <T v="small">{`${me ? t('household.youHolder') : relationOf(p, d)}${band ? ` · ${band.label}` : ''}`}</T>
        </View>
      </View>

      <Card style={{ gap: 8, ...(st.tone === 'gold' || st.tone === 'warn' ? { borderWidth: 1.5, borderColor: '#e6cf9f' } : null) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><T v="eyebrow">{t('household.passport')}</T><StatusPill label={st.label} tone={st.tone} /></View>
        {st.key === 'none' ? <T v="h3">{me ? t('household.notScannedYou') : t('household.notScanned', { name: p.firstName })}</T> : <T v="h3">{fullNameOf(p)}</T>}
        {p.passport ? <T v="small" style={{ fontVariant: ['tabular-nums'] }}>{t('household.expiresLine', { number: p.passport.numberMasked, date: fullDay(p.passport.expiry) })}</T> : null}
        {st.text ? <T v="small" color={st.tone === 'warn' ? colors.badInk : colors.goldInk}>{st.text}</T> : null}
        {st.key !== 'ok' ? <Button label={st.key === 'none' ? (me ? t('household.scanMine') : t('household.scanTheirs')) : t('household.scanNew')} icon={<Icon name="scan" color={colors.gold} />} onPress={scan} testID="person-scan" /> : null}
      </Card>

      <Group label={t('household.details')}>
        {!me ? <Row label={t('household.relation')} value={relationOf(p, d)} onPress={() => setSheet('relation')} src={<Source kind={d.relationLabel ? 'typed' : 'added'} />} testID="person-relation" /> : null}
        <Row label={t('account.dob')} value={p.dateOfBirth && p.passport ? fullDay(p.dateOfBirth) : t('account.notScanned')} locked src={<Source kind={p.passport ? 'passport' : 'none'} />} />
        {band?.note ? <View style={{ padding: 16 }}><T v="tiny">{band.note}</T></View> : null}
        {!me ? (
          <View style={{ padding: 16, gap: 8 }}>
            <T v="caption" color={colors.ink3} style={{ fontFamily: ff.ui600 }}>{t('prefs.meal')}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{MEALS.map((m) => <Chip key={m} on={meal === m} label={t(`prefs.meal.${m}`)} onPress={() => save({ meal: m })} />)}</View>
          </View>
        ) : <Row label={t('household.yourDetails')} value={t('household.yourDetailsSub')} onPress={() => router.push('/account')} />}
      </Group>

      {helper ? (
        <Group label={t('household.residency')}>
          <View style={{ padding: 16, gap: 8 }}>
            <Field label={t('household.iqama')} value={iqama} keyboardType="number-pad" maxLength={12} placeholder={d.iqamaMasked ?? '2XXXXXXXXX'} testID="iqama-input"
              onChangeText={setIqama} error={iqTouched ? iqErr : null}
              onBlur={() => { setIqTouched(true); if (iqD && !iqErr) { save({ iqama: iqD }, t('household.iqamaSaved')); setIqama(''); setIqTouched(false); } }}
              hint={d.iqamaMasked && !iqErr ? <Source kind="typed" at={d.iqamaAt} /> : null} />
          </View>
          <View style={{ padding: 16, gap: 10 }}>
            <T v="caption" color={colors.ink3} style={{ fontFamily: ff.ui600 }}>{t('household.exit')}</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['none', 'single', 'multiple'] as const).map((k) => <Chip key={k} on={exit.kind === k} label={t(`household.exit.${k}`)} onPress={() => save({ exitVisa: { kind: k, until: k === 'none' ? null : exit.until } })} />)}
            </View>
            {exit.kind !== 'none' ? <Field label={t('household.exit.useBy')} value={until} onChangeText={setUntil} placeholder="01/02/2027" keyboardType="numbers-and-punctuation" testID="exit-until"
              error={until && !untilIso ? t('passport.field.badDate') : null} onBlur={() => { if (untilIso && untilIso !== exit.until) save({ exitVisa: { kind: exit.kind, until: untilIso } }); }} /> : null}
            <T v="small" color={exit.kind === 'none' || (exitLeft !== null && exitLeft < 0) ? colors.goldInk : colors.ink2} testID="exit-line">{exitLine}</T>
          </View>
        </Group>
      ) : null}

      {!me ? <Button variant="ghost" color={colors.badInk} label={t('household.remove', { name: p.firstName })} onPress={() => setSheet('remove')} testID="person-remove" /> : null}

      <Sheet visible={sheet === 'relation'} onClose={() => setSheet(null)} label={t('household.relation')}>
        <T v="h2">{t('household.relation.title', { name: p.firstName })}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{RELATION_LABELS.map((r) => <Chip key={r} on={d.relationLabel === r} label={t(`household.relation.${r}`)} onPress={() => { buzz('select'); save({ relationLabel: r }, t('household.saved')); setSheet(null); }} />)}</View>
        <T v="small">{t('household.relation.note')}</T>
      </Sheet>
      <Sheet visible={sheet === 'remove'} onClose={() => setSheet(null)} label={t('household.remove.title', { name: p.firstName })}>
        <T v="h2">{t('household.remove.title', { name: p.firstName })}</T>
        <T v="body">{t('household.remove.body', { name: p.firstName })}</T>
        <Button variant="secondary" style={{ backgroundColor: colors.mist }} color={colors.badInk} label={t('household.remove.confirm', { name: p.firstName })} testID="person-remove-confirm"
          onPress={async () => { try { await walletApi.removePerson(p.id); await refresh(); buzz('tap'); toast(t('household.removed', { name: p.firstName })); setSheet(null); router.back(); } catch { toast(t('error.internal')); } }} />
        <Button label={t('household.remove.keep', { name: p.firstName })} onPress={() => setSheet(null)} />
      </Sheet>
    </AccountScreen>
  );
}

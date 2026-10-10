import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { COUNTRIES } from '@mada/shared';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { AccountScreen } from '@/components/wallet/AccountScreen';
import { AIRPORTS, CurrencySheet, EmailSheet, HomeSheet, LanguageSheet, PassportLockedSheet, PhoneSheet, PreferredSheet, currencyName } from '@/components/wallet/AccountSheets';
import { PhotoSheet } from '@/components/wallet/PhotoSheet';
import { Group, Row, Source, UserAvatar } from '@/components/wallet/ui';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { usePeople } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { useAccount } from '@/lib/wallet';
import { fullDay, fullNameOf, prettyPhone } from '@/lib/wallet-model';
import { colors, ff } from '@/theme';

type SheetName = 'photo' | 'name' | 'field' | 'preferred' | 'email' | 'phone' | 'home' | 'language' | 'currency';

/** Your details (Account.jsx Account): every detail with where it came from. */
export default function YourDetails() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const account = useAccount();
  const people = usePeople();
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const a = account.data;
  const self = people.data?.find((p) => p.isSelf);
  const scanned = !!self?.passport;
  const passportName = scanned ? fullNameOf(self) : '';
  const display = a?.preferredName || user?.name || self?.firstName || '';
  const home = AIRPORTS.find((x) => x[0] === (a?.home ?? 'RUH')) ?? AIRPORTS[0]!;
  const close = () => setSheet(null);
  const scan = () => router.push('/passport');

  return (
    <AccountScreen title={t('account.title')} testID="account-details" query={account}>
      <Pressable accessibilityRole="button" accessibilityLabel={a?.photo ? t('profile.photoChange') : t('profile.photoAdd')} onPress={() => { buzz('tap'); setSheet('photo'); }} style={styles.hero} testID="details-photo">
        <View>
          <UserAvatar size={84} initial={display.charAt(0)} hasPhoto={!!a?.photo} photoKey={a?.photo?.updatedAt} />
          <View style={styles.cam}><Icon name="plus" size={16} color={colors.green} width={2.4} /></View>
        </View>
        <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{a?.photo ? t('profile.photoChange') : t('profile.photoAdd')}</T>
      </Pressable>
      <T v="small" style={{ textAlign: 'center', paddingHorizontal: 4 }}>{t('account.intro')}</T>

      <Group label={t('account.name')}>
        <Row label={t('account.passportName')} value={passportName || t('account.notScanned')} locked onPress={() => setSheet('name')} src={<Source kind={scanned ? 'passport' : 'none'} />} testID="details-passport-name" />
        <Row label={t('account.calledYou')} value={display || t('account.addName')} onPress={() => setSheet('preferred')} testID="details-preferred"
          src={a?.preferredName ? <Source kind="typed" at={a.preferredAt} /> : scanned && display ? <Source kind="passport" /> : display ? <Source kind="typed" /> : <Source warn={t('account.nameWait')} />} />
      </Group>

      <Group label={t('account.contact')}>
        <Row label={t('account.email')} value={user?.email ?? t('account.notAdded')} onPress={() => setSheet('email')} testID="details-email"
          src={user?.email ? (user.emailRelay ? <Source kind="apple" /> : <Source kind="verified" at={a?.emailVerifiedAt} />) : <Source warn={t('account.emailWarn')} />} />
        <Row label={t('account.mobile')} value={prettyPhone(user?.phone)} onPress={() => setSheet('phone')} testID="details-phone"
          src={user?.phone ? (a?.phoneVerifiedAt ? <Source kind="verified" at={a.phoneVerifiedAt} /> : <Source kind="signup" />) : <Source warn={t('account.mobileWarn')} />} />
      </Group>

      <Group label={t('account.fromPassport')}>
        <Row label={t('account.dob')} value={scanned && self?.dateOfBirth ? fullDay(self.dateOfBirth) : t('account.notScanned')} locked onPress={() => setSheet('field')} src={<Source kind={scanned ? 'passport' : 'none'} />} />
        <Row label={t('account.nationality')} value={scanned && self?.nationality ? COUNTRIES[self.nationality] ?? self.nationality : t('account.notScanned')} locked onPress={() => setSheet('field')} src={<Source kind={scanned ? 'passport' : 'none'} />} />
      </Group>

      <Group label={t('account.forBookings')}>
        <Row label={t('account.home')} value={`${home[1]} · ${home[0]}`} onPress={() => setSheet('home')} src={<Source kind={a?.homeAt ? 'typed' : 'default'} at={a?.homeAt} />} testID="details-home" />
        <Row label={t('account.language')} value={t('lang.current')} onPress={() => setSheet('language')} src={<Source kind="default" />} />
        <Row label={t('account.currency')} value={`${a?.currency ?? 'SAR'} · ${currencyName(a?.currency ?? 'SAR')}`} onPress={() => setSheet('currency')} src={<Source kind={a?.currency && a.currency !== 'SAR' ? 'typed' : 'default'} />} testID="details-currency" />
      </Group>

      <PhotoSheet visible={sheet === 'photo'} onClose={close} initial={display.charAt(0)} />
      <PassportLockedSheet visible={sheet === 'name' || sheet === 'field'} field={sheet === 'name' ? 'name' : 'other'} scanned={scanned} onClose={close} onScan={scan} />
      <PreferredSheet visible={sheet === 'preferred'} onClose={close} current={display} />
      <EmailSheet visible={sheet === 'email'} onClose={close} />
      <PhoneSheet visible={sheet === 'phone'} onClose={close} />
      <HomeSheet visible={sheet === 'home'} onClose={close} />
      <LanguageSheet visible={sheet === 'language'} onClose={close} />
      <CurrencySheet visible={sheet === 'currency'} onClose={close} />
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  hero: { alignSelf: 'center', alignItems: 'center', gap: 10, paddingTop: 4 },
  cam: { position: 'absolute', end: -2, bottom: -2, width: 30, height: 30, borderRadius: 999, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.sand },
});

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { countryCode, dmyToIso, type MrzField } from '@mada/shared';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Act, Scroll, Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { Notice } from '@/components/wallet/ui';
import { ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { usePassportScan, type PassportFields } from '@/lib/passport-scan';
import { toast } from '@/lib/toast';
import { useRefreshHousehold, walletApi } from '@/lib/wallet';
import { usePeople } from '@/lib/queries';
import { colors, ff } from '@/theme';

const FIELDS: [keyof PassportFields & MrzField, Parameters<typeof t>[0]][] = [
  ['given', 'passport.field.given'], ['surname', 'passport.field.surname'], ['number', 'passport.field.number'],
  ['nationality', 'passport.field.nationality'], ['dob', 'passport.field.dob'], ['expiry', 'passport.field.expiry'],
];

/**
 * "Is this right?" (prototype Onboarding confirm): every field as read, the doubtful ones marked "Check this", an
 * expired passport warned about (saved anyway), and nothing sent until Save. Then the number goes once, encrypted.
 */
export default function PassportConfirm() {
  const router = useRouter();
  const { personId, fields, doubt, fromPhoto, manual, set } = usePassportScan();
  const people = usePeople();
  const refresh = useRefreshHousehold();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const missing = (['given', 'surname', 'number', 'dob', 'expiry'] as const).filter((k) => !fields[k].trim());
  const expIso = dmyToIso(fields.expiry);
  const dobIso = dmyToIso(fields.dob);
  const badExpiry = !!fields.expiry.trim() && !expIso;
  const badDob = !!fields.dob.trim() && !dobIso;
  const natCode = countryCode(fields.nationality);
  const badNat = !!fields.nationality.trim() && !natCode;
  const badNumber = !!fields.number.trim() && !/^[A-Za-z0-9]{5,12}$/.test(fields.number.trim());
  const expired = !!expIso && expIso < new Date().toISOString().slice(0, 10);
  const blocked = missing.length > 0 || badExpiry || badDob || badNat || badNumber;

  const save = async () => {
    if (blocked || !expIso || !dobIso || !natCode) return;
    setBusy(true); setProblem(null);
    const issuer = countryCode(fields.issuer) ?? natCode;
    try {
      const self = people.data?.find((p) => p.isSelf);
      const target = personId && personId !== self?.id ? personId : 'self';
      const r = await walletApi.savePassport(target, {
        givenNames: fields.given.trim(), surname: fields.surname.trim(), dateOfBirth: dobIso, ...(/^[MFX]$/.test(fields.sex) ? { sex: fields.sex as 'M' | 'F' | 'X' } : {}),
        passport: { number: fields.number.trim().toUpperCase(), issuingCountry: issuer, nationality: natCode, expiry: expIso, source: manual ? 'manual' : 'scan' },
      });
      await refresh();
      buzz('success');
      toast(r.person.isSelf ? t('passport.saved') : t('passport.savedFor', { name: r.person.firstName }));
      if (router.canDismiss()) router.dismissAll();
      router.replace('/wallet');
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : t('error.internal'));
    } finally { setBusy(false); }
  };

  return (
    <Screen>
      <TopBar onBack={() => router.back()} title={manual ? t('passport.confirm.bar') : undefined} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Scroll top={8} bottomPad={130}>
          <T v="h1" accessibilityRole="header">{manual ? t('passport.confirm.titleManual') : t('passport.confirm.title')}</T>
          <T v="body">{t('passport.confirm.body')}</T>
          {fromPhoto ? (
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.mist }} testID="confirm-from-photo">
              <Icon name="scan" size={18} />
              <T v="small" color={colors.green} style={{ flex: 1 }}>{`${t('passport.confirm.fromPhoto')}${doubt.length ? ` ${tn('passport.confirm.doubt', doubt.length)}` : ''}`}</T>
            </View>
          ) : null}
          {FIELDS.map(([k, label]) => {
            const unsure = fromPhoto && doubt.includes(k);
            const err = k === 'expiry' && badExpiry ? t('passport.field.badDate') : k === 'dob' && badDob ? t('passport.field.badDate') : k === 'nationality' && badNat ? t('passport.field.badCountry') : k === 'number' && badNumber ? t('passport.field.badNumber') : null;
            return (
              <Field key={k} label={t(label)} value={fields[k]} autoCapitalize="characters" error={err} testID={`pp-${k}`}
                keyboardType={k === 'dob' || k === 'expiry' ? 'numbers-and-punctuation' : 'default'} placeholder={k === 'dob' ? '11/03/1984' : k === 'expiry' ? '22/06/2031' : undefined}
                style={unsure ? { borderColor: colors.gold, borderWidth: 1.5 } : undefined}
                hint={unsure ? <T v="small" color={colors.goldInk} style={{ fontFamily: ff.ui600 }}>{t('passport.field.check')}</T> : null}
                onChangeText={(v) => set({ fields: { ...fields, [k]: v }, ...(unsure ? { doubt: doubt.filter((x) => x !== k) } : {}) })} />
            );
          })}
          {expired ? <Notice icon="visa" warn title={t('passport.expired.title')} body={t('passport.expired.body')} testID="confirm-expired" /> : null}
          {problem ? <T v="small" color={colors.badInk} accessibilityRole="alert">{problem}</T> : null}
        </Scroll>
        <Act>
          <Button disabled={blocked} busy={busy} onPress={save} testID="passport-save"
            label={missing.length ? tn('passport.fillMore', missing.length) : manual ? t('passport.save') : t('passport.saveScanned')} />
        </Act>
      </KeyboardAvoidingView>
    </Screen>
  );
}

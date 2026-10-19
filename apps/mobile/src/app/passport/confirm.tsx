import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useQueryClient } from '@tanstack/react-query';
import { countryCode, dmyToIso, type MrzField } from '@mada/shared';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Act, Scroll, Screen, TopBar } from '@/components/Layout';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { Notice } from '@/components/wallet/ui';
import { ApiError } from '@/lib/api';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { keepPassportCopy } from '@/lib/passport-copy';
import { isPdf, usePassportScan, type PassportFields } from '@/lib/passport-scan';
import { chooseFile } from '@/lib/pick';
import { toast } from '@/lib/toast';
import { useBookingBack } from '@/lib/hardware-back';
import { useRefreshHousehold, walletApi } from '@/lib/wallet';
import { usePeople } from '@/lib/queries';
import { colors, ff } from '@/theme';

type Key = keyof PassportFields;
const TEXT_FIELDS: [Key, Parameters<typeof t>[0], string?][] = [
  ['given', 'passport.field.given'], ['surname', 'passport.field.surname'], ['number', 'passport.field.number'],
  ['nationality', 'passport.field.nationality'], ['dob', 'passport.field.dob', '11/03/1984'],
];
const DATE_FIELDS: [Key, Parameters<typeof t>[0], string][] = [['issued', 'passport.field.issued', '23/06/2021'], ['expiry', 'passport.field.expiry', '22/06/2031']];
const SEXES = [['M', 'passport.field.sexM'], ['F', 'passport.field.sexF'], ['X', 'passport.field.sexX']] as const;

/**
 * "Is this right?": every detail as read (or blank to type), beside a thumbnail of the photo page to compare with.
 * Anything read with low confidence is amber with "Please check". Each detail can be changed. One button confirms;
 * then the details go once (the number encrypted on the server), and the photo or PDF goes only if they keep a copy,
 * after the line that says who can see it. Then back to wherever this was opened: a booking stays exactly as it was.
 */
export default function PassportConfirm() {
  const router = useRouter();
  const qc = useQueryClient();
  const { height } = useWindowDimensions();
  const { personId, fields, doubt, fromPhoto, manual, copy, keepCopy, set } = usePassportScan();
  const people = usePeople();
  const refresh = useRefreshHousehold();
  const [busy, setBusy] = useState(false);
  // Android back while the passport is being saved: stay, so a booking underneath never misses it.
  useBookingBack({ busy, busyText: 'back.saving', canGoBack: () => true, onLeave: () => router.back() });
  const [zoom, setZoom] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const self = people.data?.find((p) => p.isSelf);
  const who = personId ? people.data?.find((p) => p.id === personId) : null;
  const forOther = !!who && !who.isSelf;
  const pdf = isPdf(copy);

  const missing = (['given', 'surname', 'number', 'dob', 'expiry'] as const).filter((k) => !fields[k].trim());
  const expIso = dmyToIso(fields.expiry);
  const dobIso = dmyToIso(fields.dob);
  const issuedIso = fields.issued.trim() ? dmyToIso(fields.issued) : null;
  const today = new Date().toISOString().slice(0, 10);
  const badExpiry = !!fields.expiry.trim() && !expIso;
  const badDob = !!fields.dob.trim() && !dobIso;
  const badIssued = !!fields.issued.trim() && (!issuedIso || issuedIso > today || (!!expIso && issuedIso >= expIso));
  const natCode = countryCode(fields.nationality);
  const badNat = !!fields.nationality.trim() && !natCode;
  const issuerCode = fields.issuer.trim() ? countryCode(fields.issuer) : natCode;
  const badIssuer = !!fields.issuer.trim() && !issuerCode;
  const badNumber = !!fields.number.trim() && !/^[A-Za-z0-9]{5,12}$/.test(fields.number.trim());
  const expired = !!expIso && expIso < today;
  const blocked = missing.length > 0 || badExpiry || badDob || badNat || badNumber || badIssued || badIssuer;
  const fullName = [fields.given, fields.surname].map((x) => x.trim()).filter(Boolean).join(' ').toUpperCase();

  const edit = (k: Key, v: string) => set({ fields: { ...fields, [k]: v }, ...(doubt.includes(k as MrzField) ? { doubt: doubt.filter((x) => x !== k) } : {}) });
  const attach = async () => { const f = await chooseFile(); if (f) { set({ copy: f, keepCopy: true }); buzz('select'); } };

  const save = async () => {
    if (blocked || !expIso || !dobIso || !natCode) return;
    setBusy(true); setProblem(null);
    const sex = /^[MFX]$/.test(fields.sex) ? (fields.sex as 'M' | 'F' | 'X') : undefined;
    try {
      const target = personId && personId !== self?.id ? personId : 'self';
      const r = await walletApi.savePassport(target, {
        givenNames: fields.given.trim(), surname: fields.surname.trim(), dateOfBirth: dobIso, ...(sex ? { sex } : {}),
        passport: { number: fields.number.trim().toUpperCase(), issuingCountry: issuerCode ?? natCode, nationality: natCode, expiry: expIso, ...(issuedIso ? { issued: issuedIso } : {}), source: manual ? 'manual' : 'scan' },
      });
      // The copy goes only now, only if they kept it on, and never with the number.
      let copyFailed = false;
      if (copy && keepCopy) {
        try {
          await keepPassportCopy(r.person.id, copy, {
            source: fromPhoto ? 'scan' : 'upload', expiry: expIso,
            fields: { name: fullName, nationality: natCode, issuer: issuerCode ?? natCode, sex, dob: dobIso, issued: issuedIso, expiry: expIso },
          });
        } catch { copyFailed = true; }
      }
      await refresh();
      // An order sheet underneath re-checks its passports (and the names on the booking) as it comes back.
      void qc.invalidateQueries({ queryKey: ['booking', 'preview'] });
      buzz('success');
      toast(copyFailed ? t('pp.copy.failed') : r.person.isSelf ? t('passport.saved') : t('passport.savedFor', { name: r.person.firstName }));
      // Back to wherever the scan started (a booking, the Wallet, a household page), not a second copy of it.
      if (router.canDismiss()) router.dismissAll();
      router.back();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : t('error.internal'));
    } finally { setBusy(false); }
  };

  const field = (k: Key, label: Parameters<typeof t>[0], placeholder?: string, extra?: { hint?: string; err?: string | null }) => {
    const unsure = fromPhoto && doubt.includes(k as MrzField);
    const date = k === 'dob' || k === 'expiry' || k === 'issued';
    return (
      <Field key={k} label={t(label)} value={fields[k]} autoCapitalize="characters" error={extra?.err} testID={`pp-${k}`}
        keyboardType={date ? 'numbers-and-punctuation' : 'default'} placeholder={placeholder}
        style={unsure ? styles.unsure : undefined}
        hint={unsure ? <T v="small" color={colors.goldInk} style={{ fontFamily: ff.ui600 }} testID={`pp-${k}-check`}>{t('passport.field.check')}</T> : extra?.hint ? <T v="tiny">{extra.hint}</T> : null}
        onChangeText={(v) => edit(k, v)} />
    );
  };

  return (
    <Screen>
      <TopBar onBack={() => router.back()} title={manual ? t('passport.confirm.bar') : undefined} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Scroll top={8} bottomPad={24}>
          <View style={{ gap: 4 }}>
            <T v="eyebrow" testID="confirm-whose">{forOther ? t('pp.confirm.whose', { name: who!.firstName }) : t('pp.confirm.yours')}</T>
            <T v="h1" accessibilityRole="header">{manual ? t('passport.confirm.titleManual') : t('passport.confirm.title')}</T>
          </View>
          <T v="body">{t('passport.confirm.body')}</T>

          {copy ? (
            <View style={styles.compare} testID="confirm-compare">
              <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('pp.copy.title')} onPress={() => { if (!pdf) { buzz('tap'); setZoom(true); } }} style={styles.thumb} testID="confirm-thumb">
                {pdf ? <View style={styles.pdf}><Icon name="doc" size={26} /><T v="caption" style={{ fontFamily: ff.ui600 }}>PDF</T></View>
                  : <Image source={{ uri: copy.uri }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />}
              </Pressable>
              <View style={{ flex: 1, gap: 4 }}>
                <T v="small" color={colors.green} style={{ fontFamily: ff.ui600 }}>{pdf ? t('pp.confirm.comparePdf') : t('pp.confirm.compare')}</T>
                {fromPhoto ? <T v="small" testID="confirm-from-photo">{`${t('passport.confirm.fromPhoto')}${doubt.length ? ` ${tn('passport.confirm.doubt', doubt.length)}` : ''}`}</T> : null}
              </View>
            </View>
          ) : fromPhoto ? (
            <View style={styles.read} testID="confirm-from-photo">
              <Icon name="scan" size={18} />
              <T v="small" color={colors.green} style={{ flex: 1 }}>{`${t('passport.confirm.fromPhoto')}${doubt.length ? ` ${tn('passport.confirm.doubt', doubt.length)}` : ''}`}</T>
            </View>
          ) : null}
          {pdf ? <Notice icon="doc" body={t('pp.confirm.pdf')} testID="confirm-pdf" /> : null}

          <View style={styles.fullName} accessibilityRole="summary">
            <T v="caption" color={colors.ink3}>{t('passport.field.fullName')}</T>
            <T v="h3" testID="confirm-full-name" style={{ writingDirection: 'ltr' }}>{fullName || '—'}</T>
          </View>
          {TEXT_FIELDS.map(([k, label, ph]) => field(k, label, ph, {
            err: k === 'dob' && badDob ? t('passport.field.badDate') : k === 'nationality' && badNat ? t('passport.field.badCountry') : k === 'number' && badNumber ? t('passport.field.badNumber') : null,
          }))}
          <View style={{ gap: 8 }}>
            <T v="small" style={{ fontFamily: ff.ui600 }}>{t('passport.field.sex')}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
              {SEXES.map(([v, label]) => <Chip key={v} on={fields.sex === v} label={t(label)} onPress={() => set({ fields: { ...fields, sex: v } })} />)}
            </View>
          </View>
          {DATE_FIELDS.map(([k, label, ph]) => field(k, label, ph, {
            hint: k === 'issued' ? t('passport.field.issuedHint') : undefined,
            err: k === 'expiry' && badExpiry ? t('passport.field.badDate') : k === 'issued' && badIssued ? (issuedIso ? t('passport.field.badIssued') : t('passport.field.badDate')) : null,
          }))}
          {field('issuer', 'passport.field.issuer', fields.nationality || 'Saudi Arabia', { err: badIssuer ? t('passport.field.badCountry') : null })}
          {expired ? <Notice icon="visa" warn title={t('passport.expired.title')} body={t('passport.expired.body')} testID="confirm-expired" /> : null}

          {copy ? (
            <View style={styles.keep} testID="confirm-keep">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Icon name="lock" size={20} />
                <T v="h3" style={{ flex: 1, fontSize: 15 }}>{t('pp.copy.keep')}</T>
                <Pressable accessibilityRole="switch" accessibilityLabel={t('pp.copy.keep')} accessibilityState={{ checked: keepCopy }} hitSlop={8}
                  onPress={() => { buzz('select'); set({ keepCopy: !keepCopy }); }} style={[styles.switch, keepCopy ? { backgroundColor: colors.gold } : null]} testID="confirm-keep-toggle">
                  <View style={[styles.knob, keepCopy ? { alignSelf: 'flex-end' } : null]} />
                </Pressable>
              </View>
              <T v="small" testID="confirm-consent">{t('pp.copy.consent')}</T>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={attach} style={styles.attach} testID="confirm-attach">
              <Icon name="doc" />
              <View style={{ flex: 1 }}><T v="h3" style={{ fontSize: 15 }}>{t('pp.copy.attach')}</T><T v="tiny">{t('pp.copy.attachSub')}</T></View>
              <Icon name="plus" size={18} />
            </Pressable>
          )}
          {problem ? <T v="small" color={colors.badInk} accessibilityRole="alert">{problem}</T> : null}
        </Scroll>
        <Act inline>
          <Button disabled={blocked} busy={busy} onPress={save} testID="passport-save"
            label={missing.length ? tn('passport.fillMore', missing.length) : t('pp.confirm.go')} />
        </Act>
      </KeyboardAvoidingView>

      <Sheet visible={zoom} onClose={() => setZoom(false)} label={t('pp.copy.title')}>
        {copy && !pdf ? <Image source={{ uri: copy.uri }} style={{ width: '100%', height: Math.min(520, height * 0.55), borderRadius: 16 }} contentFit="contain" testID="confirm-zoom" /> : null}
        <Button variant="secondary" label={t('common.back')} onPress={() => setZoom(false)} style={{ backgroundColor: colors.mist }} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  compare: { flexDirection: 'row', gap: 14, alignItems: 'center', padding: 12, borderRadius: 18, backgroundColor: colors.mist },
  thumb: { width: 112, height: 80, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.stage },
  pdf: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  read: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.mist },
  fullName: { gap: 2, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.line },
  unsure: { borderColor: colors.gold, borderWidth: 1.5, backgroundColor: colors.warnWash },
  keep: { gap: 8, padding: 14, borderRadius: 18, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  attach: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(30,53,45,0.18)' },
  switch: { width: 52, height: 32, borderRadius: 999, backgroundColor: colors.stage, padding: 3, justifyContent: 'center' },
  knob: { width: 26, height: 26, borderRadius: 999, backgroundColor: colors.paper },
});

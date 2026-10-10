import { useEffect, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { buzz } from '@/lib/haptics';
import { t, tn } from '@/lib/i18n';
import { SHOW_DEMO_HINTS } from '@/lib/config';
import { MAX_PASSCODE_TRIES, useWalletLock } from '@/lib/wallet-lock';
import { colors, ff, radii, sizes } from '@/theme';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { Screen } from '../Layout';
import { T } from '../Text';
import { Spinner } from './ui';

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

/** "Wallet is locked" (prototype Wallet Lock): Face ID straight away; if it doesn't match, the passcode. */
export function LockScreen() {
  const { phase, lockedUntil, tryBiometric, tryPasscode, hydrate } = useWalletLock();
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const native = Platform.OS !== 'web';
  useEffect(() => { hydrate().then(() => { if (useWalletLock.getState().lockedUntil <= Date.now()) tryBiometric(); }); }, [hydrate, tryBiometric]);
  useEffect(() => { if (lockedUntil <= Date.now()) return undefined; const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, [lockedUntil]);
  const locked = lockedUntil > now;
  const minutes = Math.max(1, Math.ceil((lockedUntil - now) / 60_000));

  const submit = async (c: string) => {
    const r = await tryPasscode(c);
    if (r === 'ok') { buzz('success'); return; }
    buzz('soft');
    setCode('');
    if (r === 'wrong') setProblem(tn('wallet.lock.wrong', MAX_PASSCODE_TRIES - useWalletLock.getState().wrong));
    else if (r === 'locked') setProblem(null);
  };

  return (
    <Screen dark>
      <View style={styles.wrap} testID="wallet-lock">
        <View style={styles.icon}><Icon name="lock" color={colors.gold} size={30} /></View>
        <T v="h1" color="#f6f2ec" style={{ textAlign: 'center' }} accessibilityRole="header">{t('wallet.lock.title')}</T>
        <T v="body" color={colors.onDark2} style={{ textAlign: 'center' }}>{t('wallet.lock.body')}</T>
        {phase === 'checking' ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Spinner light /><T v="small" color="#e9e2d8">{t('wallet.lock.checking')}</T></View>
        ) : null}
        {phase === 'failed' || locked ? (
          <View style={{ gap: 10, alignSelf: 'stretch' }}>
            {locked
              ? <T v="small" color="#e6c88f" style={{ textAlign: 'center' }} accessibilityRole="alert">{t('wallet.lock.lockedOut', { minutes })}</T>
              : <T v="small" color="#e6c88f" style={{ textAlign: 'center' }} accessibilityRole="alert">{problem ?? t('wallet.lock.failed')}</T>}
            {native ? (
              <Button variant="gold" label={t('wallet.lock.usePasscode')} disabled={locked} onPress={() => submit('')} testID="lock-passcode" />
            ) : (
              <>
                <TextInput testID="lock-passcode-input" accessibilityLabel={t('wallet.lock.passcode')} value={code} editable={!locked} secureTextEntry keyboardType="number-pad" maxLength={6} placeholder="••••••"
                  placeholderTextColor="rgba(233,226,216,0.35)" onChangeText={(v) => { setProblem(null); setCode(v.replace(/\D/g, '').slice(0, 6)); }} onSubmitEditing={() => code.length === 6 && submit(code)}
                  style={[styles.otp, webNoOutline]} />
                <Button variant="gold" label={t('wallet.lock.openWallet')} disabled={code.length !== 6 || locked} onPress={() => submit(code)} testID="lock-open" />
                {SHOW_DEMO_HINTS ? <T v="tiny" color={colors.onDark3} style={{ textAlign: 'center' }}>{t('wallet.lock.demo')}</T> : null}
              </>
            )}
            {locked ? <Button variant="ghost" color={colors.onDark2} label={t('wallet.lock.open')} onPress={() => tryBiometric()} /> : null}
          </View>
        ) : null}
        {phase === 'idle' && !locked ? <Button variant="gold" block={false} label={t('wallet.lock.open')} onPress={() => tryBiometric()} testID="lock-faceid" /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, paddingHorizontal: 32, paddingBottom: 80 },
  icon: { width: 72, height: 72, borderRadius: 999, backgroundColor: 'rgba(233,226,216,0.12)', alignItems: 'center', justifyContent: 'center' },
  otp: { height: sizes.otp, borderRadius: radii.input, borderWidth: 1, borderColor: 'rgba(233,226,216,0.2)', backgroundColor: 'rgba(233,226,216,0.08)', textAlign: 'center', fontSize: 26, letterSpacing: 13, fontFamily: ff.ui600, color: colors.mist },
});

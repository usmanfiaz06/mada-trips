import type { ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppleMark, GoogleMark, WhatsAppMark } from '@/components/BrandMarks';
import { Icon, type IconName } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { T } from '@/components/Text';
import { AUTH_MODE, useWayShown, type PhoneChannel } from '@/lib/auth';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { useOnboarding } from '@/lib/onboarding';
import { colors, ff, radii } from '@/theme';
import { mmss } from './PauseSheet';

/** The address codes come from (Supabase's SMTP sender, AUTH.md §2.3). */
export const CODE_SENDER = 'no-reply@madatrips.sa';
/** Apple is offered where the sign-in screen offers it: iOS, and the mock web preview. */
export const SHOW_APPLE = Platform.OS === 'ios' || (AUTH_MODE === 'mock' && Platform.OS === 'web');

export type CodeFlow = 'signin' | 'add';

/** One choice in the sheet: an icon, what happens, and (sometimes) a line under it. */
export function HelpRow({ icon, title, sub, onPress, disabled, testID }: { icon: ReactNode; title: string; sub?: string; onPress?: () => void; disabled?: boolean; testID?: string }) {
  const body = (
    <>
      <View style={styles.icon}>{icon}</View>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="h3" style={{ fontSize: 15, fontFamily: ff.ui600 }} color={disabled ? colors.ink3 : colors.green}>{title}</T>
        {sub ? <T v="tiny" color={colors.ink3}>{sub}</T> : null}
      </View>
      {onPress ? <Icon name="chevron" size={16} color={colors.ink3} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row} testID={testID}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} testID={testID}
      onPress={() => { buzz('tap'); onPress(); }} style={({ pressed }) => [styles.row, pressed ? { opacity: 0.85 } : null, disabled ? { opacity: 0.6 } : null]}>
      {body}
    </Pressable>
  );
}

const glyph = (name: IconName) => <Icon name={name} size={18} color={colors.green} />;

/**
 * "Didn't get the code?": a calm list of what else to do, on every code screen. A new code (after the minute), the
 * other channel for a phone code (SMS or WhatsApp), WhatsApp itself or the spam folder for email, the wrong number or address, another way in (sign-in only), and, when the number or
 * address is gone for good, a request to the desk to move the account.
 */
export function CodeHelpBody({ about, contact, resendIn, onResend, onChange, flow, onLeave, channel = null, other: otherChannel = null, onSwitch }: {
  about: 'phone' | 'email';
  /** The number or address the code went to (E.164 or an email), for the recovery request. */
  contact: string;
  resendIn: number;
  onResend: () => void;
  onChange: () => void;
  flow: CodeFlow;
  /** Close the sheet before going somewhere else. */
  onLeave: () => void;
  /** A phone code's channel (WhatsApp or SMS), and the other one this server can send by. */
  channel?: PhoneChannel | null;
  other?: PhoneChannel | null;
  /** A new code by the other channel. */
  onSwitch?: () => void;
}) {
  const router = useRouter();
  const shown = useWayShown();
  const go = (fn: () => void) => { onLeave(); fn(); };
  const other = about === 'phone' ? 'email' : 'phone';
  return (
    <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10 }} keyboardShouldPersistTaps="handled">
      <T v="h2" accessibilityRole="header">{t('auth.help.title')}</T>
      <T v="body">{t('auth.help.body')}</T>
      <HelpRow icon={glyph('refund')} testID="help-resend"
        title={resendIn > 0 ? t('auth.help.resendIn', { time: mmss(resendIn) }) : t('auth.help.resend')}
        onPress={() => go(onResend)} disabled={resendIn > 0} />
      {otherChannel && onSwitch ? (
        <HelpRow icon={otherChannel === 'whatsapp' ? <WhatsAppMark size={18} /> : glyph('phone')} testID="help-switch-channel"
          title={resendIn > 0
            ? t(otherChannel === 'sms' ? 'auth.channel.useSmsIn' : 'auth.channel.useWhatsAppIn', { time: mmss(resendIn) })
            : t(otherChannel === 'sms' ? 'auth.channel.useSms' : 'auth.channel.useWhatsApp')}
          onPress={() => go(onSwitch)} disabled={resendIn > 0} />
      ) : null}
      {about === 'phone' && channel === 'whatsapp' ? (
        <HelpRow icon={<WhatsAppMark size={18} />} title={t('auth.help.whatsappTitle')} sub={t('auth.help.whatsappBody')} testID="help-whatsapp" />
      ) : null}
      {about === 'email' ? (
        <HelpRow icon={glyph('mail')} title={t('auth.help.spamTitle')} sub={t('auth.help.spamBody', { address: CODE_SENDER })} testID="help-spam" />
      ) : null}
      <HelpRow icon={glyph('edit')} title={about === 'phone' ? t('auth.help.changePhone') : t('auth.help.changeEmail')} onPress={() => go(onChange)} testID="help-change" />
      {flow === 'signin' ? (
        <>
          <T v="small" style={{ fontFamily: ff.ui600, marginTop: 6 }}>{t('auth.help.otherWay')}</T>
          {shown(other) ? <HelpRow icon={glyph(other === 'email' ? 'mail' : 'phone')} title={other === 'email' ? t('auth.help.useEmail') : t('auth.help.usePhone')} testID="help-other-code"
            onPress={() => go(() => { useOnboarding.getState().set({ via: other, social: null }); router.replace(other === 'email' ? '/email' : '/phone'); })} /> : null}
          {SHOW_APPLE && shown('apple') ? <HelpRow icon={<AppleMark size={18} color={colors.green} />} title={t('signin.apple')} testID="help-apple"
            onPress={() => go(() => router.replace({ pathname: '/signin', params: { with: 'apple' } }))} /> : null}
          {shown('google') ? <HelpRow icon={<GoogleMark size={18} />} title={t('signin.google')} testID="help-google"
            onPress={() => go(() => router.replace({ pathname: '/signin', params: { with: 'google' } }))} /> : null}
        </>
      ) : null}
      <HelpRow icon={glyph('user')} title={t('auth.help.lost')} sub={t('auth.help.lostSub')} testID="help-lost"
        onPress={() => go(() => router.push({ pathname: '/recover', params: flow === 'signin' ? { kind: about, value: contact } : {} }))} />
    </ScrollView>
  );
}

export function CodeHelpSheet({ visible, onClose, ...rest }: Omit<Parameters<typeof CodeHelpBody>[0], 'onLeave'> & { visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} label={t('auth.help.title')}>
      <CodeHelpBody {...rest} onLeave={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radii.card, backgroundColor: colors.mist },
  icon: { width: 34, height: 34, borderRadius: 12, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
});

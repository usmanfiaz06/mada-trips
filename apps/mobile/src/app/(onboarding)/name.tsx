import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, LinkButton } from '@/components/Button';
import { Field } from '@/components/Field';
import { Act, Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { t } from '@/lib/i18n';
import { AUTO_FOCUS } from '@/lib/config';
import { useOnboarding } from '@/lib/onboarding';
import { useUpdateMe } from '@/lib/queries';
import { toast } from '@/lib/toast';

/** "What should we call you?" Skip is fine. Apple and Google prefill it (FLOWS.md §1). */
export default function Name() {
  const router = useRouter();
  const suggested = useOnboarding((s) => s.suggestedName);
  const [nick, setNick] = useState(suggested);
  const update = useUpdateMe();
  const first = nick.trim().split(/\s+/)[0] ?? '';

  const go = async (skip = false) => {
    if (!skip && nick.trim()) {
      try { await update.mutateAsync({ name: nick.trim().slice(0, 30) }); } catch { toast(t('error.internal')); return; }
    }
    router.push('/alerts');
  };

  return (
    <Screen>
      <TopBar onBack={() => router.back()} right={<View style={{ paddingHorizontal: 4 }}><LinkButton label={t('common.skip')} size={15} onPress={() => go(true)} /></View>} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 24, gap: 16 }}>
          <T v="h1" accessibilityRole="header">{t('name.title')}</T>
          <T v="body">{t('name.body')}</T>
          <Field label={t('name.label')} value={nick} onChangeText={setNick} autoCapitalize="words" autoComplete="given-name" textContentType="givenName"
            maxLength={30} autoFocus={AUTO_FOCUS} placeholder={suggested} returnKeyType="next" onSubmitEditing={() => go()} testID="name-input" />
        </View>
        <Act>
          <Button label={first ? t('name.goNamed', { name: first }) : t('name.go')} busy={update.isPending} onPress={() => go()} testID="name-go" />
        </Act>
      </KeyboardAvoidingView>
    </Screen>
  );
}

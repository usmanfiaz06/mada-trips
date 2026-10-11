import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { inviteCodeIn } from '@mada/shared';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Act, Screen, TopBar } from '@/components/Layout';
import { T } from '@/components/Text';
import { buzz } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { colors } from '@/theme';

/**
 * "Got an invite code?" For someone who installed the app from an invite page: paste the link or the code and see
 * the invite (its preview first; joining asks to sign in). On iOS 16+ the system Paste button reads the clipboard
 * without a prompt, because the tap is the permission; elsewhere "Paste" asks the system first.
 */
export default function InviteCode() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const open = (value: string) => {
    const code = inviteCodeIn(value);
    if (!code) { buzz('soft'); setProblem(t('circles.code.notCode')); return; }
    buzz('success');
    router.replace(`/join/${code}`);
  };
  const pasted = (value: string | null | undefined) => {
    if (!value?.trim()) { setProblem(t('circles.code.empty')); return; }
    setText(value.trim());
    setProblem(null);
    if (inviteCodeIn(value)) open(value);
  };
  const paste = async () => {
    try { pasted(await Clipboard.getStringAsync()); } catch { setProblem(t('circles.code.empty')); }
  };

  return (
    <Screen>
      <TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 24, gap: 16 }}>
          <T v="h1" accessibilityRole="header">{t('circles.code.title')}</T>
          <T v="body">{t('circles.code.body')}</T>
          <Field
            label={t('circles.code.placeholder')} value={text} onChangeText={(v) => { setText(v); setProblem(null); }}
            autoCapitalize="none" autoCorrect={false} autoComplete="off" placeholder="abcd2345-efgh67" error={problem}
            onSubmitEditing={() => open(text)} returnKeyType="go" testID="invite-code-input"
          />
          {Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable ? (
            <Clipboard.ClipboardPasteButton
              onPress={(d) => pasted(d.type === 'text' ? d.text : null)} acceptedContentTypes={['plain-text', 'url']}
              backgroundColor={colors.paper} foregroundColor={colors.green} cornerStyle="capsule" displayMode="iconAndLabel"
              style={{ height: 44, width: 120 }}
            />
          ) : Platform.OS !== 'web' ? (
            <View style={{ flexDirection: 'row' }}><Button size="small" block={false} variant="secondary" label={t('circles.code.paste')} onPress={paste} testID="invite-code-paste" /></View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
      <Act><Button label={t('circles.code.go')} onPress={() => open(text)} disabled={!text.trim()} testID="invite-code-go" /></Act>
    </Screen>
  );
}

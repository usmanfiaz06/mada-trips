import { forwardRef, useState } from 'react';
import { View, type TextInput, type TextInputProps } from 'react-native';
import { passwordChecks } from '@mada/shared';
import { LinkButton } from '@/components/Button';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { T } from '@/components/Text';
import { t } from '@/lib/i18n';
import { colors } from '@/theme';

/**
 * A password, hidden until "Show". `fresh` is for choosing a new one (password managers offer to make one); otherwise
 * it signs in (they offer the saved one). Never auto-corrected or capitalised.
 */
export const PasswordField = forwardRef<TextInput, Omit<TextInputProps, 'secureTextEntry'> & { label: string; error?: string | null; fresh?: boolean }>(
  function PasswordField({ label, error, fresh, ...rest }, ref) {
    const [shown, setShown] = useState(false);
    return (
      <Field
        ref={ref} label={label} error={error} secureTextEntry={!shown} autoCapitalize="none" autoCorrect={false} spellCheck={false}
        autoComplete={fresh ? 'new-password' : 'current-password'} textContentType={fresh ? 'newPassword' : 'password'}
        passwordRules={fresh ? 'minlength: 8; required: lower; required: upper; required: digit; required: special;' : undefined}
        {...rest}
        hint={(
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <LinkButton label={shown ? t('auth.password.hide') : t('auth.password.show')} onPress={() => setShown((v) => !v)} />
          </View>
        )}
      />
    );
  },
);

/** Supabase's rules (PASSWORD_RULES in @mada/shared), ticking as they're met. */
export function PasswordRules({ value }: { value: string }) {
  return (
    <View style={{ gap: 6 }} testID="password-rules" accessibilityLabel={t('auth.password.rules')}>
      <T v="small" color={colors.ink3}>{t('auth.password.rules')}</T>
      {passwordChecks(value).map((c) => (
        <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          accessible accessibilityLabel={`${t(c.copy)}. ${c.ok ? t('auth.password.rule.done') : t('auth.password.rule.todo')}`} testID={`rule-${c.id}-${c.ok ? 'ok' : 'todo'}`}>
          <View style={{ width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.ok ? colors.green : 'transparent', borderWidth: c.ok ? 0 : 1.5, borderColor: colors.line }}>
            {c.ok ? <Icon name="check" size={13} color={colors.mist} width={2.4} /> : null}
          </View>
          <T v="small" color={c.ok ? colors.green : colors.ink3}>{t(c.copy)}</T>
        </View>
      ))}
    </View>
  );
}

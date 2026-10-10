import { forwardRef, type ReactNode } from 'react';
import { Platform, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { colors, font, radii, sizes, ff } from '@/theme';
import { T } from './Text';

const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
/** A web input has an intrinsic width from its font (wider in Arabic) that can push a bubble or card wider than the screen. */
const webFill = Platform.OS === 'web' ? { width: '100%' as const } : null;

/** A labelled input. Problems show under it in calm words, never red alarms (COPY.md §5.6). */
export const Field = forwardRef<TextInput, TextInputProps & { label: string; error?: string | null; hint?: ReactNode; bad?: boolean; prefix?: string; big?: boolean }>(
  function Field({ label, error, hint, bad, prefix, big, style, ...input }, ref) {
    const field = (
      <TextInput
        ref={ref}
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        {...input}
        style={[styles.input, font('body', colors.green), { fontSize: 17 }, big ? styles.otp : null, (bad || error) ? styles.bad : null, webNoOutline, webFill, prefix ? { flex: 1, minWidth: 0, width: Platform.OS === 'web' ? 0 : undefined } : null, style]}
      />
    );
    return (
      <View style={styles.field}>
        <T v="small" style={{ fontFamily: ff.ui600 }}>{label}</T>
        {prefix ? (
          <View style={styles.row}>
            <View style={[styles.input, styles.prefix]}><T v="body" color={colors.green} style={{ fontSize: 17 }}>{prefix}</T></View>
            {field}
          </View>
        ) : field}
        {error ? <T v="small" color={colors.badInk} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</T> : null}
        {hint}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  field: { gap: 6 },
  row: { flexDirection: 'row', gap: 10 },
  input: { height: sizes.input, borderRadius: radii.input, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, paddingHorizontal: 16 },
  prefix: { width: 92, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 0 },
  otp: { height: sizes.otp, textAlign: 'center', fontSize: 26, letterSpacing: 13, fontFamily: ff.ui600, fontVariant: ['tabular-nums'] },
  bad: { borderColor: colors.bad },
});

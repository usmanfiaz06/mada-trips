import * as AppleAuthentication from 'expo-apple-authentication';
import { sizes } from '@/theme';

/** Apple's own button, as the App Store asks: black, "Continue with Apple", the system's words and logo. */
export function AppleButton({ onPress }: { onPress: () => void; busy?: boolean }) {
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={sizes.button / 2}
      style={{ width: '100%', height: sizes.button }}
      onPress={onPress}
      testID="signin-apple"
    />
  );
}

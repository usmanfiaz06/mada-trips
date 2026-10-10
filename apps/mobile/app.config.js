// Extends app.json. Google Sign-In's native SDK needs the iOS client id's reversed form as a URL scheme, known only
// once the Google Cloud project exists (docs/app/AUTH.md): set EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID before a native build.
module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!iosClientId) return config;
  const iosUrlScheme = `com.googleusercontent.apps.${iosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}`;
  return { ...config, plugins: [...(config.plugins ?? []), ['@react-native-google-signin/google-signin', { iosUrlScheme }]] };
};

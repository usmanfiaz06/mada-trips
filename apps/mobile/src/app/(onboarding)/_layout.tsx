import { Redirect, Stack, useSegments } from 'expo-router';
import { useSession } from '@/lib/session';
import { colors } from '@/theme';

/** First open: welcome → sign in → phone → code → name → alerts → Today (FLOWS.md §1). */
export default function OnboardingLayout() {
  const status = useSession((s) => s.status);
  const user = useSession((s) => s.user);
  const segments = useSegments();
  const leaf = segments[segments.length - 1];
  // A finished account that reopens the app never sees onboarding again.
  if (status === 'signedIn' && user?.onboardedAt && (leaf === 'welcome' || leaf === 'signin')) return <Redirect href="/today" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.sand }, animation: 'slide_from_right' }} />;
}

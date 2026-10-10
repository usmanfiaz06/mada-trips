import { Stack } from 'expo-router';
import { colors } from '@/theme';

/** Add a passport: intro, camera, confirm (prototype Onboarding passport steps, used later as "Add your passport"). */
export default function PassportLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.sand }, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="camera" options={{ contentStyle: { backgroundColor: '#0b100d' }, animation: 'fade' }} />
      <Stack.Screen name="confirm" />
    </Stack>
  );
}

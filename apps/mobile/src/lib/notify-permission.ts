import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Ask for notifications the way the platform does it: the system prompt on a phone, the browser's prompt on the web.
 * Browsers without notifications (iPhone Safari outside a home-screen app) answer 'declined' without a prompt.
 */
export async function askNotifications(): Promise<'allowed' | 'declined'> {
  if (Platform.OS === 'web') {
    const N = typeof window !== 'undefined' ? (window as unknown as { Notification?: { permission: string; requestPermission: () => Promise<string> } }).Notification : undefined;
    if (!N) return 'declined';
    if (N.permission === 'granted') return 'allowed';
    if (N.permission === 'denied') return 'declined';
    return (await N.requestPermission()) === 'granted' ? 'allowed' : 'declined';
  }
  return (await Notifications.requestPermissionsAsync()).granted ? 'allowed' : 'declined';
}

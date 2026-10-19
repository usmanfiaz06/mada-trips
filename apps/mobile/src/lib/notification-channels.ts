import { Platform } from 'react-native';
import { t } from '@/lib/i18n';

/**
 * Android's notification channels: the server names one on every push (platform/src/lib/app/push.ts PushChannel), so
 * people can silence offers in Settings without losing a gate change. Created on launch, renamed when the language
 * changes (the app restarts then). The flight pinned in the shade has its own quiet channel (live-activity.ts).
 */
export const CHANNELS = ['trip-updates', 'messages', 'offers'] as const;
export type ChannelId = (typeof CHANNELS)[number];

export async function setUpNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const N = await import('expo-notifications');
    const I = N.AndroidImportance;
    await Promise.all([
      N.setNotificationChannelAsync('trip-updates', { name: t('channel.trips'), description: t('channel.trips.sub'), importance: I.HIGH, vibrationPattern: [0, 250, 150, 250], lightColor: '#1e352d', lockscreenVisibility: N.AndroidNotificationVisibility.PUBLIC, sound: 'default' }),
      N.setNotificationChannelAsync('messages', { name: t('channel.messages'), description: t('channel.messages.sub'), importance: I.DEFAULT, sound: 'default', lockscreenVisibility: N.AndroidNotificationVisibility.PRIVATE }),
      N.setNotificationChannelAsync('offers', { name: t('channel.offers'), description: t('channel.offers.sub'), importance: I.LOW, sound: null, vibrationPattern: null, showBadge: false }),
    ]);
    // The channel expo-notifications made before these existed: one list of channels in Settings, not two.
    await N.deleteNotificationChannelAsync('default').catch(() => {});
  } catch { /* no notifications module (Expo Go, tests): the system's fallback channel takes them */ }
}

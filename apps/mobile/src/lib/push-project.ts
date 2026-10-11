import Constants from 'expo-constants';

/**
 * The Expo project id that push tokens belong to (app.config.js puts it in extra.eas.projectId from `eas init`).
 * getExpoPushTokenAsync needs it in a standalone build; without it (a local build before `eas init`) there is no
 * token, and registerForPush quietly tries again next launch.
 */
export function pushProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

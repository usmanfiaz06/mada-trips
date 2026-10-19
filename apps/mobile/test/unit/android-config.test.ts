import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_LINK_PATHS } from '@mada/shared';

// The Android half of the store build (docs/app/ANDROID.md): what app.json and app.config.js hand to prebuild.
const require = createRequire(import.meta.url);
const appJson = require('../../app.json').expo;
const eas = require('../../eas.json');
const resolve = () => require('../../app.config.js')({ config: structuredClone(appJson) });

describe('Android config', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('package, verified app links for every shared path, RTL', () => {
    expect(appJson.android.package).toBe('sa.madatrips.app');
    const verified = appJson.android.intentFilters.filter((f: { autoVerify?: boolean }) => f.autoVerify)
      .flatMap((f: { data: { scheme: string; host: string; pathPrefix: string }[] }) => f.data)
      .filter((d: { scheme: string; host: string }) => d.scheme === 'https' && d.host === 'madatrips.sa').map((d: { pathPrefix: string }) => d.pathPrefix);
    expect(verified.sort()).toEqual([...APP_LINK_PATHS].sort());
    const loc = appJson.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-localization');
    expect(loc[1].supportsRTL).toBe(true);
  });

  it('asks only for what the app uses: mic (voice), approximate location (distance), never fine or background', () => {
    const { permissions, blockedPermissions } = appJson.android;
    for (const p of ['CAMERA', 'RECORD_AUDIO', 'ACCESS_COARSE_LOCATION', 'POST_NOTIFICATIONS']) {
      expect(permissions).toContain(`android.permission.${p}`);
      expect(blockedPermissions).not.toContain(`android.permission.${p}`);
    }
    for (const p of ['ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'READ_MEDIA_IMAGES', 'WRITE_SETTINGS', 'SYSTEM_ALERT_WINDOW'])
      expect(blockedPermissions).toContain(`android.permission.${p}`);
  });

  it('pushes default to the Trip updates channel the server names', () => {
    const n = appJson.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-notifications');
    expect(n[1].defaultChannel).toBe('trip-updates');
  });

  it('google-services.json from the EAS file variable; a build without it still resolves', () => {
    vi.stubEnv('GOOGLE_SERVICES_JSON', '');
    vi.stubEnv('GOOGLE_MAPS_ANDROID_API_KEY', '');
    const bare = resolve();
    expect(bare.android.googleServicesFile).toBeUndefined();
    expect(bare.extra.pushAndroid).toBe(false);
    expect(bare.android.config?.googleMaps).toBeUndefined();

    const file = join(mkdtempSync(join(tmpdir(), 'gs-')), 'google-services.json');
    writeFileSync(file, '{}');
    vi.stubEnv('GOOGLE_SERVICES_JSON', file);
    vi.stubEnv('GOOGLE_MAPS_ANDROID_API_KEY', 'test-key');
    const full = resolve();
    expect(full.android.googleServicesFile).toBe(file);
    expect(full.android.config.googleMaps.apiKey).toBe('test-key');
    expect(full.android.package).toBe('sa.madatrips.app'); // the maps key keeps what came before it

    vi.stubEnv('GOOGLE_SERVICES_JSON', '/nowhere/google-services.json');
    expect(resolve().android.googleServicesFile).toBeUndefined();
  });

  it('eas.json: an APK for testers, an AAB on the production channel to the internal track', () => {
    expect(eas.build.preview).toMatchObject({ distribution: 'internal', android: { buildType: 'apk' } });
    expect(eas.build.production).toMatchObject({ channel: 'production', autoIncrement: true, environment: 'production', android: { buildType: 'app-bundle' } });
    expect(eas.build.production.env).toMatchObject({ EXPO_PUBLIC_API_MODE: 'live', EXPO_PUBLIC_API_URL: 'https://madatrips.sa' });
    expect(eas.submit.production.android.track).toBe('internal');
  });
});

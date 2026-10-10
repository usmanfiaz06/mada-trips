import { RESILIENCE_ROUTES, type ConfigResponse, type StatusResponse } from '@mada/shared';
import type { AreaMock } from '../mock-api';

/*
 * Mock answers for GET /config and GET /status (platform/src/app/api/app/v1/{config,status}). Everything up, no
 * maintenance, nobody forced to update. The e2e (test/e2e-resilience.mjs) overrides these with page.route.
 */
export const resilienceMock: AreaMock = async (w) => {
  if (w.method !== 'GET') return null;
  const path = w.path.split('?')[0];
  if (path === RESILIENCE_ROUTES.config) {
    const body: ConfigResponse = {
      minVersion: '0.0.0', latestVersion: '0.1.0', maintenance: { on: false, message: null, until: null },
      features: { offlineOutbox: true, statusChecks: true, softUpdatePrompt: true }, serverTime: new Date().toISOString(),
      storeUrls: { ios: 'https://apps.apple.com/app/mada-trips', android: 'https://play.google.com/store/apps/details?id=sa.madatrips.app' },
    };
    return { status: 200, json: body };
  }
  if (path === RESILIENCE_ROUTES.status) {
    const body: StatusResponse = { status: 'ok', degraded: [], maintenance: { on: false, message: null, until: null }, time: new Date().toISOString() };
    return { status: 200, json: body };
  }
  return null;
};

import { create } from 'zustand';
import { compareVersions, type ConfigResponse, type Maintenance } from '@mada/shared';

/*
 * App-wide conditions the API client discovers and the root layout acts on. Pure state, no network (so api.ts can
 * import it without a cycle). lib/net/remote.ts fills `config` from GET /config.
 *
 *   update        this version is below minVersion (a 426, or /config said so): the update screen
 *   updateReady   a newer version exists: one quiet line, once
 *   maintenance   planned maintenance (a 503 MAINTENANCE, or /config): the maintenance screen, then a banner
 *   expired       the session ended and couldn't refresh: the sign-in-again sheet over whatever is on screen
 *   busyUntil     the server asked us to wait (429 / Retry-After): "Trying again in N seconds"
 */

export type Gates = {
  config: ConfigResponse | null;
  configAt: number | null;
  update: { minVersion: string | null } | null;
  /** The update screen was set aside ("Open my trips"): saved trips still open, the banner-free way. */
  updateSetAside: boolean;
  updateReady: boolean;
  maintenance: Maintenance | null;
  /** The maintenance screen was seen and set aside ("Open my trips"); the banner stays. */
  maintenanceDismissed: boolean;
  expired: boolean;
  busyUntil: number | null;
};

export const useGates = create<Gates>(() => ({
  config: null, configAt: null, update: null, updateSetAside: false, updateReady: false, maintenance: null, maintenanceDismissed: false, expired: false, busyUntil: null,
}));

let appVersion = '0.0.0';
export const setAppVersion = (v: string | null | undefined) => { if (v) appVersion = v; };
export const getAppVersion = () => appVersion;

export function applyConfig(c: ConfigResponse, at = Date.now()) {
  const below = compareVersions(appVersion, c.minVersion) < 0;
  const older = compareVersions(appVersion, c.latestVersion) < 0;
  const m = c.maintenance.on ? c.maintenance : null;
  useGates.setState((s) => ({
    config: c, configAt: at,
    update: below ? { minVersion: c.minVersion } : null,
    updateReady: !below && older && c.features.softUpdatePrompt !== false,
    maintenance: m,
    maintenanceDismissed: m ? s.maintenanceDismissed : false,
  }));
}

export function noteUpgradeRequired(minVersion?: unknown) {
  useGates.setState({ update: { minVersion: typeof minVersion === 'string' ? minVersion : null } });
}

export function noteMaintenance(m: { message?: string | null; until?: string | null }) {
  useGates.setState((s) => ({ maintenance: { on: true, message: m.message ?? s.maintenance?.message ?? null, until: m.until ?? s.maintenance?.until ?? null } }));
}

export const setAsideUpdate = () => useGates.setState({ updateSetAside: true });
export const endMaintenance = () => useGates.setState({ maintenance: null, maintenanceDismissed: false });
export const dismissMaintenance = () => useGates.setState({ maintenanceDismissed: true });

export const noteSessionExpired = () => useGates.setState({ expired: true });
export const clearSessionExpired = () => useGates.setState({ expired: false });

export function noteBusy(seconds: number) {
  useGates.setState({ busyUntil: Date.now() + Math.max(1, seconds) * 1000 });
}

/** A feature switch from /config; `fallback` until /config has answered. */
export function useFeature(name: string, fallback = true): boolean {
  return useGates((s) => s.config?.features[name] ?? fallback);
}

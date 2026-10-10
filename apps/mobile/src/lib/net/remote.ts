import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ConfigResponse, RESILIENCE_ROUTES, StatusResponse, type SupplierHealth } from '@mada/shared';
import { request, transport } from '../api';
import { applyConfig, endMaintenance, useGates } from './gates';
import { kvReadJson, kvWriteJson } from './kv';
import { setProbe } from './state';

/*
 * GET /config (versions, maintenance, feature switches) at launch, when the app comes back to the foreground, and
 * every 10 minutes; the last answer is kept on the phone so an offline launch still knows the switches.
 * GET /status (suppliers that aren't answering) for screens that want to say so before the traveller tries.
 */

const CONFIG_KEY = 'mada.config.v1';
const EVERY = 10 * 60_000;

export async function loadConfig(): Promise<ConfigResponse | null> {
  try {
    const c = await request({ method: 'GET', path: RESILIENCE_ROUTES.config, auth: false, retries: 1 }, ConfigResponse);
    const was = useGates.getState().maintenance;
    applyConfig(c);
    if (was && !c.maintenance.on) endMaintenance();
    void kvWriteJson(CONFIG_KEY, { at: Date.now(), config: c });
    return c;
  } catch {
    return null;
  }
}

/** The last /config this phone saw (used until the network answers). */
export async function restoreConfig() {
  const saved = await kvReadJson<{ at: number; config: unknown }>(CONFIG_KEY);
  const c = ConfigResponse.safeParse(saved?.config);
  if (c.success && !useGates.getState().config) applyConfig(c.data, saved!.at);
}

/** Keeps /config fresh. Mount once, in the root layout. */
export function useRemoteConfig() {
  useEffect(() => {
    // The reachability probe: any answer from our server means we're back.
    setProbe(async () => {
      try { await transport({ method: 'GET', path: RESILIENCE_ROUTES.config, timeoutMs: 5000 }); return true; } catch { return false; }
    });
    void restoreConfig().then(loadConfig);
    const id = setInterval(() => void loadConfig(), EVERY);
    const sub = AppState.addEventListener('change', (s) => {
      const at = useGates.getState().configAt ?? 0;
      if (s === 'active' && Date.now() - at > 60_000) void loadConfig();
    });
    return () => { clearInterval(id); sub.remove(); };
  }, []);
}

/** Suppliers that are slow or not answering right now (GET /status, cached a minute). Empty when all is well or unknown. */
export function useSupplierStatus(enabled = true): { degraded: SupplierHealth[]; down: (name: string) => SupplierHealth | null } {
  const q = useQuery({
    queryKey: ['net', 'status'],
    enabled: enabled && useGates.getState().config?.features.statusChecks !== false,
    staleTime: 60_000,
    queryFn: ({ signal }) => request({ method: 'GET', path: RESILIENCE_ROUTES.status, auth: false, signal, retries: 0 }, StatusResponse),
  });
  const degraded = q.data?.degraded ?? [];
  return { degraded, down: (name) => degraded.find((d) => d.name === name && d.state === 'down') ?? null };
}

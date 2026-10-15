import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { z } from 'zod';
import { t } from './i18n';
import { kvGet, kvSet, useTrip, useTrips } from './trips';
import { usePresence } from './wallet';

/*
 * The person on duty (COPY.md §1 "Mada and Faisal: one rule everywhere"). Mada is who you talk to; a person's name
 * appears only as presence or when that person acted, and only when the server names them: the trip's `agent`, or
 * the desk's /support/presence. Nobody is invented on the phone: with no one assigned the UI says Mada, with the
 * Mada mark in place of a face.
 */

export type AgentOnDuty = { name: string; initial: string; online: boolean };

/** The agent on duty for the trip Today is about, else the person the desk's presence names; null when no one is assigned. */
export function useAgent(): AgentOnDuty | null {
  const list = useTrips();
  const id = list.data?.currentId ?? list.data?.upcoming[0]?.id ?? null;
  const trip = useTrip(id);
  const presence = usePresence();
  const a = trip.data?.trip.agent;
  if (a) return { name: a.covering?.name ?? a.name, initial: a.covering?.initial ?? a.initial, online: a.online };
  const p = presence.data;
  if (p?.agent) return { name: p.agent.name, initial: p.agent.initial, online: p.online };
  return null;
}

/** The name a line about who is acting uses: the person on duty, or Mada when nobody is assigned yet. */
export const agentName = (agent: { name: string } | null | undefined): string => agent?.name ?? t('presence.title');

/* ───────── introducing the person once ───────── */

const MET_KEY = 'mada.agents.met.v1';
const Names = z.array(z.string());

function readMetSync(): string[] | null {
  if (Platform.OS !== 'web') return null;
  try { const v = globalThis.localStorage?.getItem(MET_KEY); return v ? Names.parse(JSON.parse(v)) : []; } catch { return []; }
}

type Met = { names: string[]; loaded: boolean; met: (name: string) => void };
/** The agents this phone has already been introduced to ("Faisal, your Mada agent" is said once; after that, just the name). */
export const useMet = create<Met>((set, get) => {
  const sync = readMetSync();
  return {
    names: sync ?? [],
    loaded: sync !== null,
    met(name) {
      if (get().names.includes(name)) return;
      const names = [...get().names, name];
      set({ names });
      void kvSet(MET_KEY, JSON.stringify(names));
    },
  };
});
if (!useMet.getState().loaded) {
  void kvGet(MET_KEY).then((v) => {
    let names: string[] = [];
    try { names = v ? Names.parse(JSON.parse(v)) : []; } catch { /* a bad file: introduce again */ }
    useMet.setState((s) => ({ names: [...new Set([...s.names, ...names])], loaded: true }));
  });
}

/**
 * The label beside an agent's face: "Faisal, your Mada agent" the first time this phone meets them, then just "Faisal".
 * With no agent: "Mada". The row that does the introducing keeps the long form until it leaves the screen.
 */
export function useAgentLabel(agent: { name: string } | null | undefined): { label: string; intro: boolean } {
  const name = agent?.name ?? null;
  const loaded = useMet((s) => s.loaded);
  // Decided when the row mounts, from the people already met (known at once on the web; on a phone the file is read
  // before the first trip screen has its data). The decision holds for as long as the row is on screen.
  const [intro] = useState<boolean>(() => { const s = useMet.getState(); return !!name && s.loaded && !s.names.includes(name); });
  useEffect(() => { if (name && loaded) useMet.getState().met(name); }, [name, loaded]);
  if (!name) return { label: t('presence.title'), intro: false };
  return intro ? { label: t('actor.intro', { agent: name }), intro: true } : { label: name, intro: false };
}

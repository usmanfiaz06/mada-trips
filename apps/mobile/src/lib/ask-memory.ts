import { useQueryClient } from '@tanstack/react-query';
import { ASK_MEMORY_ROUTE, MemoryResponse, type MemoryFact } from '@mada/shared';
import { useApiQuery } from '@/lib/net/hooks';
import { request } from './api';
import { useSession } from './session';
import { homeFromText, type HomeCode } from './today-ideas';
import { useAccount } from './wallet';

/*
 * What Mada remembers (docs/app/ASK-CHAT.md §7): the small lasting things the traveller told Ask, listed in Account,
 * each removable, or all at once. GET /ask/memory, DELETE /ask/memory/{id}, DELETE /ask/memory.
 */

export const memoryKey = ['ask', 'memory'] as const;

export const memoryApi = {
  list: () => request({ method: 'GET', path: ASK_MEMORY_ROUTE }, MemoryResponse),
  forget: (id: string) => request({ method: 'DELETE', path: `${ASK_MEMORY_ROUTE}/${id}` }, MemoryResponse),
  forgetAll: () => request({ method: 'DELETE', path: ASK_MEMORY_ROUTE }, MemoryResponse),
};

export const useMemory = () => useApiQuery({
  queryKey: memoryKey, enabled: useSession((s) => s.status) === 'signedIn', refetchOnMount: 'always',
  queryFn: async () => (await memoryApi.list()).facts,
});

/** Remove one, or everything; the list on screen follows the server's answer. */
export function useForget() {
  const qc = useQueryClient();
  return {
    one: async (id: string) => { const r = await memoryApi.forget(id); qc.setQueryData<MemoryFact[]>(memoryKey, r.facts); },
    all: async () => { await memoryApi.forgetAll(); qc.setQueryData<MemoryFact[]>(memoryKey, []); },
  };
}

/**
 * Where a flight search leaves from when nobody said (ASK-INTEGRATED §3.8, U9 memory → origin): the home airport Mada
 * remembers, else the one set in Account. Null until either is known (the caller keeps Riyadh).
 */
export function useHomeAirport(): HomeCode | null {
  const memory = useMemory();
  const account = useAccount();
  const fact = memory.data?.find((f) => f.kind === 'home_airport');
  const remembered = homeFromText(fact?.text);
  if (remembered) return remembered;
  const set = account.data?.home;
  return set === 'RUH' || set === 'JED' || set === 'DMM' ? set : null;
}

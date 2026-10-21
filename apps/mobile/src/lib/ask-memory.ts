import { useQueryClient } from '@tanstack/react-query';
import { ASK_MEMORY_ROUTE, MemoryResponse, type MemoryFact } from '@mada/shared';
import { useApiQuery } from '@/lib/net/hooks';
import { request } from './api';
import { useSession } from './session';

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

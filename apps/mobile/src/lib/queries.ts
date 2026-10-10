import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateMeRequest } from '@mada/shared';
import { ApiError, api } from './api';
import './circles-join'; // Circles: resume joining from an invite link after sign-up
import { useSession } from './session';

/*
 * Server state lives in React Query. The API client (api.ts) already retries what can be retried (network trouble and
 * 5xx on GETs, with backoff) and refreshes tokens, so an ApiError reaching React Query is final: no second layer of
 * retries. Queries pause while offline (net/state.ts drives onlineManager) and refetch on reconnect; mutations run
 * regardless and fail fast with OFFLINE, so a button never spins forever. Data is kept a day in memory, and the
 * offline copy (net/persist.ts) keeps what travel needs for longer.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 60 * 60_000,
      retry: (n, e) => !(e instanceof ApiError) && n < 2,
      refetchOnReconnect: true,
    },
    mutations: { retry: false, networkMode: 'always' },
  },
});

export const keys = { me: ['me'] as const, people: ['people'] as const };

export function useMe() {
  const status = useSession((s) => s.status);
  return useQuery({
    queryKey: keys.me,
    enabled: status === 'signedIn',
    queryFn: async () => {
      const { user } = await api.me();
      useSession.getState().setUser(user);
      return user;
    },
  });
}

export function usePeople() {
  const status = useSession((s) => s.status);
  return useQuery({ queryKey: keys.people, enabled: status === 'signedIn', queryFn: async () => (await api.people()).people });
}

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateMeRequest) => api.updateMe(patch),
    onSuccess: ({ user }) => { qc.setQueryData(keys.me, user); useSession.getState().setUser(user); },
  });
}

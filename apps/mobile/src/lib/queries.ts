import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateMeRequest } from '@mada/shared';
import { ApiError, api } from './api';
import './circles-join'; // Circles: resume joining from an invite link after sign-up
import { useSession } from './session';

/** Server state lives in React Query; never retry what the server refused on purpose (4xx). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
    mutations: { retry: false },
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

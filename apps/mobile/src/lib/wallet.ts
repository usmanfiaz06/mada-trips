import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  API_PREFIX, AccountResponse, CardsResponse, CodeSentResponse, ConsentsResponse, CreditResponse, DeletionResponse, DevicesResponse,
  DocumentGrantResponse, DocumentResponse, DocumentsResponse, ExportResponse, MeResponse, MoveCreditResponse, Notification, PeopleResponse,
  PersonDetailResponse, PresenceResponse, SendSupportMessageResponse, SupportThreadResponse, SupportUnreadResponse, Trip, walletPath,
  type AddCardRequest, type CreateDocumentMeta, type CreatePersonRequest, type SavePassportRequest, type SendSupportMessageRequest,
  type UpdateAccountRequest, type UpdatePersonRequest,
} from '@mada/shared';
import { ApiError, request, transport, refreshSession } from './api';
import { API_MODE, API_ORIGIN } from './config';
import { keys as coreKeys } from './queries';
import { useSession } from './session';
import { t } from './i18n';

/*
 * The Wallet's client: documents, the household, passports, account, cards, credit, support and the inbox.
 * JSON calls go through the shared `request` (schema-checked, refreshing). Uploads are multipart, straight to the
 * Core API (or the in-app mock), and never leave a copy anywhere else.
 */

const P = walletPath;
const Ok = z.object({ ok: z.literal(true) });

/** A file picked on the phone: a local uri (native) or a File/Blob (web). */
export type PickedFile = { uri: string; name: string; type: string; size: number; file?: Blob | null };

async function multipart<S extends z.ZodType>(method: 'POST' | 'PUT', path: string, file: PickedFile, meta: unknown, schema: S): Promise<z.infer<S>> {
  if (API_MODE === 'mock') {
    const r = await transport({ method, path, body: { __file: { name: file.name, type: file.type, size: file.size, uri: file.uri }, meta }, token: useSession.getState().tokens?.accessToken });
    if (r.status >= 400) {
      const e = (r.json as { error?: { code?: string; message?: string; fields?: Record<string, string> } }).error;
      throw new ApiError((e?.code ?? 'INTERNAL') as never, e?.message ?? t('error.internal'), r.status, { fields: e?.fields });
    }
    return schema.parse(r.json);
  }
  const send = async () => {
    const fd = new FormData();
    if (file.file) fd.append('file', file.file, file.name);
    // React Native's FormData takes { uri, name, type } for a local file.
    else fd.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
    if (meta !== undefined) fd.append('meta', JSON.stringify(meta));
    const token = useSession.getState().tokens?.accessToken;
    try {
      return await fetch(`${API_ORIGIN}${API_PREFIX}${path}`, { method, body: fd, headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : null) } });
    } catch {
      throw new ApiError('OFFLINE', t('error.offline'), 0);
    }
  };
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  const json = await res.json().catch(() => null) as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null;
  if (res.status >= 400) throw new ApiError((json?.error?.code ?? 'INTERNAL') as never, json?.error?.message ?? t('error.internal'), res.status, { fields: json?.error?.fields });
  return schema.parse(json);
}

/** A protected file's URL plus the header to send with it (for expo-image / a download). */
export function fileSource(path: string): { uri: string; headers: Record<string, string> } {
  const token = useSession.getState().tokens?.accessToken;
  return { uri: `${API_ORIGIN}${API_PREFIX}${path}`, headers: token ? { Authorization: `Bearer ${token}` } : {} };
}

const TripsLoose = z.object({ trips: z.array(z.unknown()) });

export const walletApi = {
  documents: (personId?: string) => request({ method: 'GET', path: `${P('documents')}${personId ? `?personId=${personId}` : ''}` }, DocumentsResponse),
  addDocument: (meta: CreateDocumentMeta, file: PickedFile | null) => (file
    ? multipart('POST', P('documents'), file, meta, DocumentResponse)
    : request({ method: 'POST', path: P('documents'), body: meta }, DocumentResponse)),
  deleteDocument: (id: string) => request({ method: 'DELETE', path: P('document', { id }) }, Ok),
  shareDocument: (id: string, tripId?: string) => request({ method: 'POST', path: P('documentShare', { id }), body: tripId ? { tripId } : {} }, DocumentGrantResponse),
  unshareDocument: (id: string) => request({ method: 'DELETE', path: P('documentShare', { id }) }, Ok),
  person: (id: string) => request({ method: 'GET', path: P('person', { id }) }, PersonDetailResponse),
  updatePerson: (id: string, patch: UpdatePersonRequest) => request({ method: 'PATCH', path: P('person', { id }), body: patch }, PersonDetailResponse),
  removePerson: (id: string) => request({ method: 'DELETE', path: P('person', { id }) }, Ok),
  addPerson: (p: CreatePersonRequest) => request({ method: 'POST', path: '/people', body: p }, z.object({ person: PeopleResponse.shape.people.element })),
  savePassport: (personId: string | 'self', input: SavePassportRequest) => request({ method: 'PUT', path: personId === 'self' ? P('passport') : P('personPassport', { id: personId }), body: input }, PersonDetailResponse),
  account: () => request({ method: 'GET', path: P('account') }, AccountResponse),
  updateAccount: (patch: UpdateAccountRequest) => request({ method: 'PATCH', path: P('account'), body: patch }, AccountResponse),
  setPhoto: (file: PickedFile) => multipart('PUT', P('accountPhoto'), file, undefined, AccountResponse),
  removePhoto: () => request({ method: 'DELETE', path: P('accountPhoto') }, AccountResponse),
  devices: () => request({ method: 'GET', path: P('accountDevices') }, DevicesResponse),
  signOutDevice: (id: string) => request({ method: 'DELETE', path: P('accountDevice', { id }) }, Ok),
  signOutEverywhere: () => request({ method: 'POST', path: P('accountSignOutEverywhere') }, Ok),
  scheduleDeletion: () => request({ method: 'POST', path: P('accountDeletion'), body: { confirm: 'DELETE' } }, DeletionResponse),
  cancelDeletion: () => request({ method: 'DELETE', path: P('accountDeletion') }, DeletionResponse),
  emailStart: (email: string) => request({ method: 'POST', path: P('emailStart'), body: { email } }, CodeSentResponse),
  emailVerify: (email: string, code: string) => request({ method: 'POST', path: P('emailVerify'), body: { email, code } }, MeResponse),
  phoneStart: (phone: string) => request({ method: 'POST', path: P('phoneStart'), body: { phone } }, CodeSentResponse),
  phoneVerify: (phone: string, code: string) => request({ method: 'POST', path: P('phoneVerify'), body: { phone, code } }, MeResponse),
  linkMethod: (provider: 'apple' | 'google', idToken: string) => request({ method: 'POST', path: P('methods', { provider }), body: { idToken } }, MeResponse),
  unlinkMethod: (provider: 'apple' | 'google' | 'phone') => request({ method: 'DELETE', path: P('methods', { provider }) }, MeResponse),
  consents: () => request({ method: 'GET', path: P('consents') }, ConsentsResponse),
  updateConsents: (patch: { marketing?: boolean; analytics?: boolean }) => request({ method: 'PATCH', path: P('consents'), body: patch }, ConsentsResponse),
  exportStatus: () => request({ method: 'GET', path: P('export') }, ExportResponse),
  requestExport: () => request({ method: 'POST', path: P('export') }, ExportResponse),
  cards: () => request({ method: 'GET', path: P('cards') }, CardsResponse),
  addCard: (c: AddCardRequest) => request({ method: 'POST', path: P('cards'), body: c }, CardsResponse),
  removeCard: (id: string, newDefault?: string) => request({ method: 'DELETE', path: `${P('card', { id })}${newDefault ? `?newDefault=${newDefault}` : ''}` }, CardsResponse),
  setDefaultCard: (id: string) => request({ method: 'PUT', path: P('cardsDefault'), body: { id } }, CardsResponse),
  credit: () => request({ method: 'GET', path: P('credit') }, CreditResponse),
  moveCredit: (cardId: string) => request({ method: 'POST', path: P('creditMove'), body: { cardId } }, MoveCreditResponse),
  openThread: (opts: { tripId?: string; about?: string } = {}) => request({ method: 'POST', path: P('supportThreads'), body: opts }, SupportThreadResponse),
  thread: (id: string) => request({ method: 'GET', path: P('supportThread', { id }) }, SupportThreadResponse),
  sendMessage: (id: string, m: SendSupportMessageRequest) => request({ method: 'POST', path: P('supportMessages', { id }), body: m }, SendSupportMessageResponse),
  sendAttachment: (id: string, file: PickedFile, clientId: string) => multipart('POST', P('supportAttachments', { id }), file, { clientId }, SendSupportMessageResponse),
  markRead: (id: string) => request({ method: 'POST', path: P('supportRead', { id }) }, Ok),
  unread: () => request({ method: 'GET', path: P('supportUnread') }, SupportUnreadResponse),
  presence: (threadId?: string) => request({ method: 'GET', path: `/support/presence${threadId ? `?threadKind=support&threadId=${threadId}` : ''}` }, PresenceResponse),
  /** The notifications API belongs to Trips; until it answers, the inbox is simply empty. */
  async notifications() {
    try { return (await request({ method: 'GET', path: '/notifications' }, z.object({ notifications: z.array(Notification) }))).notifications; } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.code === 'BAD_RESPONSE')) return [];
      throw e;
    }
  },
  async markNotificationsRead(ids: string[]) {
    try { await request({ method: 'POST', path: '/notifications/read', body: { ids } }, z.unknown()); } catch { /* the inbox marks them locally */ }
  },
  /** Trips belong to the Trips area; the Wallet only reads them for validity and passes. */
  async trips() {
    try {
      const r = await request({ method: 'GET', path: '/trips' }, TripsLoose);
      return r.trips.map((x) => Trip.safeParse(x)).filter((x) => x.success).map((x) => x.data);
    } catch { return []; }
  },
};

export const walletKeys = {
  documents: ['wallet', 'documents'] as const,
  person: (id: string) => ['wallet', 'person', id] as const,
  account: ['wallet', 'account'] as const,
  devices: ['wallet', 'devices'] as const,
  consents: ['wallet', 'consents'] as const,
  export: ['wallet', 'export'] as const,
  cards: ['wallet', 'cards'] as const,
  credit: ['wallet', 'credit'] as const,
  thread: (key: string) => ['support', 'thread', key] as const,
  unread: ['support', 'unread'] as const,
  presence: (id?: string) => ['support', 'presence', id ?? ''] as const,
  notifications: ['inbox'] as const,
  trips: ['wallet', 'trips'] as const,
};

const useOn = () => useSession((s) => s.status) === 'signedIn';

export const useDocuments = () => useQuery({ queryKey: walletKeys.documents, enabled: useOn(), queryFn: async () => (await walletApi.documents()).documents });
export const usePersonDetail = (id: string | undefined) => useQuery({ queryKey: walletKeys.person(id ?? ''), enabled: useOn() && !!id, queryFn: () => walletApi.person(id!) });
export const useAccount = () => useQuery({ queryKey: walletKeys.account, enabled: useOn(), queryFn: async () => (await walletApi.account()).account });
export const useDevices = () => useQuery({ queryKey: walletKeys.devices, enabled: useOn(), queryFn: async () => (await walletApi.devices()).devices });
export const useConsents = () => useQuery({ queryKey: walletKeys.consents, enabled: useOn(), queryFn: () => walletApi.consents() });
export const useExport = () => useQuery({ queryKey: walletKeys.export, enabled: useOn(), queryFn: async () => (await walletApi.exportStatus()).export });
export const useCards = () => useQuery({ queryKey: walletKeys.cards, enabled: useOn(), queryFn: () => walletApi.cards() });
export const useCredit = () => useQuery({ queryKey: walletKeys.credit, enabled: useOn(), queryFn: async () => (await walletApi.credit()).credit });
export const useUnread = () => useQuery({ queryKey: walletKeys.unread, enabled: useOn(), refetchInterval: 60_000, queryFn: async () => (await walletApi.unread()).unread });
export const useInbox = () => useQuery({ queryKey: walletKeys.notifications, enabled: useOn(), queryFn: () => walletApi.notifications() });
export const useTrips = () => useQuery({ queryKey: walletKeys.trips, enabled: useOn(), staleTime: 60_000, queryFn: () => walletApi.trips() });
export const usePresence = (threadId?: string) => useQuery({ queryKey: walletKeys.presence(threadId), enabled: useOn(), refetchInterval: 30_000, queryFn: () => walletApi.presence(threadId) });

/** Patch the account and keep the cache in step. */
export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateAccountRequest) => walletApi.updateAccount(patch),
    onSuccess: ({ account }) => qc.setQueryData(walletKeys.account, account),
  });
}

/** After anything that changes the household or its passports. */
export function useRefreshHousehold() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: coreKeys.people }), qc.invalidateQueries({ queryKey: walletKeys.documents }), qc.invalidateQueries({ queryKey: ['wallet', 'person'] })]);
}

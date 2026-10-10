# When things go wrong: states and hooks

Everything a screen needs to behave well with no connection, a slow or busy server, a supplier that isn't answering,
an expired session, maintenance or an old app version. The words come from `packages/shared/src/copy/resilience.ts`
(COPY.md §5.6); the rules are in `docs/app/FLOWS.md` §12. Every state is on one page at `/states` (mock or demo-hints
builds only), and `test/e2e-resilience.mjs` screenshots them.

## What you get for free (nothing to do)

- **The API client** (`lib/api.ts` `request`): 8 s timeouts (20 s for search, payments, orders, refunds); GETs retry
  network trouble and 5xx twice with backoff and jitter; every mutation sends an `Idempotency-Key`; 429 / Retry-After
  waits and tries again; `TOKEN_EXPIRED` refreshes once; an expired session opens the sign-in-again sheet over the
  screen (nothing typed is lost); 426 opens the update screen; 503 `MAINTENANCE` opens the maintenance screen; a
  response that doesn't match its zod schema is a soft `BAD_RESPONSE`, never a crash. `ApiError` has `.kind`
  (`offline | timeout | busy | maintenance | update | auth | supplier | gone | forbidden | input | contract | cancelled | storage | server`),
  `.retryAfter`, `.details`, `.requestId`.
- **The offline bar** across the top, the reconnect toast, the busy toast, the full-phone toast, the crash screen and the
  not-found screen. The bar shifts every screen's top inset, so `TopBar` and anything using `useTopInset()` /
  `useSafeAreaInsets()` sits under it. Don't position things at a fixed `top`.
- **The offline copy**: React Query's cache is saved to the phone and restored before the first screen. Kept by key
  root: `me`, `people` (30 days), `trips` (30 days, not `position`), `wallet` (30 days), `support`, `inbox`,
  `circles` (7 days), `booking` (7 days, never `flights`, `stays`, `preview`, `entry`, `search`). Change yours with
  `persistQueries(root, maxAgeMs, except)` from `lib/net/persist`, or per query `meta: { persist: ms | false }`.
- Queries pause offline and refetch on reconnect; mutations fail fast with `OFFLINE` instead of spinning.

## Reading data: `useApiQuery` + `QueryState`

```tsx
import { useApiQuery } from '@/lib/net/hooks';
import { QueryState, SkeletonList } from '@/components/states';

const trips = useApiQuery({ queryKey: ['trips'], queryFn: ({ signal }) => tripsApi.list({ signal }) });
return (
  <QueryState query={trips} skeleton={<SkeletonList photo />} badge>
    {(data) => <TripList trips={data} />}
  </QueryState>
);
```

`useApiQuery` is `useQuery` plus `view` (`loading | slow | offline | error | ready`), `problem` (the words),
`stale` (showing the saved copy), `updatedAt`, `retry()` and `cancel()`. `QueryState` renders: your skeleton →
after 4 s "Still working… This is slower than usual." with Stop waiting → `ErrorState` (or `InlineError` with
`section`) → your content, with "Saved on this phone · 12 min ago" when `badge` is on and the data is the saved copy.
Pass `signal` through to `request()` so Stop waiting really stops.

## Changing things: `useApiMutation`

```tsx
const pay = useApiMutation({
  mutationFn: (b: PayBody, { idempotencyKey }) => request({ method: 'POST', path: '/orders', body: b, idempotencyKey }, OrderResponse),
});
<SlideToConfirm onConfirm={() => pay.mutate(body)} busy={pay.isPending} />
```

- A second tap while the first is running is ignored (one payment).
- The same body retried (after a timeout or offline) reuses its `idempotencyKey`, so the server does it once.
  Passing the key to `request()` also makes that mutation retryable.
- Transient problems toast calm words; pass `quiet` to show your own state from `pay.problem`.
- `queueWhenOffline: (vars) => ({ kind, label, method, path, body, dedupe? })` sends it through the **outbox** instead
  when there's no connection; the mutation resolves with `undefined` and the toast says it goes when back online.

## The outbox (`lib/net/outbox`)

`enqueue({ kind, label, method, path, body, dedupe?, meta? })` keeps an item on the phone and sends it, oldest first,
when there's a connection, with its own Idempotency-Key kept across restarts. `dedupe` replaces a still-queued item
(the latest disruption choice wins). `registerOutboxKind(kind, { onSent, invalidate })` once per area.
Show state under what was queued with `<OutboxStatus item={…} />` ("Sends when you're online" · "Sending…" · "Not sent."
with Send again / Remove) or the whole list with `<OutboxList kind="message" />`; read items with `useOutbox(kind)`.

## The pieces

| Component | Use it for |
|---|---|
| `Skeleton`, `SkeletonLines`, `SkeletonCard`, `SkeletonList` | Placeholders in the shape of what's coming. Still under Reduce Motion. |
| `SlowState` | "Still working…" with Stop waiting (QueryState does this for you). |
| `InlineError` | A section that didn't load, with Try again. |
| `ErrorState` | A whole screen that couldn't load. Pass `error` or `problem`; it picks words, drawing and the one action. `booking` for supplier-down during a booking. |
| `OfflineState` | A screen that needs the network (search, a new booking). |
| `SupplierDown` | "Saudia's system isn't answering." In results; `booking` shows "Faisal is booking this by hand" with his face. Check ahead with `useSupplierStatus().down('flights')`. |
| `StaleBadge` | "Updated 12 min ago" / "Saved on this phone · 12 min ago" (`useFreshness` for the text alone). |
| `PermissionDenied` | camera, contacts, location, notifications, photos: what it's for, Open Settings, a way on without it. |
| `GoneState` | Something deleted or expired (a cancelled trip's deep link, `invite` for an expired invite). |
| `SafeImage` | A photo that never leaves a hole: initials on a tone until it loads or if it fails; `preview` (thumbnail or `blurhash:…`) first. |
| `ErrorBoundary`, `CrashState` | Already at the root; wrap a risky subtree yourself if you like. |

## Other helpers (`lib/net`)

- `serverNow()` / `useServerNow()`: countdowns (hold expiry, check-in closes) on the server's clock, never the phone's.
- `useNet()` → `{ online, weak }`; `isOffline()`; `simulateOffline(on)` for the demo "Offline" switch.
- `useFeature('name')`: a switch from GET /config.
- `describeError(e)` → `{ kind, title, body, primary, retryAfter, reference }` for your own layouts.
- `reportError(e, { where })`: to Sentry when `EXPO_PUBLIC_SENTRY_DSN` is set (scrubbed of names, numbers and tokens).

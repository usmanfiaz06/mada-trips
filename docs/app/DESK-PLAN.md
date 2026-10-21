# App desk: audit and rebuild plan (21 Oct 2026)

What the app desk at `/adminwork/desk` is today, how far it is from Mada Ops, and how to make it the place a
customer-support team runs the traveller app from. Paths are relative to `platform/src/` unless noted.

---

## 1. The Mada Ops design language

### 1.1 What it is

| Layer | Where | What it does |
|---|---|---|
| Shell | `app/adminwork/(app)/layout.tsx` | A fixed 272px sidebar, then a sticky floating header pill (`bg-tile`, `rounded-full`, `shadow-float`) holding the command trigger, close clock, notifications, locale and theme. Content sits in `<main>` at `max-w-[1440px]`, `pt-8`. |
| Navigation | `components/shell/sidebar.tsx` | Sections with 11.5px `ink-4` labels. Items are 40px `rounded-full` rows with a lucide icon (17px, stroke 1.7). The active item is `bg-surface shadow-card` with a gold icon. Counts show as a gold pill. The one accent item is New sale (`bg-ink`, a gold disc and the `N` kbd). All navigation lives here: there is no second nav bar anywhere in Ops. |
| Command palette | `components/shell/command.tsx`, `app/adminwork/api/search/route.ts` | ⌘K over the pages plus search across bookings, clients, expenses and tasks. |
| Tokens | `app/globals.css:5-136` | Canvas `--bg #e5e4df`, tiles `--surface #f8f8f5`, `--sunken`, `--line`, ink scale `ink`…`ink-4`, brand green `#1e352d`, gold `#c99c52`/`gold-2`/`gold-soft`, status `ok/warn/bad/info` each with a `-soft` pair, dark "ink tiles" (`--tile`, `glow-*` data colours), `--radius-card: 22px`, `shadow-card` and `shadow-float`. Dark mode redefines everything under `.dark` (`globals.css:58-92`), toggled by `ThemeToggle`. |
| Typography | `globals.css:94-149` | Geist Variable plus IBM Plex Sans Arabic (Arabic first when `lang="ar"`). Page title 34px at weight 380 with −0.035em tracking. Card title 17px/450. Body 13.5–14.5px. Labels 12px `ink-3`. `.num` for tabular figures. `.figure` (300 weight, oversized) for hero numbers. Sans only, no serif. |
| Primitives | `components/ui.tsx` | `PageHeader` (an eyebrow with a gold dot, title, subtitle, actions), `Card`/`CardHead`/`InkCard`, `Grid`, `btn` variants (primary ink, gold, outline, ghost, soft, danger; sm/md/lg, all `rounded-full`), `Money` (SAR suffix), `Badge` with 7 tones, `Stat`, `Empty` (icon disc, title, hint, action), `KV`, `Avatar`, `Table`/`Th`/`Td`/`RowLink`, `Field`/`Input`/`Select`/`Textarea` (the `.field` class), `Segmented`, `Tabs` (filter pills), `Notice`, `Meter`. |
| Charts | `components/charts/index.tsx` | `CycleBarcode`, `ArcGauge`, `SunGauge`, `DotColumns`, `SplitBar`, all drawn on ink tiles. |
| List pattern | `app/adminwork/(app)/sales/page.tsx:32-97` | `PageHeader` with a primary action, then `Tabs` for status, then one `Card pad={false}` holding a search and filter form, a summary strip (`bg-surface-2`: count, totals), a `Table` whose first cell is the link, `Badge` for status, `Empty`, and pagination at 50 rows. Filters live in the URL. |
| Detail pattern | `app/adminwork/(app)/sales/[id]/page.tsx:80-280` | `grid lg:grid-cols-[minmax(0,1fr)_360px]`: a `Journey` stepper first, then `KV` cards and `Table` cards on the left. The rail on the right holds the next action in a ringed card (`ring-2 ring-gold/40`), then "More actions". |
| Dashboard | `app/adminwork/(app)/page.tsx` | An `InkCard` hero with oversized figures, `Stat` tiles, ink-tile charts. |
| Density | Throughout | Comfortable: `p-6` cards, `py-3.5` table rows, `gap-4` grids, motion from `animate-rise` and `stagger`. |
| Statuses | `lib/labels.ts` (`BOOKING_STATUS` etc.) | One label and tone per status, used through `Badge`. |
| Audit | `audit_events`, `/adminwork/activity` | Every change is written with actor, entity and summary. |

### 1.2 Where the desk deviates

Colours, radii and type are mostly right: the desk reuses the tokens and most primitives. The problem is structure.

| # | Deviation | Where |
|---|---|---|
| D1 | **A second navigation bar.** There are 11 pill tabs (`DeskNav`) above every desk page, and the Ops sidebar has a single "Desk inbox" link. Ops never nests navigation. On Orders, Requests, Refunds, Recovery, Moderation and What's on the page then adds its own `Tabs` row, so the agent sees two pill rows stacked. | `components/desk/live.tsx:54-73`, `desk/layout.tsx:18-34`, `(app)/layout.tsx:27-29` |
| D2 | The agent presence switch sits in the page body next to the sub-nav. The Ops header pill is where per-user controls go. | `desk/layout.tsx:33-36`, `components/desk/parts.tsx:19-46` |
| D3 | Hand-rolled page headers copy `PageHeader` markup instead of using it. | `desk/page.tsx:87-93`, `desk/chats/page.tsx:45-51`, `desk/orders/[id]/page.tsx:73-88`, `desk/requests/[id]/page.tsx:62-71` |
| D4 | A hand-rolled table instead of `Table`/`Th`/`Td`. | `desk/orders/[id]/page.tsx:117-137` |
| D5 | `Facts` duplicates `KV`, and `DeskTimeline` is a hand-written `<section>` instead of `Card`+`CardHead`. | `components/desk/parts.tsx:155-193` |
| D6 | Status maps live in desk files (`ORDER_STAGE`, `REQUEST_STATUS`, `PAY_STATUS`, plus local `STAGE` and `KIND` maps) instead of `lib/labels.ts`. | `components/desk/parts.tsx:48-83`, `desk/refunds/page.tsx:15-18`, `desk/requests/page.tsx:14` |
| D7 | Refunds is a grid of cards, not a table. Ops lists are always tables. | `desk/refunds/page.tsx:34-83` |
| D8 | No desk list has the Ops search, filter, summary strip or pagination. `listOrders` loads every order. | `desk/orders/page.tsx:20`, `desk/requests/page.tsx:22`, `lib/app/desk/adapters.ts:132,515` |
| D9 | The detail pages have no `Journey` stepper. The order page uses a plain event list and puts the conversation in the middle of a long left column. | `desk/orders/[id]/page.tsx:160-179` |
| D10 | The eSIM low-balance `Notice` is pinned above every desk page, including chats. | `desk/layout.tsx:37-39` |
| D11 | The inbox hero is an `InkCard` of counts. On the dashboard an ink tile carries money and charts, so on the inbox it pushes the actual work list below the fold. | `desk/page.tsx:95-151` |
| D12 | Desk entities (orders, travellers, chats) are not in ⌘K search. | `app/adminwork/api/search/route.ts:16-26` |

---

## 2. The desk today

All routes sit under `/adminwork/desk` and need `desk.view`. They auto-refresh every 10–30s through `AutoRefresh`, which pauses while someone types.

| Route | What it does | Reads | Actions | UX problems |
|---|---|---|---|---|
| `/` Inbox | Live queue of every kind (order, ticketing, chat, request, refund, disruption, moderation, recovery, undelivered eSIM), routed by rota and sorted by SLA. j/k keyboard navigation. | `deskInbox()` (`lib/app/desk/inbox.ts:38-110`) rebuilds the whole queue from 8 sources on every request. | Take, reassign, escalate (`inbox-list.tsx`) | The hero tile pushes the list down. There is no snooze or done. Nothing is persisted, so a closed item vanishes with no history and nothing can be measured. The whole queue is rebuilt on **every Ops page** for the sidebar badge (`(app)/layout.tsx:17`), plus every 20s. |
| `/orders` | App bookings (flight, stay, trip) by stage | `listOrders` (all rows) | none on the list | No search, no filters, no payment or supplier column, no pagination. The stage list in `ORDER_STAGE` mixes payment and desk states. |
| `/orders/[id]` | Hold, ask the traveller, price change, issue and capture, fail and void, TBO, Hotelbeds, boarding passes, passport reveal, chat, assign | `getRequestFull` | `holdAction`, `issueAction`, `askAction`, `priceAction`, `failAction`, `replyAction`, … | A 300-line page with no stepper (D9). The next action sits halfway down the rail under preferences. **Bug: `HotelRequestsCard` renders inside the hold form** (`orders/[id]/page.tsx:236`). No margin or supplier cost is shown. There is no link to the customer, so the agent can't see their other bookings. |
| `/requests`, `/requests/[id]` | Visa, Umrah, car and other concierge requests: quote, checklist, outcome, done | `listRequests`, `getRequestFull` | `quoteAction`, `flightQuoteAction`, `checklistAction`, `outcomeAction`, `promiseAction`, `doneAction` | No search, no kind filter, no pagination, hand-rolled header (D3). |
| `/chats` | Three panes: list, thread, rail (assign, eSIM) | `listConversations(200)`, `getThread` | reply, note, canned replies, typing | Covers only support and request threads. **Ask Mada AI threads (`app_ask_threads`) are invisible.** When `talk_to_human` hands off, the agent gets a redacted summary but not the conversation. The rail shows nothing about the customer (bookings, spend, trips). There is no close/resolve state and no search. |
| `/refunds` | Decide refunds: to card through the payment supplier, or to Mada credit | `listRefunds` | `approveRefundAction`, `rejectRefundAction` | Cards, not a table (D7). Only the full requested amount can be approved, never part of it. **A card refund stays "Approved · on its way" forever**: nothing moves `approved` to `sent` (`lib/app/desk/adapters.ts:729`). The `goodwill` kind in `creditEntry` (`adapters.ts:761`) has no button. The page doesn't auto-refresh. |
| `/esims`, `/esims/[id]`, `/esims/pricing` | eSIM orders, top-up, cancel and refund. Pricing rules over the supplier catalogue. Live eSIM Access balance. | `deskEsims`, `esimBalance`, `esimPricing`, `catalogueRows` | ordering on/off, top-up, cancel, pricing rules | The only part of the desk that touches margin. Pricing is a finance tool sitting inside a support desk. |
| `/disruptions` | Today's flights with Mada travellers on board, with a push-a-plan form and a voucher | `disruptionBoard` | `planAction` | Today only, no history of what was pushed. |
| `/moderation` | Tips, reports, cover photos | `listModeration` | `moderateAction`, `blockAction`, `unblockAction` | Fine as a queue. It needs `desk.moderate` but the tab shows to everyone. |
| `/recovery` | Account recovery: move an account to a new phone or email | `listRecovery` | `recoveryAction` | Fine. |
| `/whats-on` | City events editor | `listWhatsOn` | add or edit | Content editing, not support. It doesn't belong in the desk nav. |
| `/team` | Agent profiles (traveller-facing name, languages), 7-day rota, primary agent per traveller, canned replies | `teamBoard`, `travellersWithAgents` | `saveAgentAction`, `addShiftAction`, `assignPrimaryAction`, `addCannedAction` | Four unrelated tools on one page. An agent profile can only be attached to an **existing** Ops user (accounts are created elsewhere, in `/adminwork/team`). There is no support-agent role. Nothing shows performance, time logs or history. Canned replies can't be edited or deleted. |
| File routes | `files/[id]`, `passport-copy/...`, `hotelbeds/[id]/voucher`, `moderation/cover/[id]` | | | n/a |

Cross-cutting problems:
- **Every page answers "what is waiting?", and no page answers "where is everything?".** Once a booking is confirmed it leaves every queue. The desk can't show held, ticketed, travelling or done bookings together.
- **No ticket object.** Work is derived live from source tables. Nothing has an owner over time, a priority, a resolution, a reopen, a CSAT score or a link between related items.
- **No customer page.** A traveller's name is plain text everywhere.
- **App money never reaches Ops finance.** `app_payments.ops_payment_id` exists but nothing writes it. App sales are not in `bookings` or `ledger_entries`, so Dashboard, Banks, Settlement and Daily close ignore app revenue.

---

## 3. Coverage against the owner's list

E = exists, P = partial, M = missing. "Data" is what the database already holds to back it.

| Area | State | Today | Data already there | Gap |
|---|---|---|---|---|
| Live bookings board (searching, held, paid, ticketed, travelling, done, problem) | **P** | `/orders` tabs cover the desk stages only | `app_orders.status` (requires_action … confirmed/cancelled/declined), `app_order_events`, `app_payments.status`, `app_trips` (dates, status), `app_segments`, `app_flight_events`, `app_supplier_bookings`, `app_esims.status` | One board across all products with a derived lifecycle stage. Travelling and done come from trip dates. Problem comes from failed or declined status, disruption, or an open ticket. |
| Drop-offs: abandoned search or pay sheet, stuck payments | **M** | none | `app_offers` (owner, kind, total, expires_at), `app_orders` stuck in `requires_action` or `declined`, `app_payments` in `initiated`, `requires_action` or `declined`, `app_esim_price_holds`, `app_ask_threads` with a pay card and no order | A derived drop-off list, recovery actions (message, call, resend pay link, hold the price, make a ticket) and a "recovered" mark. Abandoned *searches* need a per-user search log; `app_search_cache` is shared and not per user. |
| Ask chat threads (read, take over, reply as agent, hand back) | **M** | Handoff opens a support thread with a summary only | `app_ask_threads.transcript`, `summary`, cost columns | A read-only transcript on the desk, "Take over" (pause the AI on that thread), and "Hand back to Mada". Take over and hand back need a `mode` column and changes on the app side (ASK-CHAT.md). |
| Requests inbox | **E** | `/requests` | `app_requests`, `app_quotes` | Search, filters, pagination, customer link. |
| Tickets (create from anything, assign, priority, SLA, status, internal notes, merge) | **M** | Inbox items with take, reassign and escalate. `app_desk_items` stores manual assignment and escalation only. | `app_desk_items`, `app_desk_notes` (request and support threads only), Ops `tasks` (title, status, priority, assignee, due, checklist, link) | A real `desk_tickets` table, with events and links. See §4.4. |
| Refunds and credits | **P** | `/refunds` approve or decline | `app_refunds`, `app_refund_groups`/`items`, `app_credit_ledger` (refund, goodwill, spend, expiry, adjustment), `app_invoices` credit notes | Partial amounts, the approved→sent transition (reconcile against the supplier), goodwill credit, desk-started refunds (TBO cancel, TBO.md:120), a credit ledger per customer. |
| Finance: revenue, margin per product | **M** | none (the eSIM pricing page only) | `app_payments` (captured amount), `app_orders.lines`, `app_esims` (net cost in USD cents), `app_supplier_bookings` (net and sell), TBO fare in the order snapshot, `app_trip_charges` | Net cost per order line, a stored FX rate, and a margin view by product and day. |
| eSIM pricing desk | **E** | `/esims/pricing` | `app_esim_catalogue`, pricing rules in settings | Move it under Finance. |
| Supplier balances (eSIM Access, Hotelbeds, TBO) | **P** | eSIM Access only (`app_runtime "esim.balance"`) | `app_runtime`, `app_supplier_health`, `app_supplier_usage` | Hotelbeds and TBO balance or credit-line reads, plus thresholds and alerts. |
| Payouts and payables to suppliers | **M** for the app | Ops `/payables` and `supplier_payments` handle Ops sales | `supplier_payments` (Ops) | App supplier costs posted as payables. |
| MyFatoorah reconciliation | **M** | Webhooks are stored | `app_payment_webhooks`, `app_payments.provider_ref` | Settlement import or API pull, then match against captures, refunds and fees. |
| VAT | **P** | Invoices carry VAT and a ZATCA status | `app_invoices.vat`, `zatca_status`, `app_invoice_details` | A VAT report (output VAT by period) and a ZATCA failures queue. |
| Ops finance integration | **M** | `app_payments.ops_payment_id` is never written | Ops `bookings`, `payments`, `ledger_entries` | Post captured app sales into Ops sales and payments under an "App" channel, so the dashboard, close and settlement include them. |
| Reporting and dashboards | **M** | Inbox counts only | All of the above plus `audit_events` | A desk dashboard: volume, SLA hit rate, backlog, funnel, revenue. |
| Customer 360 | **M** | Primary-agent search on `/team` | `app_users`, `app_people`, `app_trips`, `app_orders`, `app_payments`, `app_credit_ledger`, `app_support_threads`, `app_ask_threads`, `app_ask_memory`, `app_desk_blocks`, `app_audit`, `app_devices` | One page per customer. |
| Agent accounts (create, invite, deactivate) | **P** | Ops `/adminwork/team` creates the login (`team/actions.ts:41 addMember`) with a temporary password. Desk `/team` attaches a profile. | `users`, `roles`, `app_agents` (`active`) | Create login, role and agent profile in one flow. Add a "Support agent" and "Support lead" system role (`lib/permissions.ts:56-61` has neither). Deactivating one should do both. |
| Roles and permissions | **P** | `desk.view/act/issue/refund/moderate/admin` | `roles.permissions` | Add `desk.finance`, `desk.reports`, `desk.tickets.manage`, `desk.ask.read`. See §4.3. |
| Shifts and on-duty presence | **E** | Rota with cover, online/away/off | `app_agent_shifts`, `app_agents.status`/`status_at` | Repeating shifts, week view, presence history. |
| Time logs | **M** | Only the last status change is kept | `sessions` (login time, IP, UA), `users.last_seen_at`, `status_at` | An `app_agent_presence_log` (status intervals) and "worked vs rostered". |
| Performance (first response, resolution, CSAT, volume) | **M** | `firstReplySamples` exists for the traveller-facing ETA (`lib/app/desk/agents.ts:141-167`) | `app_messages` (author_ops_user_id, created_at), `audit_events` | Needs ticket timestamps (opened, first response, resolved) and a CSAT prompt in the app. |
| Audit and history | **P** | `deskAudit` writes `app_audit` and `audit_events` (`lib/app/desk/core.ts:41`). `DeskTimeline` shows it per record. | `audit_events`, `app_audit` | Per-agent history, filters, and the desk inside `/adminwork/activity`. |
| Notifications and escalations | **P** | Manual escalate, sidebar badge, SLA colours | `app_desk_items.escalated_*` | Automatic escalation on breach, a lead notified through `NotificationBell`, night paging (SCOPE.md:314). |
| Search everywhere | **M** | | | ⌘K over app users, phone, order ref, PNR, ticket number, ICCID and ticket ref. |
| Arabic for agents | **E** | `lib/app/desk/ar*.ts` merged into `lib/i18n/ar.ts` | | Keep every new string in `AR_DESK`. Canned replies already carry EN and AR. |

---

## 4. Target design

### 4.1 Information architecture

The desk moves **into the Ops sidebar** as its own sections, and `DeskNav` is deleted. Sections show by permission.

```
Workspace          Dashboard · Tasks · Approvals                     (unchanged)
Support            My queue (count) · Tickets · Chats (count) · Ask threads · Customers
App bookings       Live board · Drop-offs (count) · Requests · Refunds & credits (count) · eSIMs · Disruptions (red count)
App finance        App revenue & margin · Reconciliation · Supplier balances · eSIM pricing
Support admin      Agents & roles · Rota & time · Performance · Saved replies & macros · Moderation · Account recovery · What's on
Operations / Finance / Admin                                          (unchanged Ops sections)
```

- Agent presence (Online / Away / Off, plus "on shift") goes into the header pill next to the bell, for desk users only.
- Supplier-balance alerts go to `NotificationBell` and the Supplier balances page, not a banner on every page.
- ⌘K searches app customers, orders, PNRs, tickets, ICCIDs and chats.

### 4.2 Key screens (wireframe level)

All of them use `PageHeader`, `Tabs`, a `Card` with a filter bar, a summary strip, `Table` and pagination, or the Ops detail grid `[minmax(0,1fr)_360px]` with a `Journey` stepper.

1. **My queue** (replaces Inbox). The header shows SLA status as small `Stat` chips (Late, Due soon, Mine, Unassigned), not a hero. Then a `Tabs` row (Mine / Team / Unassigned / Escalated) and one table: kind icon, title, customer link, SLA clock, owner, priority badge, last activity. j/k/t shortcuts stay. A row opens its ticket or record. It reads from `desk_tickets` plus the live sources. A cron or the read path upserts tickets, so items persist.
2. **Ticket** `/desk/tickets/[ref]`. Left column: `Journey` (New → Open → Waiting on customer / Waiting on supplier → Resolved → Closed), then the conversation (traveller messages, agent replies, internal notes in the existing `Thread`), then linked records (order, refund, eSIM, Ask thread). Rail: Next action, then properties (status, priority, owner, category, SLA due, tags), then customer mini-card, then merge or link, then the desk log.
3. **Live board** `/desk/bookings`. `Tabs` by lifecycle: Searching (offers, last 24h) · Paying · With desk (held or awaiting) · Confirmed · Travelling (today between trip start and end) · Done · Problems. A table with product, customer, route or city, dates, stage badge, payment badge, supplier ref, total and margin. Filters: product, supplier, date range, agent.
4. **Drop-offs** `/desk/drop-offs`. Tabs: Abandoned pay sheet · Payment failed or 3DS pending · Price hold expired · Ask pay card not used. Columns: customer, what, value, where they stopped, when, attempts. Row actions: Message (canned recovery text), Call, Create ticket, Mark recovered. A recovered mark needs an order within 72h, or a manual mark.
5. **Chats and Ask threads.** Keep the three panes. The rail becomes the customer mini-card plus open tickets plus recent bookings. Add a Resolve button, which closes the ticket and sends the CSAT prompt. Ask threads open as a read-only transcript with "Take over" and "Hand back".
6. **Customer 360** `/desk/customers/[id]`. Header: name, phone, language, primary agent, blocked badge. `Stat` tiles: lifetime spend, bookings, credit balance, open tickets. Tabs: Overview (upcoming trip, last chat) · Bookings · Payments & refunds · Credit ledger · Conversations (support, request, Ask) · Tickets · Travellers (people, masked passports) · Audit. Actions: message, create ticket, goodwill credit, block, assign primary agent.
7. **Refunds and credits.** A table (not cards) with stages Requested → Approved → Sent → Settled / Rejected, a partial-amount field, approve to card or credit, a reconcile mark from the supplier status, and a separate **Goodwill credit** form (needs `desk.refund`, with a limit from Rules & limits).
8. **App revenue and margin.** An InkCard hero (captured this cycle, margin, refunds), a `SplitBar` by product (flights, stays, eSIM, activities, requests), a table by day and product (gross, VAT, net cost, margin, margin %), and a drill into orders.
9. **Reconciliation.** MyFatoorah settlements against captures and refunds: matched, missing on our side, missing at the provider, fees. Tabby and Tamara get the same view later.
10. **Supplier balances.** One row per supplier (eSIM Access, Hotelbeds, TBO, Airalo): balance or credit line, threshold, last read, burn per day, "days left", and a link to the supplier console.
11. **Agents and roles.** A table of agents (name to travellers, Ops login, role, languages, active, on shift now, open tickets, tickets today). "Add agent" creates the Ops user, assigns the support role, creates the agent profile and shows a one-time invite link or temporary password, all in one step. Deactivate turns off the login and the profile and sends their open tickets back to the queue.
12. **Rota and time.** A week grid of shifts (repeating), cover, and a time log per agent: rostered against actually online, late starts, away time.
13. **Performance.** Per agent and per team, over a date range: tickets handled, first response (median and p90), resolution time, SLA hit %, CSAT average and count, reopen rate, refunds approved (count and SAR). Click through to the tickets behind each number.

### 4.3 Roles and permissions

New system roles go in `lib/permissions.ts SYSTEM_ROLES`. New permissions: `desk.tickets.manage` (merge, reassign anyone, edit SLA), `desk.ask.read` (read AI transcripts), `desk.finance` (revenue, margin, reconciliation, balances, eSIM pricing), `desk.reports` (performance and dashboards), `desk.customers.pii` (unmask contact details and export).

| Capability | Support agent | Senior agent / issuer | Support lead | Finance | Partner |
|---|---|---|---|---|---|
| desk.view, desk.act (queue, chats, tickets, requests) | ✓ | ✓ | ✓ | view | ✓ |
| desk.ask.read, take over | ✓ | ✓ | ✓ | | ✓ |
| desk.issue (issue and capture, full passports) | | ✓ | ✓ | | ✓ |
| desk.refund (approve, goodwill up to a limit) | | up to limit | ✓ | ✓ | ✓ |
| desk.tickets.manage (reassign anyone, merge) | | | ✓ | | ✓ |
| desk.moderate | | ✓ | ✓ | | ✓ |
| desk.admin (agents, rota, macros) | | | ✓ | | ✓ |
| desk.reports | own stats | own stats | ✓ | ✓ | ✓ |
| desk.finance | | | | ✓ | ✓ |
| team.manage (create Ops logins) | | | ✓ (support roles only) | | ✓ |

### 4.4 Tickets: model and lifecycle

New table `desk_tickets`: `id`, `ref` (T-000123), `kind` (order, ticketing, chat, request, refund, disruption, moderation, recovery, dropoff, manual), `source_kind` + `source_id` (unique while open), `customer_id` (app_users), `subject`, `status`, `priority` (low, normal, high, urgent), `category`, `owner_agent_id`, `opened_at`, `first_response_at`, `due_at`, `resolved_at`, `closed_at`, `reopened_count`, `merged_into_id`, `csat` (1–5), `csat_comment`, `tags[]`.

Plus `desk_ticket_events` (who, what, from→to, at) and `desk_ticket_links` (ticket ↔ order, refund, eSIM, ask_thread, …). `app_desk_items` and `app_desk_notes` fold into these: notes get a `ticket_id`, so any ticket can carry notes, not only request and support threads.

```
new ──take/assign──▶ open ──reply sent──▶ waiting_customer ──customer replies──▶ open
                      │  └─needs supplier──▶ waiting_supplier ──answer──▶ open
                      └─resolve──▶ resolved ──72h quiet / CSAT given──▶ closed
resolved ──customer writes again (≤7 days)──▶ open (reopened_count+1)
any ──merge──▶ closed (merged_into_id set; messages and links move to the target)
```

- **Created** automatically when a live source needs the desk (today's inbox rules in `inbox.ts:38-110`). Also by hand from anything: a chat message, an order, a customer, a drop-off, an Ask thread.
- **Assigned** by the existing routing (`lib/app/desk/routing.ts`: manual, then primary, then covering, then queue), or taken. Reassign needs `desk.tickets.manage` unless it's your own ticket.
- **Resolved** when its source finishes (order issued or voided, refund decided, request done) or an agent clicks Resolve. Chats ask for CSAT on resolve.

### 4.5 SLA rules

Keep `SLA_MINUTES` (`lib/app/desk/sla.ts:10-19`). Add:

| Rule | Target |
|---|---|
| Order confirm / ticketing / chat first reply / disruption | 4 / 15 / 10 / 10 min (unchanged) |
| Urgent call-back | 10 min (unchanged) |
| Chat next reply while open | 30 min |
| Request quote | 2 h or the request's own `promisedBy` |
| Refund decision / card refund settled | 24 h / 10 days (`expectedBy`) |
| Drop-off follow-up (value ≥ SAR 1,000) | 2 h, during working hours only |
| Manual ticket | by priority: urgent 30 min, high 4 h, normal 24 h, low 72 h |
| Pause | The clock stops in `waiting_customer` and `waiting_supplier` |
| Escalation | At 100% of target, auto-escalate and notify the on-shift lead. At 200%, notify the partners. At night with no-one online, page on-call. |

Measure in clock time (24/7 desk) except where marked as working hours.

### 4.6 Agent lifecycle

1. **Invite.** The lead clicks Add agent: name, email, phone, role (support agent or senior), team (Riyadh or Pakistan), traveller-facing first name in EN and AR, languages, photo. This creates the `users` row (`mustChangePassword`), the `app_agents` row and an audit entry, and shows the one-time link.
2. **Onboard.** First sign-in forces a password change. The agent starts `offline` and gets no routed work until rostered.
3. **Work.** Shifts on the rota. Presence changes are logged in `app_agent_presence_log`. Tickets are routed. Every action goes into `audit_events`.
4. **Review.** The Performance page and per-agent history (tickets, replies, refunds, passport reveals).
5. **Change.** Role, languages, primary travellers moved in bulk to another agent.
6. **Deactivate.** Login off, profile `active=false`, open tickets and primary travellers moved to the queue or a named agent, future shifts removed. History stays. Nothing is deleted.

---

## 5. Build plan

The units are in dependency order. ∥ marks units that can run in parallel once their dependency lands, because they touch different files.

| # | Unit | Scope | Files likely touched | Data / migration | Acceptance checks | Size |
|---|---|---|---|---|---|---|
| U1 | **Desk shell on the Mada Ops design language** | Move desk nav into sidebar sections (§4.1). Delete `DeskNav`. Move the presence switch into the header pill and the eSIM banner into the bell. Use `PageHeader` everywhere. Swap `Facts` for `KV`, wrap `DeskTimeline` in `Card`, move status maps to `lib/labels.ts`. Every list gets the Ops filter card (search, filters, summary strip, pagination at 50) with server-side `limit/offset`. Refunds becomes a table. Add a `Journey` stepper to orders and requests. Fix `HotelRequestsCard` inside the hold form. Make the sidebar badge a cheap count query, not the full `deskInbox()`. | `(app)/layout.tsx`, `components/shell/sidebar.tsx` (icons), `components/desk/live.tsx`, `components/desk/parts.tsx`, `desk/layout.tsx`, every `desk/**/page.tsx`, `lib/labels.ts`, `lib/app/desk/adapters.ts` (pagination params), `lib/app/desk/inbox.ts` (count) | none | No second nav row on any desk page. `rg "text-\[34px\]" desk` returns 0. Every list has search and pagination. Light, dark and Arabic RTL screenshots of each page. `test/app/desk.test.ts` and `test/e2e-desk.mjs` pass. An Ops page that isn't the desk no longer calls `deskInbox`. | M |
| U2 | Tickets core | `desk_tickets`, `desk_ticket_events`, `desk_ticket_links`. Upsert from inbox sources. Persist the lifecycle and SLA pause. My queue and ticket detail pages. Create from anything, assign, priority, notes on any ticket, merge, resolve, reopen, auto-escalation on breach. | `db/app-schema-desk.ts`, `drizzle/0036_desk_tickets.sql`, new `lib/app/desk/tickets.ts`, `lib/app/desk/inbox.ts`, `lib/app/desk/sla.ts`, `desk/page.tsx`, new `desk/tickets/**`, `desk/actions.ts` | yes (backfill open items) | An order needing confirmation creates exactly one ticket. Issuing resolves it. A reply sets `first_response_at`. Merge moves links. Breach notifies the lead. Unit tests for state transitions and SLA pause. | L |
| U3 ∥ (after U1) | Customer 360 and search | `desk/customers` list and `[id]` with tabs. ⌘K over customers, orders, PNRs, tickets, ICCIDs. Every traveller name links here. Goodwill credit and block from the profile. | new `desk/customers/**`, new `lib/app/desk/customers.ts`, `app/adminwork/api/search/route.ts`, `components/shell/command.tsx` | none (indexes on phone and email only if needed) | Search by phone, PNR or ICCID finds the record in under 300ms on seed data. The profile shows bookings, payments, credit, threads (including Ask) and audit. | M |
| U4 ∥ (after U1) | Live board and drop-offs | `desk/bookings` lifecycle board across products. `desk/drop-offs` with recovery actions (message from a canned reply, create ticket, mark recovered). A per-user search log for abandoned searches. | new `desk/bookings/**`, `desk/drop-offs/**`, new `lib/app/desk/board.ts`, `lib/app/desk/dropoffs.ts`, booking search route (log write) | `app_search_log` (user, kind, query, at), `app_dropoff_marks` | Every order appears in exactly one lifecycle tab. A declined payment without a later order shows in Drop-offs within a minute. Mark recovered is audited. | M |
| U5 ∥ (after U1; ticket links after U2) | Ask threads on the desk | Read-only Ask transcripts (`desk.ask.read`), linked from customer and chat. Take over: thread `mode=agent`, the AI stops answering, the agent replies through the support thread. Hand back. | `db/app-schema-ask.ts` (+`mode`, `taken_by`), `drizzle/0037_ask_takeover.sql`, `lib/app/ask-chat/store.ts` + turn guard, new `desk/ask/**`. **Coordinate with the ask-chat worker.** | yes | The transcript renders text and cards with no secrets. While taken over, a traveller message produces no AI turn and appears in the desk chat. Hand back restores the AI with a system note. | M |
| U6 (after U2) | Refunds, credits and app finance | Refund table with partial amounts, approved→sent reconciliation job, goodwill credit, desk-started cancel and refund (TBO, Hotelbeds). Net cost captured per order line with stored FX. App revenue and margin page. Supplier balances (eSIM Access, Hotelbeds, TBO). MyFatoorah reconciliation. VAT report. Post captured app sales to Ops `bookings`/`payments` (`ops_payment_id`) under channel "app". Move eSIM pricing here. | `desk/refunds/page.tsx`, `lib/app/desk/adapters.ts` (refund fns), new `lib/app/finance/*.ts`, new `desk/finance/**`, `lib/app/esim/ops.ts`, `lib/app/suppliers/live/myfatoorah.ts`, `tbo-air.ts`, `suppliers/hotelbeds/*`, `lib/dashboard.ts` | `app_order_costs` (order, line, supplier, net, currency, fx), `app_recon_rows`, `ops_payment_id` writes | A partial refund moves to Sent when the provider confirms. Margin per product equals the sum of order lines. A test settlement file matches 100% of seeded captures. App revenue shows on the Ops dashboard. | L |
| U7 ∥ (after U2) | Agents, roles, time and performance | One-step Add agent (Ops user + role + profile + invite). Deactivate with reassignment. Support agent and lead system roles plus the new permissions. Repeating shifts and week grid. Presence log. Performance page (first response, resolution, SLA %, CSAT, volume, refunds). CSAT prompt on resolve (app side: one tap). Per-agent history. | `lib/permissions.ts`, `app/adminwork/(app)/team/actions.ts`, `desk/team/**` split into `desk/agents`, `desk/rota`, `desk/performance`, `desk/macros`, `lib/app/desk/agents.ts`, new `lib/app/desk/performance.ts`, app CSAT endpoint | `app_agent_presence_log`, `app_agent_shifts.repeat`, canned edit/delete | Creating an agent results in a working login and routed work after a shift is added. Deactivating empties their queue. Performance numbers match a hand count on seed data. | L |
| U8 (last) | Desk dashboard and alerts | Desk home for leads: backlog, SLA hit today, funnel (search → pay → confirmed), drop-off value, revenue today, supplier balance days-left, who's on. Breach and balance alerts in `NotificationBell`, plus night paging. | new `desk/overview/page.tsx`, `lib/briefing.ts`, `components/notify.tsx` | none | Every number links to its list. Alerts fire once per breach. | M |

Parallel lanes: after U1, **U3, U4 and U5** touch disjoint route folders and libs. After U2, **U6 and U7** are disjoint, except that both add sidebar items to `(app)/layout.tsx`: land U1's section scaffolding with placeholder entries so later units only flip permission flags. U2 owns `desk/actions.ts` and `inbox.ts`. Other units add their own `*-actions.ts` files, as `esim-actions.ts` already does.

---

## 6. Open questions for the owner

1. **Who are the first support agents, and where?** Riyadh, Pakistan or outsourced, how many, and should Pakistan agents see full passports or issue tickets (`desk.issue`)?
2. **Refund and goodwill limits.** What can a support agent approve alone (SAR per refund or credit, per day) before a lead or partner must approve? Should refunds above that go through the existing Ops Approvals?
3. **App money in Ops finance.** Should captured app sales post into Ops sales, close and Day-25 settlement as their own channel (and count toward partner settlement), or stay a separate app P&L?
4. **CSAT and drop-off outreach.** May we ask travellers to rate a resolved chat (one tap), and may agents contact people who abandoned a pay sheet (WhatsApp, call), and within what consent window?
5. **Ask take-over.** When an agent takes over an Ask thread, should the traveller see it ("Noura joined"), and may agents read every Ask transcript or only ones that were handed off?
6. **Night cover.** Is there a real 24/7 rota from launch, or should breaches outside working hours page an on-call partner by phone?

## 7. Defaults the coordinator chose (21 Oct, owner asleep; change any of these later)

| # | Question | Default built |
|---|---|---|
| 1 | Who the agents are | Agents in Riyadh to start. Support agent role: no `desk.issue`, passports masked (last 3 characters); Support lead: `desk.issue`, full passport behind a reveal that is audited. |
| 2 | Refund and goodwill limits | Settings with defaults: an agent alone up to SAR 500 per refund, SAR 2,000 per day, goodwill credit up to SAR 200; above that a lead approves through Ops Approvals. All amounts are editable settings, not code. |
| 3 | App money in Ops finance | Captured app sales post to Ops as their own channel "app" (dashboard, daily close), shown separately; excluded from partner settlement behind a setting `APP_SALES_IN_SETTLEMENT=no` until the owner says yes. |
| 4 | CSAT and drop-off outreach | One-tap rating after a resolved chat or ticket (skippable, asked once). Drop-off outreach: in-app or push only, within 48 h; WhatsApp or a call only when the traveller already chose that contact on a request. |
| 5 | Ask take-over | The traveller sees "Noura from Mada joined" (a real, named agent only). Agents read Ask transcripts that were handed off or belong to a customer with an open ticket; leads can read any, and every read is audited. |
| 6 | Night cover | The rota decides; an urgent breach with nobody on duty pages the on-call lead by push and SMS (setting `DESK_ONCALL_PHONE`). |

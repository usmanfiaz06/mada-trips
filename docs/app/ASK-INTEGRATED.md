# Ask Mada, integrated: chats, living plans, one connected trip

**Status:** design spec, 21 Oct 2026. Nothing here is built yet.

**Built so far:** U1, the data model and conversations list (migration `0042_ask_threads_list`; `ask-chat/{titles,attach,threads}.ts`; `GET/PATCH/DELETE /ask/threads[/{id}]`; app `ask/index.tsx` list + `ask/[threadId].tsx`; tests `ask-threads.test.ts`, `e2e-ask-chats.mjs`; screens `ai-u1-chats-en/ar.png`, `ai-u1-thread-en.png`). Choices made inside U1: `titled_by` records how the automatic title was made (`words` → `place` → `route` → `trip`, only ever climbing) or `traveller`; the desk list shows a title only when it was made from what was read (place, route, trip), never from the traveller's words; the attach question is asked before any chat exists, so "Yes, that trip" never leaves an empty chat behind. U1+ built with it: search over titles, trip places and every line said (the row shows the matching line and the chat opens there, marked), groups Today / Yesterday / This week / This month / Earlier, filters All · Trips · Upcoming · Past · Archived, the day over the first message of each day, and a message's time on long-press. Find in an open chat: the header's search, a count ("2 of 5"), previous and next; the searched words are marked in the list's matching line; a message's time also shows on hover on the web.

**U6 built (documents in chat):** migration `0046_ask_attachments` (`app_people.passport_fingerprint`, `app_documents.fingerprint`, `app_ask_attachments`, `app_doc_share_requests`); `documents/fingerprint.ts` (HMAC-SHA256 of kind, issuer, number, date of birth; pepper `APP_FINGERPRINT_KEY` or derived from `APP_DATA_KEY`), written on every passport save and filled for older ones by the hourly `documents` job (each number decrypted once) or on the spot when a passport arrives; `ask-chat/attachments.ts` (read → card → tap), `ask-chat/doc-shares.ts`, `ask-chat/tools-docs.ts` (`documents_on_file`, `use_document`, `request_document_share`); `POST /ask/attachments`, `POST /ask/attachments/{id}` (the tap), `GET/POST /ask/shares/{id}`; the composer's + (`lib/ask-docs.ts`, `DocCards.tsx`, `app/ask/share/[id].tsx`); tests `ask-docs.test.ts`, `e2e-ask-docs.mjs`; screens `ai-u6-have-it-en/ar.png`, `ai-u6-whose-en.png`. Choices made inside U6: the card and the model say only the **last two characters** (what the mask `A08•••41` already shows), not three; `(owner, fingerprint)` is indexed, not unique (an old household with a duplicate would fail the migration), and "never twice" is enforced where passports arrive; a renewed passport offers `[Replace] [Keep the old one]` (one passport per person, so no "keep both"); picking a name on "Whose passport is this?" opens that person's add/consent card rather than saving (the lines' names replace the person's on save); the consent card applies to friends, colleagues, helpers and anyone new, not to family; "This booking only" wipes the number at trip end + 1 day (7 days without a trip), keeping the mask and expiry; there is no server OCR yet, so a photo the phone couldn't read is kept encrypted for 24 h and answered "We couldn't read the bottom two lines"; the passport rule against the trip is the 6-month default (`passportReady`), not yet per destination; `request_document_share` needs a companion's user id, which only U5's tools hand the model.

Builds on [ASK-CHAT.md](ASK-CHAT.md) (engine, tools, §7 memory, §8 desk take-over), [ASSISTANT.md](ASSISTANT.md) (how Mada talks), [FLOWS.md](FLOWS.md), [EXPERIENCE.md](EXPERIENCE.md), [DESK-PLAN.md](DESK-PLAN.md) (U3 customer 360, U5 Ask on the desk).

**U3 built (Ask tools for plans):** `ask-chat/tools-plan.ts` with `create_plan`, `get_plan`, `update_plan`, `set_origin`, `find_for_item`, `open_in_app` (strict schemas, last in the tool list so the cached prefix holds); the model reads a gist with item ids shortened to 8 characters (`[a1b2c3d4]`) and days as `D1…`, and the rule "no drive km or times yet" while U4 hasn't measured them; cards `plan`, `plan_diff` and `link` (shared `ask-chat.ts`, app `PlanCards.tsx`); a plan made in a chat attaches the chat to its trip and the title follows the route ("Riyadh → Singapore → Penang · 12–18 Dec", RTL arrow in Arabic); the turn's context carries the plan's id and version and one line for changes made by the traveller, the desk or a booking since the last message, marked seen after the turn; the sentence gate holds a km or an hour no tool returned ("within 2 hours" stays a promise); "never say we don't do it" in ASSISTANT.md §1/§1a and the `never-no` eval check with 8 new conversations (mocked in `ask-plan.test.ts`). Choices made: "Review the plan" opens the trip page until the plan screen lands (U8); `find_for_item` runs the live search for flights from RUH/JED/DMM and stays in a live destination, and hands anything else to `create_request` with the plan's dates filled in (cards aren't tagged with the item yet: U7 sets `priced`); openai-compatible providers get the plan tools and a short plan block in the compact prompt only on a turn that reads as a plan (road trip, N-day trip, «رحلة برية», a chat whose trip has a plan), which keeps the token budget.

**U5 built (companions):** migration `0045_trip_travellers`: `app_trip_travellers` with role owner/view/suggest/edit and status going/invited/declined, `app_people.linked_user_id`, `app_trip_sharing.share_prices`, `app_plan_change_requests`; `trips/{travellers,change-requests}.ts`; `ask-chat/tools-people.ts` with `add_traveller`, `remove_traveller`, `shared_trip`, `request_change`, `decide_change`; `GET/POST/PATCH /trips/{id}/travellers`, `PATCH/DELETE …/{travellerId}`, `POST …/invite`, `GET /trips/{id}/change-requests/{id}`, `POST …/decide`, `GET /trips/shared[/{id}]`, `POST /trips/shared/invites/{id}/accept|decline`; app cards `ChoiceCard`, `InviteCard`, `ChangeRequestCard`, screens `trip/[id]/travellers.tsx` and `trip/[id]/shared.tsx`, "Shared with you" on Trips; tests `trip-travellers.test.ts`, `e2e-ask-people.mjs`; screens `ai-u5-*`. Choices made inside U5: a single friend on Mada is never added by the tool on its own, he comes back as a one-row choice card, because adding him tells him about the trip (§5.2, the tap is the consent); a friend picked is "invited" in his app until he says yes; a circle companion gets a household row linked to him (`person_id` + `user_id` on his traveller row) so the plan, searches and the pay sheet count him and `traveller_ids` stays the household cache; an older writer's `traveller_ids` is caught up on the next read; more nights at a booked stay can be asked for (it costs money, so the owner approves and it becomes a new stay idea to book on his pay sheet), anything else booked can't; a change card is kept whole on the line Mada adds to each chat (`kept`) and read again live; the 24 h reminder and 48 h close run with the quotes job. Not built: the shared trip chat (U8).

**U7 built (booking from the plan):** `planItemIds` on every `OrderDraft` kind that books (trip, stay, eSIM, quote) and `tripId` on a flight draft; `lib/app/plans/booking.ts` (`priceItems`, `esimOffer`, `linkRequest`, `linkOrder`, `resolveItemIds`, `bookReady`); `GET /trips/{id}/plan/ready`; the pay sheet's "Book what's ready" (`/pay?plan=<tripId>`, `components/booking/BookReady.tsx`): every priced item and open desk quote ticked by default with its own lines, one total that follows the ticks, "Demo fare · not bookable" on a sample fare and on the total, the items whose price ran out apart with "Price again" (opens the trip's chat with the words). Each ticked item is its own order through the same `POST /orders`; `order.created` (plans/events.ts) links the items to it (held → booked) and puts the order on the plan's trip, and once confirmed the item moves onto the stay, flight or eSIM the order wrote (`relinkOrders`), so no second item appears; a refund that cancels the stay cancels the item. `create_request` takes `item_id` and the kinds `car_rental` and `driver` (request-only, §13.6; `details.car`); migration `0047_request_plan_item` (`app_requests.plan_item_id`); the item reads "With the team · back by 18:40", then "Quote ready · SAR 650" when the desk quotes. `price_quote_for_pay` takes `item_ids` (the gist's 8-character ids): the choice prices the items and the draft carries them. Plan reads gain `price`, `quote`, `promisedBy`, `priceExpired` per item and `totals` (tool, quote and booking prices only); the plan card shows "Ready to book · SAR …" with [Book what's ready]. Choices made: a room stays "Booked" after the desk confirms the order until the hotel's own reference is in (§3.2: the item never claims confirmed on its own); a declined card leaves the item priced; each item is charged as its own order (no new payment code), with credit off on this sheet. Tests `booking-plan.test.ts`, `e2e-book-ready.mjs`; screens `ai-u7-book-ready-en/ar.png`.

**What the owner asked for (gist):** several chats instead of one, so two trips never mix. Mada creates the plan ("here is your 7-day road trip, review it"), the plan names the hotel and the car status, booking from the plan updates it, and the trip keeps its chat. Every plan has a starting point and is named "Riyadh → AlUla"; change the start and it re-plans. Add Abdullah as a companion and ask which Abdullah when there are several. Map the daily drives. Never "we don't do that". A passport sent in chat goes into Documents, and we never ask for the same passport twice. One experience where every action updates everything linked to it.

**The rule this spec enforces:** *a fact lives in one place and every screen reads it from there.* The chat never holds its own copy of a hotel, a traveller or a passport. It holds references to them, and it changes them through the same functions the app's screens call.

---

## 0. What exists today (the starting point)

| Area | Today | Gap against the vision |
|---|---|---|
| Ask threads | `app_ask_threads`: one row per conversation, `messages` + `transcript` + `summary`, `mode` ai/agent (0034, 0035, 0038). The phone keeps **one** thread id and restores it within 24 h (`mada.ask.chat.v1`). `POST /ask/chat` takes `tripId` as context only. | No list, no title, no link to a trip, no archive. Two trips share one thread. |
| Plans | `PLANS` in `packages/shared/src/schemas/booking-data.ts`: two hard-coded `CuratedPlan`s (`alula2`, `istanbul3`), with `day → stops{time, icon, title, note}`. `GET /plans`, `GET /plans/{id}` price them per household. `app/ask/plan/[id].tsx` shows them; "Book it all" sends `{kind:'package', planId}` to `/pay`. Saved via `app_saved(kind='plan')`. | Static. No origin, no travellers, no legs, no per-item status, no link to the bookings it causes. |
| Trips | `app_trips` (**one** `city`, `start_date`, `end_date`, `traveller_ids`, `status`), `app_segments` (flights), `app_stays`, `app_pickups`, `app_trip_bookings` (order ↔ trip), `app_trip_ideas` (activities pinned to a day), `app_trip_facts`. | Single city. A road trip through 4 cities can't be expressed. No origin. |
| Travellers | `app_people` (household; passport number AES-encrypted in `passport_number_enc`, `passport_number_masked`, `passport_expiry`), `app_person_details` (iqama, meal). Circle members are `app_users` via `app_circle_members`, `app_friendships`; invites in `app_circle_invites` (app / link / sms / whatsapp, phone encrypted). | A friend who travels with you has no "traveller" row of yours, and you can't hold their passport with consent. |
| Documents | `app_documents` (per person, `kind`, `fields`, `valid_until`, `file_id` → `app_files` with a per-file AES key), `app_document_grants` (time-boxed share to the desk/trip). Passport flow `app/passport/*`: on-device ML Kit OCR → shared `findMrz` (ICAO check digits) → confirm → `PUT /passport` or `/people/{id}/passport`. | Only reachable from Wallet. Ask can't take a photo or file. No dedupe check against what's stored. |
| Requests and pay | `app_requests` (the desk pipe, `details` jsonb, `trip_id`), `app_orders` (draft, snapshot, `trip_id`), `price_quote_for_pay` → `OrderDraft` → the app's pay sheet. | A booking made from chat isn't tied back to a plan item. |
| Cars and transfers | `plan_car_now` (a card only), `transfers/service.ts` (airport transfers on a trip), `rides/service.ts` (ride now). | No self-drive rental, no "car for days 2–6". |
| Maps | `react-native-maps` (`StaysMap`), `DrawnMap`, `GOOGLE_MAPS_ANDROID_API_KEY` (Android map tiles), Nominatim geocoding via `/geocode` (cached in `app_geocodes`). | No routing. |
| Memory | `app_ask_memory` (home_airport, cabin…), consent for sensitive kinds. | Home airport isn't used as a plan origin. |

---

## 1. Object model and links

### 1.1 The graph

```
                ┌──────────────── Memory (app_ask_memory: home_airport, needs…)
                │                         │ origin default, needs
                ▼                         ▼
 Conversation ──1:1 (optional)──▶ Trip ◀──1:1──▶ Plan (living itinerary)
 app_ask_threads   trip_id          app_trips        app_plans + app_plan_items
      │                               │  ▲                 │ item.booking_ref
      │ mentions (refs only)          │  │ trip_id         ▼
      │                               │  └──── Bookings: app_orders/app_trip_bookings → app_segments,
      │                               │        app_stays, app_pickups, app_esims, app_trip_ideas, car rentals
      │                               │  ◀──── Requests (app_requests.trip_id, + plan_item_id)
      │                               ▼
      └──────────────────────▶ Travellers (app_trip_travellers: household person | circle user | invitee)
                                      │
                                      ▼
                               Documents (app_documents per person; app_document_grants for sharing)
```

- A **conversation** may be attached to at most one trip; a trip has at most one *primary* conversation (more can exist; the trip page opens the primary).
- A **plan** belongs to exactly one trip. Creating a plan creates the trip in `status = 'planning'` (no booking yet). The trip becomes "booked" when its first item is booked.
- A **plan item** points to the booking that fulfils it (`booking_kind` + `booking_id`), or to the request working on it (`request_id`). The booking tables stay the source of truth for price, status and confirmation; the item shows them.
- A **trip traveller** is either a household person (`person_id`), a Mada user from the circle (`user_id`), or a pending invite (`invite_id`). Documents always hang off a person row, so a circle companion whose passport you hold gets a person row in *your* household with `linked_user_id` set (§5.4).

### 1.2 New tables and columns (migration `0042_ask_integrated.sql` and later)

| Table / column | Type | Unit | Why |
|---|---|---|---|
| `app_ask_threads.title` | text null | U1 | "Riyadh → AlUla · 20–22 Nov". Null until the first turn names it. |
| `app_ask_threads.trip_id` | uuid null → `app_trips` (set null) | U1 | The trip this chat is about. Index `(owner_id, trip_id)`. |
| `app_ask_threads.archived_at` | timestamptz null | U1 | Archive without deleting. |
| `app_ask_threads.last_at` | timestamptz not null default now() | U1 | Sort the list; updated in `appendTurn`/`appendLine`. Index `(owner_id, archived_at, last_at desc)`. |
| `app_ask_threads.preview` | text null (≤ 140, redacted) | U1 | The last line, for the list. Written from the transcript, never from `messages`. |
| `app_ask_threads.ended_at` | timestamptz null | U1 | Set when a thread hits `MAX_TURNS` (60): the list shows "Continue in a new chat" with the trip carried over. |
| `app_trips.origin` | jsonb null `{kind: airport|city|place, code?, name, lat?, lng?, source: memory|profile|said|default}` | U2 | Every trip has a start. |
| `app_trips.title` | text null | U2 | Derived "Riyadh → AlUla"; null means derive at read time. Set only when the traveller renames. |
| `app_trips.kind` | text not null default 'simple' (`simple` \| `multi` \| `road`) | U2 | A road trip and a multi-city trip have several places; `city` stays the main destination for old code. |
| `app_plans` | new | U2 | `id`, `trip_id` (unique), `owner_id`, `version` int, `origin` jsonb (copy of trip origin at plan time), `return_to` jsonb null, `start_date`, `end_date`, `pace` (easy/normal/full), `template_id` text null (`alula2`…), `notes` text[], `checks` jsonb (§3.4), `created_by` (`ask`/`template`/`desk`), `created_at`, `updated_at`. |
| `app_plan_items` | new | U2 | `id`, `plan_id`, `day` int (0-based, null for whole-trip items such as eSIM or insurance), `sort` int, `kind` (`leg`, `stay`, `car`, `activity`, `meal`, `note`, `check`), `mode` (for legs: `flight`, `drive`, `train`, `ferry`, `transfer`, `walk`), `title`, `place` jsonb `{name, city, country, lat, lng}`, `from_place` / `to_place` jsonb (legs), `starts_at` / `ends_at` (local text `YYYY-MM-DDTHH:mm`, plus `tz`), `nights` int (stays), `status` (§3.2), `booking_kind` (`segment`, `stay`, `pickup`, `esim`, `idea`, `rental`, `order`) + `booking_id` uuid null, `request_id` uuid null, `offer_id` uuid null (a priced option the traveller hasn't paid), `drive` jsonb null (§4), `source` (`ask`, `manual`, `template`, `desk`, `booking`), `deleted_at`. Index `(plan_id, day, sort)`. |
| `app_plan_events` | new | U2 | `id`, `plan_id`, `item_id` null, `at`, `by_kind` (`ask`, `traveller`, `desk`, `system`), `op` (`create`, `add`, `move`, `update`, `remove`, `status`, `origin`), `diff` jsonb (redacted, ≤ 2 KB), `seen_in_thread` bool. The audit trail and the "what changed while you were away" feed for the chat (§3.6). |
| `app_trip_travellers` | new | U5 | `trip_id`, `id`, `person_id` null → `app_people`, `user_id` null → `app_users`, `invite_id` null → `app_circle_invites`, `role` (`owner`, `companion`), `status` (`going`, `invited`, `declined`), `added_by_kind` (`ask`, `traveller`), `created_at`. Check: exactly one of person/user/invite. `app_trips.traveller_ids` stays as a cache written from this table (old readers keep working). |
| `app_people.linked_user_id` | uuid null → `app_users` | U5 | A household row that stands for a circle member (Abdullah, a friend), so his passport can sit in your Documents with his consent. |
| `app_people.passport_fingerprint` | text null | U6 | HMAC-SHA256(pepper, issuer + number + dob). Equality check for "same passport again" without decrypting. Unique per `(owner_id, passport_fingerprint)` where not deleted. |
| `app_documents.fingerprint` | text null | U6 | Same HMAC for passports, visas (issuer + number), IDs. |
| `app_ask_attachments` | new | U6 | `id`, `thread_id`, `owner_id`, `file_id` → `app_files` (purpose `ask`), `kind_guess` (`passport`, `visa`, `id`, `ticket`, `booking`, `photo`, `other`), `result` jsonb (redacted: masked number, expiry, matched person id), `document_id` null, `status` (`read`, `confirmed`, `discarded`), `created_at`. Discarded files are deleted from storage after 24 h. |
| `app_requests.plan_item_id` | uuid null | U7 | A request done by hand that fulfils a plan item. |
| `app_drive_cache` | new | U4 | `key` (hash of rounded from/to, mode, avoid flags, day-of-week bucket), `provider`, `distance_m`, `duration_s`, `borders` jsonb, `tolls` bool, `polyline` text null, `fetched_at`, `expires_at`. Retention per the provider's terms (§4.3). |

Nothing existing is renamed or dropped. `PLANS` stays as templates.

### 1.3 Event map: every write and what it updates

All writes go through one function per object (`plans.ts`, `trip-travellers.ts`, the existing booking/document functions). Each write emits a domain event (`lib/app/live` or a new `lib/app/events.ts` with `emit(kind, payload)`); listeners update caches, notify, and append a `plan_event`. The app invalidates React Query keys by event kind (pushed as a silent notification on native, or picked up on focus).

| Write | Source table | What updates (screen → why) |
|---|---|---|
| Plan created | `app_plans`, `app_plan_items`, `app_trips` (planning) | Ask: plan card. Trips tab: new "Planning" trip card titled "Riyadh → AlUla". Trip page: Plan tab. Conversation list: title + trip chip. Desk U3 customer: "Planning: Riyadh → AlUla, 20–22 Nov". Today: nothing until 7 days before. |
| Origin changed | `app_trips.origin`, legs re-planned | Trip title everywhere ("Jeddah → AlUla"), plan legs 0 and last, open offers on those legs marked stale, chat gets a plan diff card, desk U3 line. |
| Item added / moved / removed (by Ask or by hand) | `app_plan_items`, `app_plan_events` | Plan screen (day), trip timeline, plan card in the chat updates in place (version), a "you changed day 3" line in the thread on next open (§3.6). |
| Stay booked (pay sheet confirmed or desk confirmed) | `app_orders` → `app_trip_bookings` → `app_stays` → item `status=booked`, `booking_*` set | Plan day N shows the hotel name and "Booked", every night it covers. Trip timeline: check-in row. Wallet: voucher when issued. Desk board (U4): order in its lifecycle tab. Today card: from 1 day before ("Check in at … after 15:00"). Ask thread: "Booked: … nights 2–4" line. Money tab: the charge. |
| Flight booked | `app_segments` | Plan legs, trip timeline, boarding/Live Activity flow (existing), Today on the day, flight-status tracking (existing), the drive leg from the airport re-anchors to the arrival time. |
| Car rental booked or requested | `app_plan_items(kind=car)` + rental booking or `app_requests(kind='car_rental')` | Every drive leg in its date range shows "Car: booked · Toyota Fortuner" or "Car: requested". Pickup/return rows on days N/M. Today on pickup day. Desk board. |
| Transfer booked | `app_pickups` | Plan leg mode `transfer` shows driver when known; trip pickup screen (existing). |
| eSIM bought | `app_esims` (trip_id) | Plan check "eSIM" goes green; Wallet eSIM; Today install nudge the day before (existing). |
| Activity booked / pinned | `app_trip_ideas` or order | Plan day stop with status; trip Things. |
| Request created from plan | `app_requests(plan_item_id)` | Item `status=requested` with "The team gets back by 18:40"; Trips → Requests; desk inbox with a link to the plan. |
| Request answered (quote) | `app_quotes` | Item shows "Quote ready · SAR 4,200" with Pay; Ask thread line; push. |
| Traveller added | `app_trip_travellers` (+ invite) | Plan header avatars, every search the plan runs counts them, pay sheet traveller list, circle (the trip circle if one exists), entry check re-runs (§3.4). |
| Companion accepts invite | `app_circle_invites` → `accepted`; `app_trip_travellers.status=going` | Owner: push "Abdullah joined Riyadh → AlUla", plan avatars. Abdullah: the trip appears in his Trips tab (read view, §5.5). |
| Document saved / confirmed from chat | `app_documents`, `app_people.passport_*`, `app_ask_attachments` | Wallet → Documents, household person page, plan check "Passports" re-evaluated, entry check, pay sheet stops asking. |
| Document expires within the trip + 6 months | derived nightly | Plan check turns amber; Today; Ask opens the next turn about this trip with it. |
| Desk takes the thread over / hands back | `app_ask_threads.mode` | Unchanged (ASK-CHAT §8). The list row shows "Noura from Mada is here". |
| Memory fact saved (home airport) | `app_ask_memory` | Next plan's origin default; Account → What Mada remembers. |

---

## 2. The conversations list

### 2.1 What Ask opens to

- Ask (the orb, Today shortcuts, `/ask`) opens the **list** when the traveller has at least one non-archived thread; otherwise it opens a new chat straight away (no empty list for new people).
- Exception, kept from today: if the last turn was under 24 h ago **and** Ask was opened from the orb, it opens that conversation directly with a back arrow to the list (continuity with `restoreAskChat`). From a trip page it opens that trip's chat. With `?prefill=` it opens a new chat unless the prefill names a trip that has one (`plan.changePrefill` → that trip's chat).
- The composer sits at the bottom of the list too: typing there starts a new chat (or attaches, §2.2). The list is never a wall between the traveller and asking.

### 2.2 New chat or continue: the attach rule

Run on the server in `chat.ts` at the first turn of a thread without `trip_id`, after slots are read:

| Signal in the first message (slots) | Action |
|---|---|
| A trip id passed (`tripId` from the trip page) | Attach. |
| Destination matches an upcoming trip's place (any plan stop city or `app_trips.city`) **and** dates overlap or are absent | Ask once with a choice card: "About your Singapore–Malaysia trip in Dec?" → `[Yes, that trip]` `[Something new]`. Yes moves this message into that trip's thread (the server returns `thread` with the existing id and a `moved` flag; the new empty thread is deleted). |
| Destination of a trip in the past | New chat (the past trip is context only). |
| No destination yet (an eSIM, "how much is a visa") | New chat, unattached. It attaches later when a plan or a booking creates/names a trip. |
| A booking made in an unattached chat creates a trip | Attach the thread to that trip. |

- One trip, one primary thread: `app_trips` keeps no pointer; the primary is the oldest non-archived thread with that `trip_id`. "Ask about this trip" on the trip page opens it, or starts one attached.
- Two trips in one chat: when the traveller pivots to a different destination mid-thread ("also, Istanbul in March"), Mada answers and offers `[Start a chat for Istanbul]`. Tapping it opens a new thread with that message carried over. It never splits silently.

### 2.3 Titles

- Derived on the server after each turn until the traveller renames (`title_locked` is implied by a manual rename, stored as `title` + a `titled_by` text column `auto|traveller`, part of U1).
- Format: `<origin> → <destination>[ → …] · <dates>` when a plan or trip exists ("Riyadh → AlUla · 20–22 Nov", «الرياض ← العلا · ٢٠–٢٢ نوفمبر» with the RTL arrow), else the kind and place ("eSIM for Pakistan", "UK visa for 2"), else the first 6 words, redacted.
- Dates: same month "20–22 Nov", across months "28 Nov – 3 Dec", undated "Dec". Arabic uses Arabic-Indic digits only if the app's number setting says so (ARABIC.md).

### 2.4 The list

- Rows: title, trip chip (status: Planning / Booked / Today / Done), preview (redacted last line), relative time, an unread dot for desk replies, "Noura from Mada is here" when `mode=agent`.
- Sections: **Upcoming trips** (attached to a trip that hasn't ended, sorted by trip start), **Recent** (others, by `last_at`), **Archived** behind a row at the bottom.
- Search: `GET /ask/threads?q=` over `title`, `preview` and trip place names (ILIKE on the server; no message bodies are searched or indexed). 30 per page, cursor on `last_at`.
- Archive: swipe (iOS) / long-press menu (Android) / an Archive action in the chat menu. Archived threads keep working when opened; sending a message unarchives. Delete is in the chat menu behind a sheet; deleting a chat never deletes its trip or plan.
- Endpoints (U1): `GET /ask/threads` → `{threads: [{id, title, tripId, tripStatus, preview, lastAt, mode, unread, archived}] , next}`; `GET /ask/threads/{id}` → `{thread, transcript, plan?}` (the transcript the app shows, so a thread opens on any device, not only the one that kept it); `PATCH /ask/threads/{id}` `{title?, archived?}`; `DELETE /ask/threads/{id}`.

### 2.5 Continuity and the desk

- The phone's kept copy (`mada.ask.chat.v1`) becomes a small cache keyed by thread id (last 3 threads, 8 turns each), so opening a recent chat paints instantly; `GET /ask/threads/{id}` refreshes it. The 24 h rule only decides whether the orb jumps into the last chat.
- "New chat" stays in the top bar of a conversation.
- Desk take-over is per thread and unchanged: `mode`, `taken_by`, `desk_note`, polling `GET /ask/chat/desk?threadId`. The desk transcript page (U5) shows the title, the trip chip and a "Plan" link (§10).
- Fold, spend and limits stay per thread and per person as today. `MAX_TURNS` 60 → at the end the thread shows "This chat is full. Continue in a new one" and the new one carries `trip_id` and the plan, so nothing is lost.

---

## 3. The living plan

### 3.1 Structure

```
Plan  (trip: "Riyadh → AlUla", 20–22 Nov, 3 travellers, pace easy)
├─ origin: Riyadh (RUH) · source: memory "Flies from Riyadh"
├─ return_to: Riyadh (default = origin)
├─ travellers: Omar (you), Sara, Abdullah (invited)
├─ checks (whole trip): Passports ✓ · Visa: not needed ✓ · eSIM: — · Insurance: — · Car: needed days 1–2
├─ Day 1 · Thu 20 Nov
│   ├─ leg   flight RUH → ULH 07:30–08:50       status: idea   (offer held? no)
│   ├─ car   pickup at ULH 09:15, return day 2  status: idea   "Book a car"
│   ├─ stay  Desert resort, nights 1–2          status: booked (app_stays …) "Habitas AlUla" only if booked/held
│   ├─ act   Old Town 16:00                     status: idea
│   └─ act   Elephant Rock 18:10                status: idea
└─ Day 2 · Fri 21 Nov
    ├─ leg   drive Resort → Hegra 38 km · 35 min
    ├─ act   Hegra tour 09:00 (2.5 h)          status: requested (A-2291, back by 18:40)
    └─ leg   flight ULH → RUH 19:40             status: idea
```

- **Legs** connect places in order. The first leg starts at the origin; the last ends at `return_to` (a one-way trip has none). Modes: `flight`, `drive` (self-drive or a driver), `train`, `ferry`, `transfer` (booked car with driver), `walk`.
- **Stays** are per night range; every night between the first arrival and the last departure is either covered by a stay item, marked "no stay needed" (`app_trip_facts.no_stay` already exists: family, own flat), or shows a gap ("Night 3: no stay yet").
- **Car** is one item per rental with a date range; drive legs inside the range read their status from it. Outside a rental a drive leg shows "No car for this day".
- **Activities and meals** are timed stops with an optional `refKind/refId` (an activity from the catalogue, an experience, an event), reusing `app_trip_ideas` when pinned.
- **Notes** are short lines ("Hegra is closed on Tuesdays") with a `source`: a tool result or the traveller. Mada never writes an opening time or a price as a note unless a tool returned it.
- **Checks** (§3.4) are computed, not typed.

### 3.2 Statuses per item

| Status | Meaning | Who sets it | Shown as |
|---|---|---|---|
| `idea` | Suggested, nothing priced or held | Ask, template, traveller | Outline, "Idea" |
| `priced` | An offer exists (`offer_id`) with a price from a tool, not paid | Ask after a search | "SAR 1,240 · price as of 14:05" (offers expire: §7.4) |
| `requested` | The desk is working on it (`request_id`) | `create_request` | "With the team · back by 18:40" |
| `held` | Supplier hold or desk hold, payment pending | booking flow / desk | "Held until 18:00" |
| `booked` | Paid, awaiting supplier confirmation | pay sheet | "Booked" |
| `confirmed` | Supplier confirmation or ticket number in hand | supplier / desk | "Confirmed · ref ABC123" |
| `cancelled` | Was booked, now cancelled | refund flow | struck through, kept for history |
| `skipped` | Traveller doesn't want it | traveller | hidden behind "Show skipped" |

Status of booked items is **read** from the booking row (`app_stays.status`, `app_segments.status`, `app_orders.status`) at read time, and cached on the item by the event listener. The item never claims "confirmed" on its own.

### 3.3 The "review your plan" card (in chat)

- New `ChatCard` `{type:'plan', planId, version, title, dates, travellers:[{name, initial, status}], days:[{label, summary, statuses}] (≤ 7 rows, 1 line each), checks:[{key, state}], totals:{priced, booked, currency} | null, actions}`. Totals only sum items whose price came from a tool or a booking; otherwise the line is absent (never an estimate).
- Actions: `[Review the plan]` (opens the plan screen), `[Book what's ready]` (only when ≥ 1 item is `priced`), and up to 2 of Mada's next steps ("Add a car for days 1–2", "Change the start").
- The card updates in place: the transcript stores `{type:'plan', planId}` and the app renders the current version; a "Updated 2 min ago" line appears when the version is newer than when it was sent.
- Later turns that change the plan send a **diff card** `{type:'plan_diff', planId, from, to, changes:[{op, day, title}]}` ("Added: Habitas AlUla, nights 1–2 · Moved: Hegra to day 2 morning") instead of the whole plan.

### 3.4 Checks (whole-trip items)

| Check | Computed from | States |
|---|---|---|
| Passports | each traveller's passport on file, expiry vs `end_date` + 6 months (or the destination's rule from `checkEntry`) | ✓ / missing (who) / expires (who, when) |
| Visa / entry | `checkEntry` per nationality per country on the route (a road trip Singapore → Malaysia checks both, and the land border) | ✓ not needed / needed (link to the visa request) / unknown → request |
| eSIM | `app_esims` with this `trip_id` or covering the countries | — / bought / installed |
| Insurance | an order line or a stated "we have our own" | — / covered / said not needed |
| Car | drive legs without a rental or driver | ✓ / needed days N–M |
| Stays | nights without stay or `no_stay` | ✓ / gap nights |
| Money | unpaid holds and quotes with expiry | ✓ / "Pay by 18:00" |

Checks never block; they are the plan's to-do list and they feed Mada's next steps ("Two things left: a car for days 1–2 and Abdullah's passport").

### 3.5 How the agent edits it

Tools (schemas in §8): `create_plan`, `get_plan`, `update_plan` (a list of item ops: `add`, `update`, `move`, `remove`, `set_status` limited to `idea|skipped`), `set_origin`, `add_traveller`. Rules:

- The model proposes, the server places: `create_plan` takes the shape (places, nights per place, pace, must-dos) and the server builds days, legs and drive times (§4), timing stops with fixed rules (no drive over 5 h a day without a stop, check-in after 15:00, a meal near 13:00 and 20:00 by default). The model never writes a time it didn't get from a tool or the traveller; template times are tool output.
- Every op is versioned: `update_plan` takes `version`; a stale version returns `is_error` "The plan changed (version 7). Read it again." so a manual edit in the plan screen is never overwritten.
- Booked/confirmed items can't be moved or removed by the agent. It offers the change flow instead ("Change the hotel dates" → `app/trip/[id]/change.tsx`).
- After each change the tool result gives the model a ≤ 600-char gist of the plan (day labels, item titles, statuses), not the whole object.

### 3.6 Manual edits flow back

- The plan screen edits through the same `plans.ts` functions (`PATCH /plans/{id}/items/{itemId}`, `POST /plans/{id}/items`, `DELETE …`). Each writes a `plan_event` with `by_kind='traveller'`, `seen_in_thread=false`.
- The next turn in that trip's thread gets one context line: `Since the last message the traveller changed the plan: moved Hegra to day 2 09:00; removed Harrat Viewpoint.` and the events are marked seen. Mada uses it, doesn't recite it.
- Desk edits (`by_kind='desk'`) do the same and also add a visible line in the chat: "The team at Mada updated your plan: hotel confirmed."

### 3.7 Templates replace the samples, samples stay as templates

- `PLANS.alula2`, `PLANS.istanbul3` become **templates**: `GET /plans` keeps returning them for the discover cards (unchanged contract). "Use this plan" (new button) calls `create_plan {template_id}` with the traveller's origin, dates and household and opens the new living plan. The old `{kind:'package', planId}` pay path keeps working for templates until U7 moves "Book it all" onto plan items.
- A template becomes data: move `CuratedPlan` stops to `{dayOffset, kind, mode, title, note, place, at}` with places resolved, so the AlUla template knows its flight is ULH. The "Riyadh → AlUla" stop title becomes a leg from `origin`.
- New templates are added by the desk later (out of scope here); Ask generates plans from scratch for any place.

### 3.8 Origin

- Order of defaults: (1) said in this conversation, (2) `app_ask_memory.home_airport`, (3) the city of the traveller's last booked outbound flight, (4) profile country → main airport (SA → RUH), (5) ask. When the default came from 2–4, the plan card says it in one line: "Starting from Riyadh. Change". When nothing is known: one question with chips `[Riyadh] [Jeddah] [Dammam] [Somewhere else]`.
- Saying a new start ("we're leaving from Jeddah") offers `remember` for home airport only if it sounds lasting ("we live in Jeddah now"); a one-off start is just `set_origin`.
- `set_origin` re-plans: the first and last legs are rebuilt (RUH→ULH flight becomes JED→ULH flight, or a drive if under 6 h by road and the traveller prefers driving), `priced` items on those legs drop to `idea` with "price needs checking again", booked items are never touched and Mada says what that means ("Your Riyadh flight is booked. Shall we change it to Jeddah, or add Jeddah → Riyadh first?" with chips).
- Title follows the origin everywhere (§2.3), unless renamed.

---

## 4. Drives

### 4.1 What a drive leg shows

`Riyadh → AlUla · 1,100 km · about 11 h 10 min · 1 stop suggested` and, for a border: `Johor Bahru → Singapore via Woodlands Causeway · border crossing: passports, car permit (VEP) for a Malaysian rental`. Per leg: distance, duration (traffic-free and typical), tolls yes/no, ferries, border crossings (country codes and crossing name), and a tiny route map.

### 4.2 Data sources compared

Prices change; the figures below are the public list prices as of this writing and must be re-checked on each vendor's pricing page before U4 ships.

| Option | Coverage (GCC, SE Asia, Turkey) | Borders / tolls / ferries | Commercial terms | Cost at our scale (~20k legs/month after caching) | Fit |
|---|---|---|---|---|---|
| **Google Routes API** (Compute Routes) | Best, incl. Saudi, Malaysia, Singapore; Arabic names | Tolls (`tollInfo`), ferries (`avoidFerries`), country changes visible in step data | Allowed for commercial apps. Restrictions: content shown with a map must be on a Google map; caching limited (lat/lng up to 30 days, other content not beyond short-term) | Free monthly usage cap per SKU, then about USD 5 per 1,000 (Essentials). Roughly USD 0–100/month | Same Google Cloud project as the existing Android Maps key (a server key restricted to Routes) |
| Mapbox Directions | Good in cities, thinner on Saudi rural roads | Exclusions (toll, ferry, border via `exclude=border_crossing` reveals them) | Commercial OK; caching restricted; must show on a Mapbox map for map display | Free tier ~100k requests/month, then ~USD 2 per 1,000 | New vendor, new SDK for maps |
| OSRM (self-hosted, OSM data) | OSM quality: good on main roads in KSA/MY/SG | No tolls or border metadata out of the box (derivable from country polygons) | BSD-2 software, ODbL data: commercial OK with attribution, cache freely | Server cost only (a GCC + SE Asia extract fits a ~16 GB RAM VM, ~USD 80/month) + ops time | Unlimited caching; no traffic |
| OpenRouteService (hosted) | OSM | Border info (`extra_info: countryinfo`), tolls (`tollways`) | Hosted plan has daily quotas and its own terms for commercial use; self-hosting is free (GPL) | Free tier too small for production; self-host similar to OSRM | Good fallback |

**Recommendation: Google Routes API**, called only from the server, behind a `drive.ts` interface with an OSRM adapter as the fallback and for tests. Reasons: best Saudi and Malaysian coverage, tolls and traffic, one vendor already set up, low cost at our volume. Conditions: show route lines only on a Google-provider map (`PROVIDER_GOOGLE` on iOS needs an iOS key) or show no line (text only: distance and time are fine without a map), and cache within Google's terms (§4.3). If counsel reads the caching terms as too tight for plans that live for weeks, switch the default to self-hosted OSRM (owner decision 4).

### 4.3 Caching

- Key: from/to rounded to 3 decimals (~100 m), mode, avoid flags, departure bucket (weekday/weekend × day/night). Store distance, duration, tolls, borders; polyline only for Google-map display and dropped at `expires_at`.
- Google: `expires_at` = fetched + 30 days for coordinates-derived data, and the plan item stores only the numbers it displays with `as_of`. On read past expiry the leg is re-fetched lazily (once per leg per day max). OSRM: 90 days.
- Budget guard: `DRIVE_DAILY_CALLS` (default 2,000) per day in total; past it, legs show the unknown state below.

### 4.4 When we don't know

- No route (islands, closed border, no road data): "No road route found. A flight or ferry instead?" with chips from the tools (search_flights to the nearest airport).
- Provider down or budget hit: "About 1,100 km" from great-circle distance × 1.25, labelled "estimate, straight-line", never a time. Re-fetch on next open.
- Borders the router can't tell: from country polygons along the polyline; if that fails, the leg says "Crosses into Malaysia" only when start and end countries differ.
- Never: a drive time that no source returned.

---

## 5. Companions

### 5.1 `add_traveller` matching

Inputs: `name` (as said), optional `relation`, optional `phone`. The server searches, in order:

1. Household (`app_people`, not deleted): given names / surname / relation label ("my brother", «أخوي»), Arabic and Latin forms (a shared `nameKey()` that folds Abdullah / Abdallah / عبدالله / عبد الله).
2. Circle: friends (`app_friendships` accepted), members of the traveller's circles, accepted invitees.
3. Phone contacts, only if the app has contact permission and already matched hashes (`matchContacts`); the server never receives the address book, only hashes (as today).

| Result | Mada says | Card |
|---|---|---|
| One match in household | "Abdullah's on the trip." | plan diff |
| One match in circle | "Abdullah's on the trip. We'll let him know." (invite to the trip, he accepts in his app) | plan diff + invite status |
| Several matches | "Which Abdullah?" | **choice card**: up to 4 rows (photo/initial, name, how known: "Your brother", "Friend · Riyadh Hiking", "Contact · +966 5•• ••• 482"), plus `[Someone else]` |
| No match | "Abdullah isn't in your circle yet. Invite him?" | `[Invite from contacts]` `[Add his number]` `[Just add his name]` |

- "Just add his name" creates a household person row (`relation: 'friend'`, given name only) so the plan counts him and searches price for him; passport later.
- Invite sends via the existing `inviteByPhone` (sms/whatsapp, number encrypted) with the trip linked: `app_circle_invites.kind = 'trip'` (new value) and `app_trip_travellers.invite_id`. The message is the existing invite template with "for Riyadh → AlUla, 20–22 Nov". Sending needs a tap on the card (it shares the trip name and dates with a third party).
- Disambiguation is never guessed: two exact matches always ask.

### 5.2 Guard rules

- Adding someone to a plan is free and reversible: no confirmation beyond the choice card.
- Sharing anything with them (an invite, the plan) needs the tap.
- A minor in the household can be added freely; a minor in someone else's household can't be added (no access to that row).

### 5.3 What the companion sees

| Companion is | Sees | Can do |
|---|---|---|
| Household person, no account | nothing (they're yours) | — |
| Mada user who accepted the trip invite | The trip in Trips: title, dates, plan days, stay names and check-in times, flight times **for legs they're on**, the car pickup, the trip circle chat. Not: prices, payment, other people's documents, the owner's Ask chat. | Their own Ask chat about the trip (a separate thread, attached to the same trip, read-only plan for them), upload their own passport, react/vote in the trip circle |
| Invited, not yet accepted | The invite preview (trip name, dates, who invited) | Accept / decline |

Edits to the plan remain the owner's (and the desk's). A companion's suggestion in their own chat becomes a circle message to the owner ("Abdullah suggests adding a stop in Madinah"), not a plan change. Owner decision 5 can open co-editing later.

### 5.4 Their documents

- A companion's passport lives in **their** wallet if they have an account. For bookings the owner needs the details: Mada asks the companion in their app ("Omar is booking Riyadh → AlUla. Share your passport details for this trip?") → an `app_document_grants` row (trip-scoped, expires at trip end + 7 days). The owner sees "Abdullah's passport: shared for this trip" and the booking flow reads it through the grant; the number is never shown to the owner beyond the mask.
- If the companion has no account, the owner may upload it (a household row with `linked_user_id` null). Before saving Mada asks: "This is Abdullah's passport. Do you have his OK to keep it in your documents?" `[Yes, keep it]` `[Use for this booking only]`. "This booking only" uses it for the order and deletes the file and number after the booking is confirmed (kept: masked number and expiry on the order's traveller line, as orders keep today).
- When an invited companion later signs up and accepts, the owner's row is offered to move to him: he confirms, it moves to his wallet with a grant back to the owner for the trip.

---

### 5.5 Permissions and changes asked by a companion (owner decision, 21 Oct)

Each person on a trip has a role the trip owner sets when adding them, and can change later on the trip's Travellers screen:

| Role | Sees | Can do |
|---|---|---|
| Can view | The plan, times, places, their own documents (no prices unless the owner shares them) | Ask Mada questions about the trip |
| Can suggest (default) | As above | Ask Mada for a change; it becomes a change request the owner approves |
| Can edit | As above, plus prices if shared | Change ideas and unbooked items directly; anything that costs money or shares data still goes to the payer |

How a change request flows, all inside the chats:
1. Abdullah, in his chat for the trip: "Can we stay two nights in Melaka?" Mada checks the plan and his role. With "Can suggest": "We'll ask Omar to confirm." A `change_request` card shows the diff (Melaka 1 → 2 nights, Penang 2 → 1) and its status "Waiting for Omar".
2. Omar gets a push ("Abdullah suggests a change to Riyadh → Penang") and, in his own chat for the trip, the same card with Approve · Decline · Change it. Approve applies the plan ops (versioned, §3.5); Decline can carry a one-line reason.
3. Abdullah's chat updates: "Omar approved. Melaka is now two nights." (or "Omar kept it as it is: <reason>"). Both plans, the trip page and Today update through the event map (§1.3).
4. A change that costs money (a second Melaka night that has to be booked) needs the payer's approval and then goes to the pay sheet on the payer's phone; Mada never charges the companion's card unless they pay their own share.
5. Requests expire after 48 h with a reminder at 24 h; open requests show on the trip page.

A shared trip chat (optional, per trip): the owner can turn on "Trip chat" so all travellers and Mada talk in one thread; private one-to-one chats with Mada stay. In the shared chat, Mada says who asked for what and approvals happen in place. Built in U5 (roles, change requests, cards) and U8 (Travellers screen, shared trip chat); new tables `app_trip_travellers.role`, `app_plan_change_requests`.

## 6. Documents in chat

### 6.1 Attaching

- The composer gets a `+` (paperclip on Android): `Take a photo` (camera), `Photo library`, `File` (PDF). Max 10 MB, JPEG/PNG/HEIC/PDF.
- The phone reads first: for anything that looks like a passport page, `ocr.native.ts` (ML Kit, on device) + `findMrz` run before upload. If an MRZ is found with valid check digits, the app sends the **fields** (number encrypted on the server as today) plus the file only if the traveller keeps a copy. If not found, the file is uploaded encrypted (`app_files`, purpose `ask`, its own key) and the server classifies it (kind guess only from file type + a server-side OCR of the MRZ lines if the phone couldn't read them; no image goes to the chat model).
- Web: file picker only; MRZ read on the server.

### 6.2 What happens next (one card, no forms in chat)

```
Mada: That's a passport for Omar Alharbi, ending 482, valid to 22 Jun 2031.
      [ Omar Alharbi · P ••••482 · to 06/2031 ]
      We already have this one. Use it for the hotel?
      [Use it]  [It's a new passport]  [Not Omar's]
```

| Case (server decides by `passport_fingerprint` and name/dob match) | Card |
|---|---|
| Same passport already on file | "We already have this passport, ending 482, valid to 2031. Use it?" `[Use it]`. The new image is discarded unless they ask to replace the copy. **Never stored twice.** |
| Same person, different number (renewed) | "A newer passport for Omar, valid to 2036. Replace the old one (ending 482)?" `[Replace]` `[Keep both]` |
| Matches a household person by name + dob, no passport yet | "Omar's passport. Add it to your documents?" `[Add it]` |
| Matches a circle companion on this trip | §5.4 consent card |
| No match | "Whose passport is this?" chips: household names + `[Someone new]` (creates the person from the MRZ: names, dob, sex, nationality) |
| Visa / ID / iqama | same flow against `app_documents` (`fingerprint`) and `app_person_details.iqama_enc` |
| Unreadable | "We couldn't read the bottom two lines. Try again in good light, or type the details." `[Take it again]` `[Type it]` (opens `app/passport/confirm` prefilled) |
| Not a document (a ticket, a screenshot of a booking) | "Looks like a booking confirmation. Add it to a trip?" `[Add to Riyadh → AlUla]` → request `kind='import'` to the desk (existing imported-trip path) |

- Confirmation always happens on the card with the fields visible (masked number). Nothing is saved before the tap. The full confirm screen (`app/passport/confirm.tsx`) is one tap away ("Check the details").

### 6.3 Expiry against the trip

- On save and nightly: expiry < trip end + the destination's rule (6 months default, from `checkEntry`) → plan check amber, and the card says it: "Valid to 2 Jul 2027. Malaysia asks for 6 months beyond your stay, so it's fine." or "…expires 2 months after you're back. Turkey asks for 150 days. Renew first?" `[How to renew]` `[Request help]`.

### 6.4 What the model may read

- The model never sees an image of a document, the full number, or the MRZ (redaction stays and already catches MRZ lines in text).
- The tool result for a document is `{person: "Omar", kind: "passport", ending: "482", valid_to: "2031-06", nationality: "SA", on_file: true}`.
- Attachments appear in the transcript as `{type:'attachment', kind, label:"Passport · Omar · ••482"}`; the desk transcript shows the same line, and opens the document only through the existing grant + `agentReadDocument` audit.
- Discarded or "this booking only" files are deleted; `app_ask_attachments` keeps the redacted result for the transcript.

---

## 7. Booking from the plan and the chat

### 7.1 One way to pay

Every booking from a plan item goes through the existing path: a tool (or the plan screen) prices an offer → `priceDraft` → `OrderDraft` with a new optional `planItemIds: string[]` → the app's pay sheet → order → `app_trip_bookings` with the plan's `trip_id`. On confirmation the listener sets the items to `booked` and links them. No new payment code.

| Item | Live today | From the plan |
|---|---|---|
| Flight | TBO when certified; otherwise **by request** (`APP_FLIGHTS_MODE=request`) | `[Find flights]` runs `search_flights` for that leg; or creates the request with the leg filled in |
| Stay | Hotelbeds / mock | `[Find a stay for nights 1–2]` → `search_stays` with dates and travellers from the plan; choosing one prices it (`priced`) |
| eSIM | eSIM Access | `[Add an eSIM]` → `esim_plans` for the countries and days on the plan |
| Transfer | `transfers/service.ts` (airport, on a trip) | leg mode `transfer` → transfer options |
| Car rental (self-drive) | **not live** | request `kind='car_rental'` with pickup/return place and dates, driver age, car size, from the plan |
| Driver for the day / intercity | not live | request `kind='driver'` |
| Activity | catalogue (`app_activities`) | pin / book via existing activity flow; else request |
| Train, ferry, border car permit, insurance | not live | request with the leg filled in |

### 7.2 Partial booking

- `[Book what's ready]` opens the pay sheet with every `priced` item, each with a checkbox (default on), total updated live. The rest stay as they are.
- A plan can be half booked forever; checks show what's left.
- Holds expire: an item whose offer expired drops back to `idea` with "price expired, check again" (`app_offers.expires_at`); the chat says so the next time the trip comes up.

### 7.3 Requests for what isn't live

- `create_request` gains `plan_item_id` and `trip_id`. The desk request page shows the plan item and links the plan (§10). The rules from ASK-CHAT §1 "Found by hand" hold: only what the team needs, one question at a time, contact preference, the promise time from the tool.
- When the desk sends a quote, the item becomes "Quote ready" with Pay; when booked by the desk, the desk's booking writes the booking row and links the item (the desk UI gets "Link to plan item" in the request view, U8).

### 7.4 Honest prices

- Demo fares keep "Demo fare · not bookable" on cards, on plan items, on the pay sheet. A plan that contains a demo price shows the label on its total.
- Plan totals sum only tool or booking prices, with "as of" times. No "about SAR 6,000 for the whole trip" unless a quote said it.

---

## 8. The agent's toolset

Existing 13 tools stay. New and changed tools (strict JSON schemas; all run as the signed-in traveller through the same functions as the routes; every one returns `{text (gist ≤ 600 chars), cards?, pay?, isError?}`):

| Tool | Input | Output to model | Cards / side effects | Confirm first? |
|---|---|---|---|---|
| `create_plan` | `{trip_id: string|null, template_id: string|null, origin: Place|null, return_to: Place|null|"same", stops: [{place: string, nights: int}] (1–12), start: date|null, days: int|null (1–30), travellers: string[] (person/user ids), pace: "easy"|"normal"|"full", must: string[] (≤ 6, short), travel_mode: "fly"|"drive"|"mixed"|null}` | plan gist, version, unknowns ("origin unknown", "no start date") | creates trip (planning) + plan + items; attaches thread; drive legs (§4); `plan` card | No (free, reversible). Asks for the start date only if none and no default; defaults: next month, Thu–Sat for ≤ 3 days |
| `get_plan` | `{plan_id}` or `{trip_id}` | gist incl. statuses, checks, version | — | — |
| `update_plan` | `{plan_id, version: int, ops: [{op:"add"|"update"|"move"|"remove"|"skip", item_id?: string, day?: int, after_item_id?: string, item?: {kind, mode?, title, place?, from?, to?, at?: "HH:mm", nights?, note?}}] (≤ 10)}` | new gist + version, or `is_error` for stale version / booked item | items changed, `plan_event`s, `plan_diff` card | No. Booked items refused with the change flow offered |
| `set_origin` | `{plan_id, origin: Place, return_to: Place|"same"|null}` | what changed incl. affected booked items | legs rebuilt, title updated, `plan_diff` | Only when a booked item is affected (chips) |
| `add_traveller` | `{plan_id|trip_id, name: string, relation: string|null, phone: string|null}` | `{matched: [...], added?: id}` (names + how known, no contacts) | adds `app_trip_travellers` on a single household match; else **choice card** / invite card | Inviting someone outside needs the card tap |
| `remove_traveller` | `{plan_id, traveller_id}` | gist | removes; booked tickets stay until changed | Yes if they're on a booked item |
| `plan_route` | `{from: Place, to: Place, mode: "drive"|"ferry", depart: datetime|null}` | `{km, minutes, tolls, borders[], source, as_of}` or unknown | caches | — |
| `find_for_item` | `{plan_id, item_id}` | dispatches to `search_flights` / `search_stays` / `esim_plans` / transfer options with dates, places and travellers from the plan | the usual cards, tagged with `item_id`; choosing sets `priced` | — |
| `price_quote_for_pay` (changed) | + `plan_item_ids: string[]` | as today | `pay` event; on confirm items → booked | **Always the pay sheet** (slide to confirm) |
| `create_request` (changed) | + `plan_item_id`, `trip_id` | as today | item → requested | Contact preference asked first (as today) |
| `documents_on_file` | `{traveller_ids: string[]}` | per person: kind, ending, valid_to, on_file, shared_for_trip | — | — |
| `use_document` | `{attachment_id, person_id|null, action: "use"|"add"|"replace"|"this_booking_only"}` | result gist | writes `app_documents`/`app_people.passport_*`; never runs without the card tap (the app sends the tap as a structured message `{tap: {card, choice}}`, checked server-side like `consentOf`) | **Yes** (card tap) |
| `request_document_share` | `{trip_id, user_id, kind: "passport"}` | sent / already shared | push to the companion | Yes (shares the trip with them) |
| `open_in_app` | `{screen: "plan"|"trip"|"documents"|"household"|"esim"|"requests"|"money"|"change"|"refund"|"support", id: string|null}` | — | a `link` card ("Open the plan") | — |

`Place` = `{name: string, kind: "airport"|"city"|"place", code: string|null}`; the server resolves it (airports table, `/geocode`) and rejects what it can't place.

### 8.1 Guard rules (server-enforced, not just prompt)

1. **Money:** nothing is charged except through the pay sheet the traveller slides. Tools only price.
2. **Sharing data:** invites, document shares and anything sent to a third party need a card tap, verified from the thread (`tap` message) like memory consent.
3. **Sensitive storage:** documents save only after the tap; health/religion memory as today.
4. **Booked things:** the agent can't move, cancel or remove a booked/confirmed item; it opens the change/refund flow.
5. **Facts:** prices, times, availability, opening hours, drive times only from this turn's tool results (the sentence gate extends to "km" and "h/min" durations).
6. **Ownership:** every id the model passes is checked against the caller (plans, items, people, attachments).

### 8.2 "Never say we don't do it"

Prompt rule (ASSISTANT.md §1, new bullet under "Always resolve") and an eval check (`never-no`): a reply may not say "we don't offer", "not available", «ما نقدر», «ما عندنا» without, in the same reply, one of:

| Situation | Mada does |
|---|---|
| A tool sells it | Do it (search, price, add to plan). |
| No tool sells it, the team can | Take the details and `create_request` (cruise, train, rental car, driver, border permit, group). |
| It's in the app already | `open_in_app` with one line ("Your boarding pass is in Wallet."). |
| Truly impossible (illegal, unsafe, outside travel) | Say it in one short line and offer the nearest real thing. |

The eval set gains 8 conversations (§12 patterns plus "rent a car in Langkawi", "a driver in AlUla", "train KL to Penang", "car permit Malaysia–Singapore").

---

## 9. Screen by screen

### 9.1 Ask home (the chat list)

```
┌──────────────────────────────────────┐
│ Ask Mada                     [ + ]   │  + = new chat
│ ┌──────────────────────────────────┐ │
│ │ 🔍 Search chats                  │ │
│ └──────────────────────────────────┘ │
│ UPCOMING TRIPS                       │
│ Singapore → Kuala Lumpur · 12–19 Dec │
│ Planning · "Car added for days 3–6"  │
│                               2h  •  │
│ Riyadh → AlUla · 20–22 Nov           │
│ Booked · Noura from Mada is here     │
│                            Yesterday │
│ RECENT                               │
│ eSIM for Pakistan                    │
│ "Here are three plans for 10 days"   │
│                               Mon    │
│ Archived (4)                       › │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ Where to next?              (↑)  │ │  composer: new chat
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

| State | What shows |
|---|---|
| Empty (no threads) | Skip the list; open a new chat with the usual suggestions. |
| Loading | 3 skeleton rows; the composer is live immediately. |
| Partial (cache only) | Cached rows, a thin "Updating…" line; rows without server data greyed. |
| Error | Cached rows + "Couldn't refresh. Pull to try again." Never blocks the composer. |
| Offline | Cached rows (last 3 threads open); composer sends through the offline flows as today; "You're offline. We'll send it when you're back." |
| Guest | No list (threads need an account); the chat works through the flows as today. |
| RTL | Mirror layout; the arrow in titles is `←` with places in reading order («الرياض ← العلا»); time on the start side; swipe-to-archive is swipe right. |

### 9.2 A conversation with plan and choice cards

```
┌──────────────────────────────────────┐
│ ‹  Singapore → Kuala Lumpur      ⋯   │  ⋯ = rename, plan, archive, delete
│    12–19 Dec · Planning   [Plan ›]   │  trip chip opens the plan
│                                      │
│              7-day road trip from     │
│              Singapore to Malaysia    │
│              with Abdullah            │
│                                      │
│ Here's a 7-day plan. Review it.      │
│ ┌──────────────────────────────────┐ │
│ │ Singapore → Kuala Lumpur         │ │
│ │ 12–19 Dec · You, Abdullah (?)    │ │
│ │ D1 Singapore · stay: none yet    │ │
│ │ D2 Drive → Melaka 240 km 3h      │ │
│ │    border Woodlands · car: none  │ │
│ │ D3 Melaka                        │ │
│ │ D4 Drive → KL 150 km 2h          │ │
│ │ …                                │ │
│ │ To do: car days 2–7 · 2 stays    │ │
│ │ [Review the plan]                │ │
│ └──────────────────────────────────┘ │
│ Which Abdullah?                      │
│ ┌──────────────────────────────────┐ │
│ │ (A) Abdullah · your brother      │ │
│ │ (A) Abdullah K · friend, Hiking  │ │
│ │ ( ) Someone else                 │ │
│ └──────────────────────────────────┘ │
│ [Book a car] [Find stays] [Start from KL]│
│ ┌──────────────────────────────────┐ │
│ │ (+) Message Mada            (↑)  │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

States: plan creating ("Putting the plan together…" status line, then the card); a partial plan (drives still computing show "Drive time: checking…" and fill in via a `replace`-style card update); tool error ("We couldn't map the drives right now. The plan is saved; drive times will show when they're ready." + next steps); offline (send queued, flows fallback, plan card renders from cache). RTL: card rows mirror, km/h numbers stay LTR inside RTL text (`⁦…⁩` isolates), the day label reads «اليوم ٢».

### 9.3 The plan screen (`app/trip/[id]/plan.tsx`, new; `app/plan/[id].tsx` and `app/ask/plan/[id].tsx` stay the template screen that Circles, Discover and Saved link to)

```
┌──────────────────────────────────────┐
│ ‹ Riyadh → AlUla              ⋯      │
│ 20–22 Nov · Omar, Sara, Abdullah     │
│ From Riyadh · Change                 │
│ ┌ To do ───────────────────────────┐ │
│ │ ● Car for day 1–2   [Book a car] │ │
│ │ ● Abdullah's passport [Ask him]  │ │
│ └──────────────────────────────────┘ │
│ [Day 1] [Day 2]   [Map]              │
│ 07:30 ✈ Riyadh → AlUla   Idea [Find] │
│ 09:15 🚗 Car pickup ULH   Needed     │
│ 10:00 🏨 Habitas AlUla    Booked ✓   │
│        nights 1–2                    │
│ 16:00 ★ Old Town          Idea       │
│ ──  🚗 18 km · 20 min                │
│ 18:10 ★ Elephant Rock     Idea       │
│ [+ Add to day 1]                     │
├──────────────────────────────────────┤
│ [Book what's ready · SAR 2,480]  [Ask]│
└──────────────────────────────────────┘
```

- Tap an item: a sheet with details, status, the booking (if any) and actions (Find / Book / Change / Skip / Remove / Move to day…). Drag to reorder within a day (long-press on Android, accessible "Move up/down" actions).
- "Ask" opens the trip's chat with the plan in context.
- Map tab: one map per day with stops and the route line (Google-provider map, §4.2) or a list of legs if no map.
- States: loading skeleton; partial (drives computing); error (cached plan + "Couldn't refresh"); offline (read-only, edits queued with a banner "Changes will sync when you're back", conflicts resolved by version: the server wins and the traveller sees "This changed on another device"); empty day ("Nothing planned. Free day, or [Add something]").

### 9.4 The trip page (`app/trip/[id]/index.tsx`)

- Adds a **Plan** section at the top for planning trips (the to-do card + day list summary) and keeps the timeline for booked trips, with plan-only items (ideas) shown dimmed in the timeline.
- A persistent `Ask about this trip` button (the Ask orb on this screen opens the trip's chat).
- Travellers row with avatars and invite status; tapping goes to the companion sheet.
- Title from origin → stops; rename in ⋯.

### 9.5 Documents (Wallet → Documents, household person page)

- Each document shows its origin: "Added from Ask, 21 Oct" (source `ask`).
- Shared-for-trip badges: "Shared with Omar for Riyadh → AlUla until 29 Nov · Stop sharing".
- A person's page shows trips they're on.

### 9.6 Circle invite (from the companion card)

```
┌──────────────────────────────────────┐
│ Invite Abdullah                       │
│ to Riyadh → AlUla · 20–22 Nov        │
│ ( ) From contacts                     │
│ ( ) Add a number  [+966 ___________] │
│ Send by  (•) WhatsApp  ( ) SMS       │
│ He'll see the trip name, dates and   │
│ the plan. Not prices or documents.   │
│ [Send invite]                         │
└──────────────────────────────────────┘
```

States: sending, sent ("Invite sent. We'll tell you when he joins."), number already a Mada user (switches to an in-app invite with his first name, if he allows being found by phone), error ("Couldn't send. Try again or share the link.") with `[Share link]` (existing `linkFor`).

### 9.7 Arabic notes

- All new strings in `packages/shared/src/copy/{en,ar}/words.ts` in spoken Riyadh Arabic (ARABIC.md): «هذي خطتك، شوفها» for "Here's the plan, review it", «أي عبدالله؟» for "Which Abdullah?", «عبدالله مو في دائرتك، نعزمه؟», «جوازك عندنا، ينتهي ٢٠٣١، نستخدمه؟».
- Arrows: `→` in LTR, `←` in RTL; place order follows reading order.
- Distances «٢٤٠ كم · ٣ ساعات»; dates «٢٠–٢٢ نوفمبر».

---

## 10. What the desk sees

| Desk page | Adds |
|---|---|
| U3 Customer 360 (`/adminwork/desk/customers/[id]`) | A **Trips & plans** tab: each trip with its title, plan version, item statuses, travellers (with invite state), checks; links to the plan (read-only view) and to its Ask thread(s). |
| U5 Ask threads (`/adminwork/desk/ask`, `[id]`) | Title and trip chip in the list; filter "Has a plan"; the transcript shows plan cards as compact summaries and attachment lines ("Passport · Omar · ••482"), never images or numbers. A side panel with the current plan. |
| Requests (`/adminwork/desk/requests/[id]`) | The plan item the request fulfils (day, leg, dates, travellers) and "Link booking to plan item" when the desk books by hand. |
| Tickets (U2) | A ticket created from a plan request links the trip, plan item and thread (`desk_ticket_links` kinds `plan`, `ask_thread`). |
| Plan edits by the desk | Allowed with `desk.act`: same plan functions, `by_kind='desk'`, visible line in the traveller's chat. Taking over a thread doesn't lock the plan. |
| Documents | Unchanged: only through grants and `agentReadDocument` (audited). |

---

## 11. Build plan

Order is by dependency. ∥ marks units that can run in parallel without touching the same files.

| # | Unit | Scope | Files | Migration | Acceptance checks | Size |
|---|---|---|---|---|---|---|
| U1 | **Data model + conversation list** | Thread columns (title, titled_by, trip_id, archived_at, last_at, preview, ended_at); list/get/patch/delete endpoints; server title derivation (destination/kind until plans exist); attach rule §2.2 (trip id, or the "About your X trip?" choice card); the app's list screen, thread open from server, cache by thread id, orb behaviour; desk U5 list shows title. | `db/app-schema-ask.ts`, `drizzle/0042_ask_threads_list.sql`, `ask-chat/store.ts`, `ask-chat/chat.ts`, new `ask-chat/titles.ts`, new `app/api/app/v1/ask/threads/**`, `packages/shared/src/schemas/ask-chat.ts` (thread list, `moved`), `apps/mobile/src/app/ask.tsx` → `ask/index.tsx` (list) + `ask/[threadId].tsx`, `lib/ask-chat.ts`, copy words, desk `ask/page.tsx` | yes (backfill `last_at` = updated_at, `preview` from transcript) | Two chats about two places stay separate; reopening each shows its own turns on a second device; orb within 24 h opens the last chat; search finds by title; archive/unarchive; take-over still works (`desk-ask.test.ts` passes); Arabic list RTL screenshots. | M |
| U1+ | **Search and dates (owner, 21 Oct)** | Full-text search across chats (title and messages) and find-in-chat; list grouped Today / Yesterday / This week / This month / Earlier with last-activity times; filter chips All · Trips · Upcoming · Past · Archived; day separators and per-message time on long-press in conversations. Added to U1. | as U1 | no | Search finds a word from an old message and opens the chat at it; groups and filters in en/ar. | S |
| U2 | **Living plan core** | `app_plans`, `app_plan_items`, `app_plan_events`; `trips.origin/title/kind`; `plans.ts` (create from shape or template, ops with version, read with statuses from bookings, checks); plan endpoints; templates migrated to data (PLANS untouched for `GET /plans`); event emitter + listeners for stays/segments/esims/orders → items. | `db/app-schema-plans.ts` (new), `drizzle/0043_plans.sql`, new `lib/app/plans/{plans,ops,checks,templates,events}.ts`, `app/api/app/v1/trips/[id]/plan/**`, `packages/shared/src/schemas/plans.ts` (new) | yes | Create from template with origin JED → first leg JED→ULH; stale version rejected; booking a stay on the trip marks the matching item booked; checks compute passport/visa/stay gaps on seed data; unit tests for ops and status reads. | L |
| U3 (after U1, U2) | **Ask tools for plans** | `create_plan`, `get_plan`, `update_plan`, `set_origin`, `find_for_item`, `open_in_app`; `plan` and `plan_diff` cards; origin defaults from memory; thread ↔ trip attach on create; manual-edit context line; "never say no" rule + evals; sentence gate for km/durations. | `ask-chat/tools.ts` (+ new `ask-chat/tools-plan.ts`), `prompt.ts`, `persona.ts` + ASSISTANT.md, `guard.ts`, `evals.ts`, `chat.ts` (context), shared `ask-chat.ts` cards, `ChatThread.tsx` (PlanCard, PlanDiffCard) | no | Eval "7-day road trip SG→MY" creates a plan with ≥ 3 drive legs and no invented time; "start from Jeddah" rebuilds legs and title; manual move shows up in the next turn's context; `never-no` passes on all 8 new conversations. | L |
| U4 ∥ (after U2) | **Drives** | `drive.ts` interface, Google Routes adapter (server key), OSRM adapter (tests + fallback), cache table, budget guard, border detection, unknown states; leg enrichment on plan create/update. | new `lib/app/drive/{drive,google,osrm,borders}.ts`, `db/app-schema-plans.ts` (cache table only), `drizzle/0044_drive_cache.sql`, `lib/app/plans/ops.ts` (one call site) | yes | Riyadh→AlUla returns km/time from the fixture; budget hit → estimate label, no time; SG→Melaka lists the border; cache hit makes no call. | M |
| U5 ∥ (after U2) | **Companions** | `app_trip_travellers`, `app_people.linked_user_id`, `nameKey`, `add_traveller`/`remove_traveller` tools, choice card, invite card with `kind='trip'`, companion read view of a trip, trip traveller cache into `traveller_ids`. | `db/app-schema-trips.ts`, `drizzle/0045_trip_travellers.sql`, new `lib/app/trips/travellers.ts`, `circles/invites.ts` (trip kind), `ask-chat/tools-people.ts` (new), mobile `components/booking/ChoiceCard.tsx` (new), `app/trip/[id]/travellers.tsx` (new) | yes | Two Abdullahs → choice card, never a guess; unknown → invite card; accepted invite shows the trip in his Trips without prices; old `traveller_ids` readers unchanged (trips tests pass). | M |
| U6 ∥ (after U1) | **Documents in chat** | Composer attachments, on-device MRZ before upload, `app_ask_attachments`, fingerprints (backfill by decrypting once in a job), dedupe/replace/new/whose cards, `use_document`/`documents_on_file`/`request_document_share`, expiry vs trip, consent for others' passports, discard job. | `apps/mobile/src/components/booking/Composer*.tsx`, `lib/passport-scan.ts`, `lib/ocr*.ts` (reuse), new `platform/src/lib/app/ask-chat/attachments.ts`, `documents/index.ts`, `people.ts` (fingerprint), `db/app-schema-ask.ts` (attachments table), `drizzle/0046_ask_attachments.sql`, new `app/api/app/v1/ask/attachments/route.ts` | yes (fingerprint backfill) | Same passport twice → "we already have it", no second row; renewed → replace offer; the model's input never contains the number (redaction test); a companion's passport needs the consent tap; files discarded after 24 h. | L |
| U7 (after U3; U5 for travellers) | **Booking from the plan** | `planItemIds` on `OrderDraft`, pay sheet multi-select "Book what's ready", listener links orders to items, `create_request` with `plan_item_id`, car rental and driver request kinds, offer expiry → idea, demo labels on plan totals. | `packages/shared/src/schemas/booking.ts`, `lib/app/booking/{pricing,orders,requests}.ts`, `apps/mobile/src/app/pay/index.tsx`, `lib/app/plans/events.ts`, `ask-chat/tools.ts` (two changed tools) | small (`app_requests.plan_item_id`, `drizzle/0047`) | Book 2 of 4 priced items → 2 booked, 2 still priced; desk quote → item "Quote ready"; demo fare label on plan total; refund → item cancelled. | M |
| U8 (after U2, U7) | **Plan screen + trip page** | New `app/trip/[id]/plan.tsx` (days, map, item sheet, reorder, add, to-do card, offline queue with version conflicts); trip page Plan section and "Ask about this trip"; templates "Use this plan"; desk read-only plan view and "Link to plan item". | `apps/mobile/src/app/trip/[id]/plan.tsx` (new; `app/plan/[id].tsx` stays the template re-export), `app/trip/[id]/index.tsx`, `app/ask/plan/[id].tsx` (Use this plan button), `components/plan/*` (new), desk `customers/[id]` tab + `requests/[id]`, `lib/app/desk/customers.ts` | no | Reorder by hand appears in the chat's next context; offline edit syncs; conflict shows the message; RTL screenshots of every state; e2e: create in chat → book stay → day shows hotel → trip timeline shows check-in. | L |
| U9 (last) | **Cross-feature polish and Today** | Today cards from plan items (pickup, check-in, drive day "3 h to Melaka, leave by 10"), push on companion join/quote ready, desk "Has a plan" filter, memory → origin, eval run live on staging, COPY review. | `app/(tabs)/today.tsx`, `lib/app/trips/notify.ts`, desk `ask/page.tsx`, `ask-chat/evals.ts` | no | Each event in §1.3 updates its listed screens in an e2e script; live eval cost per conversation reported. | M |

Parallel lanes: after U1 and U2 land, **U4, U5, U6** touch disjoint files (drive/*, trips/travellers + circles, attachments + documents). U3 and U7 both touch `ask-chat/tools.ts`, so U3 moves the plan tools into `tools-plan.ts` and U5 into `tools-people.ts`; U7 changes only the two existing tools.

---

## 12. Five patterns, end to end

### 12.1 "7-day road trip Singapore to Malaysia with Abdullah"

1. New chat (no trip matches). Slots: destination SG/MY, 7 days, companion "Abdullah", mode road.
2. Origin unknown from the sentence; memory says "Flies from Riyadh". Mada: the trip starts in Singapore, so the plan's **origin is Riyadh** with a first leg RUH → SIN (flight) and the road trip from Singapore. Card line: "Starting from Riyadh. Change".
3. `add_traveller("Abdullah")` → two matches → choice card. In parallel `create_plan {origin: RUH, stops: [Singapore 2, Melaka 1, Kuala Lumpur 2, Penang 2], days: 7, travel_mode: mixed}` → server builds legs: RUH→SIN flight, SIN→Melaka drive (border Woodlands/Tuas, from `plan_route`), Melaka→KL drive, KL→Penang drive, PEN→RUH flight; stays per night as `idea`; car needed days 3–7; checks: entry for SG and MY per nationality (`entry_rules`).
4. Reply: "Here's your 7-day plan from Riyadh, through Melaka and KL to Penang. Review it." Plan card. "Which Abdullah?" card. Chips: `[Book a car for days 3–7] [Find stays] [Start in Singapore instead]`.
5. Tap "Abdullah · your brother" → he's on the plan; the entry check re-runs for his nationality.
6. Thread titled "Riyadh → Singapore → Penang · 12–19 Dec", attached to the new planning trip; Trips tab shows it.
7. "Book a car" → no live rentals → Mada asks pickup in Singapore or Johor (a Singapore car needs a permit to enter Malaysia; this is a **tool** fact from the entry/route rules, not the model's knowledge; if no tool knows it, Mada says the team will confirm the cross-border rules) → contact preference → `create_request(kind: car_rental, plan_item_id)` → item "With the team · back by 18:40".

### 12.2 "Use my passport" (while booking a hotel)

1. In the trip chat, Mada prices a stay; the pay draft needs passport details for Omar and Abdullah.
2. `documents_on_file` → Omar: on file, ending 482, to 2031; Abdullah: none.
3. Mada: "We have your passport, ending 482, valid to 2031. We'll use it. Abdullah's is missing." Chips `[Ask Abdullah to share]` `[Add his passport]` `[Book without him for now]`.
4. Traveller sends a photo instead: on-device MRZ → it's Omar's again → fingerprint matches → "We already have this one" card, image discarded. **No second copy.**
5. `[Ask Abdullah to share]` → `request_document_share` (tap = consent to share the trip) → Abdullah gets "Omar is booking Riyadh → AlUla. Share your passport for this trip?" → he shares → grant → Omar's chat: "Abdullah's passport is in. Ready to book." → `price_quote_for_pay` → pay sheet → booked → plan nights 1–2 show the hotel.

### 12.3 "Change the start to Jeddah"

1. In "Riyadh → AlUla", nothing booked: `set_origin(JED)` → legs RUH→ULH / ULH→RUH become JED→ULH / ULH→JED; priced flight offers drop to `idea`; title becomes "Jeddah → AlUla" in the list, the trip page and the desk.
2. Reply: "Now starting from Jeddah. The flights need checking again." Diff card. Chips `[Find Jeddah flights] [Drive instead (about 7 h)]` (the 7 h only if `plan_route` returned it).
3. If the RUH→ULH flight was booked: Mada doesn't touch it. "Your Riyadh → AlUla flight is booked. Add a Jeddah → Riyadh flight before it, or change it to leave from Jeddah?" `[Add Jeddah → Riyadh] [Change the flight] [Keep Riyadh]`. "Add" inserts a leg JED→RUH on day 1 (status idea) and `find_for_item` searches it; "Change" opens the change flow (request kind change).

### 12.4 "Add a hotel in Melaka" from the plan screen, then a question in chat

1. On the plan screen, day 3 "Stay: none yet" → `[Find a stay]` → StayFlow with dates/travellers → choose → pay → booked.
2. Listener: item booked; trip timeline check-in; Wallet voucher on issue; desk board order; Today card the day before check-in.
3. Later in the chat: "what time is check-in in Melaka?" → context has the change line (`added: … nights 3`), `get_trip` returns the stay's check-in from the booking → Mada answers from the tool, or "The hotel's check-in time isn't in our booking. We'll ask them." `[Ask the hotel]` → request.

### 12.5 "Is my passport OK for this trip?" (and the chat that already knows the trip)

1. From the trip page → "Ask about this trip" opens its thread (no attach question).
2. `documents_on_file` + `entry_rules` for each country on the route → "Yours is fine to 2031. Sara's expires 2 Jul 2027; Turkey asks for 150 days beyond your stay, so it needs renewing first." (rule text from `checkEntry`).
3. Chips `[How to renew] [Request help with renewal] [Remind me in January]`. The plan check is already amber; Today will show it from 30 days before.

---

## 13. Open decisions for the owner

| # | Decision | Recommended default |
|---|---|---|
| 1 | Does Ask open to the list or to the last chat? | The list, except the orb jumps into the last chat if it was under 24 h ago (today's continuity). |
| 2 | When a message matches an existing trip, ask or attach silently? | Ask once with a choice card; attach silently only from the trip page. |
| 3 | Can the agent add items without the traveller confirming each one? | Yes for ideas (free, reversible, shown in a diff card); never for anything that costs money or shares data. |
| 4 | Routing provider | Google Routes API on the server with an OSRM fallback; switch the default to self-hosted OSRM if counsel finds Google's caching terms too tight for plans that live for weeks. |
| 5 | Can companions edit the plan? | Decided 21 Oct: roles per person set by the owner (view / suggest (default) / edit); suggestions become change requests the owner approves inside the chat (§5.5); money always goes to the payer. |
| 6 | Self-drive car rental: request-only or a live supplier? | Request-only through the desk now (it shows up as "car rental" in plans and is counted); pick a supplier once 50 requests a month come in. |

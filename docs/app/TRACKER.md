# Mada Trips: work tracker

The coordinator's record of units, order and decisions, kept outside the chat so nothing depends on conversation memory.
Rules: each unit is one self-contained worker (background session or one-shot subagent) that finishes, reports once and ends;
at most 3 run at once; a dependent unit starts only after the one before it is integrated and verified.

Sources: owner's 31 questions → `scratchpad/OWNER-AUDIT.md`; outside-in critique (scorecard 5.1/10, 15 changes) → `scratchpad/CRITIQUE.md`.

## In flight (18 Oct, round 3 — CRITIQUE-2 scored 6.8/10; target ≥ 9 every dimension)

| Unit | CRITIQUE-2 issues | Session |
|---|---|---|
| R3a · Ask understands | #2 slot-fill, #6 UK ETA/visa + who, #3 offline Ask, #14 thread hygiene, #16 Umrah polish, #17 car-now "To", #20 eSIM wording | session_01WryyLrjtNxpoUmdfcG36B7 |
| R3b · booking/pay/money | #1 passport unblock, #4 footer overlap, #9 hotel page + bundle card, #10 family polish, #13 one money truth, #19 GACA card | session_01YKWDyHsA6CyxjkXCHsivhx |
| R3c · trip/outcomes/Arabic | #7 outcomes what + visa refusal + auto-close, #8 Arabic fixes, #11 low battery, #12 no invented facts, #15 recovery aftercare | session_01A4PrSXoVynLC3FGZDyhVNc |

Next after these: #5 entry bundle / 3G cold start (42 s → < 8 s, M–L, touches build config — run alone), #18 credentials line (needs owner's licence/IATA numbers), then retest (CRITIQUE-3).

## 21 Oct (afternoon) — Ask integrated (docs/app/ASK-INTEGRATED.md)
- Done: U1 chats list + search/dates 28c104c…8606d45 · U2 living plan core 2e7f59c · supplier adapters (Routes, car hire, Klook, Sherpa, XCover, Tabby/Tamara, Duffel, RateHawk) c7f04e3…8634276 · supplier privacy f70c9ed + live-build fix 740077d (docs/app/SUPPLIER-PRIVACY.md).
- Running (cloud): U3 plan tools session_016yJq5f5oHv6Rws4W8PhJPV · U4 drives session_01JfpbadgWdqmreUgWX6RF5A · U5 companions/roles/approvals session_01JnQAGLMp99aGMxkd2yzKJV · U6 documents in chat session_01BdYjfbVuaTCUZEVWF1DRNu. Next: U7 booking from plan → U8 plan screen + trip page + shared trip chat → U9 Today/polish.
- Done since: U3 plan tools 78f0b0d · U4 drives b18ca7c · U6 documents in chat b4a739a. Merged 17:15: build/tsc clean, 831 platform tests (known failures + desk-overview alerts test fails only in the full run: shared-state flake → fix in U9), 190 mobile, live export leak scan clean. Running: U5 (nudged to push), U7.
- U5 19cb26e/592b3e7 and U7 94b7014 landed; U8 running session_01PD77d14dKrqSwcfzzhfG8c. Migration 0043 re-dated after 0042 (543034c); staging applied 0043 before 0042, so it is fine.
- U8 plan screen + trip page + shared trip chat 49827a8 landed. Merged 19:15: build/tsc clean, 864 platform tests (known failures only), 201 mobile, live leak scan clean. Running: U9 (last) session_01Bb9KrrsrTamzLyBKHnvogY.
- Carry into U9: an approved change that costs money (U5) → U7's pay sheet on the payer's phone.
- Carry into U8/U9 (from U1): attach a chat to the trip a booking creates; "Start a chat for X?" on destination switch; rename/archive/delete inside a conversation; e2e-booking flaked once on the "Checking flights to Istanbul" line — recheck.
- U8 plan screen + trip page + shared trip chat + U1 leftovers + desk plan view: built (migration 0048_trip_chat). Left for U9: Today cards from the plan, push on trip-chat messages, desk "updated your plan" chat line, map tab on the plan, trip-chat composer words, desk-overview alerts flake.
- Owner: confirm voucher "Payable through" line + drop of "HBX Group" mark with Hotelbeds certification; eSIM network names OK to show?

## 21 Oct
- Done overnight: desk U1 920001c, U2 tickets 3464c31, U3 customers 80d3a52, U4 board/drop-offs da6f2ec, U5 Ask on desk fb43b79, U7 agents/rota/performance/CSAT a02a7d6 · app: waiting states + Ask cards 934f8e5, living Today cards 3cbc2a0 · Ask memory 5589a1d. Merged tree at 05:30: platform build + tsc clean, 163 desk/ask tests, 185 mobile tests, copy lint, root typecheck all pass.
- Also done: U6 refunds/credits/app finance 27c2de9 (owner items in docs/app/APP-FINANCE.md), Ask token trim −42% a928afa. Merged tree 06:20: build/tsc clean, 188 desk+ask, 185 mobile, copy lint, root typecheck pass.
- U8 overview + alerts 75cc25f. ALL DESK UNITS DONE. Final check 07:00: build/tsc clean, 195 desk+ask, 185 mobile, copy lint, root typecheck. Staging has the new routes. Morning report: https://claude.ai/artifact/G2y3TebZ3yGCtDNJ3GcQFD
- Desk plan docs/app/DESK-PLAN.md (defaults §7).
- Earlier 21 Oct: bubbles 0aac18b/5992166 · build fix 601d744 · no second eSIM flow 6df3516 · follow-ups read with context a587f45 · complete requests only a6c6dd5.

### Ask on free tiers (21 Oct, verified on staging)
- Code path works with Gemini: tool calls without index (e665e80), thought signatures (05c548e), best answering model (fc8913b, warm-up 3 models d88f6e8), short waits for a provider back within 6 s (7ef9453). Deep check: Gemini runs the search and the next step.
- Limits are the blocker: Groq free = 8,000 tokens/min and one turn ≈ 2 calls × 4.5k tokens, so about one turn a minute; Gemini free quota was used up by testing ("exceeded your current quota").
- Owner decision: enable billing on Gemini (Flash-Lite ≈ $0.10/M input) or Groq Dev tier; optionally add Z.ai to the chain (ASK_CHAT_PROVIDERS=groq,gemini,zai with ZAI_API_KEY). Pin ASK_CHAT_MODEL_GEMINI=gemini-3.6-flash to skip the warm-up calls.
- Possible next: trim per-turn tokens (system prompt + tool schemas) for free tiers.

## Done (17–18 Oct)

- Map pin → hotel card, grouped pins, map layout 1b3b0f6 · SW updates per build + refresh bar, no endless spinners (12 s; live flight/stay 20 s), eSIM size words 3cfc4f5 · CRITIQUE-2 37687ab (6.8/10). Combined e2e green at 3cfc4f5.

- E eSIM Airalo adapter ddb7fe0 · EA eSIM Access + pricing desk + entry points c753521, 1121524 · pricing dominance fix 056de8d · ED eSIM design c537e0e · destination any-country + no dead ends 29abe14 · ring fix 54916ac.
- G guests + language b93a4a0, 1b08696 · V speed b7d890b, 6a2eb2f · sign-in shows only enabled providers 9f640ef.
- Staging eSIM Access live (real balance). First real order refused for low balance (order 5581fe1c…, auto-refund at readyBy). Owner to top up ≥ $50.
- Decisions pending: fonts (recommend keep English Instrument Serif + Inter Tight, Arabic → Readex Pro with riyal-sign icon); staging region (server iad1 vs DB Singapore → set sin1) and Haiku 5.5 + streaming + spoken replies — owner said "let it be for now" (18 Oct).
- Found, not yet fixed: pay sheet "A person at Mada confirms it…" overlaps passport rows; activities.test "What's on" red.

## Done

- U Umrah 2a27865 · S offline + 8% f4c03f5 · P polish 99dc1da, b031925 · L native b28466d, beb83f0 (+ alarm module source a2d380c). Combined check in progress 17 Oct.

- W wiring 5aa5bc6. Open: English stay text on Arabic hotel page; refunds that moved money / pay-link splits can't be taken back; no "opened by agent" signal.
- M money c57a3b4. Open: hotel loyalty matched by name; instalments not on Money screen.
- A Arabic + moderation 1803a70. ARABIC.md awaits owner approval.
- F family 0fc2c3f (critique 1, 2, 3, 11): party parsing en/ar, stepper, age not passport, correctAsk, night flights demoted with kids, per-person lines. Open: live model path doesn't extract party; stay per-person is total/guests/nights.
- N now path 129de3a (critique 4, 10): car-now flow + /rides, urgent call-back (997 only for hurt/unsafe), urgent first on desk, honest disruption screen. Open: no live ride supplier (answers "none" → call-back); urgent stays top until an agent writes.
- O outcomes 1bcc3cf, 22adfeb (critique 5, 6): outcome schema, desk close/progress forms, nudge, hotel named everywhere (demo hotel = Bereketzade Hotel). Open: refund outcome doesn't issue the refund; bookings can't be nudged.

## Next, in order (critique items; start as slots free)

1. ~~**Family**~~ done: never drop a traveller silently (stepper adults/children+ages/infants), age without passport, corrections in any flow ("we are 5", "December", "right now", "I have a permit"), family ranking and per-person fare lines. (critique 1, 2, 3, 11)
2. ~~**Now path and truth**~~ done: car now (driver, plate, meeting point, price), urgent + trip <24 h → disruption card and call-back (not 997), disruption screen honest when nothing is wrong. (critique 4, 10)
3. ~~**Outcomes**~~ done: every request ends issued / refused / partial / cancelled with reason, deadline, next step; "Mada is on it" always with what, when, cost. Hotel named everywhere. (critique 5, 6)
4. ~~**Umrah**~~ done: built around the permit slot, Makkah nights by distance band with named hotel, Madinah/Haramain, last-ten-nights warning. (critique 7)
5. ~~**Guests and language**~~ done: guests search and see prices, Discover with a real city, guest links render; language switch keeps the flow; replies in the traveller's language. (critique 8, 9) — after A.
6. ~~**Web shell and 8% mode**~~ done: service-worker app shell, one-screen low-battery mode. (critique 14)
7. **Native** (code done, needs Apple account to test): Live Activity, real boarding passes, Apple Wallet. (critique 15) — needs the Apple account and a build.
8. **Social** (owner audit 10, 19, 21, 22, 24–27): public groups/trips/events, video and multi-attachments, badges, reviews, collections. After the beta.

## Integration notes

- F+N+O integrated at 22adfeb: typecheck clean; platform 467 pass, 6 fail (activities/places pre-existing; auth + review-login only fail in the full run) → given to P.
- Workers in cloud sessions can't read this container's scratchpad: put everything in the prompt.

- W + M integrated (8f8bbcd): support.test fixed; platform support/trips/circles 52/52; e2e circles, trips, booking, wallet, arabic pass on a mock export (`EXPO_PUBLIC_API_MODE=mock` is required for e2e exports).
- Owner to approve `docs/app/ARABIC.md` (30 before/after pairs).

## Decisions on record

- Owner asked (17 Oct): guests browsing prices — recommended for web AND mobile (Apple 5.1.1(v): don't force sign-in before account features); awaiting go-ahead.
- Cars: Hotelbeds Transfers is already wired for pre-booked airport pickups (transfers/service.ts); car-now has no on-demand supplier (Careem/Uber have no open booking API) → call-back. Proposed: offer Hotelbeds transfer for any ride ≥ supplier lead time.
- eSIM: today a fixed SAR 39 placeholder (EsimFlow), no supplier. Owner registered with eSIM Access (17 Oct); Airalo adapter kept as optional second, one-tap iOS install link.

- Background stays warm off-white; actionable surfaces a touch lighter (not pure white).
- Design bar: serif for journey headlines, one warm line per screen, photos with room, no voids, labels over sentences.
- Presence shows whoever is on duty; never "covering for".
- Mada is who you talk to; an agent is named only when real and present.
- Map shows every price; three picks never hide anything.
- Email-only testers may book on staging (`APP_BOOKING_REQUIRES_PHONE=no`, owner to set in Vercel).

## Owner-side blockers for go-live

Apple Developer (D-U-N-S) and App Store Connect; Google Play Console; Supabase phone + SMS hook, Google, ZeptoMail SMTP, redirect URLs; WhatsApp number + Meta verification + Zoho templates; SMS aggregator; MyFatoorah; Vercel production variables; Google Maps Android key; Hotelbeds live keys; counsel sign-off on legal pages; passport-copy retention decisions (4).

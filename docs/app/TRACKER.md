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

## 21 Oct
- Running (cloud): waiting states + Ask card redesign session_01KFd5cTyooy1iFBKBkfVQh9; Today living cards session_0166FEGi2mPcCu9uWM3X1T2b (local workers were lost to an interrupt at 02:45 and restarted 04:24); Desk U1 done 920001c. U2 tickets 3464c31 and U4 board/drop-offs da6f2ec done (merged tree builds, 122 desk+ask tests pass). Cloud: U3 customers session_01Jk7WhrhZbnGySgap2g8MSG, U5 Ask on desk session_01RcSsbJEnw3heY1YqKQFNiK, U6 finance session_01D6oqZJUvKJg6TNVwUfVvTj, U7 agents session_01NyMe9ZCpbCgwx55xB4YzkR. U8 dashboard after U6+U7.
- Desk plan docs/app/DESK-PLAN.md f1517f5 (defaults §7). Order: U1 → U2 tickets → (U3 customers ∥ U4 board/drop-offs ∥ U5 Ask on desk) → (U6 finance ∥ U7 agents) → U8 dashboard. U5 waits for the Ask memory worker (ask-chat files).
- Done: Ask memory 5589a1d · Gemini fixes: index-less tool calls e665e80, thought signatures 05c548e, best model fc8913b · bubbles 0aac18b/5992166 · build fix 601d744 · Gemini auto-model 95ef945, 0102780 (works: gemini-3.6-flash; 3.8/3.7 hang on free key) · staging /ask/providers check · no second eSIM flow 6df3516 · follow-ups read with context, mobility rule a587f45 · complete requests only a6c6dd5.

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

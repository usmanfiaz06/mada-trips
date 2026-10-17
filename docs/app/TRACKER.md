# Mada Trips: work tracker

The coordinator's record of units, order and decisions, kept outside the chat so nothing depends on conversation memory.
Rules: each unit is one self-contained worker (background session or one-shot subagent) that finishes, reports once and ends;
at most 3 run at once; a dependent unit starts only after the one before it is integrated and verified.

Sources: owner's 31 questions → `scratchpad/OWNER-AUDIT.md`; outside-in critique (scorecard 5.1/10, 15 changes) → `scratchpad/CRITIQUE.md`.

## In flight (17 Oct)

| Unit | What | Status |
|---|---|---|
| U · Umrah (Next 4) | permit-first Umrah, Makkah distance bands with named hotels, Madinah, Haramain, last-ten-nights warning; parser "taxi now" → car; bundle names the hotel; visible fare "Rules" link | started 17 Oct, session_012zVYc7M9ZXTLs4ymLNRe7o |
| S · offline shell + 8% mode (Next 6) | service worker, cached trip offline, queued messages, low-battery screen | started 17 Oct, session_017G6Ew7RnxLE7Kii7UWv8nv |
| L · native (Next 7) | Live Activity + Dynamic Island, real boarding passes (BCBP import), Apple Wallet .pkpass, NATIVE.md owner steps | started 17 Oct on owner's request (4th slot), session_0171JzMP5syiTg9p3seyBrmn |
| P · polish | red platform tests (activities, places, auth flake), duplicate cards, real child/infant fares, hold-ended + price-down + 3DS branch, extras carrier, split tripId, waiting-screen made-up details | started 17 Oct, session_01NVAgKWJjayiCpo83VzFAwJ |

## Done

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
4. **Umrah** (U running): built around the permit slot, Makkah nights by distance band with named hotel, Madinah/Haramain, last-ten-nights warning. (critique 7)
5. **Guests and language**: guests search and see prices, Discover with a real city, guest links render; language switch keeps the flow; replies in the traveller's language. (critique 8, 9) — after A.
6. **Web shell and 8% mode** (S running): service-worker app shell, one-screen low-battery mode. (critique 14)
7. **Native**: Live Activity, real boarding passes, Apple Wallet. (critique 15) — needs the Apple account and a build.
8. **Social** (owner audit 10, 19, 21, 22, 24–27): public groups/trips/events, video and multi-attachments, badges, reviews, collections. After the beta.

## Integration notes

- F+N+O integrated at 22adfeb: typecheck clean; platform 467 pass, 6 fail (activities/places pre-existing; auth + review-login only fail in the full run) → given to P.
- Workers in cloud sessions can't read this container's scratchpad: put everything in the prompt.

- W + M integrated (8f8bbcd): support.test fixed; platform support/trips/circles 52/52; e2e circles, trips, booking, wallet, arabic pass on a mock export (`EXPO_PUBLIC_API_MODE=mock` is required for e2e exports).
- Owner to approve `docs/app/ARABIC.md` (30 before/after pairs).

## Decisions on record

- Owner asked (17 Oct): guests browsing prices — recommended for web AND mobile (Apple 5.1.1(v): don't force sign-in before account features); awaiting go-ahead.
- Cars: Hotelbeds Transfers is already wired for pre-booked airport pickups (transfers/service.ts); car-now has no on-demand supplier (Careem/Uber have no open booking API) → call-back. Proposed: offer Hotelbeds transfer for any ride ≥ supplier lead time.
- eSIM: today a fixed SAR 39 placeholder (EsimFlow), no supplier. Proposed: Airalo Partner API (or eSIM Go), one-tap iOS install link.

- Background stays warm off-white; actionable surfaces a touch lighter (not pure white).
- Design bar: serif for journey headlines, one warm line per screen, photos with room, no voids, labels over sentences.
- Presence shows whoever is on duty; never "covering for".
- Mada is who you talk to; an agent is named only when real and present.
- Map shows every price; three picks never hide anything.
- Email-only testers may book on staging (`APP_BOOKING_REQUIRES_PHONE=no`, owner to set in Vercel).

## Owner-side blockers for go-live

Apple Developer (D-U-N-S) and App Store Connect; Google Play Console; Supabase phone + SMS hook, Google, ZeptoMail SMTP, redirect URLs; WhatsApp number + Meta verification + Zoho templates; SMS aggregator; MyFatoorah; Vercel production variables; Google Maps Android key; Hotelbeds live keys; counsel sign-off on legal pages; passport-copy retention decisions (4).

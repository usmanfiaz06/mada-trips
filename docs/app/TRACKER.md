# Mada Trips: work tracker

The coordinator's record of units, order and decisions, kept outside the chat so nothing depends on conversation memory.
Rules: each unit is one self-contained worker (background session or one-shot subagent) that finishes, reports once and ends;
at most 3 run at once; a dependent unit starts only after the one before it is integrated and verified.

Sources: owner's 31 questions → `scratchpad/OWNER-AUDIT.md`; outside-in critique (scorecard 5.1/10, 15 changes) → `scratchpad/CRITIQUE.md`.

## In flight (16 Oct, resumed 18:55 UTC after the usage limit)

| Unit | What | Status |
|---|---|---|
| W · wiring | cancelled trips visible, booked stay → hotel page, document viewer, friend-request → profile, hello thread, hotel requests on pay, thanks counts, take-back for sent items, plural copy | items 2, 3, 5, 6 pushed; rest finishing |
| M · money | preferences applied + re-confirmed extras, loyalty numbers per traveller, FX display (SAR charged), trip Money view, ask someone to pay | prefs/FX code in tree, Money view next |
| A · Arabic + moderation | spoken Riyadh Arabic across copy, reader-language notifications, ARABIC.md voice guide, moderation rules (ar/en lists, venue rule, spam, image hook, chat screening, desk queue) | **DONE** 1803a70: 2,561 ar lines rewritten, inbox renders in reader's language, moderation + desk queue, ARABIC.md (30 pairs for owner approval) |
| F · family (unit 1 of Next) | stepper, age without passport, corrections in any flow, family ranking, per-person fare lines | started 16 Oct as a background session |

## Next, in order (critique items; start as slots free)

1. **Family**: never drop a traveller silently (stepper adults/children+ages/infants), age without passport, corrections in any flow ("we are 5", "December", "right now", "I have a permit"), family ranking and per-person fare lines. (critique 1, 2, 3, 11)
2. **Now path and truth**: car now (driver, plate, meeting point, price), urgent + trip <24 h → disruption card and call-back (not 997), disruption screen honest when nothing is wrong. (critique 4, 10)
3. **Outcomes**: every request ends issued / refused / partial / cancelled with reason, deadline, next step; "Mada is on it" always with what, when, cost. Hotel named everywhere. (critique 5, 6)
4. **Umrah**: built around the permit slot, Makkah nights by distance band with named hotel, Madinah/Haramain, last-ten-nights warning. (critique 7)
5. **Guests and language**: guests search and see prices, Discover with a real city, guest links render; language switch keeps the flow; replies in the traveller's language. (critique 8, 9) — after A.
6. **Web shell and 8% mode**: service-worker app shell, one-screen low-battery mode. (critique 14)
7. **Native**: Live Activity, real boarding passes, Apple Wallet. (critique 15) — needs the Apple account and a build.
8. **Social** (owner audit 10, 19, 21, 22, 24–27): public groups/trips/events, video and multi-attachments, badges, reviews, collections. After the beta.

## Integration notes

- After W and M land: fix stale platform `support.test` (expects "Faisal confirms it"; copy is now "Mada confirms it" since 7759801); rerun e2e-circles ("hello sent" from W's hello thread) and platform trips.test.
- Owner to approve `docs/app/ARABIC.md` (30 before/after pairs).

## Decisions on record

- Background stays warm off-white; actionable surfaces a touch lighter (not pure white).
- Design bar: serif for journey headlines, one warm line per screen, photos with room, no voids, labels over sentences.
- Presence shows whoever is on duty; never "covering for".
- Mada is who you talk to; an agent is named only when real and present.
- Map shows every price; three picks never hide anything.
- Email-only testers may book on staging (`APP_BOOKING_REQUIRES_PHONE=no`, owner to set in Vercel).

## Owner-side blockers for go-live

Apple Developer (D-U-N-S) and App Store Connect; Google Play Console; Supabase phone + SMS hook, Google, ZeptoMail SMTP, redirect URLs; WhatsApp number + Meta verification + Zoho templates; SMS aggregator; MyFatoorah; Vercel production variables; Google Maps Android key; Hotelbeds live keys; counsel sign-off on legal pages; passport-copy retention decisions (4).

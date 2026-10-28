# Cancel and refund in Ask

"Cancel my Dubai hotel and refund me" / «ألغِ فندق دبي ورجّع فلوسي» is answered inside the chat, with the refund screen's
rules, the same Mada Wallet-first choice and the same tracker. Nothing is cancelled until the traveller slides on the card.

Code: `platform/src/lib/app/ask-chat/tools-refund.ts` (the tool), `apps/mobile/src/components/booking/RefundQuoteCard.tsx`
(the card), `packages/shared/src/schemas/ask-chat.ts` (`refund_quote` in `ChatCard`), copy `packages/shared/src/copy/ask-refund.ts`
and `copy/ar/askRefund.ts` (the choice, "You get back" and the tracker reuse the refund screen's `rf.*` words).

## The tool: `refund_quote` (read only)

Input: `trip_id` (or null and `city`), `items` (`stay`, `flight`, `pickup`, `esim`, `activity`, `everything`), `reason`
(`plans` unless said). It:

1. Finds the trip: the id, the chat's trip, then the traveller's upcoming trip in the city; then a trip shared with them.
2. Owner only. A companion who can suggest or edit: the ask goes to the owner as a change request (`requestChange` with
   `ask: true`, so an editor's ask also waits for the owner), with the change card and one plain line ("only Omar can
   cancel and refund it; we've asked him"). A companion who can only view: the plain line, no card. The refund screen's
   POST refuses anyone but the owner too (the trip isn't theirs: 404).
3. Picks the payments the words name (an eSIM and an activity are both extras, told apart by the title) and reads
   exactly what the refund screen reads: `refundQuoteItems` (GACA and fare rules, the free-cancellation window, the
   instalment split), what the hotel, airline or driver keeps (paid less what the rule gives back), and the auto-approval
   decision for each pick (`decideAuto`: the same rule `createRefund` applies, `APP_REFUND_AUTO_MAX`, the open-flag check).
   Hotelbeds' cancellation simulation and TBO's release stay with the desk-started cancel (`/desk/refunds/new`), as on the
   refund screen.
4. Already asked for (a second ask, a retried turn): no new quote; the card comes back with `refund` set and shows the
   tracker.
5. Returns the card and a short text for the model: back, kept, both picks with "approved at once" or "after the team
   checks it", and "nothing is cancelled or refunded yet: only their slide does that".

Listed after every everyday tool and before the places tools (which stay last). Free-tier providers are sent it only on a
turn that reads as a cancel or a refund (`REFUNDY`; then the turn gets `get_trips`, `talk_to_human`, `refund_quote` and
the short refund rule), so the lean budget stays inside 2,650 tokens a call (2,605 with it).

## The card: `refund_quote`

What is cancelled and the city; "You get back SAR X" big; one line for what's kept ("The hotel keeps SAR 460 under its
cancellation rules", or "All of it comes back under the rules"); the refund screen's two places, Mada Wallet first, chosen
and marked Recommended ("Mada Wallet · instantly" only when the rules approve it at once, else "Mada Wallet … once we've
checked it, usually within a day"), and "Back to your {card} · Your bank shows it in 5–10 working days". Paid with
instalments: "Back through Tabby", no choice. Nothing back by the rules: "Slide to ask Mada anyway".

The slide ("Cancel and refund SAR X") calls `POST /trips/{id}/refunds` (the refund screen's call) with the payments,
the reason, the destination and the card's `clientKey`. The key is made from the owner, the trip and the payments, so a
second slide, the same card on another phone, or a card from a retried turn returns the same refund (a refund that was
declined or taken back gets a new key, so asking again works). Then the card is the tracker: a state pill (In your Mada
Wallet · Approved · Sent to your card · Waiting for the team · Not refunded), the refund screen's headline, the
`RefundTracker` steps, and Open Wallet or See it in Trips. The pushes are `createRefund`'s, one per step. The refund id
is kept on the phone by key, so the card opens on its tracker later.

## The prompt

"Cancel or refund: refund_quote with what they named, then one or two lines on what comes back and what's kept; the card
does the rest. Never say anything is cancelled or refunded until the card or a tool says so. Unsure: explain the rule
plainly. The card marks the Mada Wallet Recommended; never push it further." (`open_in_app refund` is no longer the answer.)

## Tests

- `platform/test/app/ask-refund.test.ts`: the quote matches the refund screen's numbers for the pickup, the flights and
  the stay; the slide creates exactly one refund (a second slide and a retried turn find it); auto (Wallet, instant, one
  push) and desk (a fee kept, "we're looking"); over `APP_REFUND_AUTO_MAX`; a companion's ask goes to the owner as a
  change and creates no refund; tool text and card pass the supplier-leak denylist; the evals' "claims" check.
- Evals `refund-dubai-hotel` ("Cancel my Dubai hotel and refund me") and `refund-dubai-hotel-ar` («ألغِ فندق دبي ورجّع
  فلوسي»): `refund_quote` with the stay, never `open_in_app`, a request or a hotel search, and no "cancelled"/"refunded"
  («تم الإلغاء») before the slide.
- `packages/shared/test/refunds.test.ts`: the card parses; every word is in Arabic.
- `apps/mobile/test/e2e-ask-refund.mjs` (mock web export): the card before and after the slide, English and Arabic, and
  the hotel on Tabby. Screens: `screens/ask-refund-before-en.png`, `ask-refund-after-en.png`, `ask-refund-before-ar.png`,
  `ask-refund-after-ar.png`, `ask-refund-hotel-en.png`. The mock's trip is Istanbul and its stay is paid with Tabby, so the
  shots use the airport pickup for the two-place choice.

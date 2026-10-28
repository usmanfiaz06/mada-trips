# App finance on the desk (DESK-PLAN U6)

Refunds after the decision, what each app sale cost us, and where app money lands in Ops. Code: `platform/src/lib/app/finance/`,
pages under `/adminwork/desk/refunds` and `/adminwork/desk/finance`. Migrations `drizzle/0040_app_finance.sql` and `drizzle/0049_refund_wallet.sql` (bank reference, Auto).

## Refunds and the Mada Wallet (`/desk/refunds`)

```
requested ─approve (within limits)──▶ approved (card) ─provider confirms──▶ sent ─settlement file──▶ settled
    │                               └▶ sent (Mada Wallet, at once)
    └─approve (over a limit)──▶ awaiting_lead ─lead approves in Ops Approvals──▶ lead_approved ─finance job──▶ approved / sent
                                               └─withdrawn, or every lead says no──▶ requested
approved ─provider says failed──▶ requested (with a note)
asked ─rules clear (Auto)──▶ approved (card, straight to the provider) or sent (Mada Wallet, credited now)
```

- **Partial amounts.** The desk approves all or part of what was asked; `amount` is what moves, `requested_amount` keeps the ask.
- **Limits** (Rules & limits, §7 default 2): an agent with `desk.refund` approves alone up to SAR 500 per refund and SAR 2,000 a day
  (`deskRefundLimit`, `deskRefundDailyLimit`); goodwill up to SAR 200 each and SAR 2,000 a day (`deskGoodwillLimit`,
  `deskAgentDailyLimit`). Above them the request goes to Ops Approvals (kind `app_refund` / `goodwill`), decided by `desk.admin`.
- **approved → sent.** The `finance` cron job (every 5 minutes) asks the provider for each card refund on its way (MyFatoorah
  `GetRefundStatus`; built against the published API, not yet run against a merchant account). Tabby and Tamara have no status
  call yet: the desk marks those sent by hand with the provider's reference.
- **Desk-started cancel and refund** (`/desk/refunds/new`): Hotelbeds simulates the cancellation first and shows what the hotel
  keeps; TBO releases the hold or files a change request. The refund then waits at To decide like any other, unless the
  supplier cancelled free (or released the hold) and all of it comes back: then the rules approve it (below).
- **The traveller's refund and the desk's rows move together** (`finance/refund-groups.ts`): a trip refund the traveller
  asked for is one group (`app_refund_groups`, what Trips → Requests shows) over one `app_refunds` row per payment. Every
  move of a row (desk approval or no, a lead's yes, the provider's answer, the desk marking it sent) brings the group to
  the stage of its slowest live row and carries the bank reference up.
- **Bank reference.** The provider's refund status gives the ARN when it has one (MyFatoorah `GetRefundStatus`), or the
  desk types it when it marks a refund sent; it is kept in `bank_reference` and shown on the tracker ("Sent to your Visa
  ending 41 · 12 Nov · Reference 7438…", with a copy button and "Show this to your bank if it isn't there after 10 working
  days."). After 10 working days (Sunday to Thursday) without it settling, the tracker offers "Still not there? Tell us",
  which opens a chat with the refund already written out. The desk refund detail shows it as Bank reference.
- **One push per step** (inbox first, then push; `notify()`): "We're looking at your refund" only when it waits for a
  person; "Refund approved" (card); "Refund sent" with the reference when there is one; "In your Mada Wallet" (instant,
  opens the Wallet). A refund over several payments still sends one push per step. A no comes from the desk with its reason.

## Auto-approval (instant when the rules are clear)

A refund skips the desk only when **all** of these hold (`finance/auto-approve.ts`, the rule itself is `autoApproveRefund`
in `@mada/shared` so the app's mock follows it too):

1. **The amount is what the rules give back with no fee**: inside the free-cancellation window or the supplier's simulation
   shows no fee (`free`), or the supplier already confirmed the cancellation and the refund (the airline cancelled; a
   Hotelbeds cancellation at no fee or a TBO hold released, from the desk) (`supplier_confirmed`). A refund that keeps a
   fee, or an "ask anyway", always goes to a person.
2. **It goes to the Mada Wallet or back to the card.** Tabby and Tamara always go to a person.
3. **It is within `APP_REFUND_AUTO_MAX`** (env, in SAR, e.g. `500` or `750.50`; default the agent's single-refund limit,
   Rules & limits `deskRefundLimit`, SAR 500; `0` turns auto-approval off).
4. **No open fraud or abuse flag on the account.** The only risk signal that exists today is an unlifted desk block
   (`app_desk_blocks`, set from the customer page). There is no fraud score, chargeback or velocity flag yet; when one
   exists it belongs in `openRiskFlag`.

Then a Mada Wallet refund is credited at once (stage sent) and a card refund goes straight to approved and on to the
provider (the finance job confirms it sent, as for any approved refund); if the provider turns the card refund down it goes
back to To decide with a note. Every auto-approval writes the rule that allowed it to `app_refunds.auto_rule`, to the app
audit (`refund.auto_approved`) and to the Ops audit (`desk.refund.auto_approved`); the desk Refunds list and detail show an
**Auto** tag with the rule. The refund screen says "Mada Wallet · instantly" only when the pick will be approved at once
(the quote carries `autoMax`); otherwise it says the wallet is ready once checked, usually within a day. The Ask chat's
`refund_quote` card (ASK-REFUND.md) shows the same numbers and choice and calls the same POST.

## The Mada Wallet («محفظة مادا»)

What the code and tables call credit (`app_credit_ledger`, `lib/app/credit.ts`) is the **Mada Wallet** everywhere a
traveller reads it: the refund screen, confirmations, the tracker, the Wallet tab, Money and Payments, receipts, pushes,
the pay sheet ("Use Mada Wallet first") and the desk's words to travellers.

- **Bookings only.** It is used first on the next booking and never expires. Nothing moves it to a card or pays it out:
  `POST /credit/move` and `moveCreditToCard` are gone (a test keeps it that way). A traveller who wants the money on
  their card chooses the card when they ask for the refund. The refund screen offers both, Mada Wallet first, chosen and
  marked Recommended; the disruption screen's refund option offers the same choice.
- **Card refunds: one range everywhere**: the bank shows it in 5–10 working days.
- **Lines.** Each movement reads "Refund · Garden hotel, Istanbul · +SAR 1,840" or "Used · Istanbul, 9–15 Mar · −SAR 300";
  the Wallet tab shows the latest three under the balance and the sheet shows them all. "Open Wallet" after a refund, and
  the push, open the Wallet on it (`/wallet?credit=1`).

## Revenue and margin (`/desk/finance`, VAT at `/desk/finance/vat`)

Every captured app payment gets one `app_order_costs` row per sold line: sell (VAT inside), VAT, the supplier's net in its own
currency, the rate to SAR at capture, and where the cost came from (supplier, estimated, typed by finance, or missing). Margin
per product is the sum of its lines. eSIM and Hotelbeds costs come from the supplier; TBO flights are estimated from
`TBO_AIR_MARKUP_BPS`; desk-quoted services have no cost until finance types one on the page.

## Reconciliation (`/desk/finance/reconciliation`)

Import the MyFatoorah settlement (deposit) report as CSV. Each line is matched to a capture or refund: matched captures clear
their Ops payment on the deposit day, matched refunds move to Settled; amount differences, lines Mada doesn't have and our
captures missing from the file are listed. Demo: `npx tsx src/lib/app/finance/seed-finance.ts settlement.csv` writes a file that
matches the seeded week in full.

## Supplier balances (`/desk/finance/balances`)

eSIM Access: the live prepaid balance (read every 15 minutes, or on the page). Hotelbeds and TBO: the credit line from Rules &
limits (`appHotelbedsCreditLine`, `appTboCreditLine`, 0 = not set) less what Ops Payables still owes them; neither has a balance
call wired.

## App money in Ops (§7 default 3)

Each captured app payment is posted once as an Ops sale (`bookings.channel = 'app'`, client "Mada app travellers", prepared by
the inactive system user "Mada app") and an Ops payment (`app_payments.ops_payment_id`, account retail). The Ops dashboard shows
App beside Retail and Corporate. A partial refund lowers the sale and its payment; a full refund marks the sale refunded.
App sales stay out of the Day-25 partner settlement until `APP_SALES_IN_SETTLEMENT=yes`.

## For the owner to set

- `APP_REFUND_AUTO_MAX` (env, SAR): the most the rules approve without a person. Default the agent's single-refund limit
  (SAR 500); `0` turns auto-approval off.
- `APP_SALES_IN_SETTLEMENT` (env): `yes` to count app sales in the partner settlement. Default no.
- Rules & limits: the refund and goodwill limits above, and the Hotelbeds and TBO credit lines.
- `APP_FX_RATES` (env): the rates costs are written at (USD is the peg; EUR and others are placeholders until set).
- Who sees App finance: `finance.view` today, or `desk.finance` once the support roles carry it.
- The MyFatoorah merchant account, to confirm `GetRefundStatus` and the settlement report's column names against real files.

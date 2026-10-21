# App finance on the desk (DESK-PLAN U6)

Refunds after the decision, what each app sale cost us, and where app money lands in Ops. Code: `platform/src/lib/app/finance/`,
pages under `/adminwork/desk/refunds` and `/adminwork/desk/finance`. Migration `drizzle/0038_app_finance.sql`.

## Refunds and credits (`/desk/refunds`)

```
requested ─approve (within limits)──▶ approved (card) ─provider confirms──▶ sent ─settlement file──▶ settled
    │                               └▶ sent (Mada credit, at once)
    └─approve (over a limit)──▶ awaiting_lead ─lead approves in Ops Approvals──▶ lead_approved ─finance job──▶ approved / sent
                                               └─withdrawn, or every lead says no──▶ requested
approved ─provider says failed──▶ requested (with a note)
```

- **Partial amounts.** The desk approves all or part of what was asked; `amount` is what moves, `requested_amount` keeps the ask.
- **Limits** (Rules & limits, §7 default 2): an agent with `desk.refund` approves alone up to SAR 500 per refund and SAR 2,000 a day
  (`deskRefundLimit`, `deskRefundDailyLimit`); goodwill up to SAR 200 each and SAR 2,000 a day (`deskGoodwillLimit`,
  `deskAgentDailyLimit`). Above them the request goes to Ops Approvals (kind `app_refund` / `goodwill`), decided by `desk.admin`.
- **approved → sent.** The `finance` cron job (every 5 minutes) asks the provider for each card refund on its way (MyFatoorah
  `GetRefundStatus`; built against the published API, not yet run against a merchant account). Tabby and Tamara have no status
  call yet: the desk marks those sent by hand with the provider's reference.
- **Desk-started cancel and refund** (`/desk/refunds/new`): Hotelbeds simulates the cancellation first and shows what the hotel
  keeps; TBO releases the hold or files a change request. The refund then waits at To decide like any other.

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

- `APP_SALES_IN_SETTLEMENT` (env): `yes` to count app sales in the partner settlement. Default no.
- Rules & limits: the refund and goodwill limits above, and the Hotelbeds and TBO credit lines.
- `APP_FX_RATES` (env): the rates costs are written at (USD is the peg; EUR and others are placeholders until set).
- Who sees App finance: `finance.view` today, or `desk.finance` once the support roles carry it.
- The MyFatoorah merchant account, to confirm `GetRefundStatus` and the settlement report's column names against real files.

# eSIMs: eSIM Access (live), Airalo (optional), mock

The traveller picks a plan for the trip, pays for it on the order sheet, and Mada buys it from the supplier once the
card is captured. They install it with one tap on an iPhone, or with the QR code and the codes on Android. On the trip
the app shows what's left, offers top-ups, and walks them through "Not connecting?". The desk sees every eSIM, the
supplier balance, and the owner's pricing.

Code: `platform/src/lib/app/suppliers/live/esimaccess.ts` (the adapter), `lib/app/esim/service.ts` (plans, order sheet,
buying, webhooks), `esim/pricing.ts` + `packages/shared/src/schemas/esim-pricing.ts` (the price rules),
`esim/ops.ts` (balance, low-balance orders, the cron job), `esim/catalogue.ts` (the daily sync).
Desk: `/adminwork/desk/esims`, `/adminwork/desk/esims/<id>`; pricing under App finance at `/adminwork/desk/finance/esim-pricing` (the old path redirects).

Until the keys are in, everything runs on mock fixtures: plans, orders, the balance ($500), the catalogue, usage.

---

## 1. Add the keys in Vercel (Preview / staging first)

eSIM Access has **no sandbox**. Every order spends the real prepaid balance. You get the money back only by cancelling an
eSIM that was never installed. So on staging, test with one or two cheap plans, and cancel them from the desk
afterwards (step 5).

In the eSIM Access console, open **Developer**. Copy the **Access Code** and the **Secret Key**.

In Vercel, open the platform project, then **Settings › Environment Variables**. Add these to **Preview** (or your staging
project) first:

| Variable | Value | Notes |
|---|---|---|
| `SUPPLIER_MODE_ESIM` | `esimaccess` | Sends eSIMs to eSIM Access. `airalo` sends them to Airalo; `mock` (or unset) uses the fixtures. |
| `ESIMACCESS_ACCESS_CODE` | your Access Code | Sent as `RT-AccessCode`. |
| `ESIMACCESS_SECRET_KEY` | your Secret Key | Signs every call (`RT-Signature`, HMAC-SHA256). It is never sent itself. |
| `ESIMACCESS_WEBHOOK_SECRET` | a long random string, e.g. `openssl rand -hex 24` | Goes in the webhook URL (step 2). eSIM Access does not sign its webhooks; this secret is how we know the call is from them. |
| `ESIMACCESS_ALLOW_OUTSIDE_PRODUCTION` | `yes` | **Staging only.** Without it, staging refuses to buy, because buying spends real money. Never set it on production (it does nothing there). |
| `APP_OPS_EMAIL` | the ops inbox | Gets the low-balance email. Without it, the desk banner is the only alert. |
| `ESIMACCESS_BASE_URL` | leave unset | Defaults to `https://api.esimaccess.com`. |

Redeploy. Open **desk › eSIMs**. The badge should read *eSIM Access*. The balance card should show your balance after you
press **Check now**. A red badge means a key is missing.

For production, add the same variables to **Production**, without `ESIMACCESS_ALLOW_OUTSIDE_PRODUCTION`. Use a different
`ESIMACCESS_WEBHOOK_SECRET` there. Prefer separate eSIM Access accounts or keys for staging and production if they offer
them.

Airalo stays available as a second supplier: `SUPPLIER_MODE_ESIM=airalo` plus the `AIRALO_*` variables (CONNECT.md §13).

## 2. What to paste in eSIM Access › Developer › Webhook

```
https://<your platform domain>/api/app/v1/esim/esimaccess/webhook?key=<ESIMACCESS_WEBHOOK_SECRET>
```

For example, on staging: `https://mada-staging.vercel.app/api/app/v1/esim/esimaccess/webhook?key=3f9c…`.

When you save, eSIM Access sends a test notice (`CHECK_HEALTH`). Our route answers 200, and the URL is saved. If it won't
save, check that the deploy with the key is live.

What the notices do:
- `ORDER_STATUS` (the eSIM is ready): finishes the order. The traveller sees the install screen.
- `ESIM_STATUS` and `SMDP_EVENT`: mark the eSIM installed when it reaches the phone, and refresh usage.
- `DATA_USAGE`: at 25% left or less, the traveller gets a line with **Top up**.
- `VALIDITY_USAGE`: a line when it ends within 3 days.

Nothing in a notice is believed on its own: the order or eSIM is read back from the API first. Each `notifyId` is
handled only once. If `ESIMACCESS_WEBHOOK_SECRET` is not set, only eSIM Access's published sender IPs are let in.

If a notice never comes, the cron job (every 15 minutes) picks up orders still being made. After 30 minutes, such an order
goes to the desk as *With Mada*.

## 3. Topping up credit

Prices are wholesale, in USD, paid from a prepaid balance.
- **Top up:** in the eSIM Access console, use the billing / top-up page. Keep at least a few days of orders in the
  balance.
- **The desk shows the balance** on desk › eSIMs. The cron job re-reads it every 15 minutes; **Check now** reads it at
  once.
- **When the balance counts as low:** below the alert threshold (pricing page, default $50), or below what a usual day of
  orders costs (the last 7 days' average). Then:
  - every desk page shows a red banner;
  - `APP_OPS_EMAIL` gets one email, repeated at most every 12 hours.
- **If it runs out after a traveller paid:**
  - The traveller sees *"Mada is sorting your eSIM. Ready by HH:MM, nothing for you to do."* and gets a notice. The time
    is "Promise when the balance runs out" on the pricing page (default 120 minutes), and it never moves.
  - The desk inbox gets an urgent item: *Top up the eSIM balance*.
  - Ops gets an urgent email, whatever the 12-hour rule.
  - Once you top up, the cron job orders it again within 15 minutes.
  - If the promised time passes first, the card is refunded automatically and the traveller sees the refund as the
    outcome.

## 4. Setting margins on the desk (admin only)

Open desk › eSIMs › **eSIM pricing**. You need *Change limits & rules* (`settings.manage`). Every save goes in the audit
trail with your name, and prices follow at once, in the app and on the order sheet.

**How a price is made:**
1. Cost in USD × today's dollar rate from the FX table (SAR is pegged at 3.75).
2. The higher of:
   - cost + **margin %** (default 30%);
   - cost + **minimum profit** in SAR, counted after the card fee (default SAR 10).
3. **Rounding** up (default: the next riyal ending in 9: 19, 29, 49). Other choices: a whole riyal, or none.
4. **The guard:** never below cost + the card fee. The fee is MyFatoorah's **card fee %** (default 2.5%) plus a fixed SAR
   part (default 0). If anything would sell below it, the guard wins and the plan shows *Guard*.
5. **Match suggested retail** (off by default): sell at the supplier's suggested retail, rounded up to a whole riyal,
   still never below the guard.

**Overrides:**
- **Per place** (country or region code): its own margin and minimum profit. Blank means the global rule.
- **Per plan:** its own margin, minimum profit, or a **fixed** SAR price. The guard still applies.
- Precedence: plan, then place, then global.

**For each plan, per place, the page shows:** cost in USD and SAR, the sell price, what Mada keeps (SAR and %), the
difference from suggested retail, and which rule set the price.

**Curating:**
- **Hide** a plan: travellers never see it and it can't be paid for.
- **Pick** up to three per place: the app shows these first. They are sized by data. Every other plan is under **See
  all plans**, best value first. Without picks, the app chooses light, regular and heavy sizes for the trip.
- Whether picked or chosen, a plan another one beats is never offered: same coverage, no more data, no more days and
  no lower price (5 GB · 30 days at SAR 29 next to 10 GB · 30 days at SAR 29 drops the 5 GB). The one marked
  recommended is the cheapest that covers the trip (lasts its days, about 0.7 GB a day); ties go to more data. Prices
  still come from the rules above, minimum profit and guard included (schemas/esim.ts `undominatedPlans`,
  `recommendEsimPlan`).

**Daily catalogue:** the cron job syncs every plan once a day. **Sync now** runs it at once. The pages say "Cost went up
on N plans" and mark those plans. Sell prices follow the rules automatically, never below the guard.

**Price holds:** a price the traveller saw is kept for them for "Hold a price shown" minutes (default 30), even if the cost
or your rules change meanwhile. If the new price is lower, they pay the lower one.

Before the first save, the margin starts from `APP_ESIM_MARKUP_BPS` (e.g. 3000 = 30%) if it is set.

Daily plans (e.g. "1GB/Day"): the app prices them for the trip's days (the day's price × days), and they are ordered for
that many days.

## 5. Support playbook

**Where to look:**
- desk › eSIMs: the list. Open an eSIM to see:
  - its ICCID and eSIM Access id;
  - whether it is installed, on, used up or ended, and until when;
  - data used and left (eSIM Access updates usage every 2 to 3 hours);
  - the APN, top-ups, and the order.
- In **Chats**, the traveller's eSIMs show beside the conversation, with a link to each.

**"It won't install":**
1. Ask whether they are on Wi-Fi and on iOS 17.4 or later for the one-tap link. Otherwise they scan the QR code from
   another screen, or type the codes.
2. **Send install details again** puts the install screen back in their inbox and on their phone.
3. An eSIM can be installed only once. If they deleted it, refund it, or top up a new one.

**"It doesn't connect":**
- The app's **Not connecting?** has already walked them through each check: Data Roaming on, the eSIM picked for
  mobile data, the APN when there is one, airplane mode, restart. Only then does it offer Talk to Mada, so if they write,
  those checks are done.
- Look at the eSIM page:
  - *Installed: not yet* → it never reached the phone. Install again from the codes.
  - Installed but no usage after landing → check coverage and the operator. eSIM Access support can check the profile
    by its ICCID.

**"I've run out":**
- They can top up in the app.
- Or use **Top up on Mada**: it is bought on our balance and the traveller pays nothing. Use it as a goodwill gesture or
  a fix. It is never bought twice for one click.

**A note to the traveller:** write it in your own words; it lands in their inbox under your name.

**Refund:**
- **Cancel and refund** on the eSIM page.
- If it was **never installed**, eSIM Access cancels it and returns its cost to our balance.
- If it was **installed**, eSIM Access won't take it back. The traveller still gets their share of the order back, and
  Mada carries the cost.

**"With Mada" (stuck):**
- *Waiting on our supplier balance*: top up (§3).
- *No answer*: **Check the supplier and order**. It looks the order up first, by its order number or our reference
  (`mada:<order id>` as the transactionId), so nothing is ever bought twice.

**Never twice:**
- Every order carries our reference as its `transactionId`. eSIM Access treats a repeated transactionId as the same
  purchase.
- We keep its order number from the first answer.
- A retry, a second server or the desk's button looks before it buys.

## Checks

- `platform/test/app/esimaccess.test.ts` covers:
  - signing (the docs' own example);
  - the units (USD × 10,000, bytes, daily plans);
  - a retry never buying twice;
  - orders that come later, and the webhook (secret, IPs, duplicates);
  - low balance after payment (promise, desk, email, re-order, auto-refund);
  - the pricing rules and desk edits;
  - holds, picks and hidden plans;
  - the catalogue sync.
- `apps/mobile/test/e2e-esim.mjs` walks the app in English and Arabic.

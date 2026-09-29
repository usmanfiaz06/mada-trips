# Mada Ops: internal platform plan

The internal operating system for Mada Trips. It turns the *Operational & Financial Governance Document* into software: every booking, riyal, approval and partner payout goes through one place, and the governance rules run as system behaviour instead of relying on people to remember them.

Status: **v1 built** in [`platform/`](../../platform). See its README to run it.

---

## 1. What the governance document actually asks for

Read as software requirements, the document comes down to eight rules:

| # | Rule in the document | What the platform must do |
|---|---|---|
| R1 | Partner out-of-pocket setup costs are **partner loans** | Partner Equity Ledger: every advance is logged, proved, verified, then repaid in parts |
| R2 | Expense claims need **amount (SAR) + proof + justification**, sent to Abdulaziz | Expense claim form that won't submit without all three; Abdulaziz's verification queue |
| R3 | **Two bank accounts**: Retail/B2C and Corporate/B2B, never mixed | Every receipt and payment is tagged to one account; B2B money can't be posted to B2C and the other way round |
| R4 | Pakistan team books but **cannot issue** (no TTP). Only Bader, or Riyadh staff he delegates to, can issue | Two steps: *Prepared* (Pakistan) then *Issued* (authorised issuer only). Delegation has limits and is logged |
| R5 | **Daily report by 10:00 PM** (Riyadh time) from both teams: PNR/ticket, client, pax, net cost, sell, margin, payment method, collection status | Bookings *are* the report. At 10 PM the day locks and one consolidated report goes to Abdulaziz, who reconciles it against the banks |
| R6 | Cash customers are recorded **in real time**; contract work lives in a **live POS** visible to the core team | Two ways in: a quick POS sale for walk-ins, and a job/case flow for corporate contracts. One live board for both |
| R7 | **Day-25 cut-off** on *cleared* funds, then a **4-step waterfall**: overheads, IATA reserve, partial partner repayment, 33.33 / 33.33 / 33.34 dividend | Month-close wizard that only counts funds cleared on or before the 25th, rolls the rest forward, and fills the waterfall in order |
| R8 | Credit for **non-contracted clients**: **two directors approve up to SAR 20,000**; above that **all partners decide jointly**. Limits go up later | Approval engine with limits you can change in settings, not in code |

Plus company structure, which sets permissions:

| Partner | Titles | Main job in the platform |
|---|---|---|
| **Abdulaziz** | Chairman, BOD, Managing Partner, Shareholder | Finance controller: receives daily reports, verifies expenses, runs reconciliation and month close |
| **Bader** | CEO, BOD, Managing Partner, Shareholder | Operations: the only issuing authority (TTP), delegates issuance, runs supplier/IATA side |
| **Haneef** | BOD, Managing Partner, Shareholder | Director: approves credit, reviews reports, gets dividends |

### The core idea: money in the bank is not profit

Most of what lands in the bank belongs to IATA and the airlines. So the platform always shows three different numbers and never mixes them up:

- **Cash position**: what is in the two accounts right now.
- **Owed out**: BSP/IATA liabilities and supplier payables coming due (money that is *not ours*).
- **Earned**: gross margin on settled bookings minus fixed overheads = net profit.

Every dashboard puts "Cash" and "Profit" next to each other so nobody reads a big balance as a good month.

---

## 2. Who uses it (personas)

| Persona | Where | Device | What they need most |
|---|---|---|---|
| **Riyadh retail agent** | Office, 12 PM to 10 PM | Desktop at counter, sometimes a phone | Log a walk-in sale in under 30 seconds, take payment, issue if delegated, close the day with no stress |
| **Pakistan corporate team** | Remote, 2 hours ahead of Riyadh | Desktop | Pick up corporate requests, prepare bookings, send them to issue, build monthly invoices |
| **Bader (CEO / issuer)** | Anywhere | Mostly **phone** | An issuance queue he can clear in seconds, set delegation, see supplier exposure |
| **Abdulaziz (Chairman / finance)** | Anywhere | Desktop + phone | Nightly reconciliation, expense verification, Day-25 close, partner ledger |
| **Haneef (Director)** | Anywhere | Mostly **phone** | Approve or reject credit requests fast, read the numbers, see his ledger and payouts |

Time zone note: 10:00 PM Riyadh is 12:00 AM Pakistan. The system runs on **Asia/Riyadh** time and shows each Pakistan user their local time next to it, with a countdown to the cut-off.

---

## 3. Modules

```
                    ┌──────────────── Mada Ops ────────────────┐
  Front office      │  1 POS (walk-in)      2 Corporate desk   │
                    │  3 Issuance queue     4 Clients & credit  │
  Control           │  5 Approvals          6 Daily close       │
  Finance           │  7 Banks & recon      8 Expenses & AP     │
                    │  9 IATA/BSP reserve  10 Month close (D25) │
  Partners          │ 11 Partner ledger    12 Dashboards        │
  Platform          │ 13 Users, roles, settings, audit log      │
                    └──────────────────────────────────────────┘
```

1. **POS (retail)**: quick sale for walk-in and online B2C. Service type (flight, hotel, visa, package, other), pax, PNR/ticket no., net cost, sell price, margin worked out live, payment method (cash, mada, card, bank transfer). Posts to the **Retail account** only.
2. **Corporate desk**: requests from contracted clients (email/WhatsApp/portal) become *Cases*. Pakistan team quotes, books, sends to issue. Each case is linked to the client's contract and credit terms.
3. **Issuance queue**: every booking that needs ticketing lands here. Only users with an **Issuer** permission can mark it *Issued*. Bader can delegate issuance to named Riyadh staff with limits (max ticket value, retail only / corporate allowed, working hours, expiry date).
4. **Clients & credit**: client profiles: *Contracted corporate* (contract, rates, credit limit, terms, billing contact) or *Retail*. Shows live exposure: open balance, overdue, limit left.
5. **Approvals**: one engine for credit to non-contracted clients, raising credit limits, expense claims, refunds/write-offs, and partner repayments. Routes by amount (see 5.3).
6. **Daily close (10 PM)**: auto-built from the day's activity; each team confirms, then it locks. Abdulaziz gets it, ticks off cash counted and bank amounts, and signs.
7. **Banks & reconciliation**: two accounts. Bank lines are imported (CSV/statement upload first, bank API later) and matched to receipts. A receipt is *Collected* when recorded and *Cleared* only when matched to a bank line; clearing date drives Day-25.
8. **Expenses & payables**: company expenses, supplier bills, fixed overheads (salaries, rent, utilities, comms, licences) as recurring items.
9. **IATA / BSP reserve**: upcoming BSP remittance debits from issued tickets; shows the reserve needed for the next cycles and warns when the account is running below it.
10. **Month close (Day 25)**: wizard: freeze the cycle, confirm cleared funds, net profit, walk the waterfall, approve, record transfers to partners.
11. **Partner ledger**: per partner: capital advances, verified expenses, repayments, dividends, current balance owed. The first working-capital injection for IATA is also a tracked advance.
12. **Dashboards**: role-specific home screens (see section 6).
13. **Admin & audit**: users, roles, permission changes, limits, and an audit log nobody can edit for every money and approval action.

---

## 4. Key objects (data model, simplified)

```
Partner ─┬─ LedgerEntry (advance | expense_reimb | repayment | dividend)
         └─ User (can also be staff)

User ── Role (partner_finance, partner_ceo, director, retail_agent, corp_agent, viewer)
     └─ Delegation (issuer rights: limits, scope, expiry, granted_by)

Client (retail | corporate_contracted | corporate_noncontracted)
   └─ Contract (terms, credit_limit, payment_terms_days)
   └─ CreditRequest ── Approval[]

Booking / Sale
   ├─ channel: retail_pos | corporate_case
   ├─ items: flight | hotel | visa | package | other
   ├─ pnr, ticket_numbers[], passengers[]
   ├─ net_cost, sell_price, vat, margin (derived)
   ├─ status: draft → prepared → pending_issue → issued → (void | refunded | reissued)
   ├─ prepared_by, issued_by (issuer or delegate), timestamps
   └─ Payment[] (method, amount, account: RETAIL | CORPORATE, collected_at, cleared_at, bank_line_id)

Invoice (monthly consolidated per corporate client) ── Booking[]
BankAccount (RETAIL | CORPORATE) ── BankLine[] (imported)
Expense (category, amount, proof_file, justification, paid_by: company | partner) ── Approval[]
BSPObligation (period, due_date, amount, status)
DailyClose (date, team, figures snapshot, submitted_by, verified_by, locked)
SettlementCycle (26th → 25th, cleared_inflows, gross_profit, overheads, net_profit, waterfall[], approved_by[])
AuditEvent (who, what, before, after, when, ip/device)
```

Rules the data enforces:
- Margin, totals and profit are **always worked out**, never typed in.
- A locked daily close or settlement cycle can't be edited; corrections go in as dated adjustments with a reason.
- A payment's account must match the client type (retail to Retail, corporate to Corporate). Exceptions need approval.
- Nobody approves their own request (Abdulaziz's own expense claims go to Bader or Haneef).

---

## 5. User journeys

### 5.1 Walk-in customer (Riyadh agent), the target is under 30 seconds

1. Customer arrives. Agent hits **New sale** (keyboard: `N`).
2. Picks service (Flight), types client name or phone. Returning clients autocomplete; new clients need only name + phone.
3. Pastes PNR. Enters **net cost** and **sell price**; the margin shows live, green/amber/red against the target margin.
4. Takes payment: picks method (mada / card / cash / transfer). Split payments allowed.
5. **Issue**:
   - If the agent has delegation and the sale is within limits, **Issue now** is enabled and they enter the ticket no.
   - Otherwise it goes to Bader's **issuance queue** and the agent sees "Waiting for issue: Bader notified".
6. Receipt printed or sent on WhatsApp. The sale appears in the live board and in tonight's report automatically.

Edge cases the UI handles: unpaid/partially paid (flagged in red on the close), void within 24h, refund (needs approval), price changed after quote.

### 5.2 Corporate request (Pakistan team, then issuer)

1. Request arrives from a contracted client, logged as a **Case** (client, traveller, dates, policy notes).
2. Agent builds options and books (holds PNR). Case moves to **Prepared** with net cost, sell price, fare rules and time limit.
3. System checks the **client's credit left**. If the booking would go over it, a credit request goes to Approvals automatically.
4. Case lands in the **issuance queue** with a ticketing deadline countdown.
5. **Bader** (or a delegate) reviews on phone: one card with route, pax, net vs sell, client exposure, then **Issue** or **Send back** with a note.
6. Ticket no. recorded; case marked Issued; added to the client's **month-to-date invoice** and to the BSP obligation for that period.

### 5.3 Credit approval for a non-contracted client (R8)

| Amount (configurable) | Route |
|---|---|
| ≤ SAR 20,000 | Any **2 of 3 directors** approve |
| > SAR 20,000 | **All 3 partners** approve (joint decision) |
| Contracted client within contract limit | No approval; auto-allowed |

1. Agent tries to give credit (pay later) to a non-contracted client, and the system opens a credit request with the amount, the reason and client history.
2. Directors get a push/WhatsApp notification: **Approve / Reject / Ask** in one tap on phone.
3. Live progress: "1 of 2 approvals: Bader ✓, waiting on Abdulaziz or Haneef".
4. Once approved, the booking goes ahead with a due date. Overdue credit shows up on every director's home screen.
5. Rejections need a short reason. Everything is audit-logged.

### 5.4 Partner pays a business expense (R1, R2)

1. Partner opens **Add expense** on phone: amount in SAR, photo/PDF of proof, description + business reason. Can't submit if any of the three is missing.
2. Chooses "Paid by me personally" (becomes a partner loan) or "Paid by company".
3. Goes to **Abdulaziz** to verify (if Abdulaziz submitted it, it goes to Bader or Haneef).
4. Once verified, it's posted to the **Partner Equity Ledger** as money owed back to that partner.
5. Repaid in parts through the Day-25 waterfall (Priority 3).

### 5.5 Daily close at 10:00 PM (R5, R6)

- **9:00 PM**: nudges to both teams: "3 sales missing payment status, 1 PNR missing net cost."
- **9:45 PM**: each team opens **Close my day**: a checklist of anything incomplete, and a cash count for the Riyadh counter (expected vs counted).
- **10:00 PM**: day locks automatically. The unified report (every booking with PNR/ticket, client, pax, net, sell, margin, method, status) goes to Abdulaziz as an in-app report + PDF + WhatsApp/email summary.
- **Next morning**: Abdulaziz does **reconcile**: matches report receipts to the lines in both bank accounts, marks differences, signs off. Anything unmatched carries forward and stays visible.

### 5.6 Month close on Day 25 (R7)

A guided, step-by-step wizard:

1. **Cut-off**: the cycle runs 26th to 25th. Only receipts **cleared in the bank** on or before the 25th count; the rest are listed as "rolling to next cycle".
2. **Profit**: revenue from settled bookings minus direct supplier/IATA cost = gross operating profit; minus fixed overheads = **net monthly profit**.
3. **Waterfall**, each step filled from what's left:
   1. Operating overheads (salaries, rent, utilities, admin)
   2. IATA working-capital reserve (from upcoming BSP debits + safety buffer)
   3. Partial partner repayment (a % or cap that partners set; spread pro-rata across outstanding partner loans unless partners choose otherwise)
   4. Dividend of the remainder: Abdulaziz 33.33%, Bader 33.33%, Haneef 33.34%, rounded to the halala so it adds up exactly
4. **Approve**: all three partners sign off in the app.
5. **Pay**: record the transfer reference for each partner. The cycle locks and each partner gets a statement PDF.

If there's nothing left after Priority 2, the wizard says so plainly and shows what's short.

### 5.7 Bader delegates issuance to the Riyadh agent (R4)

Settings → Delegation → pick user → scope (retail only / include corporate), max value per ticket, daily cap, allowed hours, expiry date → confirm. The delegate sees a badge "Can issue up to SAR X". Every delegated issue shows in Bader's feed. He can revoke at once.

---

## 6. Screens and navigation

Sidebar on desktop, bottom tabs on phone. Everyone sees only what their role allows.

| Screen | Retail agent | Pakistan team | Bader | Abdulaziz | Haneef |
|---|---|---|---|---|---|
| Home (role-specific) | Today's sales, to-do for close | Open cases, deadlines | Issue queue, exposure | Cash vs profit, recon status | Approvals, KPIs |
| POS / New sale | ✓ | – | ✓ | view | view |
| Corporate cases | view | ✓ | ✓ | view | view |
| Issuance queue | if delegated | – | ✓ | view | view |
| Clients & credit | limited | ✓ | ✓ | ✓ | ✓ |
| Approvals | request | request | ✓ | ✓ | ✓ |
| Daily close | own team | own team | ✓ | ✓ verify | view |
| Banks & recon | – | – | view | ✓ | view |
| Expenses | – | – | ✓ | ✓ verify | ✓ |
| IATA/BSP reserve | – | – | ✓ | ✓ | view |
| Month close | – | – | approve | ✓ run | approve |
| Partner ledger | – | – | own + all | ✓ | own + all |
| Settings & audit | – | – | ✓ | ✓ | view |

**Partner home** (the screen that matters most): top row, four numbers side by side: *Cash in banks* · *Owed to IATA/suppliers* · *Net profit this cycle* · *Days to Day 25*. Below that: *Waiting for you* (approvals, issues, verifications), then trend charts (margin by channel, receivables ageing, BSP coverage).

---

## 7. UX principles ("best of the best")

1. **Fastest possible data entry at the counter**: keyboard-first POS, autocomplete everywhere, sensible defaults, no page reloads, `N` for new sale, `⌘K` command bar to jump anywhere.
2. **Decisions on the phone in one tap**: approvals and issues are cards with everything needed to decide; no digging.
3. **Show the rule, don't just enforce it**: when something is blocked, say why and who can unblock it ("Over your SAR 5,000 issue limit: sent to Bader").
4. **Nothing gets lost**: every draft autosaves; incomplete items follow the user to the close checklist.
5. **Cash ≠ profit, always visibly separate.**
6. **Deadlines are visible**: countdown to 10 PM, to ticketing time limits, to Day 25, to the next BSP debit.
7. **Trust by design**: audit trail on every record ("Edited by the Riyadh counter at 21:14: sell 1,850 → 1,900"), locked periods, no self-approval.
8. **Bilingual from day one**: English + Arabic with full RTL, SAR formatting, Hijri date shown alongside Gregorian where useful.
9. **Brand-consistent but calm**: uses Mada green `#1e352d`, sand `#e9e2d8`, gold `#d9b77a`, with a clean, dense, data-first layout (not the marketing site's cinematic motion). Light and dark mode.

---

## 8. Recommended tech stack

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js (React, TypeScript)** + Tailwind + shadcn/ui | Fast, polished UI; one codebase for desktop and phone (installable PWA) |
| Database & auth | **Supabase (Postgres)** with Row-Level Security | Real database with money-safe numbers (`numeric`), role rules enforced at the database, file storage for receipts/proofs, realtime updates for the live board |
| Money logic | Server-side only, in Postgres functions / server actions | Margins, waterfall and cut-offs can't be tampered with from the browser |
| Notifications | Email + WhatsApp Business API (later) + web push | Directors approve from where they already are |
| PDFs | Server-rendered daily report, invoices, partner statements | |
| Hosting | Vercel (like the website) + Supabase, ideally a region near KSA | |
| Security | 2FA for partners, device/session log, audit table only ever added to | |

Later integrations (not in the first version): GDS (Amadeus/Sabre) PNR import, bank statement APIs, BSPlink reports import, ZATCA e-invoicing (Fatoora) for tax invoices.

---

## 9. Build phases

| Phase | Scope | Result |
|---|---|---|
| **0: Design** | Your design direction, clickable prototype of POS, issuance queue, approvals, partner home | Agree on look and flows before coding |
| **1: Operate daily (MVP)** | Auth & roles, clients, POS, corporate cases, issuance queue + delegation, payments on the two accounts, **daily close at 10 PM**, audit log | Teams stop using WhatsApp/Excel for daily work |
| **2: Control** | Approvals engine (2-of-3 up to 20K / joint above), credit limits, expense claims with proof, partner ledger | Governance rules R1, R2, R8 enforced |
| **3: Finance** | Bank statement import & reconciliation, BSP reserve, recurring overheads, monthly corporate invoices | Cleared vs collected is known exactly |
| **4: Month close** | Day-25 wizard, waterfall, partner statements, dashboards | The whole partner payout runs in the app |
| **5: Integrations** | GDS, bank API, ZATCA, WhatsApp | Less typing, fewer errors |

---

## 10. Questions for the partners

Answers to these change the build; everything else can use sensible defaults.

1. **Approvals**: can *any* two of the three directors approve up to 20K, or must Bader or Abdulaziz be one of them? Does "jointly agreed" above 20K mean all three?
2. **Contracted clients**: do they have per-client credit limits in their contract? What's the default payment term (30 days)?
3. **Riyadh delegation**: what are the "strict parameters": a max ticket value, retail only, time window?
4. **Priority 3 repayment**: fixed amount, % of surplus, or decided each month? Pro-rata across partners, or first-in-first-out?
5. **IATA reserve**: how many BSP cycles ahead should the reserve cover, and should there be a minimum buffer?
6. **VAT**: is VAT charged on the full ticket or only on the service fee/margin? (Check with your accountant; the platform will support both.)
7. **Refunds, voids, ADMs**: who approves, and do they hit the cycle they happened in or the original one?
8. **Tools today**: which GDS do you use, which banks, and is there an existing Excel/POS whose data we should import?
9. **Language**: should Arabic be the default for Riyadh staff?
10. **Design direction**: share references (apps you like, mood, colours). Default: Mada brand, calm, data-first.


---

## 11. Decisions since the first draft

- **Partner repayments follow equity.** The Priority 3 pool is split 33.33 / 33.33 / 33.34 among partners who are still owed money, never paying anyone more than their balance; any leftover goes to dividends.
- **English and Arabic**, with full right-to-left support; each person picks their language.
- **Sans-serif only** for the internal platform (Geist + IBM Plex Sans Arabic), unlike the website.
- **Visual direction:** bento layout on a neutral canvas, near-black "ink" tiles for the hero numbers, oversized light numerals, and charts designed around Mada's own data:
  - *cycle barcode*: every sale in the cycle as one line, coloured by margin
  - *Day-25 arc*: how far through the cycle we are
  - *sun gauge*: IATA reserve coverage, echoing the Mada sun mark
  - *dot columns*: margin per day
  - *waterfall*: the Day-25 cash allocation
- **Roles are editable** (permission matrix), with safeguards so nobody can remove the last administrator.
- **Everything is logged** (sign-ins, sales, issues, payments, votes, remarks, role and rule changes) in an append-only activity log with CSV export.

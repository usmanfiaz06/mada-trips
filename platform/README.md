# Mada Ops

The internal operations platform for Mada Trips. It runs the partners' *Operational & Financial Governance Document* as software: sales and ticketing, issuance control, approvals, expenses, the 10 PM daily close, bank reconciliation, the Day-25 settlement waterfall and the Partner Equity Ledger. Every action is recorded in an append-only activity log.

English and Arabic (full right-to-left), light and dark, phone to desktop.

## Run it locally

Needs Node 20+ and Postgres 14+.

```bash
cd platform
cp .env.example .env            # set DATABASE_URL
npm install
npm run db:migrate              # create tables (+ the append-only trigger on the activity log)
npm run db:seed                 # demo data; or: npm run db:seed -- --bootstrap  (partners only, no demo)
npm run dev                     # website on http://localhost:3100, platform on /adminwork
```

Demo sign-ins (password `Mada@2026`, override with `SEED_PASSWORD`):

| Person | Email | Role |
|---|---|---|
| Abdulaziz | abdulaziz@madatrips.com | Partner |
| Bader | bader@madatrips.com | Partner · Issuing authority (TTP) |
| Haneef | haneef@madatrips.com | Partner |
| Riyadh Counter | counter@madatrips.com | Retail agent (Riyadh), delegated issuer |
| Pakistan Desk 1, 2 | desk1@ / desk2@madatrips.com | Corporate desk (Pakistan) |

`npm run db:seed -- --reset` wipes everything and reseeds.

## Deploy (same Vercel project as the website)

One Vercel project serves both: the public website at `madatrips.sa` and Mada Ops at `madatrips.sa/adminwork`. The website isn't changed; at build time `scripts/copy-site.mjs` copies it from the repo root into `public/`, and Next.js serves it with the same clean URLs and headers as before. Nothing on the website links to `/adminwork`, and the platform tells search engines not to index it.

One-time setup in the existing Vercel project:

1. **Settings → Build and Deployment → Root Directory:** `platform`. Framework Preset switches to **Next.js**. Leave "Include files outside the root directory" on (the website lives there).
2. **Database.** Either create a **Supabase** project (turn off "Enable Data API"; the platform connects to Postgres directly) and add its **Transaction pooler** connection string as `DATABASE_URL` in Vercel, or use **Storage → Create Database → Neon**, which adds `DATABASE_URL` for you.
3. **Settings → Environment Variables:** add `SEED_PASSWORD`, the first password for the three partner logins.
4. **Redeploy.** Each build runs `vercel-build`: migrations, first-time setup (roles, the three partners, bank accounts; skipped once anyone exists), then the build. Demo data is never loaded in production.

Then open `/adminwork`, sign in as a partner (e.g. `abdulaziz@madatrips.com`), change the password under **My profile**, and add the team under **Team**. With the root directory set to `platform`, the root `vercel.json` is no longer read; its headers now live in `next.config.ts`.

## How the governance rules are enforced

| Rule | Where |
|---|---|
| Two bank accounts never mixed | a sale's account is decided by the client type (retail → B2C, corporate → B2B); payments inherit it |
| Remote team can't issue (no TTP) | `src/lib/issuance.ts`: flights need `issue.unlimited` or an active delegation within its per-ticket limit, daily cap, scope and expiry |
| Credit for non-contracted clients: any 2 directors ≤ SAR 20,000, all directors above | `src/lib/approvals.ts` (`createApproval`); thresholds live in **Rules & limits** |
| Contracted clients buy on credit within their limit | over-limit sales go to the same approval route; raising a limit needs directors, lowering applies at once |
| Expenses need amount, proof and justification, verified by someone else | the form won't submit without all three; the submitter can never verify their own |
| Partner-paid expenses become partner loans | on verification they're posted to the Partner Equity Ledger (startup costs as capital advances) |
| 10 PM daily report, both teams | `src/lib/daily.ts`; the submitted report is a locked snapshot; late submissions are marked |
| Day-25 cut-off on cleared funds | a booking belongs to the cycle in which its last payment **cleared** in the bank |
| Waterfall: overheads → IATA reserve → repayments → dividends | `computeSettlement` in `src/lib/finance.ts`; repayments and dividends are split **by equity**; repayments never exceed what a partner is owed |
| Settlement signed by all directors | approval kind `settlement`; on approval, ledger entries are posted and the IATA reserve updated |
| Who did what | every write calls `audit()` in the same transaction; a database trigger makes `audit_events` append-only |

Money is stored in halalas (integers), so totals and splits are exact.

## Structure

```
src/db/            schema, migrations runner, seed
src/lib/           auth, permissions, approvals engine, finance & settlement, daily report, i18n
src/app/(app)/     one folder per module: sales, issuance, approvals, clients, expenses, close,
                   finance, settlement, partners, team (+ roles), activity, settings, me
src/components/    UI kit, charts (cycle barcode, arc gauge, sun gauge, dot columns, waterfall),
                   timeline & remarks, attachments, shell (sidebar, command palette)
drizzle/           SQL migrations
```

Design tokens are in `src/app/globals.css`. The interface is sans-serif only (Geist, with IBM Plex Sans Arabic for Arabic).

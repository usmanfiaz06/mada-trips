// The agent desk in Mada Ops, end to end, in headless Chromium against a running platform with demo data.
//
//   DATABASE_URL=… npm run db:migrate && psql "$DATABASE_URL" -f drizzle/pending/desk.sql   (and the other pending files)
//   DATABASE_URL=… npm run db:seed && DATABASE_URL=… npx tsx --conditions=react-server src/lib/app/desk/seed.ts
//   DATABASE_URL=… APP_DATA_KEY=… npm run dev
//   BASE=http://localhost:3100 node test/e2e-desk.mjs [shot-dir]
//
// Signs in as Faisal's Ops login (Riyadh Counter) and as Bader (every desk right), walks every desk page in English
// and Arabic, light and dark, desktop and phone widths, then works the flows: confirm & hold, reveal a passport,
// issue tickets, ask the traveller, reply in chat with a note, approve and decline refunds, push a disruption plan,
// moderate, and put a shift on the rota. Screenshots go to the shot directory. Fails on any page error.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:3100';
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/desk-shots');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Mada@2026';
const ONLY = process.env.ONLY ?? ''; // "pages" or "flows" to run one half
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const problems = [];
let n = 0;

async function session(email, { width = 1440, height = 960, locale = 'en', theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 600 ? 2 : 1, isMobile: width < 600, hasTouch: width < 600 });
  const host = new URL(BASE).hostname;
  await ctx.addCookies([{ name: 'mada_locale', value: locale, domain: host, path: '/adminwork' }, { name: 'mada_theme', value: theme, domain: host, path: '/adminwork' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${email} ${page.url()}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Download the React DevTools|favicon|status of 404/.test(m.text())) problems.push(`${email} console ${page.url()}: ${m.text().slice(0, 300)}`); });
  await page.goto(`${BASE}/adminwork/login`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 60_000 }), page.click('button[type=submit]')]);
  return { ctx, page };
}

async function shot(page, name, full = true) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(350);
  n += 1;
  const file = `${OUT}/${String(n).padStart(3, '0')}-${name}.png`;
  await page.screenshot({ path: file, fullPage: full });
  return file;
}

async function go(page, path) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  if (!res || res.status() >= 400) problems.push(`${path}: HTTP ${res?.status()}`);
  // Forms post through React: wait until the page is hydrated before anyone clicks.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
  const body = await page.innerText('body');
  if (/Application error|Unhandled Runtime Error|Something went wrong/.test(body ?? '')) problems.push(`${path}: error page`);
}

async function firstHref(page, pattern, text) {
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => ({ href: a.getAttribute('href'), text: a.textContent ?? '' })));
  const hit = hrefs.find((h) => pattern.test(h.href ?? '') && (!text || h.text.includes(text)));
  if (!hit) throw new Error(`No link matching ${pattern} ${text ?? ''} on ${page.url()}`);
  return hit.href;
}

async function expectText(page, text) {
  const body = await page.innerText('body');
  if (!body?.includes(text)) problems.push(`${page.url()}: expected "${text}"`);
}

/* ───────────── discover ids once ───────────── */
const lead = await session('bader@madatrips.com');
await go(lead.page, '/adminwork/desk/orders?s=all');
const ids = {
  awaiting: await firstHref(lead.page, /\/desk\/orders\/[0-9a-f-]{36}$/, 'Riyadh to Istanbul'),
  held: await firstHref(lead.page, /\/desk\/orders\/[0-9a-f-]{36}$/, 'Riyadh to London'),
  issued: await firstHref(lead.page, /\/desk\/orders\/[0-9a-f-]{36}$/, 'Riyadh to Jeddah'),
  tabby: await firstHref(lead.page, /\/desk\/orders\/[0-9a-f-]{36}$/, 'Jeddah to Dubai'),
};
await go(lead.page, '/adminwork/desk/requests?s=all');
ids.visa = await firstHref(lead.page, /\/desk\/requests\/[0-9a-f-]{36}$/, 'Schengen');
ids.umrah = await firstHref(lead.page, /\/desk\/requests\/[0-9a-f-]{36}$/, 'Umrah');
await go(lead.page, '/adminwork/desk/chats');
ids.chat = await firstHref(lead.page, /\/desk\/chats\?t=support:/, 'Sultan');

const PAGES = [
  ['inbox', '/adminwork/desk'], ['inbox-team', '/adminwork/desk?f=team'], ['orders', '/adminwork/desk/orders'], ['order-awaiting', ids.awaiting], ['order-held', ids.held],
  ['order-issued', ids.issued], ['requests', '/adminwork/desk/requests'], ['request-visa', ids.visa], ['request-umrah', ids.umrah], ['chats', '/adminwork/desk/chats'], ['chat-thread', ids.chat],
  ['refunds', '/adminwork/desk/refunds'], ['disruptions', '/adminwork/desk/disruptions'], ['moderation', '/adminwork/desk/moderation'], ['moderation-blocked', '/adminwork/desk/moderation?s=blocked'], ['team', '/adminwork/desk/team'],
];
await lead.ctx.close();

/* ───────────── every page, both languages, both themes, desktop and phone ───────────── */
if (ONLY !== 'flows') {
  const passes = [
    { tag: 'en-light-desktop', locale: 'en', theme: 'light', width: 1440, height: 960 },
    { tag: 'ar-dark-desktop', locale: 'ar', theme: 'dark', width: 1440, height: 960 },
    { tag: 'en-dark-phone', locale: 'en', theme: 'dark', width: 390, height: 844 },
    { tag: 'ar-light-phone', locale: 'ar', theme: 'light', width: 390, height: 844 },
  ];
  for (const p of passes) {
    const s = await session('counter@madatrips.com', p);
    for (const [name, path] of PAGES) {
      await go(s.page, path);
      await shot(s.page, `${p.tag}-${name}`);
    }
    if (p.width > 1000) {
      await go(s.page, '/adminwork/desk');
      await s.page.keyboard.press('j');
      await s.page.keyboard.press('?');
      await shot(s.page, `${p.tag}-inbox-shortcuts`, false);
    }
    await s.ctx.close();
  }
}

/* ───────────── the flows ───────────── */
if (ONLY !== 'pages') {
  const { page, ctx } = await session('bader@madatrips.com', { width: 1440, height: 960 });
  // Click, then wait until the action has answered (no pending button) and the page has refreshed.
  const settle = async () => { await page.waitForTimeout(300); await page.waitForFunction(() => !document.querySelector('form button[disabled]'), null, { timeout: 90_000 }); await page.waitForLoadState('networkidle'); await page.waitForTimeout(500); };
  const submitIn = async (formSel, button) => { await page.locator(formSel).getByRole('button', { name: button }).click(); await settle(); };

  // Confirm & hold, look at a passport, issue.
  await go(page, ids.awaiting);
  await page.fill('input[name=pnr]', 'x7k2qd');
  await submitIn('form:has(input[name=pnr]):has-text("Confirm and hold")', 'Confirm and hold');
  await expectText(page, 'Held · issue tickets');
  await page.getByRole('button', { name: 'Show full number' }).first().click();
  await page.waitForTimeout(800);
  await expectText(page, 'A11493107');
  await shot(page, 'flow-order-held-passport');
  const tickets = page.locator('input[name=ticket]');
  for (let i = 0; i < await tickets.count(); i++) await tickets.nth(i).fill(`065123456789${i}`);
  page.once('dialog', (d) => d.accept());
  await submitIn('form:has(input[name=ticket])', 'Issue tickets and capture');
  await expectText(page, 'Confirmed by Bader at Mada');
  await shot(page, 'flow-order-issued');

  // Ask the traveller on the Tabby order.
  await go(page, ids.tabby);
  await page.getByText('Ask the traveller').first().click();
  await page.fill('textarea[name=question]', "Is the name on Maria's ticket MARIA SANTOS, as on her passport?");
  await submitIn('form:has(textarea[name=question])', 'Send the question');
  await expectText(page, 'Waiting on the traveller');
  await shot(page, 'flow-order-asked');

  // A quote on the visa request.
  await go(page, ids.visa);
  const amounts = page.locator('input[name=lineAmount]');
  for (let i = 0; i < await amounts.count(); i++) await amounts.nth(i).fill('320');
  await submitIn('form:has(input[name=lineAmount])', 'Send the quote');
  await expectText(page, 'Quote sent');
  await shot(page, 'flow-request-quoted');

  // Chat: a note for the team, then a reply as Bader.
  await go(page, ids.chat);
  await page.getByRole('button', { name: 'Note for the team' }).click();
  await page.fill('textarea[name=body]', 'Checked the mada statement: two charges on 8 Oct.');
  await submitIn('form:has(textarea[name=body])', 'Add note');
  await page.getByRole('button', { name: /Reply as/ }).click();
  await page.fill('textarea[name=body]', "You're right, it went through twice. I've started the refund for one of them.");
  await submitIn('form:has(textarea[name=body])', 'Send');
  await expectText(page, 'it went through twice');
  await shot(page, 'flow-chat-replied');

  // Refunds: approve one to credit, decline one.
  await go(page, '/adminwork/desk/refunds');
  const first = page.locator('form:has(input[name=destination])').first();
  await first.locator('text=Mada credit').click();
  await first.getByRole('button', { name: 'Approve refund' }).click();
  await settle();
  const decline = page.locator('form:has(textarea[name=reason])').first();
  await decline.locator('textarea[name=reason]').fill('This was a non-refundable rate, booked inside the free cancellation window.');
  await decline.getByRole('button', { name: 'Decline with reason' }).click();
  await settle();
  await go(page, '/adminwork/desk/refunds?s=sent');
  await shot(page, 'flow-refunds-sent');

  // Disruption plan for the cancelled flynas flight, with a voucher.
  await go(page, '/adminwork/desk/disruptions');
  const plan = page.locator('form:has(textarea[name=plan])').first();
  await plan.locator('textarea[name=plan]').fill("We've moved you to XY205 at 21:15. Same seats, and your pickup moves with you.");
  await plan.locator('input[name=optionLabel]').first().fill('Take XY205');
  await plan.locator('input[name=optionDetail]').first().fill('21:15, same seats');
  await plan.locator('input[name=voucher]').fill('150');
  await plan.getByRole('button', { name: /Send to/ }).click();
  await settle();
  await expectText(page, 'Sent by Bader');
  await shot(page, 'flow-disruption-plan');

  // Moderation: approve the good tip.
  await go(page, '/adminwork/desk/moderation');
  await page.locator('section', { hasText: 'Karaköy' }).getByRole('button', { name: 'Approve', exact: true }).click();
  await settle();
  await shot(page, 'flow-moderation');

  // Rota: Omar covers for Faisal tomorrow night.
  await go(page, '/adminwork/desk/team');
  const shift = page.locator('form:has(input[name=startsAt])');
  await shift.locator('select[name=agentId]').selectOption({ label: 'Omar' });
  await shift.locator('select[name=coveringForId]').selectOption({ label: 'Faisal' });
  const t0 = new Date(Date.now() + 3 * 3600_000 + 48 * 3600_000);
  const iso = (d) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 16);
  await shift.locator('input[name=startsAt]').fill(iso(t0));
  await shift.locator('input[name=endsAt]').fill(iso(new Date(t0.getTime() + 8 * 3600_000)));
  await shift.getByRole('button', { name: 'Add to the rota' }).click();
  await settle();
  await expectText(page, 'covering for Faisal');
  await shot(page, 'flow-rota');

  // The activity log has the desk's actions.
  await go(page, '/adminwork/activity');
  await expectText(page, 'Issued');
  await shot(page, 'flow-activity', false);
  await ctx.close();

  // An agent without desk.issue sees no issue form and no reveal.
  const agent = await session('desk1@madatrips.com', { width: 1440, height: 960 });
  await go(agent.page, ids.held);
  if (await agent.page.locator('input[name=ticket]').count()) problems.push('desk1 can see the issue form');
  if (await agent.page.getByRole('button', { name: 'Show full number' }).count()) problems.push('desk1 can reveal passports');
  await shot(agent.page, 'flow-agent-no-issue');
  await agent.ctx.close();
}

await browser.close();
console.log(`${n} screenshots in ${OUT}`);
if (problems.length) { console.error(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log('Desk e2e passed.');

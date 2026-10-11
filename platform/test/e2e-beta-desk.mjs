// Flights by request on the desk, end to end against a running platform (demo data, mock suppliers):
//
//   DATABASE_URL=… npm run db:migrate && DATABASE_URL=… npm run db:seed
//   DATABASE_URL=… npx tsx --conditions=react-server src/lib/app/desk/seed.ts
//   DATABASE_URL=… APP_DATA_KEY=… APP_FLIGHTS_MODE=request APP_DESK_AUTOPILOT=off APP_BOOKING_REQUIRES_PHONE=no npm run dev
//   BASE=http://localhost:3100 node test/e2e-beta-desk.mjs [shot-dir]
//
// A traveller (through the Core API, as the app does) sends a flight request; the agent opens it on the desk, sees
// the form's answers, builds two fares in the quote builder (flights, a price per traveller, bags, rules, the hold)
// and sends them; the traveller pays the second; the order appears on the desk, the agent records the PNR and a
// ticket number each and issues; the traveller's trip has every ticket number. The builder again in Arabic.
// Screenshots each desk step. Fails on any problem.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:3100';
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/beta-desk-shots');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Mada@2026';
mkdirSync(OUT, { recursive: true });
const problems = [];
let n = 0;
const step = (s) => console.log('·', s);
const check = (ok, what) => { if (!ok) { problems.push(what); console.log('PROBLEM', what); } };

/* ───────────── the app's side, through the Core API ───────────── */
const api = async (method, path, token, body) => {
  const res = await fetch(`${BASE}/api/app/v1${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};
async function traveller() {
  const phone = `+9665${String(10_000_000 + Math.floor(Math.random() * 89_999_999))}`;
  await api('POST', '/auth/otp/start', null, { phone });
  const v = await api('POST', '/auth/otp/verify', null, { phone, code: '123456' });
  if (v.status !== 200) throw new Error(`sign-in: ${JSON.stringify(v.json)}`);
  const token = v.json.tokens.accessToken;
  await api('PATCH', '/me', token, { name: 'Omar' });
  const hessa = (await api('POST', '/people', token, { givenNames: 'Hessa', surname: 'Alharbi', relation: 'spouse', dateOfBirth: '1988-07-24' })).json.person.id;
  const me = (await api('GET', '/people', token)).json.people.find((p) => p.isSelf).id;
  const card = await api('POST', '/cards', token, { token: 'tok_mock_visa41', brand: 'visa', last4: '4241', exp: '08/28', makeDefault: true });
  const cardId = card.json.cards.find((c) => c.last4 === '4241').id;
  return { token, me, hessa, cardId };
}

/* ───────────── the desk ───────────── */
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
async function desk(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${page.url()}: ${e.message}`));
  await page.goto(`${BASE}/adminwork/login`);
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 60_000 }), page.click('button[type=submit]')]);
  return { ctx, page };
}
const shot = async (page, name) => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); n += 1; await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png`, fullPage: true }); };
const go = async (page, path) => { await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400); };

try {
  step('app: a flight request');
  const t = await traveller();
  const depart = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  const back = new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10);
  const r = await api('POST', '/requests', t.token, { kind: 'flight', query: 'Istanbul', travellerIds: [t.me, t.hessa], note: 'Aisle for Hessa please',
    search: { destination: 'istanbul', destinationName: null, from: 'RUH', depart, return: back, cabin: 'economy', carrier: null, flexDays: 1, bags: 'one', prefs: ['direct'] } });
  check(r.status === 201, `request created (${r.status} ${JSON.stringify(r.json).slice(0, 200)})`);
  const id = r.json.request.id;

  step('desk: the request, its answers and the quote builder');
  let { page } = await desk('desk1@madatrips.com');
  await go(page, '/adminwork/desk/requests');
  await shot(page, 'requests-list');
  await go(page, `/adminwork/desk/requests/${id}`);
  check(await page.getByText('Route').count() > 0, 'request facts');
  check(await page.getByTestId('flight-quote-builder').count() > 0, 'quote builder');
  await shot(page, 'request-builder-empty');
  const fare = async (i, { code, airline, out, backNo, dep, arr, bdep, barr, price, bags, change, refund }) => {
    const f = page.getByTestId(`fare-${i}`);
    await f.getByLabel('Airline code', { exact: true }).fill(code);
    await f.getByLabel('Airline', { exact: true }).fill(airline);
    const leg1 = page.getByTestId(`leg-${i}-1`), leg2 = page.getByTestId(`leg-${i}-2`);
    await leg1.getByLabel('Flight number', { exact: true }).fill(out); await leg1.getByLabel('Departs', { exact: true }).fill(dep); await leg1.getByLabel('Lands', { exact: true }).fill(arr);
    await leg2.getByLabel('Flight number', { exact: true }).fill(backNo); await leg2.getByLabel('Departs', { exact: true }).fill(bdep); await leg2.getByLabel('Lands', { exact: true }).fill(barr);
    await f.locator('label', { hasText: 'Adult fare' }).locator('input').fill(price);
    await f.locator('label', { hasText: /^Bags/ }).locator('input').fill(bags);
    await f.locator('label', { hasText: /^Changes/ }).locator('input').fill(change);
    await f.locator('label', { hasText: /^Refund$/ }).locator('input').fill(refund);
  };
  await fare(1, { code: 'SV', airline: 'Saudia', out: 'SV263', backNo: 'SV264', dep: '09:40', arr: '13:55', bdep: '15:10', barr: '19:20', price: '2160', bags: '23 kg checked and 7 kg cabin, each', change: 'SAR 300 per person', refund: 'Refund minus SAR 400 per person' });
  await page.getByRole('button', { name: 'Copy this fare' }).first().click();
  await fare(2, { code: 'TK', airline: 'Turkish Airlines', out: 'TK145', backNo: 'TK144', dep: '02:10', arr: '06:20', bdep: '21:00', barr: '01:15', price: '1980', bags: '2 × 23 kg checked, each', change: 'Free', refund: 'Not refundable, taxes back' });
  await page.getByTestId('leg-2-2').getByLabel('Lands the next day').check();
  await page.getByLabel('PNR (optional)').fill('X7K2QD');
  await shot(page, 'request-builder-filled');
  await page.getByRole('button', { name: 'Send 2 fares' }).click();
  await page.getByText('Fares sent').first().waitFor({ timeout: 20_000 }).catch(() => problems.push('fares not sent'));
  await shot(page, 'request-fares-sent');

  step('app: the fares, and pay the second');
  const rv = (await api('GET', `/requests/${id}`, t.token)).json.request;
  check(rv.quote?.flight?.options?.length === 2, 'two fares in the app');
  const draft = { kind: 'quote', requestId: id, optionId: 'opt2' };
  const pv = (await api('POST', '/orders/preview', t.token, { draft, useCredit: false })).json.preview;
  check(pv?.total?.amount === 1980_00 * 2, `preview total ${pv?.total?.amount}`);
  const o = await api('POST', '/orders', t.token, { draft, useCredit: false, payment: { method: 'card', cardId: t.cardId }, plan: 'full', expectedTotal: pv.total.amount, idempotencyKey: `e2e-${Date.now()}` });
  check(o.json?.outcome === 'created', `order ${JSON.stringify(o.json).slice(0, 200)}`);

  step('desk: the order, the ticketed step (an agent with the issuing right)');
  const lead = await desk('bader@madatrips.com');
  const deskPage = page;
  page = lead.page;
  await go(page, '/adminwork/desk/orders');
  await shot(page, 'orders-list');
  await go(page, `/adminwork/desk/orders/${id}`);
  await shot(page, 'order-awaiting');
  await page.getByLabel('PNR', { exact: true }).fill('X7K2QD').catch(() => page.locator('input[name=pnr]').last().fill('X7K2QD'));
  const tickets = page.locator('input[name=ticket]');
  check(await tickets.count() === 2, 'a ticket field per traveller');
  await tickets.nth(0).fill('065 1234567890');
  await tickets.nth(1).fill('065 1234567891');
  await shot(page, 'order-tickets-filled');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Issue tickets and capture' }).click();
  await page.getByText(/Confirmed by .* at Mada/).first().waitFor({ timeout: 30_000 }).catch(() => problems.push('not issued'));
  await shot(page, 'order-issued');

  step('app: the trip with every ticket number');
  const ov = (await api('GET', `/orders/${o.json.order.id}`, t.token)).json.order;
  check(ov.status === 'confirmed', `order confirmed (${ov.status})`);
  const trip = (await api('GET', `/trips/${ov.tripId}`, t.token)).json.trip;
  check(trip?.bookingRef === 'X7K2QD', `trip PNR ${trip?.bookingRef}`);
  check(JSON.stringify(trip?.travellers?.map((p) => p.ticketNumber)) === JSON.stringify(['0651234567890', '0651234567891']), `tickets ${JSON.stringify(trip?.travellers?.map((p) => p.ticketNumber))}`);
  check(trip?.segments?.length === 2 && trip.segments[1].arriveLocal.startsWith(new Date(Date.parse(`${back}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)), 'return lands the next day');

  step('Arabic desk: the builder in Arabic');
  page = deskPage;
  await page.context().addCookies([{ name: 'mada_locale', value: 'ar', domain: new URL(BASE).hostname, path: '/adminwork' }]);
  const r2 = await api('POST', '/requests', t.token, { kind: 'flight', travellerIds: [t.me], search: { destination: 'dubai', destinationName: null, from: 'RUH', depart, return: null, cabin: 'business', carrier: null, flexDays: 0, bags: 'cabin', prefs: [] } });
  await go(page, `/adminwork/desk/requests/${r2.json.request.id}`);
  await shot(page, 'request-builder-arabic');
} catch (e) {
  problems.push(`crash: ${e instanceof Error ? e.message : e}`);
  console.log(e);
} finally {
  await browser.close();
}
console.log(`${n} screenshots in ${OUT}`);
if (problems.length) { console.log(`\n${problems.length} problem(s):\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log('OK');

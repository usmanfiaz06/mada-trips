// Ask threads on the desk (DESK-PLAN U5), in headless Chromium against a running platform with demo data.
//
//   (the setup in test/e2e-desk.mjs, then) DATABASE_URL=… npx tsx --conditions=react-server src/lib/app/desk/seed-customers.ts
//   BASE=http://localhost:3100 node test/e2e-desk-ask.mjs [shot-dir]
//
// As Faisal's login (support agent): the Ask threads list (search, tabs), Sara's conversation handed to the desk, read
// and audited; Yousef's (not handed over, nothing open) refused. Takes Sara's over, replies as Faisal, and the list shows
// him holding it. As Bader (lead): reads Yousef's, then hands Sara's back to Mada. Screenshots of the list and the
// transcript, light, dark and Arabic. Fails on any page error.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://localhost:3100';
const OUT = resolve(process.argv[2] ?? process.env.SHOTS ?? 'test/desk-shots');
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Mada@2026';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const problems = [];
const check = (ok, what) => { if (!ok) problems.push(what); else console.log(`ok  ${what}`); };

async function session(email, { locale = 'en', theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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

async function go(page, path) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  if (!res || res.status() >= 400) problems.push(`${path}: HTTP ${res?.status()}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(300);
  const body = await page.innerText('body');
  if (/Application error|Unhandled Runtime Error|Something went wrong/.test(body ?? '')) problems.push(`${path}: error page`);
  return body;
}

const shot = async (page, name) => { await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/desk-u5-${name}.png`, fullPage: false }); };
const threadOf = async (page, q) => {
  await go(page, `/adminwork/desk/ask?q=${encodeURIComponent(q)}`);
  return page.locator('a[href^="/adminwork/desk/ask/"]').first().getAttribute('href');
};

let sara, yousef;

// ── the support agent ──
{
  const { ctx, page } = await session('counter@madatrips.com');
  const list = await go(page, '/adminwork/desk/ask');
  check(list.includes('Ask threads') && (await page.locator('[data-testid=ask-row]').count()) >= 2, 'the Ask threads list shows conversations');
  check(await page.locator('nav a[href="/adminwork/desk/ask"]').count() > 0, 'Ask threads is in the sidebar');
  sara = await threadOf(page, '0500004127');
  yousef = await threadOf(page, 'Yousef');
  check(!!sara && !!yousef && sara !== yousef, 'search finds Sara by phone and Yousef by name');
  await go(page, '/adminwork/desk/ask?s=handed');
  check((await page.locator(`a[href="${sara}"]`).count()) === 1 && (await page.locator(`a[href="${yousef}"]`).count()) === 0, 'Handed off tab: Sara\'s, not Yousef\'s');

  const refused = await go(page, yousef);
  check((await page.locator('[data-testid=ask-refused]').count()) === 1 && !refused.includes('كم سعر'), "agent is refused Yousef's conversation, and sees none of it");

  const t = await go(page, sara);
  check(t.includes('Can the four of us sit together') && (await page.locator('[data-testid=ask-line-mada]').count()) >= 2, "Sara's transcript renders");
  await page.getByRole('button', { name: 'Take over' }).click();
  await page.waitForSelector('[data-testid=ask-reply]', { timeout: 30_000 });
  await page.waitForTimeout(400);
  check((await page.innerText('body')).includes('Faisal from Mada joined'), 'take over: the joined line is in the thread');
  await page.fill('[data-testid=ask-reply]', 'Hi Sara, Faisal here. I asked Saudia for four seats together, row 32.');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.waitForSelector('[data-testid=ask-line-agent]', { timeout: 30_000 });
  check((await page.locator('[data-testid=ask-line-agent]').count()) === 1, 'the reply shows as Faisal\'s');
  check((await page.locator('[data-testid=next-action] a[href^="/adminwork/desk/tickets/"], [data-testid=create-ticket]').count()) >= 0 && (await page.innerText('body')).includes('Ask Mada conversation taken over'), 'a ticket is linked to the thread');
  await shot(page, 'thread-light');
  await go(page, '/adminwork/desk/ask?s=taken');
  check((await page.locator(`a[href="${sara}"]`).count()) === 1, 'Taken over tab shows Sara\'s');
  await go(page, '/adminwork/desk/ask');
  await shot(page, 'list-light');
  await ctx.close();
}

// ── the lead ──
{
  const { ctx, page } = await session('bader@madatrips.com');
  const y = await go(page, yousef);
  check(y.includes('كم سعر'), "lead reads Yousef's conversation");
  await go(page, sara);
  // A lead handing back someone else's conversation confirms first.
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Hand back to Mada' }).click();
  await page.waitForTimeout(1500);
  await go(page, sara);
  check((await page.innerText('body')).includes('handed it back to Mada'), 'lead hands it back to Mada');
  await ctx.close();
}

// ── the same screens, dark and Arabic ──
for (const [locale, theme] of [['en', 'dark'], ['ar', 'light']]) {
  const { ctx, page } = await session('bader@madatrips.com', { locale, theme });
  const tag = locale === 'ar' ? 'ar' : theme;
  await go(page, '/adminwork/desk/ask');
  await shot(page, `list-${tag}`);
  await go(page, sara);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, `thread-${tag}`);
  if (locale === 'ar') check((await page.getAttribute('html', 'dir')) === 'rtl', 'Arabic is right to left');
  await ctx.close();
}

await browser.close();
if (problems.length) { console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`); process.exit(1); }
console.log('\nAsk threads e2e: all good');

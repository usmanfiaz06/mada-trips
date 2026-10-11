import "server-only";
import { createHash } from "node:crypto";
import { eq, or } from "drizzle-orm";
import {
  CITY_INFO, INVITE_CODE, PLANS, hasArabic, isLocale, joinNames, pickLocale, planById, t, tn,
  type CopyKey, type CoverKey, type InvitePreview, type Lang, type PersonRef, type Vars,
} from "@mada/shared";
import { db } from "@/db";
import { appPlaces } from "@/db/app-schema-places";
import { clientIp, ipHash } from "../http";
import { inLocale } from "../resilience/request";
import { previewOrNull } from "../circles/invites";
import { ANDROID_PACKAGE } from "./well-known";

/*
 * What an app link shows to someone without the app (madatrips.sa/join/<code>, /i/<code>, /plan/<id>, /trip/<id>,
 * /city/<id>): one fast page, no framework, no tracking. It mirrors the app's invite preview (prototype InvitePreview):
 * the cover, who invited you, who's in, what they'll see if you join; then "Open in Mada Trips", the store buttons
 * and, for an invite, the code to paste after installing ("Got an invite code?" in the app).
 *
 * Language: ?lang=ar|en, else Accept-Language. Arabic is right to left. Open Graph and Twitter cards make the link
 * preview well in WhatsApp and iMessage; the picture comes from /links/og/… (next/og).
 *
 * Env: APP_STORE_URL, PLAY_STORE_URL (the store pages; without them the buttons say "Not in the stores yet"),
 * APP_STORE_ID (optional, Safari's Smart App Banner). Files in ./assets: the circle covers the app ships, Instrument
 * Serif and IBM Plex Sans Arabic (both SIL OFL 1.1), Mada's symbol and wordmark.
 */

export type Stores = { ios: string | null; android: string | null; iosId: string | null };

const httpsUrl = (v: string | undefined) => {
  const s = (v ?? "").trim();
  try { return s && new URL(s).protocol === "https:" ? s : null; } catch { return null; }
};
export function stores(env: NodeJS.ProcessEnv = process.env): Stores {
  const id = (env.APP_STORE_ID ?? "").trim();
  return { ios: httpsUrl(env.APP_STORE_URL), android: httpsUrl(env.PLAY_STORE_URL), iosId: /^\d{6,12}$/.test(id) ? id : null };
}
/** The Play Store link carries the invite, so the app can pick it up after installing (Install Referrer). */
export function playWithReferrer(url: string, code: string | null): string {
  if (!code) return url;
  const u = new URL(url);
  u.searchParams.set("referrer", `invite=${code}`);
  return u.toString();
}

export function localeFor(req: Request): Lang {
  const q = new URL(req.url).searchParams.get("lang");
  if (isLocale(q)) return q;
  return pickLocale(req.headers.get("accept-language"));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const tt = (key: CopyKey, vars?: Vars) => esc(t(key, vars));

/* ───────────── the page ───────────── */

// Static, so the Content-Security-Policy can allow it by hash. Words come in data- attributes.
const SCRIPT = `(()=>{const d=document,b=d.body,ua=navigator.userAgent,o=d.getElementById('open');
if(o&&/Android/i.test(ua)){o.href='intent://'+b.dataset.path+'#Intent;scheme=madatrips;package='+b.dataset.pkg+';S.browser_fallback_url='+encodeURIComponent(b.dataset.fallback||location.href)+';end'}
if(o)o.addEventListener('click',()=>{setTimeout(()=>{if(d.hidden)return;const s=d.getElementById('stores');if(s){s.scrollIntoView({behavior:'smooth',block:'center'});s.classList.add('pulse')}},1600)});
const c=d.getElementById('copy'),k=d.getElementById('code');
if(c&&k)c.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(k.textContent.trim());toast(b.dataset.copied)}catch(e){const r=d.createRange();r.selectNodeContents(k);const s=getSelection();s.removeAllRanges();s.addRange(r);toast(b.dataset.refused)}});
function toast(m){const t=d.getElementById('toast');t.textContent=m;t.classList.add('on');clearTimeout(t.h);t.h=setTimeout(()=>t.classList.remove('on'),2800)}})();`;
const SCRIPT_HASH = `'sha256-${createHash("sha256").update(SCRIPT).digest("base64")}'`;

const CSS = `
@font-face{font-family:'Instrument Serif';src:url(/links/font/instrument-serif.ttf) format('truetype');font-display:swap}
@font-face{font-family:'Plex Arabic';font-weight:400;font-display:swap;src:url(/links/font/plex-arabic-400.woff2) format('woff2');unicode-range:U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF,U+200C-200F}
@font-face{font-family:'Plex Arabic';font-weight:600;font-display:swap;src:url(/links/font/plex-arabic-600.woff2) format('woff2');unicode-range:U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF,U+200C-200F}
:root{--night:#0f1a16;--green:#1e352d;--sand:#e9e2d8;--paper:#fffdf9;--mist:#f6f2ec;--gold:#d9b77a;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--night);color:var(--paper)}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Plex Arabic',sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
[dir=rtl] body{font-family:'Plex Arabic',system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif}
.screen{position:relative;min-height:100vh;min-height:100svh;display:flex;flex-direction:column;max-width:480px;margin:0 auto;overflow:hidden;background:var(--night)}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;animation:drift 18s ease-in-out infinite}
@keyframes drift{0%,100%{transform:scale(1.04)}50%{transform:scale(1.1) translate(-1%,-1%)}}
@media (prefers-reduced-motion:reduce){.bg{animation:none}}
.plain{position:absolute;inset:0;background:radial-gradient(120% 70% at 50% 18%,#2a4a40 0%,#1e352d 45%,#0f1a16 100%)}
.veil{position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,26,22,.55) 0%,rgba(15,26,22,.05) 24%,rgba(15,26,22,.2) 42%,rgba(15,26,22,.92) 66%,#0f1a16 100%)}
.top{position:relative;display:flex;align-items:center;justify-content:center;padding:calc(22px + env(safe-area-inset-top)) 24px 0}
.top img{height:26px;width:auto}
.main{position:relative;margin-top:auto;padding:120px 24px calc(24px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:12px}
.stack{display:flex}
.av{width:40px;height:40px;border-radius:999px;display:grid;place-items:center;font-weight:600;font-size:15px;border:2px solid var(--night);margin-inline-start:-10px;background:var(--mist);color:var(--green)}
.av:first-child{margin-inline-start:0}
.av.green{background:var(--green);color:var(--sand)}.av.gold{background:var(--gold);color:var(--green)}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);margin:0}
[dir=rtl] .eyebrow{letter-spacing:0;font-size:14px;text-transform:none}
h1{font-family:'Instrument Serif','Plex Arabic',Georgia,serif;font-weight:400;font-size:46px;line-height:1;letter-spacing:-.01em;margin:0;text-wrap:balance;overflow-wrap:anywhere}
h1.ar{font-weight:600;font-size:38px;line-height:1.2;letter-spacing:0}
h1.long{font-size:36px}
.sub{font-size:14px;line-height:1.45;color:rgba(255,253,249,.85);margin:0}
.panel{background:rgba(255,253,249,.08);border:1px solid rgba(255,253,249,.12);border-radius:24px;padding:16px;display:grid;gap:6px;font-size:13px;line-height:1.45;color:rgba(255,253,249,.8);margin:0}
.panel b{color:var(--paper);font-weight:600}
.panel ol{margin:0;padding:0;list-style:none;display:grid;gap:6px}
.btn{min-height:56px;border-radius:999px;display:flex;align-items:center;justify-content:center;gap:8px;font-size:17px;font-weight:600;text-decoration:none;border:0;width:100%;cursor:pointer;font-family:inherit;padding:0 22px;text-align:center}
.btn.gold{background:var(--gold);color:var(--green)}
.btn:active{transform:scale(.98)}
.stores{display:grid;grid-template-columns:1fr 1fr;gap:10px;border-radius:20px;transition:box-shadow .4s}
.stores.pulse{box-shadow:0 0 0 3px rgba(217,183,122,.55)}
.store{min-height:52px;border-radius:16px;border:1px solid rgba(255,253,249,.24);display:flex;align-items:center;justify-content:center;gap:8px;color:var(--paper);text-decoration:none;font-size:13px;font-weight:600;background:rgba(15,26,22,.4);padding:6px 10px;text-align:center;line-height:1.25}
.store svg{flex:none}
.store.off{opacity:.55}
.note{font-size:12px;line-height:1.4;color:rgba(255,253,249,.65);text-align:center;margin:0}
.code{display:grid;gap:10px;padding:14px 16px;border-radius:20px;background:rgba(15,26,22,.6);border:1px dashed rgba(217,183,122,.5)}
.code p{margin:0;font-size:13px;line-height:1.45;color:rgba(255,253,249,.82)}
.code p b{color:var(--paper)}
.code .row{display:flex;gap:10px;align-items:center;justify-content:space-between}
.code code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px;letter-spacing:.02em;white-space:nowrap;color:var(--gold);direction:ltr;unicode-bidi:isolate;user-select:all;-webkit-user-select:all}
.copy{min-height:40px;padding:0 16px;border-radius:999px;border:0;background:var(--paper);color:var(--green);font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;flex:none}
.desk{display:none;font-size:13px;color:rgba(255,253,249,.7);text-align:center;margin:0}
.toast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom));transform:translate(-50%,16px);opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;background:var(--paper);color:var(--green);padding:12px 18px;border-radius:999px;font-size:14px;font-weight:600;box-shadow:0 12px 30px rgba(0,0,0,.35);max-width:calc(100% - 32px);text-align:center}
.toast.on{opacity:1;transform:translate(-50%,0)}
a:focus-visible,button:focus-visible{outline:2px solid var(--gold);outline-offset:3px}
@media (min-width:720px){body{display:grid;place-items:center;padding:32px 16px;background:radial-gradient(80% 80% at 50% 30%,#1e352d,#0b1310)}.screen{min-height:min(880px,calc(100vh - 64px));border-radius:36px;box-shadow:0 40px 80px -30px rgba(0,0,0,.7);width:420px}.desk{display:block}}
`;

type Shell = {
  locale: Lang; title: string; desc: string; url: string; image: string | null; imageAlt: string; status?: number; index?: boolean;
  /** Path the app opens (join/abc…), for the madatrips:// and Android intent links. */
  appPath: string; stores: Stores; code: string | null; cover: CoverKey | null; body: string;
};

function storeButtons(s: Stores, code: string | null): string {
  const apple = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM13.9 5c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z"/></svg>`;
  const play = `<svg width="16" height="18" viewBox="0 0 20 22" aria-hidden="true"><path fill="currentColor" d="M1 1.2 12.1 11 1 20.8c-.3-.2-.5-.6-.5-1V2.2c0-.4.2-.8.5-1zm12.6 11.1 2.6 2.3-12 6.8 9.4-9.1zm0-2.6L4.2.6l12 6.8-2.6 2.3zm4.1-1.3 2.7 1.5c.8.5.8 1.7 0 2.2l-2.7 1.5-2.9-2.6 2.9-2.6z"/></svg>`;
  const btn = (href: string | null, icon: string, label: string, id: string) => href
    ? `<a class="store" id="${id}" href="${esc(href)}" rel="noopener">${icon}<span>${label}</span></a>`
    : `<span class="store off" id="${id}" aria-disabled="true">${icon}<span>${label}</span></span>`;
  const none = !s.ios && !s.android;
  return `<div class="stores" id="stores">${btn(s.ios, apple, tt("links.appStore"), "store-ios")}${btn(s.android ? playWithReferrer(s.android, code) : null, play, tt("links.googlePlay"), "store-android")}</div>`
    + (none ? `<p class="note" id="not-yet"><b>${tt("links.notYet")}.</b> ${tt("links.notYetBody")}</p>` : "");
}

export function faces(people: PersonRef[]): string {
  return `<div class="stack" aria-hidden="true">${people.slice(0, 4).map((p) => `<span class="av ${p.tone === "default" ? "" : p.tone}">${esc(p.initial)}</span>`).join("")}</div>`;
}

function page(s: Shell): Response {
  const rtl = s.locale === "ar";
  const meta = [
    `<meta name="description" content="${esc(s.desc)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${rtl ? "مادا للرحلات" : "Mada Trips"}">`,
    `<meta property="og:title" content="${esc(s.title)}">`,
    `<meta property="og:description" content="${esc(s.desc)}">`,
    `<meta property="og:url" content="${esc(s.url)}">`,
    `<meta property="og:locale" content="${rtl ? "ar_SA" : "en_US"}">`,
    ...(s.image ? [
      `<meta property="og:image" content="${esc(s.image)}">`, `<meta property="og:image:type" content="image/png">`,
      `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`,
      `<meta property="og:image:alt" content="${esc(s.imageAlt)}">`,
    ] : []),
    `<meta name="twitter:card" content="${s.image ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${esc(s.title)}">`,
    `<meta name="twitter:description" content="${esc(s.desc)}">`,
    ...(s.image ? [`<meta name="twitter:image" content="${esc(s.image)}">`] : []),
    ...(s.stores.iosId ? [`<meta name="apple-itunes-app" content="app-id=${s.stores.iosId}, app-argument=${esc(s.url)}">`] : []),
    `<meta name="robots" content="${s.index ? "index, follow" : "noindex, nofollow"}">`,
    `<meta name="theme-color" content="#0f1a16">`,
    `<meta name="format-detection" content="telephone=no">`,
  ];
  const fallback = s.stores.android ? playWithReferrer(s.stores.android, s.code) : "";
  const html = `<!doctype html>
<html lang="${s.locale}" dir="${rtl ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(s.title)}</title>
${meta.join("\n")}
<link rel="icon" href="/assets/brand/favicon.svg" type="image/svg+xml">
<link rel="canonical" href="${esc(s.url)}">
<link rel="preload" href="/links/font/${rtl ? "plex-arabic-600.woff2" : "instrument-serif.ttf"}" as="font" crossorigin>
${s.cover ? `<link rel="preload" href="/links/cover/${s.cover}.jpg" as="image">` : ""}
<style>${CSS}</style>
</head>
<body data-path="${esc(s.appPath)}" data-pkg="${ANDROID_PACKAGE}" data-fallback="${esc(fallback)}" data-copied="${tt("links.codeCopied")}" data-refused="${tt("links.copyRefused")}">
<main class="screen">
${s.cover ? `<img class="bg" src="/links/cover/${s.cover}.jpg" alt="" fetchpriority="high">` : `<div class="plain"></div>`}
<div class="veil"></div>
<header class="top"><img src="/links/brand/wordmark-sand.svg" alt="${rtl ? "مادا للرحلات" : "Mada Trips"}" width="58" height="26"></header>
<section class="main">
${s.body}
<a class="btn gold" id="open" href="madatrips://${esc(s.appPath)}">${tt("links.open")}</a>
${storeButtons(s.stores, s.code)}
${s.code ? `<div class="code" id="code-box"><p><b>${tt("links.newHere")}</b> ${tt("links.codeHint")}</p><div class="row"><code id="code">${esc(s.code)}</code><button class="copy" id="copy" type="button">${tt("links.copyCode")}</button></div></div>` : ""}
<p class="desk">${tt("links.desktop")}</p>
</section>
</main>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>${SCRIPT}</script>
</body>
</html>`;
  return new Response(html, {
    status: s.status ?? 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Shared caches keep it a minute: a link turned off stops showing within that.
      "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      Vary: "Accept-Language",
      "Content-Language": s.locale,
      "Content-Security-Policy": `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self'; script-src ${SCRIPT_HASH}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

const originOf = (req: Request) => new URL(req.url).origin;
const titleClass = (s: string) => [hasArabic(s) ? "ar" : "", s.length > 22 ? "long" : ""].filter(Boolean).join(" ");

/* ───────────── /join/<code> and /i/<code> ───────────── */

export async function joinPage(req: Request, rawCode: string): Promise<Response> {
  const locale = localeFor(req);
  return inLocale(locale, async () => {
    const code = decodeURIComponent(rawCode).trim().toLowerCase();
    const st = stores();
    const origin = originOf(req);
    const p = INVITE_CODE.test(code) ? await previewOrNull(code, null, ipHash(clientIp(req)), { web: true }) : null;
    const url = `${origin}/join/${encodeURIComponent(p ? p.code : code)}`;
    if (!p) {
      return page({
        locale, status: 404, title: t("circles.join.notFound"), desc: t("links.gone.body"), url, image: null, imageAlt: "", appPath: "circles", stores: st, code: null, cover: null,
        body: `<h1>${tt("circles.join.notFound")}</h1><p class="sub">${tt("links.gone.body")}</p>`,
      });
    }
    return page(joinShell(p, locale, origin, url, st));
  });
}

function joinShell(p: InvitePreview, locale: Lang, origin: string, url: string, st: Stores): Shell {
  const from = p.from.short;
  const image = `${origin}/links/og/join/${p.code}?lang=${locale}`;
  if (p.status !== "open") {
    const [title, body] = p.status === "cancelled" ? ["circles.join.cancelledTitle", "circles.join.cancelledBody"] as const
      : p.status === "full" ? ["circles.join.fullTitle", "circles.join.fullBody"] as const : ["circles.join.expiredTitle", "circles.join.expiredBody"] as const;
    return {
      locale, title: t(title), desc: t(body, { name: from }), url, image: null, imageAlt: "", appPath: "circles", stores: st, code: null, cover: null,
      body: `<p class="eyebrow">${tt("circles.join.invitedYou", { name: from })}</p><h1>${tt(title)}</h1><p class="sub">${tt(body, { name: from })}</p>`,
    };
  }
  if (!p.circle) {
    const title = t("links.mada.ogTitle", { name: from });
    return {
      locale, title, desc: t("circles.join.madaBody"), url, image, imageAlt: title, appPath: `join/${p.code}`, stores: st, code: p.code, cover: null,
      body: `${faces([p.from])}<p class="eyebrow">${tt("circles.join.invitedYou", { name: from })}</p><h1 class="${titleClass(t("circles.join.madaTitle", { name: from }))}">${tt("circles.join.madaTitle", { name: from })}</h1><p class="sub">${tt("circles.join.madaBody")}</p>`,
    };
  }
  const c = p.circle;
  const names = c.members.map((m) => m.short);
  const inLine = c.memberCount > names.length || names.length === 0
    ? tn("circles.join.peopleIn", c.memberCount, { count: c.memberCount })
    : names.length === 1 ? t("circles.join.isIn", { names: names[0]! }) : t("circles.join.areIn", { names: joinNames(names) });
  const title = t("links.join.ogTitle", { name: from, circle: c.name });
  return {
    locale, title, desc: t("links.join.ogDesc"), url, image, imageAlt: title, appPath: `join/${p.code}`, stores: st, code: p.code, cover: c.cover,
    body: `${faces(c.members)}
<p class="eyebrow">${tt("circles.join.invitedYou", { name: from })}</p>
<h1 class="${titleClass(c.name)}">${esc(c.name)}</h1>
<p class="sub">${esc([c.trip, inLine].filter(Boolean).join(" · "))}</p>
<div class="panel"><b>${tt("circles.join.theySee")}</b><span>${tt("circles.join.theySeeBody")}</span></div>`,
  };
}

/* ───────────── /plan/<id> ───────────── */

export function planPage(req: Request, rawId: string): Response {
  const locale = localeFor(req);
  return inLocale(locale, () => {
    const id = decodeURIComponent(rawId);
    const sum = planById(id);
    const full = PLANS[id];
    const st = stores();
    const origin = originOf(req);
    const url = `${origin}/plan/${encodeURIComponent(id)}`;
    if (!sum || !full) return genericPage(req, locale, { title: t("links.trip.title"), body: t("links.trip.body"), appPath: `plan/${encodeURIComponent(id)}`, status: 404, cover: null });
    const days = tn("links.plan.days", sum.days, { count: sum.days });
    const lines = full.plan.map((d) => `<li>${tt("links.plan.dayLine", { day: d.day, stops: d.stops.filter((x) => x.icon === "star" || x.icon === "food").map((x) => x.title).slice(0, 3).join(", ") })}</li>`).join("");
    return page({
      locale, title: sum.title, desc: t("links.plan.ogDesc", { sub: sum.sub }), url, image: `${origin}/links/og/plan/${encodeURIComponent(id)}?lang=${locale}`, imageAlt: sum.title, index: true,
      appPath: `plan/${encodeURIComponent(id)}`, stores: st, code: null, cover: sum.photoKey,
      body: `<p class="eyebrow">${tt("links.plan.eyebrow")}</p><h1 class="${titleClass(sum.title)}">${esc(sum.title)}</h1><p class="sub">${esc(`${sum.sub} · ${sum.city} · ${days}`)}</p><div class="panel"><ol>${lines}</ol></div>`,
    });
  });
}

/* ───────────── /trip/<id> and /city/<id> ───────────── */

export function tripPage(req: Request, rawId: string): Response {
  const locale = localeFor(req);
  // A trip is private: the page never says whose or where. The app shows it to people who may see it.
  return inLocale(locale, () => genericPage(req, locale, { title: t("links.trip.title"), body: t("links.trip.body"), appPath: `trip/${encodeURIComponent(decodeURIComponent(rawId))}`, cover: null }));
}

export async function cityPage(req: Request, rawId: string): Promise<Response> {
  const locale = localeFor(req);
  return inLocale(locale, async () => {
    const id = decodeURIComponent(rawId).slice(0, 80);
    const city = await cityName(id, locale);
    const known = Object.keys(CITY_INFO).find((k) => k.toLowerCase() === city.en.toLowerCase());
    return genericPage(req, locale, {
      title: t("links.city.title", { city: city.label }), body: t("links.city.body"), appPath: `city/${encodeURIComponent(id)}`,
      cover: known ? CITY_INFO[known]!.photoKey : null, index: true,
    });
  });
}

async function cityName(id: string, locale: Lang): Promise<{ en: string; label: string }> {
  const pretty = id.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  try {
    const [row] = await db.select({ name: appPlaces.name, nameAr: appPlaces.nameAr }).from(appPlaces)
      .where(/^\d{1,10}$/.test(id) ? eq(appPlaces.id, Number(id)) : or(eq(appPlaces.slug, id.toLowerCase()), eq(appPlaces.name, pretty))).limit(1);
    if (row) return { en: row.name, label: locale === "ar" && row.nameAr ? row.nameAr : row.name };
  } catch { /* the places table may be empty or absent: use the link's own words */ }
  return /^\d+$/.test(id) ? { en: "", label: locale === "ar" ? "مدينة" : "A city" } : { en: pretty, label: pretty };
}

function genericPage(req: Request, locale: Lang, o: { title: string; body: string; appPath: string; status?: number; cover: CoverKey | null; index?: boolean }): Response {
  const origin = originOf(req);
  const url = origin + new URL(req.url).pathname;
  return page({
    locale, status: o.status, title: o.title, desc: o.body, url, image: null, imageAlt: "", appPath: o.appPath, stores: stores(), code: null, cover: o.cover, index: o.index,
    body: `<h1 class="${titleClass(o.title)}">${esc(o.title)}</h1><p class="sub">${esc(o.body)}</p>`,
  });
}

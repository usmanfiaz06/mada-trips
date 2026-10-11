#!/usr/bin/env node
/*
 * Builds the app's legal and help pages for madatrips.sa from content-en.mjs and content-ar.mjs:
 *   /privacy, /terms, /support, /delete-account   and   /ar/privacy, /ar/terms, /ar/support, /ar/delete-account
 * The header, menu and footer come from the site's own contact page (contact.html, ar/contact.html), so the pages
 * look like the rest of the site; only <head> facts, the language switch and <main> are replaced. The App Store,
 * Google Play (Data safety, account deletion) and the app's Help › About link to these URLs.
 *
 *   node tools/legal/build.mjs          write the eight .html files at the repo root and in ar/
 *   node tools/legal/build.mjs --check  exit 1 if a committed page differs from what this would write
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { en, UPDATED as UPDATED_EN } from './content-en.mjs';
import { ar, UPDATED as UPDATED_AR } from './content-ar.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ORIGIN = 'https://www.madatrips.sa';
const PAGES = ['privacy', 'terms', 'support', 'delete-account'];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function page(c, updated, slug) {
  const p = c.pages[slug];
  const isAr = c.lang === 'ar';
  const here = `${isAr ? '/ar' : ''}/${slug}`;
  const other = `${isAr ? '' : '/ar'}/${slug}`;
  let html = readFileSync(join(root, isAr ? 'ar/contact.html' : 'contact.html'), 'utf8');
  const title = `${p.title} | ${isAr ? 'مادا' : 'Mada Trips'}`;

  // <head>: title, description, canonical and alternates, Open Graph, robots, and the legal stylesheet.
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(/(<meta[^>]*name="description"[^>]*>|<meta content="[^"]*" name="description"\/>)/, `<meta name="description" content="${esc(p.description)}" />`);
  html = html.replace(/<link[^>]*rel="canonical"[^>]*>/, `<link rel="canonical" href="${ORIGIN}${here}" />`);
  html = html.replace(/<link[^>]*hreflang="en"[^>]*rel="alternate"[^>]*>|<link rel="alternate" hreflang="en"[^>]*>/, `<link rel="alternate" hreflang="en" href="${ORIGIN}/${slug}" />`);
  html = html.replace(/<link[^>]*hreflang="ar"[^>]*rel="alternate"[^>]*>|<link rel="alternate" hreflang="ar"[^>]*>/, `<link rel="alternate" hreflang="ar" href="${ORIGIN}/ar/${slug}" />`);
  html = html.replace(/<link[^>]*hreflang="x-default"[^>]*rel="alternate"[^>]*>|<link rel="alternate" hreflang="x-default"[^>]*>/, `<link rel="alternate" hreflang="x-default" href="${ORIGIN}/${slug}" />`);
  html = html.replace(/(<meta[^>]*property="og:url"[^>]*>|<meta content="[^"]*" property="og:url"\/>)/g, `<meta property="og:url" content="${ORIGIN}${here}" />`);
  html = html.replace(/(<meta[^>]*property="og:title"[^>]*>|<meta content="[^"]*" property="og:title"\/>)/g, `<meta property="og:title" content="${esc(title)}" />`);
  html = html.replace(/(<meta[^>]*name="twitter:title"[^>]*>|<meta content="[^"]*" name="twitter:title"\/>)/g, `<meta name="twitter:title" content="${esc(title)}" />`);
  for (const k of ['og:description', 'twitter:description']) {
    const attr = k.startsWith('og') ? 'property' : 'name';
    html = html.replace(new RegExp(`(<meta[^>]*${attr}="${k}"[^>]*>|<meta content="[^"]*" ${attr}="${k}"/>)`, 'g'), `<meta ${attr}="${k}" content="${esc(p.description)}" />`);
  }
  html = html.replace(/(<link[^>]*href="\/css\/style\.css"[^>]*>)/, `$1\n  <link rel="stylesheet" href="/css/legal.css" />`);

  // The language switch points at the same page in the other language.
  html = html.replace(/(<a[^>]*class="(?:nav__lang|menu__lang|footer__lang)"[^>]*href=")[^"]*(")/g, `$1${other}$2`);
  html = html.replace(/(<a[^>]*href=")[^"]*("[^>]*class="(?:nav__lang|menu__lang|footer__lang)")/g, `$1${other}$2`);

  const toc = p.sections.map(([id, h]) => `<li><a href="#${id}">${h}</a></li>`).join('');
  const body = p.sections.map(([id, h, inner]) => `\n      <section class="legal__section" id="${id}">\n        <h2>${h}</h2>${inner.trimEnd().replace(/\n/g, '\n        ')}\n      </section>`).join('');
  const main = `<main>
    <section class="legal" data-nav="dark">
      <div class="container legal__wrap">
        <p class="legal__draft" role="note"><b>${c.lang === 'ar' ? 'مسودة' : 'DRAFT'}</b> ${c.draft}</p>
        <p class="eyebrow">${c.eyebrow}</p>
        <h1 class="legal__title">${p.title}</h1>
        <p class="legal__lead">${p.lead}</p>
        <p class="legal__meta">${c.updatedLabel}: ${updated}</p>
        <nav class="legal__toc" aria-label="${c.contents}"><p>${c.contents}</p><ol>${toc}</ol></nav>${body}
      </div>
    </section>
  </main>`;
  html = html.replace(/<main>[\s\S]*<\/main>/, main);
  // The note goes after the doctype: anything before it would put the browser in quirks mode.
  return html.replace(/^(<!doctype html>|<!DOCTYPE html>)\s*/i, `$1\n<!-- Built by tools/legal/build.mjs from tools/legal/content-${c.lang}.mjs. Edit those, then run it. -->\n`);
}

const check = process.argv.includes('--check');
let stale = 0;
for (const [c, updated] of [[en, UPDATED_EN], [ar, UPDATED_AR]]) {
  for (const slug of PAGES) {
    const file = join(root, c.lang === 'ar' ? 'ar' : '', `${slug}.html`);
    const html = page(c, updated, slug);
    if (check) {
      let old = '';
      try { old = readFileSync(file, 'utf8'); } catch { /* missing */ }
      if (old !== html) { console.error(`stale: ${file}`); stale++; }
    } else {
      writeFileSync(file, html);
      console.log(`wrote ${file.slice(root.length + 1)}`);
    }
  }
}
if (stale) process.exit(1);

#!/usr/bin/env node
/*
 * npm run store:listing — checks docs/app/store/listing.json against the stores' limits and COPY.md, then writes
 * docs/app/store/LISTING.md: every field, in English and Arabic, ready to paste into App Store Connect and Play Console.
 * Exit code 1 when a field is too long or breaks a copy rule.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'app', 'store');
const listing = JSON.parse(readFileSync(join(dir, 'listing.json'), 'utf8'));

// [field, store and label, limit] — App Store Connect and Play Console limits (characters).
const FIELDS = [
  ['name', 'App Store name · Play title', 30],
  ['subtitle', 'App Store subtitle', 30],
  ['promotionalText', 'App Store promotional text', 170],
  ['playShortDescription', 'Play short description', 80],
  ['keywords', 'App Store keywords (comma-separated, no spaces after commas)', 100],
  ['description', 'App Store description · Play full description', 4000],
  ['whatsNew', 'What’s new (1.0)', 4000],
];
const CAPTION_MAX = 48;
// COPY.md §3.2: words that sound like AI or a system, and the punctuation the copy lint refuses.
const BANNED = /\b(AI|smart|intelligent|magic|assistant|bot|seamless|effortless|curated|tailored|elevate|unlock|delve|embark|error|invalid|submit|successfully|user)\b|!|—/i;

const problems = [];
const len = (s) => [...s].length;
for (const [lang, l] of Object.entries(listing.locales)) {
  for (const [key, label, max] of FIELDS) {
    const v = l[key];
    if (typeof v !== 'string' || !v.trim()) { problems.push(`${lang}.${key} (${label}) is empty`); continue; }
    if (len(v) > max) problems.push(`${lang}.${key} (${label}) is ${len(v)} characters; the limit is ${max}`);
    const m = BANNED.exec(v);
    if (m) problems.push(`${lang}.${key} uses "${m[0]}" (COPY.md §3.2)`);
  }
  if (/,\s/.test(l.keywords)) problems.push(`${lang}.keywords: no spaces after commas (they count against the 100)`);
  const words = l.keywords.split(',');
  if (new Set(words).size !== words.length) problems.push(`${lang}.keywords repeats a word`);
  for (const s of l.screenshots) {
    if (len(s.caption) > CAPTION_MAX) problems.push(`${lang} caption "${s.id}" is ${len(s.caption)} characters; keep it under ${CAPTION_MAX}`);
    const m = BANNED.exec(s.caption);
    if (m) problems.push(`${lang} caption "${s.id}" uses "${m[0]}"`);
  }
}
const ids = Object.values(listing.locales).map((l) => l.screenshots.map((s) => s.id).join());
if (new Set(ids).size !== 1) problems.push('the screenshot ids must be the same, in the same order, in every language');

const block = (s) => '```\n' + s + '\n```';
const md = [`# Store listing

**Generated** from [listing.json](listing.json) by \`npm run store:listing\`, which also checks every length and COPY.md's word rules. Edit the JSON, not this file. The Arabic is a first draft for the native writer.

| | |
|---|---|
| Category | App Store: ${listing.category.appStore.primary} (secondary ${listing.category.appStore.secondary}). Play: ${listing.category.play} |
| Marketing URL | ${listing.urls.marketing} |
| Support URL | ${listing.urls.support} |
| Privacy policy URL | ${listing.urls.privacy} |
| Account deletion URL (Play) | ${listing.urls.deleteAccount} |
| Contact email | ${listing.contactEmail} |
| Copyright | ${listing.copyright} |

Answers for age rating, App Privacy, Data safety, export compliance and review are in [REVIEW.md](REVIEW.md) and [PRIVACY-LABELS.md](PRIVACY-LABELS.md).
`];
for (const [lang, l] of Object.entries(listing.locales)) {
  md.push(`\n## ${lang === 'en' ? 'English' : 'Arabic'} (App Store ${l.appStoreLocale}, Play ${l.playLocale})\n`);
  for (const [key, label, max] of FIELDS) md.push(`### ${label} · ${len(l[key])}/${max}\n\n${block(l[key])}\n`);
  md.push(`### Screenshot captions\n\n| # | Screen | Caption |\n|---|---|---|\n${l.screenshots.map((s, i) => `| ${i + 1} | ${s.id} | ${s.caption} |`).join('\n')}\n`);
}
writeFileSync(join(dir, 'LISTING.md'), md.join('\n'));

if (problems.length) {
  console.log(`Store listing problems:\n${problems.map((p) => `  ✖ ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Store listing OK (${Object.keys(listing.locales).join(', ')}); wrote docs/app/store/LISTING.md`);

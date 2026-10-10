/*
 * English / العربية for the prototype (COPY.md §7.4).
 *
 * The production app reads every word from the shared catalogue (packages/shared/src/copy). The prototype's screens
 * hold their words inline, mostly the catalogue's English verbatim, so Arabic here works the other way round: a
 * translator watches the page and swaps each English line for the catalogue's Arabic (exact lines first, then
 * catalogue templates with their {placeholders}, then the prototype's own lines below). The page turns right to left
 * with dir="rtl"; Arabic fonts and a few mirrored layouts come from css/rtl.css.
 *
 * Nothing here changes what the screens do: switching back to English puts every original line back.
 */
import { en, ar, nameIn } from '../../../../packages/shared/src/copy/index.ts';
import { LRI, PDI, isLatinRun, pluralKeys } from '../../../../packages/shared/src/locale.ts';
import { PROTO_AR } from './i18n-proto.js';

const KEY = 'mada.proto.lang';
const norm = (s) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/* ---------- the dictionary: English line → Arabic line ---------- */

const exact = new Map();
const templates = [];
function add(english, arabic, key = null) {
  if (!english || !arabic || english === arabic) return;
  const e = norm(english);
  if (/\{\w+\}/.test(e)) {
    const names = [];
    const literal = e.replace(/\{\w+\}/g, '').replace(/[\s·.,:;!?()–-]/g, '');
    const gaps = (e.match(/\{\w+\}/g) || []).length;
    if (literal.length < 4 || !gaps) return;
    const src = e.split(/(\{\w+\})/).map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (m) { names.push(m[1]); return '(.+?)'; }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('');
    templates.push({ re: new RegExp(`^${src}$`), names, arabic, key, weight: literal.length });
  } else if (!exact.has(e)) exact.set(e, arabic);
}
for (const [k, v] of Object.entries(en)) add(v, ar[k], k);
for (const [e, a] of Object.entries(PROTO_AR)) { exact.delete(norm(e)); add(e, a); }
templates.sort((a, b) => b.weight - a.weight);

const fillVar = (v) => {
  const named = nameIn(v, 'ar');
  if (named !== v) return named;
  const line = exact.get(norm(v));
  if (line) return line;
  const sar = /^SAR ([\d,.]+)$/.exec(v);
  if (sar) return `${sar[1]} ر.س`;
  // "flights, stay, passports": each item, joined with the Arabic comma.
  if (v.includes(', ')) {
    const items = v.split(', ').map((x) => exact.get(norm(x)) ?? nameIn(x, 'ar'));
    if (items.every((x) => /[\u0600-\u06ff]/.test(x))) return items.join('، ');
  }
  // Latin names and phone numbers ("+966 51 234 5678") keep their own order inside an Arabic line.
  return (/[A-Za-z]/.test(v) && isLatinRun(v)) || /^\+?\d[\d\s()+-]*\d$/.test(v) && /[+\s]/.test(v) ? `${LRI}${v}${PDI}` : v;
};

/* Dates the prototype writes itself ("Saturday 10 Oct", "Thu 11 Mar", "9–15 Mar", "Rabiʻ II 29"). */
const DATE_WORDS = {
  Sunday: 'الأحد', Monday: 'الاثنين', Tuesday: 'الثلاثاء', Wednesday: 'الأربعاء', Thursday: 'الخميس', Friday: 'الجمعة', Saturday: 'السبت',
  Sun: 'الأحد', Mon: 'الاثنين', Tue: 'الثلاثاء', Wed: 'الأربعاء', Thu: 'الخميس', Fri: 'الجمعة', Sat: 'السبت',
  January: 'يناير', February: 'فبراير', March: 'مارس', April: 'أبريل', June: 'يونيو', July: 'يوليو', August: 'أغسطس', September: 'سبتمبر', October: 'أكتوبر', November: 'نوفمبر', December: 'ديسمبر',
  Jan: 'يناير', Feb: 'فبراير', Mar: 'مارس', Apr: 'أبريل', May: 'مايو', Jun: 'يونيو', Jul: 'يوليو', Aug: 'أغسطس', Sep: 'سبتمبر', Oct: 'أكتوبر', Nov: 'نوفمبر', Dec: 'ديسمبر',
  Muharram: 'محرم', Safar: 'صفر', 'Rabiʻ I': 'ربيع الأول', 'Rabiʻ II': 'ربيع الآخر', 'Jumada I': 'جمادى الأولى', 'Jumada II': 'جمادى الآخرة', 'Jumada al-Ula': 'جمادى الأولى', 'Jumada al-Akhirah': 'جمادى الآخرة',
  Rajab: 'رجب', 'Shaʻban': 'شعبان', Shaban: 'شعبان', Ramadan: 'رمضان', Shawwal: 'شوال', 'Dhuʻl-Qiʻdah': 'ذو القعدة', 'Dhuʻl-Hijjah': 'ذو الحجة',
  Today: 'اليوم', Tomorrow: 'غدًا', today: 'اليوم', tomorrow: 'غدًا', Tonight: 'الليلة',
};
const DATE_RE = new RegExp(`(${Object.keys(DATE_WORDS).sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-zʻ])`, 'g');
function translateDate(t) {
  const rest = t.replace(DATE_RE, '').replace(/[\d\s·,–:-]/g, '');
  if (rest || !DATE_RE.test(t)) return null;
  DATE_RE.lastIndex = 0;
  return t.replace(DATE_RE, (w) => DATE_WORDS[w]);
}

/* A gap only takes what its name allows, so "{amount} back" never swallows "Abdullah is back". */
const NUMERIC = /^(count|n|i|days|minutes|seconds|hours|need|left|total|kg|temp|km|nights|rate|alt|min|year|age|version)$/;
const MONEY = /^(amount|price|each|fee|lo|hi|paid|tax|night)$/;
const TIMEISH = /^(ago|when|time|eta|at|until|since)$/;
function fits(name, v) {
  if (name === 'items') return v.length <= 140;
  if (TIMEISH.test(name)) return /\d|now|today|yesterday|tomorrow/i.test(v) && v.length <= 24;
  if (NUMERIC.test(name)) return /^[\d٠-٩][\d٠-٩,.:]*$/.test(v);
  if (MONEY.test(name)) return /\d/.test(v) && v.length <= 24;
  return v.length <= 48 && v.split(/\s+/).length <= 5;
}

/** The Arabic for an English line, or null. */
export function translate(text) {
  const t = norm(text);
  // A phone number on its own keeps its order: "+966 51 234 5678", not "5678 234 51 966+".
  if (/^\+?\d[\d ]{6,}\d$/.test(t) && /[+ ]/.test(t)) return `${LRI}${t}${PDI}`;
  // An arrow on its own between two places points the way Arabic reads.
  if (t === '→') return '←';
  if (!t || !/[A-Za-z]/.test(t)) return null;
  const sar = /^SAR ([\d,.]+)$/.exec(t);
  if (sar) return `${sar[1]} ر.س`;
  const hit = exact.get(t);
  if (hit) return hit;
  const date = translateDate(t);
  if (date) return date;
  const named = nameIn(t, 'ar');
  if (named !== t) return named;
  for (const tp of templates) {
    const m = tp.re.exec(t);
    if (!m || !tp.names.every((name, i) => fits(name, m[i + 1]))) continue;
    let out = tp.arabic;
    // A counted line: Arabic picks its form (one, two, few, other) from the number.
    const ci = tp.names.findIndex((x) => x === 'count' || x === 'n');
    const num = ci >= 0 ? Number(m[ci + 1]) : NaN;
    if (tp.key && Number.isInteger(num)) {
      const base = tp.key.replace(/\.(one|other)$/, '');
      for (const k of pluralKeys(base, num, 'ar')) if (ar[k]) { out = ar[k]; break; }
    }
    tp.names.forEach((name, i) => { out = out.split(`{${name}}`).join(fillVar(m[i + 1])); });
    return out;
  }
  // "Riyadh → Istanbul": both places in Arabic, the arrow pointing the way Arabic reads.
  const route = /^(.+?) → (.+)$/.exec(t);
  if (route) {
    const [a, b] = [nameIn(route[1], 'ar'), nameIn(route[2], 'ar')];
    if (a !== route[1] && b !== route[2]) return `${a} ← ${b}`;
  }
  // "· 31 min to King Khalid": a line that starts with a middle dot.
  if (t.startsWith('· ')) { const rest = translate(t.slice(2)); if (rest) return `· ${rest}`; }
  // "Saudia · 4 travellers": translate each part between middle dots.
  if (t.includes(' · ')) {
    const parts = t.split(' · ');
    const tr = parts.map((p) => translate(p) ?? (nameIn(p, 'ar')));
    if (tr.some((p, i) => p !== parts[i])) return tr.join(' · ');
  }
  return null;
}

/* ---------- the page ---------- */

let lang = 'en';
try { lang = localStorage.getItem(KEY) === 'ar' ? 'ar' : 'en'; } catch { /* private mode */ }
const listeners = new Set();
export const getLang = () => lang;
export const onLang = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

const ORIGINAL = new WeakMap(); // text node → its English
const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
const ATTR_ORIGINAL = new WeakMap(); // element → { attr: English }
let observer = null;
let busy = false;

function skip(el) {
  return !el || el.closest?.('[data-no-translate], script, style, .mrz, .pp-mrz, .pp-wait-mrz, code, [translate="no"]');
}

function translateTextNode(node) {
  if (skip(node.parentElement)) return;
  const current = node.nodeValue;
  const prev = ORIGINAL.get(node);
  // React wrote a new English value since we last looked: remember it.
  const english = prev && prev.arabic === current ? prev.english : current;
  const arabic = translate(english);
  if (arabic && arabic !== current) {
    const lead = /^\s*/.exec(english)[0];
    const trail = /\s*$/.exec(english)[0];
    ORIGINAL.set(node, { english, arabic: lead + arabic + trail });
    node.nodeValue = lead + arabic + trail;
  } else if (!arabic && prev && prev.arabic !== current) ORIGINAL.delete(node);
}

const INLINE = new Set(['B', 'STRONG', 'EM', 'I', 'SPAN', 'U']);
/** Text nodes of a line: its own text and the text inside inline tags (<b>, <span>) with no further structure. */
function lineNodes(el) {
  const out = [];
  for (const n of el.childNodes) {
    if (n.nodeType === 3) out.push(n);
    else if (n.nodeType === 1 && INLINE.has(n.tagName) && !n.querySelector('*') && !skip(n)) out.push(...n.childNodes);
    else return null;
  }
  return out.every((n) => n.nodeType === 3) ? out : null;
}

/**
 * Lines React split into several text nodes ("Leave in ", "42", " min") or across inline tags
 * ("Last Eid, the four of you went to <b>Baku</b>."): translate the line as a whole, into its first text node.
 */
function translateSplit(el) {
  if (skip(el)) return false;
  const nodes = lineNodes(el);
  if (!nodes || nodes.length < 2) return false;
  const englishParts = nodes.map((n) => { const o = ORIGINAL.get(n); return o && o.arabic === n.nodeValue ? o.english : n.nodeValue; });
  const english = englishParts.join('');
  const arabic = translate(english);
  if (!arabic) return false;
  nodes.forEach((n, i) => {
    const value = i === 0 ? arabic : '';
    ORIGINAL.set(n, { english: englishParts[i], arabic: value });
    if (n.nodeValue !== value) n.nodeValue = value;
  });
  return true;
}

function translateAttrs(el) {
  if (skip(el)) return;
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (!v) continue;
    const store = ATTR_ORIGINAL.get(el) ?? {};
    const english = store[a] && store[a].arabic === v ? store[a].english : v;
    const arabic = translate(english);
    if (arabic && arabic !== v) { store[a] = { english, arabic }; ATTR_ORIGINAL.set(el, store); el.setAttribute(a, arabic); }
  }
}

function walk(root) {
  if (root.nodeType === 3) { if (!translateSplit(root.parentElement)) translateTextNode(root); return; }
  if (root.nodeType !== 1) return;
  const els = [root, ...root.querySelectorAll('*')];
  for (const el of els) {
    translateAttrs(el);
    if (translateSplit(el)) continue;
    for (const n of el.childNodes) if (n.nodeType === 3) translateTextNode(n);
  }
}

function restore(root) {
  const els = [root, ...root.querySelectorAll('*')];
  for (const el of els) {
    for (const n of el.childNodes) {
      const o = n.nodeType === 3 && ORIGINAL.get(n);
      if (o) { if (n.nodeValue === o.arabic) n.nodeValue = o.english; ORIGINAL.delete(n); }
    }
    const store = ATTR_ORIGINAL.get(el);
    if (store) { for (const [a, o] of Object.entries(store)) if (el.getAttribute(a) === o.arabic) el.setAttribute(a, o.english); ATTR_ORIGINAL.delete(el); }
  }
}

function start() {
  if (observer) return;
  walk(document.body);
  observer = new MutationObserver((list) => {
    if (busy) return;
    busy = true;
    try {
      for (const m of list) {
        if (m.type === 'characterData') { if (!translateSplit(m.target.parentElement)) translateTextNode(m.target); }
        else if (m.type === 'attributes') translateAttrs(m.target);
        else m.addedNodes.forEach((n) => walk(n));
      }
    } finally {
      // Our own swaps are not news: drop them so the observer never answers itself.
      observer?.takeRecords();
      busy = false;
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

function stop() {
  observer?.disconnect();
  observer = null;
  restore(document.body);
}

function apply() {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  if (lang === 'ar') start(); else stop();
}

/** English or العربية. The page turns right to left at once; no reload. */
export function setLang(next) {
  lang = next === 'ar' ? 'ar' : 'en';
  try { localStorage.setItem(KEY, lang); } catch { /* private mode */ }
  apply();
  listeners.forEach((fn) => fn(lang));
}

/** Call once the app has mounted. */
export function initLang() {
  apply();
  window.__madaLang = { get: getLang, set: setLang, translate };
}

import React, { useMemo, useState } from 'react';
import { useStore, buzz, HAPTIC, PEOPLE } from '../store.jsx';
import { Icon, TopBar, Sheet, EmptyState, ArtCompass } from '../ui.jsx';
import CITIES from '../data/cities.json';
import { PLACES } from './Circles.jsx';

/* Every city in the world we can name (bundled, no network: cities.json is built from GeoNames, CC BY 4.0, and
   OurAirports, public domain, by platform/scripts/places/export-bundles.ts). Search, and the page for any city.
   Cities we sell open Ask; anywhere else, "Plan it with Mada" sends Faisal a request and opens the chat. */

/* Same rule as normPlace() in @mada/shared. */
const SPECIAL = { ı: 'i', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe', đ: 'd', ł: 'l', þ: 'th', ð: 'd' };
export const norm = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[ıøßæœđłþð]/g, (c) => SPECIAL[c] || c).replace(/['’‘`ʻʿʾ´]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/* Cities we sell in the app (flights and rooms on screen). Others with our photo are ones we know by hand. */
const SERVED = new Set([745044, 292223, 108841, 2643743, 587084, 360630, 110690, 105343]);
/* Our cities whose Discover week, ideas and tips live in Circles. */
const PLACE_KEY = { 745044: 'Istanbul', 611717: 'Georgia', 587084: 'Baku', 108841: 'AlUla', 2643743: 'London', 292223: 'Dubai', 108410: 'Riyadh', 110690: 'Abha' };

const ALL = CITIES.cities.map(([id, name, cc, iata, tz, popK, photo, alts]) => {
  const other = alts ? alts.split('|') : [];
  return {
    id: String(id), name, cc, country: CITIES.countries[cc], iata: iata || null, tz: CITIES.tz[tz], pop: popK * 1000, photo: photo || null,
    curated: !!photo, served: SERVED.has(id), codes: [iata, ...other.filter((a) => /^[A-Z]{3}$/.test(a))].filter(Boolean),
    names: [norm(name), ...other.filter((a) => !/^[A-Z]{3}$/.test(a)).map(norm)],
  };
});
const BY_ID = new Map(ALL.map((c) => [c.id, c]));
export const cityById = (id) => BY_ID.get(String(id)) || null;
export const cityByName = (name) => ALL.find((c) => c.names[0] === norm(name)) || null;

const grams = (s) => { const t = `  ${s} `; const g = new Set(); for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3)); return g; };
const similarity = (a, b) => { const A = grams(a); const B = grams(b); let n = 0; A.forEach((x) => { if (B.has(x)) n++; }); return n / (A.size + B.size - n); };
const rank = (c) => 0.06 * Math.log10(Math.max(c.pop, 1000)) + (c.served ? 0.12 : 0) + (c.curated ? 0.08 : 0);

/** Prefix, then words inside names, then typos; airport codes too. The same ranking the server uses. */
export function searchCities(input, limit = 8) {
  const q = norm(input);
  if (!q) return { results: [], suggestions: [] };
  const code = /^[a-z]{3}$/.test(q) ? q.toUpperCase() : null;
  const scored = [];
  for (const c of ALL) {
    let s = 0;
    let via = null;
    if (code && c.codes.includes(code)) { s = 1.2; via = code; }
    for (const n of c.names) {
      let m = 0;
      if (n === q) m = 1;
      else if (n.startsWith(q)) m = 0.9 - Math.min(0.15, (n.length - q.length) * 0.005);
      else if (q.length >= 3 && n.includes(` ${q}`)) m = 0.72;
      else if (q.length >= 4) { const sim = similarity(n, q); if (sim >= 0.3) m = sim * 0.85; }
      if (m > s) { s = m; via = null; }
    }
    if (s > 0) scored.push({ c, via, score: s + rank(c) });
  }
  scored.sort((a, b) => b.score - a.score || b.c.pop - a.c.pop);
  if (scored.length) return { results: scored.slice(0, limit).map((x) => ({ ...x.c, via: x.via })), suggestions: [] };
  /* Nothing: the closest names we know. Short queries match the letters in order ("sd" → Sydney, San Diego). */
  const letters = q.replace(/\s+/g, '');
  const inOrder = (n) => { let i = 0; for (const ch of n) { if (ch === letters[i]) i++; if (i === letters.length) return true; } return false; };
  const near = ALL.filter((c) => c.pop >= 500000 || c.curated).map((c) => {
    const n = c.names[0];
    const s = Math.max(similarity(n, q), n[0] === letters[0] && inOrder(n) ? 0.3 : 0);
    return { c, score: s > 0.15 ? s + rank(c) : 0 };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return { results: [], suggestions: near.slice(0, 3).map((x) => x.c) };
}

export function localTime(tz, at = new Date()) {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(at); } catch (e) { return null; }
}
function offsetMin(tz, at = new Date()) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(at).map((x) => [x.type, x.value]));
    return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - at.getTime()) / 60000);
  } catch (e) { return 0; }
}
/** "1 hour behind Riyadh": the traveller lives in Riyadh in this prototype. */
export function timeDiff(tz) {
  const d = offsetMin(tz) - offsetMin('Asia/Riyadh');
  if (Math.abs(d) < 1) return 'Same time as Riyadh';
  const h = Math.abs(d) / 60;
  const label = Number.isInteger(h) ? (h === 1 ? '1 hour' : `${h} hours`) : `${Math.floor(h) ? `${Math.floor(h)}h ` : ''}${Math.abs(d) % 60}m`;
  return `${label} ${d > 0 ? 'ahead of' : 'behind'} Riyadh`;
}

const where = (c) => `${c.country}${c.iata ? ` · ${c.iata}` : ''}`;
const img = (c) => (c.photo ? `img/places/${c.photo}.jpg` : null);

/** One row in the search: our photo, or the city's initial in the empty-state family. */
export function CityRow({ c, onPick, note, on }) {
  return (
    <button type="button" className={'city-row' + (on ? ' on' : '')} aria-pressed={on ? 'true' : 'false'} onClick={() => { buzz(HAPTIC.select); onPick(c); }} data-city={c.id}>
      {c.photo ? <img src={img(c)} alt="" /> : <span className="pl-mono" aria-hidden="true">{c.iata || c.name.slice(0, 2)}</span>}
      <span className="grow col" style={{ gap: 0, minWidth: 0 }}>
        <span className="h3" style={{ fontSize: 16 }}>{c.name}</span>
        <span className="tiny">{note || (c.via ? `${c.country} · ${c.via}` : where(c))}</span>
      </span>
      {on ? <Icon name="check" size={20} color="#1e352d" width={2.4} /> : <Icon name="chevron" size={18} color="#7a857f" />}
    </button>
  );
}

/** The search results part of the city sheet: hits, or a gentle no-match with the closest names. */
export function CityResults({ q, onPick, current }) {
  const { results, suggestions } = useMemo(() => searchCities(q), [q]);
  if (results.length) return <div className="col" style={{ gap: 8 }}>{results.map((c) => <CityRow key={c.id} c={c} onPick={onPick} on={c.name === current} />)}</div>;
  return (
    <div className="col" style={{ gap: 10 }}>
      <EmptyState compact className="well" art={<ArtCompass />} title={`No city called ‘${q.trim()}’.`} body="Try a city or an airport code." />
      {suggestions.length > 0 && <span className="eyebrow">Closest we know</span>}
      {suggestions.map((c) => <CityRow key={c.id} c={c} onPick={onPick} />)}
    </div>
  );
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "Tbilisi, 4 of us, sometime in May": the same words planMessage() in @mada/shared writes. */
export function planMessage(city, n, month) {
  return [city, n ? (n === 1 ? 'just me' : `${n} of us`) : null, month != null ? `sometime in ${MONTHS[month]}` : 'dates to decide'].filter(Boolean).join(', ');
}

function PlanSheet({ c, onClose, onSend }) {
  const { s } = useStore();
  const household = (s.household.length ? s.household : ['omar']).filter((id) => !PEOPLE[id]?.helper);
  const [n, setN] = useState(household.length || 1);
  const now = new Date();
  const months = Array.from({ length: 8 }, (_, i) => (now.getMonth() + 1 + i) % 12);
  const [month, setMonth] = useState(null);
  const [text, setText] = useState(null);
  const msg = text ?? planMessage(c.name, n, month);
  return (
    <Sheet label={`Plan ${c.name} with Mada`} onClose={onClose}>
      <h2 className="h2">Plan {c.name} with Mada</h2>
      <span className="eyebrow">How many of you</span>
      <div className="chips" role="radiogroup" aria-label="How many of you">
        {[1, 2, 3, 4, 5, 6].map((k) => <button key={k} type="button" role="radio" aria-checked={n === k ? 'true' : 'false'} className={'chip' + (n === k ? ' on' : '')} onClick={() => { setN(k); setText(null); buzz(HAPTIC.select); }}>{k === 6 ? '6+' : k}</button>)}
      </div>
      <span className="eyebrow">When</span>
      <div className="chips" role="radiogroup" aria-label="When">
        {months.map((m) => <button key={m} type="button" role="radio" aria-checked={month === m ? 'true' : 'false'} className={'chip' + (month === m ? ' on' : '')} onClick={() => { setMonth(m); setText(null); buzz(HAPTIC.select); }}>{MONTHS[m].slice(0, 3)}</button>)}
        <button type="button" role="radio" aria-checked={month === null ? 'true' : 'false'} className={'chip' + (month === null ? ' on' : '')} onClick={() => { setMonth(null); setText(null); }}>Not sure yet</button>
      </div>
      <div className="field">
        <label htmlFor="plan-msg">Your message</label>
        <textarea id="plan-msg" className="input" style={{ height: 76, padding: 14, resize: 'none', lineHeight: 1.4 }} value={msg} onChange={(e) => setText(e.target.value)} />
      </div>
      <span className="tiny">We’ll put it together by hand. Faisal replies in the chat, usually within 20 minutes.</span>
      <button type="button" className="btn primary block" disabled={!msg.trim()} onClick={() => onSend({ n, month, msg: msg.trim() })}>Send to Mada</button>
    </Sheet>
  );
}

export default function City({ params = {} }) {
  const { s, set, pop, push } = useStore();
  const c = cityById(params.id) || (params.name ? cityByName(params.name) : null);
  const [planning, setPlanning] = useState(false);
  if (!c) {
    return (
      <div className="screen push">
        <TopBar onBack={pop} />
        <div className="scroll no-dock">
          <EmptyState center tall art={<ArtCompass />} title="We can’t find that city." body="Search again by its name or its airport code." action={<button type="button" className="btn primary" onClick={pop}>Search cities</button>} />
        </div>
      </div>
    );
  }
  const place = PLACES[PLACE_KEY[c.id]] || null;
  const time = localTime(c.tz);
  const send = ({ n, month, msg }) => {
    const own = msg !== planMessage(c.name, n, month);
    const offline = !!s.demo.offline;
    const id = 'pl' + Date.now();
    const title = `A trip to ${c.name}`;
    const about = `${title}`;
    set((p) => ({
      requests: [...p.requests, {
        id, kind: 'general', short: 'trip', title, detail: own ? `${c.name}, ${c.country} · “${msg}”` : `${c.name}, ${c.country} · ${planMessage('', n, month).replace(/^, /, '')}`, status: offline ? 'queued' : 'sent', created: Date.now(), quote: 0, place: c.id,
        quoteText: `I’m putting ${c.name} together by hand${n ? ` for ${n === 1 ? 'you' : `${n} of you`}` : ''}${month != null ? ` in ${MONTHS[month]}` : ''}: flights from Riyadh, a place to stay and what’s worth doing. Options land here, and nothing is booked until you say so.`,
      }],
      support: [...(p.support || []), { id: 'm' + Date.now(), at: Date.now(), from: 'me', text: msg, about, queued: offline, intent: 'free' }],
      tripsTab: 'requests',
    }));
    setPlanning(false);
    buzz(HAPTIC.success);
    if (!offline) {
      setTimeout(() => set((p) => ({ support: [...(p.support || []), { id: 'm' + Date.now() + 'f', at: Date.now(), from: 'faisal', text: `Lovely. I’ll put ${c.name} together by hand and send you options here, usually within 20 minutes. It’s in Trips → Requests too.` }] })), 1600);
    }
    push('support', { about });
  };
  const plan = () => {
    buzz(HAPTIC.tap);
    if (c.served || c.curated) push('ask', { prefill: `A trip to ${c.name}` });
    else setPlanning(true);
  };
  const hero = c.photo ? (
    <div className="photo pl-hero" style={{ height: 300, borderRadius: 0, flexShrink: 0 }}>
      <img className="drift" src={img(c)} alt={`${c.name}, ${c.country}`} />
      <span className="shade" />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 }}><TopBar onBack={pop} dark /></div>
      <span className="over" style={{ gap: 4 }}>
        <span className="pill glass" style={{ alignSelf: 'flex-start' }}>{c.served ? 'Book it in Mada' : 'Planned by Mada'}</span>
        <span className="display" style={{ fontSize: 44, color: '#fffdf9' }}>{c.name}</span>
        <span className="small" style={{ color: 'rgba(255,253,249,.9)' }}>{c.country}</span>
      </span>
    </div>
  ) : (
    <div className="pl-type" role="img" aria-label={`${c.name}, ${c.country}`}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 }}><TopBar onBack={pop} dark /></div>
      <span className="pl-code" aria-hidden="true">{c.iata || ''}</span>
      <span className="pl-rose" aria-hidden="true"><ArtCompass /></span>
      <span className="pl-type-over">
        <span className="eyebrow" style={{ color: '#d9b77a' }}>{c.country}</span>
        <span className="display pl-name">{c.name}</span>
        {time && <span className="small" style={{ color: 'rgba(246,242,236,.82)' }}>{time} there now</span>}
      </span>
    </div>
  );
  return (
    <div className="screen push city-page">
      {hero}
      <div className="scroll no-dock" style={{ paddingTop: 16, paddingBottom: 170, gap: 12 }}>
        <div className="pl-facts rise">
          <div className="pl-fact"><span className="tiny">Local time</span><span className="h3 num">{time || 'Unknown'}</span><span className="tiny">{timeDiff(c.tz)}</span></div>
          <div className="pl-fact"><span className="tiny">Nearest airport</span><span className="h3 num">{c.iata || 'By road'}</span><span className="tiny">{c.codes.length > 1 ? `Also ${c.codes.slice(1).join(', ')}` : c.iata ? 'The closest with flights' : 'We’ll find the way in'}</span></div>
        </div>
        <div className="card well rise d1 pl-weather" style={{ gap: 12 }}>
          <Icon name="rain" size={20} color="#7d5d27" />
          <span className="small" style={{ color: '#1e352d' }}>The forecast shows here 10 days before you go.</span>
        </div>
        {place ? (
          <>
            <div className="card rise d1" style={{ gap: 8 }}>
              <span className="eyebrow">Worth doing</span>
              {place.ideas.map((x) => <span key={x} className="row small" style={{ color: '#1e352d', alignItems: 'flex-start' }}><Icon name="star" size={16} color="#b98f4a" />{x}</span>)}
            </div>
            <div className="card rise d2" style={{ gap: 10 }}>
              {place.fly && <div className="col" style={{ gap: 2 }}><span className="eyebrow">Getting there</span><span className="small" style={{ color: '#1e352d' }}>{place.fly}</span></div>}
              <div className="col" style={{ gap: 2 }}><span className="eyebrow">When to go</span><span className="small" style={{ color: '#1e352d' }}>{place.when}</span></div>
              <div className="col" style={{ gap: 2 }}><span className="eyebrow">Visa</span><span className="small" style={{ color: '#1e352d' }}>{place.visa}</span></div>
              <div className="col" style={{ gap: 2 }}><span className="eyebrow">Where to stay</span><span className="small" style={{ color: '#1e352d' }}>{place.stay}</span></div>
            </div>
          </>
        ) : (
          <div className="card rise d1 pl-byhand" style={{ gap: 10 }}>
            <span className="eyebrow">What Mada puts together</span>
            {[['flight', `Flights from Riyadh${c.iata ? ` to ${c.iata}` : ''}, with the best connection`], ['stay', 'A place to stay that suits who’s going'], ['visa', `What each passport needs for ${c.country}`], ['star', 'The few things worth doing, booked']].map(([ic, t]) => (
              <span key={t} className="row small" style={{ color: '#1e352d' }}><span className="pl-ic"><Icon name={ic} size={16} /></span>{t}</span>
            ))}
            <span className="tiny">You see the whole plan and the price before anything is booked.</span>
          </div>
        )}
        <span className="tiny pl-credit">City and time zone from GeoNames (CC BY 4.0). Airports from OurAirports.</span>
      </div>
      <div className="act">
        <span className="tiny" style={{ textAlign: 'center' }}>{c.served ? `Flights and rooms for ${c.name} are right here.` : 'We’ll put it together by hand. Faisal replies here, usually within 20 minutes.'}</span>
        <button type="button" className="btn primary block" onClick={plan}>Plan it with Mada</button>
      </div>
      {planning && <PlanSheet c={c} onClose={() => setPlanning(false)} onSend={send} />}
    </div>
  );
}

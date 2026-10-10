import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, buzz, HAPTIC, PEOPLE, FLIGHTS, HOTELS, STAY_NIGHTS, PICKUP, fmt, passportIssue } from '../store.jsx';
import { Icon, Sun, TopBar, Route, Sheet, Steps, AirlineMark, AddPersonSheet } from '../ui.jsx';
import { PLANS } from './Plan.jsx';

const REQUEST_KINDS = {
  visa: { short: 'visa', title: 'Visa', icon: 'visa' },
  umrah: { short: 'Umrah trip', title: 'Umrah', icon: 'umrah' },
  car: { short: 'car', title: 'Car rental', icon: 'car' },
  food: { short: 'table', title: 'Restaurant table', icon: 'food' },
  todo: { short: 'plans', title: 'Things to do', icon: 'star' },
  general: { short: 'request', title: 'Request', icon: 'doc' },
};

const OTHER_CITIES = ['dubai', 'london', 'baku', 'cairo', 'paris', 'tbilisi', 'bali', 'maldives', 'jeddah', 'abha', 'alula'];

export function parseIntent(text) {
  const t = text.toLowerCase();
  if (/alula|weekend|itinerary|days in|plan a|day trip/.test(t) && !/visa/.test(t)) return 'plan';
  if (/visa|schengen|\beta\b|appointment/.test(t)) return 'visa';
  if (/umrah|makkah|mecca|madinah/.test(t)) return 'umrah';
  if (/esim|data plan|sim card/.test(t)) return 'esim';
  if (/hotel|stay|room|apartment|villa/.test(t)) return 'stay';
  if (/car|rental|driver/.test(t)) return 'car';
  if (/restaurant|dinner|lunch|table|breakfast/.test(t)) return 'food';
  if (/tour|things to do|activity|museum|cruise|tickets/.test(t)) return 'todo';
  if (/flight|fly|istanbul|eid|trip|return|ticket|\bto\b/.test(t) || OTHER_CITIES.some((c) => t.includes(c))) return 'flight';
  return 'general';
}

const INTENT_PROMPT = {
  flight: 'Flights', stay: 'A place to stay', visa: 'A visa', umrah: 'An Umrah trip', car: 'A car', food: 'A table somewhere good', todo: 'Things to do', esim: 'Data for the trip',
};

export default function Ask({ params }) {
  const { s, set, pop, push, go, toast } = useStore();
  const [query, setQuery] = useState(params.prefill || (params.intent ? INTENT_PROMPT[params.intent] : ''));
  const [intent, setIntent] = useState(params.intent || (params.prefill ? parseIntent(params.prefill) : null));
  const [draft, setDraft] = useState('');
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [cta, setCta] = useState(null);

  const submit = (text) => {
    const v = (text ?? draft).trim();
    if (!v) return;
    buzz(HAPTIC.tap);
    setQuery(v);
    setIntent(parseIntent(v));
    setCta(null);
    setDraft('');
  };

  useEffect(() => { if (s.guest && intent) setNeedsSignIn(true); }, [intent]);

  let body;
  if (!intent) body = <Start onPick={submit} />;
  else if (intent === 'flight') body = <FlightFlow query={query} setCta={setCta} />;
  else if (intent === 'stay') body = <StayFlow setCta={setCta} />;
  else if (intent === 'esim') body = <EsimFlow />;
  else if (intent === 'plan') body = <PlanFlow query={query} />;
  else body = <RequestFlow kind={intent} query={query} />;

  return (
    <div className="screen push">
      <TopBar onBack={pop} backLabel="Close" />
      <p className="tiny" style={{ margin: '0 24px 8px' }}>Instant answers from Mada. A Mada agent confirms anything you book.</p>
      <div className="scroll no-dock" style={{ paddingBottom: 110 }}>
        {query && <div className="rise" style={{ alignSelf: 'flex-end', maxWidth: '78%', background: '#1e352d', color: '#f6f2ec', padding: '12px 16px', borderRadius: '22px 22px 6px 22px', fontSize: 16, lineHeight: 1.4 }}>{query}</div>}
        {s.demo.offline && intent && intent !== 'esim' && ['flight', 'stay'].includes(intent) ? <Offline /> : body}
      </div>
      {cta && !s.demo.offline ? (
        <div className="act" style={{ bottom: 24 }}>
          <button type="button" className="btn primary block" disabled={cta.disabled} onClick={cta.onClick}>{cta.label}</button>
          <button type="button" className="link" style={{ alignSelf: 'center', fontSize: 13 }} onClick={() => setCta(null)}>Ask something else</button>
        </div>
      ) : (
      <form className="act" style={{ bottom: 24 }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="row" style={{ height: 56, borderRadius: 999, background: '#fffdf9', border: '1px solid var(--line)', padding: '0 6px 0 20px', boxShadow: '0 10px 30px -18px rgba(30,53,45,.4)' }}>
          <label htmlFor="ask-input" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Ask Mada</label>
          <input id="ask-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={intent ? 'Anything else?' : 'Where to? Say it any way you like'} autoComplete="off"
            style={{ flex: '1 1 auto', minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontSize: 16 }} />
          <button type={draft ? 'submit' : 'button'} className="icon-btn dark" aria-label={draft ? 'Send' : 'Hold to talk'} onClick={draft ? undefined : () => toast('Voice comes in the app. Type here for now.')}>
            <Icon name={draft ? 'up' : 'mic'} color="#f6f2ec" size={20} />
          </button>
        </div>
      </form>
      )}
      {needsSignIn && (
        <Sheet label="Sign in to book" onClose={() => { setNeedsSignIn(false); pop(); }}>
          <h2 className="h2">Sign in to book</h2>
          <p className="body">Booking needs an account, so Mada can confirm with your details and your tickets land in your Wallet.</p>
          <button type="button" className="btn primary block" onClick={() => set({ onboarded: false, guest: false, stack: [] })}>Sign in</button>
          <button type="button" className="btn ghost block" onClick={() => { setNeedsSignIn(false); pop(); }}>Not now</button>
        </Sheet>
      )}
    </div>
  );
}

function Start({ onPick }) {
  const { s } = useStore();
  const ideas = s.trip
    ? ['Add a hotel in Istanbul', 'Dinner for 6 on the first night', 'A car for a day trip', 'Data for the trip']
    : ['Istanbul for Eid, all four of us', 'Same as last Eid', 'A hotel in Istanbul', 'Schengen visa for Sara', 'Umrah in Ramadan'];
  return (
    <div className="col rise" style={{ gap: 14 }}>
      <h1 className="display" style={{ fontSize: 40 }}>Where to?</h1>
      <p className="body">Say it any way you like. A place, dates, who's going. We'll ask only what we need.</p>
      <div className="chips">{ideas.map((i) => <button key={i} type="button" className="chip" onClick={() => onPick(i)}>{i}</button>)}</div>
    </div>
  );
}

function Offline() {
  return (
    <div className="notice rise">
      <Icon name="wifiOff" />
      <div className="grow">
        <span className="h3">You're offline.</span>
        <span className="small">Searching needs a connection. Everything for your trips is still on this phone, and requests to Mada send once you're back.</span>
      </div>
    </div>
  );
}

function Working({ lines, step }) {
  return (
    <div className="row rise" style={{ alignItems: 'flex-start', gap: 12 }}>
      <Sun width={34} color="#b98f4a" className={step < lines.length ? 'think' : ''} style={{ flexShrink: 0, marginTop: 2 }} />
      <Steps items={lines.map((text, i) => ({ text, state: i < step ? 'done' : i === step ? 'now' : 'todo' })).filter((x, i) => i <= step)} />
    </div>
  );
}

function useSequence(n, ms, run) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!run) return undefined;
    setStep(0);
    const ts = Array.from({ length: n }, (_, i) => setTimeout(() => setStep(i + 1), ms * (i + 1)));
    return () => ts.forEach(clearTimeout);
  }, [run]);
  return step;
}

/* ---------- travellers picker ---------- */

function useTravellers() {
  const { s } = useStore();
  const base = (s.household.length ? s.household : ['omar']).filter((id) => id !== 'lina');
  return useState(base);
}

function TravellerChips({ value, onChange }) {
  const { s } = useStore();
  const [adding, setAdding] = useState(false);
  const all = s.household.length ? s.household : ['omar'];
  return (
    <div className="chips">
      {adding && <AddPersonSheet onClose={() => setAdding(false)} onAdded={(p) => { onChange([...value, p.id]); setAdding(false); }} />}
      {all.map((id) => {
        const p = PEOPLE[id];
        const on = value.includes(id);
        return (
          <button key={id} type="button" className="chip" aria-pressed={on ? 'true' : 'false'}
            onClick={() => { buzz(HAPTIC.select); if (on && value.length === 1) return; onChange(on ? value.filter((x) => x !== id) : [...value, id]); }}>
            {p.name}{p.helper ? ' (helper)' : ''}
          </button>
        );
      })}
      <button type="button" className="chip" style={{ background: 'transparent', boxShadow: 'inset 0 0 0 1.5px rgba(30,53,45,.25)' }} onClick={() => setAdding(true)}><Icon name="plus" size={16} />Someone else</button>
    </div>
  );
}

/* ---------- flights ---------- */

function FlightFlow({ query, setCta }) {
  const { s, set, push } = useStore();
  const lower = query.toLowerCase();
  const otherCity = OTHER_CITIES.find((c) => lower.includes(c));
  const knowsWhere = lower.includes('istanbul') || lower.includes('same as last') || s.trip;
  const knowsWhen = /eid|mar|march|ramadan|summer/.test(lower) || lower.includes('same as last');
  const knowsWho = /all|four|family|us\b|me\b|just/.test(lower) || lower.includes('same as last');
  const [where, setWhere] = useState(knowsWhere ? 'Istanbul' : otherCity ? otherCity : null);
  const [when, setWhen] = useState(knowsWhen ? 'eid' : null);
  const [who, setWho] = useTravellers();
  const [whoDone, setWhoDone] = useState(knowsWho || (s.household.length <= 1));
  const [mode, setMode] = useState('normal');
  const ready = where && when && whoDone;
  const [runKey, setRunKey] = useState(0);
  const lines = ['Checking 14 flights', 'Holding seats at this price', 'Matching seats and meals for ' + who.length];
  const step = useSequence(lines.length, 750, ready ? `${runKey}` : null);
  const [pick, setPick] = useState('best');
  const [open, setOpen] = useState(null);
  const [bundle, setBundle] = useState(false);
  const [renewalAsked, setRenewalAsked] = useState(false);
  const [trip, setTrip] = useState({ type: 'return', dep: 9, ret: 15, month: 'Mar', cabin: 'Economy', infants: 0, flex: false });
  const [sort, setSort] = useState('best');
  const [editing, setEditing] = useState(false);
  const cabinX = trip.cabin === 'Business' ? 3.2 : trip.cabin === 'Premium' ? 1.7 : 1;
  const legX = trip.type === 'oneway' ? 0.55 : 1;
  const fare = (f) => Math.round(f.pp * cabinX * legX);
  const dateLabel = trip.type === 'oneway' ? `${trip.month} ${trip.dep}, one way` : `${trip.dep}–${trip.ret} ${trip.month}`;

  if (where && where !== 'Istanbul') {
    const city = where.charAt(0).toUpperCase() + where.slice(1);
    return <RequestFlow kind="general" query={`Flights to ${city}`} note={`Live results in this prototype are set up for Istanbul. In the app we'd show ${city} here; for now Mada searches it for you.`} />;
  }
  if (!where) return (
    <Ask1 q="Where to?" options={[['Istanbul', 'Istanbul'], ['Somewhere else', 'other']]} onPick={(v) => setWhere(v === 'other' ? 'other-city' : v)} />
  );
  if (where === 'other-city') return <RequestFlow kind="general" query="Flights somewhere new" />;
  if (!when) return (
    <>
      <Ask1 q="When?" options={[['Eid al-Fitr · 9–15 Mar', 'eid'], ['Mid-year school break · 20–27 Jun', 'june'], ['I’ll pick dates', 'pick']]} onPick={(v) => { if (v === 'pick') setEditing(true); else { if (v === 'june') setTrip({ ...trip, month: 'Jun', dep: 20, ret: 27 }); setWhen(v); } }} />
      {editing && <SearchSheet value={trip} onClose={() => setEditing(false)} onDone={(t) => { setTrip(t); setWhen('custom'); setEditing(false); }} />}
    </>
  );
  if (!whoDone) return (
    <div className="col rise" style={{ gap: 12 }}>
      <span className="h2">Who's going?</span>
      <TravellerChips value={who} onChange={setWho} />
      <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={() => { buzz(HAPTIC.tap); setWhoDone(true); }}>{who.length === 1 ? 'Just ' + PEOPLE[who[0]].name : `These ${who.length}`}</button>
    </div>
  );

  const searching = step < lines.length;
  if (searching) return <Working lines={lines} step={step} />;

  if (s.demo.supplierDown && mode === 'normal') return (
    <div className="col rise" style={{ gap: 12 }}>
      <div className="notice warn"><Icon name="flight" color="#7d5d27" /><div className="grow"><span className="h3">Saudia's system isn't answering.</span><span className="small">Flynas and Turkish are fine. Or a Mada agent can search Saudia by hand and come back within 20 minutes.</span></div></div>
      <div className="row">
        <button type="button" className="btn primary small" onClick={() => { setMode('others'); buzz(HAPTIC.tap); }}>Show the others</button>
        <button type="button" className="btn secondary small" onClick={() => setMode('byhand')}>Ask Mada</button>
      </div>
    </div>
  );
  if (mode === 'byhand') return <RequestFlow kind="general" query="Saudia flights to Istanbul for Eid" note="A Mada agent will search Saudia by hand and send you the options here." autoSend />;

  if (s.demo.noResults && mode === 'normal') return (
    <div className="col rise" style={{ gap: 12 }}>
      <span className="h2">Nothing direct on those dates.</span>
      <p className="body">Eid seats to Istanbul are gone on the 9th. There's room a day either side, or with one short stop.</p>
      <div className="chips">
        <button type="button" className="chip" onClick={() => { setMode('flex'); setRunKey((k) => k + 1); }}>Try a day either side</button>
        <button type="button" className="chip" onClick={() => { setMode('flex'); setRunKey((k) => k + 1); }}>Allow one stop</button>
      </div>
    </div>
  );

  const durMin = (f) => { const m = f.dur.match(/(\d+)h (\d+)m/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
  const options = FLIGHTS.filter((f) => !(s.demo.supplierDown && mode === 'others' && f.id === 'best'))
    .slice().sort((a, b) => (sort === 'cheapest' ? a.pp - b.pp : sort === 'fastest' ? durMin(a) - durMin(b) : sort === 'earliest' ? a.dep.localeCompare(b.dep) : 0));
  const current = options.find((f) => f.id === pick) || options[0];
  const blocking = who.map((id) => ({ p: PEOPLE[id], issue: passportIssue(s, id) })).filter((x) => x.issue?.blocking);
  const hotelTotal = HOTELS[0].night * STAY_NIGHTS * (who.length > 2 ? 1 : 0.55) + PICKUP;
  const infantFare = (f) => Math.round(fare(f) * 0.1);
  const total = fare(current) * who.length + infantFare(current) * trip.infants + (bundle ? hotelTotal : 0);

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row tiny rise"><Icon name="check" color="#2f7a4b" size={16} width={2.4} />Checked 14 flights · holding seats for {who.length}</div>
      <div className="col rise d1" style={{ gap: 2 }}>
        <h2 className="h2" style={{ fontSize: 24 }}>Three ways to get there.</h2>
      </div>
      <button type="button" className="search-summary rise d1" onClick={() => setEditing(true)} aria-label="Edit search">
        <span className="col" style={{ gap: 1 }}>
          <span className="h3" style={{ fontSize: 15 }}>Riyadh → Istanbul · {mode === 'flex' && trip.month === 'Mar' && trip.dep === 9 ? '10–15 Mar' : dateLabel}</span>
          <span className="tiny">{who.length} {who.length === 1 ? 'adult' : 'people'}{trip.infants ? ` + ${trip.infants} on a lap` : ''} · {trip.cabin}{trip.flex ? ' · ±2 days' : ''}</span>
        </span>
        <span className="link" style={{ fontSize: 14 }}>Edit</span>
      </button>
      <div className="row" style={{ gap: 16 }} role="group" aria-label="Sort flights">
        {[['best', 'Best'], ['cheapest', 'Cheapest'], ['fastest', 'Fastest'], ['earliest', 'Earliest']].map(([id, label]) => (
          <button key={id} type="button" aria-pressed={sort === id ? 'true' : 'false'} onClick={() => { setSort(id); buzz(HAPTIC.select); }}
            style={{ border: 0, background: 'none', padding: '4px 0', fontSize: 14, fontWeight: 600, color: sort === id ? '#1e352d' : '#7a857f', borderBottom: sort === id ? '2px solid #d9b77a' : '2px solid transparent' }}>{label}</button>
        ))}
      </div>
      {options.map((f, i) => {
        const on = current.id === f.id;
        return (
          <div key={f.id} className={'card rise d' + (i + 2) + (on ? ' selected' : '')} style={{ padding: 0, gap: 0 }}>
            <button type="button" aria-pressed={on ? 'true' : 'false'} onClick={() => { buzz(HAPTIC.select); if (on) setOpen(open === f.id ? null : f.id); else { setPick(f.id); setOpen(null); } }}
              style={{ border: 0, background: 'none', textAlign: 'left', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
              <span className="spread">
                <span className="row" style={{ gap: 10 }}>
                  <AirlineMark flight={f} />
                  <span className="col" style={{ gap: 2 }}>
                    <span className="h3" style={{ fontSize: 15 }}>{f.airline}</span>
                    <span className="pill" style={{ height: 22, alignSelf: 'flex-start', ...(on ? { background: '#d9b77a' } : {}) }}>{f.label}</span>
                  </span>
                </span>
                <span className="num" style={{ fontSize: 17, fontWeight: 600 }}>SAR {fmt(fare(f) * who.length + infantFare(f) * trip.infants)}</span>
              </span>
              <Route dep={f.dep} arr={f.arr} from={f.from} to={f.to} dur={f.dur} />
              <span className="small">{f.reason}</span>
            </button>
            {on && open === f.id && (
              <div className="col rise" style={{ padding: '0 16px 14px', gap: 8 }}>
                <div className="divider" />
                {[['Bags', f.bags], ['Change', f.change], ['Cancel', f.refund], ...(trip.type === 'oneway' ? [] : [['Return', `${f.back} · ${trip.month} ${trip.ret}`]]), ...(trip.infants ? [['Lap infant', `SAR ${fmt(infantFare(f))} each · bassinet on request`]] : [])].map(([k, v]) => (
                  <div key={k} className="spread small"><span>{k}</span><span style={{ color: '#1e352d', fontWeight: 600 }}>{v}</span></div>
                ))}
              </div>
            )}
            {on && open !== f.id && <span className="tiny" style={{ padding: '0 16px 12px' }}>Tap again for bags and change rules</span>}
          </div>
        );
      })}

      <div className="card well rise d4" style={{ gap: 10 }}>
        <span className="h3">Travellers</span>
        <TravellerChips value={who} onChange={setWho} />
      </div>

      {blocking.map(({ p, issue }) => (
        <div key={p.id} className="notice warn rise" role="alert">
          <Icon name="visa" color="#7d5d27" />
          <div className="grow">
            <span className="h3">{p.name} can't travel on this passport.</span>
            <span className="small">{issue.text}</span>
            <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn primary small" onClick={() => { setWho(who.filter((x) => x !== p.id)); buzz(HAPTIC.select); }}>Book without {p.name}</button>
              <button type="button" className="btn secondary small" disabled={renewalAsked} onClick={() => {
                setRenewalAsked(true);
                set((prev) => ({ requests: [...prev.requests, { id: 'r' + Date.now(), kind: 'visa', short: 'passport renewal', title: `Passport renewal for ${p.name}`, detail: 'Before the Istanbul trip on 9 Mar', status: s.demo.offline ? 'queued' : 'sent', created: Date.now(), quote: 150 }] }));
                buzz(HAPTIC.success);
              }}>{renewalAsked ? 'Mada is on it' : 'Renew it first'}</button>
            </div>
          </div>
        </div>
      ))}

      <div className="card rise d5" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <div className="grow col" style={{ gap: 3 }}>
          <span className="h3">Add connecting rooms near Galata Tower and airport pickup?</span>
          <span className="small">You asked for connecting rooms last Eid. 6 nights · SAR {fmt(hotelTotal)}</span>
        </div>
        <button type="button" className={'btn small ' + (bundle ? 'primary' : 'secondary')} aria-pressed={bundle ? 'true' : 'false'} onClick={() => { setBundle(!bundle); buzz(HAPTIC.select); }}>{bundle ? 'Added' : 'Add'}</button>
      </div>

      <PublishCta setCta={setCta} cta={{
        label: blocking.length ? `Sort out ${blocking[0].p.name}'s passport first` : `Review · SAR ${fmt(total)}`,
        disabled: blocking.length > 0,
        onClick: () => push('pay', { kind: 'trip', flightId: current.id, travellers: who, bundle, flex: mode === 'flex', search: trip }),
      }} deps={[blocking.length, total, current.id, who.join(), bundle, mode, JSON.stringify(trip)]} />
      {editing && <SearchSheet value={trip} onClose={() => setEditing(false)} onDone={(t) => { setTrip(t); setEditing(false); setRunKey((k) => k + 1); }} />}
    </div>
  );
}

/* Edit a search in one place: trip type, dates, cabin, infants. */
function SearchSheet({ value, onClose, onDone }) {
  const [t, setT] = useState(value);
  const [pickRet, setPickRet] = useState(false);
  const days = t.month === 'Jun' ? 30 : 31;
  const first = t.month === 'Jun' ? 2 : 1; // Mon=0: 1 Mar 2027 is a Monday, 1 Jun 2027 a Tuesday
  const today = t.month === 'Mar' ? 0 : 0;
  const pickDay = (d) => {
    buzz(HAPTIC.select);
    if (t.type === 'oneway' || !pickRet) { setT({ ...t, dep: d, ret: Math.max(d + 1, t.ret) }); if (t.type !== 'oneway') setPickRet(true); }
    else if (d <= t.dep) setT({ ...t, dep: d });
    else { setT({ ...t, ret: d }); setPickRet(false); }
  };
  return (
    <Sheet label="Edit search" onClose={onClose}>
      <h2 className="h2">Your search</h2>
      <div className="seg" role="radiogroup" aria-label="Trip type">
        {[['return', 'Return'], ['oneway', 'One way']].map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={t.type === id ? 'true' : 'false'} onClick={() => setT({ ...t, type: id })}>{label}</button>)}
      </div>
      <div className="spread">
        <span className="h3" style={{ fontSize: 15 }}>{t.type === 'oneway' ? `Leaving ${t.month} ${t.dep}` : pickRet ? `Leaving ${t.month} ${t.dep} · now pick the return` : `${t.month} ${t.dep} → ${t.month} ${t.ret} · ${t.ret - t.dep} nights`}</span>
        <span className="row" style={{ gap: 4 }}>
          {['Mar', 'Jun'].map((m) => <button key={m} type="button" className={'chip' + (t.month === m ? ' on' : '')} style={{ height: 30 }} onClick={() => setT({ ...t, month: m, dep: m === 'Jun' ? 20 : 9, ret: m === 'Jun' ? 27 : 15 })}>{m}</button>)}
        </span>
      </div>
      <div className="cal" role="grid" aria-label={`${t.month} 2027`}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="cal-h">{d}</span>)}
        {Array.from({ length: first - 1 + today }, (_, i) => <span key={'b' + i} />)}
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
          const inRange = t.type === 'return' && d > t.dep && d < t.ret;
          const end = d === t.dep || (t.type === 'return' && d === t.ret);
          return <button key={d} type="button" className={'cal-d' + (end ? ' end' : inRange ? ' in' : '')} aria-pressed={end ? 'true' : 'false'} onClick={() => pickDay(d)}>{d}</button>;
        })}
      </div>
      <label className="spread small" style={{ color: '#1e352d' }}><span>Flexible by 2 days either side</span><input type="checkbox" checked={t.flex} onChange={(e) => setT({ ...t, flex: e.target.checked })} /></label>
      <span className="eyebrow">Cabin</span>
      <div className="seg" role="radiogroup" aria-label="Cabin">
        {['Economy', 'Premium', 'Business'].map((c) => <button key={c} type="button" role="radio" aria-checked={t.cabin === c ? 'true' : 'false'} onClick={() => setT({ ...t, cabin: c })}>{c}</button>)}
      </div>
      <div className="spread">
        <span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Babies on a lap</span><span className="tiny">Under 2 on the day you fly back. One per adult.</span></span>
        <span className="row" style={{ gap: 10 }}>
          <button type="button" className="icon-btn" aria-label="One fewer baby" disabled={!t.infants} onClick={() => setT({ ...t, infants: t.infants - 1 })}>−</button>
          <span className="num h3" aria-live="polite">{t.infants}</span>
          <button type="button" className="icon-btn" aria-label="One more baby" disabled={t.infants >= 2} onClick={() => setT({ ...t, infants: t.infants + 1 })}>+</button>
        </span>
      </div>
      <button type="button" className="btn primary block" disabled={pickRet && t.type === 'return'} onClick={() => onDone(t)}>{pickRet && t.type === 'return' ? 'Pick a return date' : 'Search'}</button>
    </Sheet>
  );
}

function Ask1({ q, options, onPick }) {
  return (
    <div className="col rise" style={{ gap: 12 }}>
      <span className="h2">{q}</span>
      <div className="chips">{options.map(([label, v]) => <button key={label} type="button" className="chip" onClick={() => { buzz(HAPTIC.select); onPick(v); }}>{label}</button>)}</div>
    </div>
  );
}

/* ---------- stays ---------- */

function StayFlow({ setCta }) {
  const { s, push } = useStore();
  const [who] = useTravellers();
  const run = useSequence(2, 700, 'go');
  const [pick, setPick] = useState('galata');
  const rooms = who.length > 2 ? '2 connecting rooms' : '1 room';
  if (run < 2) return <Working lines={['Checking 120 places near your plans', 'Keeping rooms side by side']} step={run} />;
  const cur = HOTELS.find((h) => h.id === pick);
  const factor = who.length > 2 ? 1 : 0.55;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="col rise" style={{ gap: 2 }}>
        <h2 className="h2" style={{ fontSize: 24 }}>Three places you'd like.</h2>
        <span className="small">9–15 Mar · 6 nights · {rooms}</span>
      </div>
      {HOTELS.map((h, i) => {
        const on = h.id === pick;
        return (
          <button key={h.id} type="button" className={'card tap rise d' + (i + 1) + (on ? ' selected' : '')} style={{ padding: 0, overflow: 'hidden', gap: 0 }} aria-pressed={on ? 'true' : 'false'} onClick={() => { setPick(h.id); buzz(HAPTIC.select); }}>
            <span className="photo" style={{ height: 120, borderRadius: 0, display: 'block' }}>
              <img src="img/istanbul.jpg" alt="" style={{ objectPosition: ['30% 60%', '80% 70%', '50% 20%'][i], filter: i === 2 ? 'hue-rotate(-10deg) saturate(1.1)' : undefined }} />
              <span className="pill" style={{ position: 'absolute', top: 10, left: 10, background: on ? '#d9b77a' : 'rgba(255,253,249,.9)' }}>{h.label}</span>
              <span className="pill" style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(255,253,249,.9)' }}>{h.rating}</span>
            </span>
            <span className="col" style={{ padding: '12px 16px 14px', gap: 4 }}>
              <span className="spread"><span className="h3">{h.name}</span><span className="num" style={{ fontWeight: 600 }}>SAR {fmt(h.night * STAY_NIGHTS * factor)}</span></span>
              <span className="small">{h.area}</span>
              <span className="small" style={{ color: '#1e352d' }}>{h.note}</span>
            </span>
          </button>
        );
      })}
      <PublishCta setCta={setCta} cta={{ label: `Review · SAR ${fmt(cur.night * STAY_NIGHTS * factor)}`, onClick: () => push('pay', { kind: 'stay', hotelId: cur.id, travellers: who }) }} deps={[cur.id]} />
    </div>
  );
}

/* ---------- curated plans ---------- */

function PlanFlow({ query }) {
  const { push } = useStore();
  const step = useSequence(3, 650, 'go');
  const id = /istanbul/i.test(query) ? 'istanbul3' : 'alula2';
  const plan = PLANS[id];
  if (step < 3) return <Working lines={['Looking at what’s open that weekend', 'Fitting it around prayer times and the kids', 'Holding tables and tour slots']} step={step} />;
  return (
    <div className="col rise" style={{ gap: 12 }}>
      <span className="h2">We've planned it. Change anything you like.</span>
      <button type="button" className="photo" style={{ height: 220, border: 0, padding: 0 }} onClick={() => push('plan', { id })}>
        <img src={plan.img} alt="" /><span className="shade" />
        <span className="over" style={{ textAlign: 'left', gap: 4 }}>
          <span className="pill glass" style={{ alignSelf: 'flex-start' }}>{plan.days} days · {plan.plan.reduce((a, d) => a + d.stops.length, 0)} stops</span>
          <span className="display" style={{ fontSize: 30, color: '#fffdf9' }}>{plan.title}</span>
          <span className="small" style={{ color: 'rgba(255,253,249,.9)' }}>{plan.sub}</span>
        </span>
      </button>
      <button type="button" className="btn primary block" onClick={() => push('plan', { id })}>See the plan</button>
    </div>
  );
}

/* ---------- eSIM ---------- */

function EsimFlow() {
  const { s, push } = useStore();
  const n = s.trip ? s.trip.travellers.length : 1;
  return (
    <div className="col rise" style={{ gap: 12 }}>
      <h2 className="h2" style={{ fontSize: 24 }}>Data in Türkiye, ready on landing.</h2>
      <div className="card">
        <div className="spread"><span className="h3">10 GB for 7 days</span><span className="num" style={{ fontWeight: 600 }}>SAR 39 each</span></div>
        <span className="small">Installs on each phone before you fly. Turns on when you land. Your Saudi number keeps working for calls.</span>
      </div>
      <button type="button" className="btn primary block" onClick={() => push('pay', { kind: 'esim', count: n })}>Review · SAR {fmt(39 * n)}</button>
    </div>
  );
}

/* ---------- requests an agent completes ---------- */

const FORMS = {
  visa: [
    { k: 'where', q: 'Which visa?', options: ['Schengen', 'UK', 'United States', 'Somewhere else'] },
    { k: 'who', q: 'For who?', people: true },
    { k: 'when', q: 'When do you travel?', options: ['This summer', 'In the next 3 months', 'Not sure yet'] },
  ],
  umrah: [
    { k: 'when', q: 'When?', options: ['In Ramadan', 'After Eid', 'Pick dates later'] },
    { k: 'who', q: "Who’s going?", people: true },
    { k: 'stay', q: 'Where to stay in Makkah?', options: ['Steps from the Haram', 'Good value, short ride'] },
  ],
  car: [
    { k: 'where', q: 'Where?', options: ['Istanbul', 'Riyadh', 'Somewhere else'] },
    { k: 'size', q: 'What size?', options: ['7 seats for the family', 'Standard car'] },
    { k: 'days', q: 'For how long?', options: ['1 day', '3 days', 'The whole trip'] },
  ],
  food: [
    { k: 'where', q: 'Where?', options: ['Istanbul, near the hotel', 'Riyadh'] },
    { k: 'when', q: 'When?', options: ['Tonight', 'Tomorrow', 'First night of the trip'] },
    { k: 'pref', q: 'What matters?', options: ['Halal', 'Family seating', 'A view', 'Quiet'], multi: true },
  ],
  todo: [
    { k: 'pick', q: 'Pick what you like', options: ['Bosphorus dinner cruise', 'Princes’ Islands day trip', 'Topkapı Palace tickets', 'A food walk in Kadıköy'], multi: true },
    { k: 'who', q: "Who’s going?", people: true },
  ],
  general: [],
};

function RequestFlow({ kind, query, note, autoSend }) {
  const { s, set, go, push } = useStore();
  const form = FORMS[kind] || [];
  const [answers, setAnswers] = useState({});
  const [who, setWho] = useTravellers();
  const [sent, setSent] = useState(null);
  const firstOpen = form.findIndex((f) => !(f.people ? answers[f.k] : answers[f.k]?.length));
  const done = firstOpen === -1;

  const send = () => {
    const info = REQUEST_KINDS[kind];
    const detail = form.map((f) => (f.people ? who.map((id) => PEOPLE[id].name).join(', ') : [].concat(answers[f.k]).join(', '))).filter(Boolean).join(' · ') || query;
    const r = {
      id: 'r' + Date.now(), kind, short: info.short, title: kind === 'general' ? query : `${info.title}${answers.where ? ': ' + [].concat(answers.where)[0] : ''}`,
      detail, status: s.demo.offline ? 'queued' : 'sent', created: Date.now(),
      quote: { visa: 450, umrah: 6900, car: 980, food: 0, todo: 1140, general: 0 }[kind],
    };
    set((prev) => ({ requests: [...prev.requests, r] }));
    setSent(r);
    buzz(HAPTIC.success);
  };
  useEffect(() => { if (autoSend && !sent) send(); }, []);

  if (sent) return (
    <div className="col rise" style={{ gap: 14 }}>
      <div className="row"><span className="avatar green">F</span><div className="col" style={{ gap: 0 }}><span className="h3">{sent.status === 'queued' ? 'Saved. It sends when you’re back online.' : 'Sent to Mada.'}</span><span className="small">Usually within 2 hours, any time of day.</span></div></div>
      <div className="card well"><span className="h3">{sent.title}</span><span className="small">{sent.detail}</span></div>
      <button type="button" className="btn primary block" onClick={() => go('trips')}>See it in Trips</button>
    </div>
  );

  return (
    <div className="col" style={{ gap: 18 }}>
      {note && <div className="notice rise"><Icon name="doc" /><span className="grow small">{note}</span></div>}
      {kind === 'umrah' && <div className="notice warn rise"><Icon name="umrah" color="#7d5d27" /><span className="grow small">Every traveller needs their own Nusuk permit. We'll remind you to get them once dates are set.</span></div>}
      {form.map((f, i) => i > (done ? form.length : firstOpen) ? null : (
        <div key={f.k} className="col rise" style={{ gap: 10 }}>
          <span className="h2">{f.q}</span>
          {f.people ? (
            <>
              <TravellerChips value={who} onChange={setWho} />
              {!answers[f.k] && <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={() => { setAnswers({ ...answers, [f.k]: true }); buzz(HAPTIC.tap); }}>Done</button>}
              {kind === 'visa' && who.includes('lina') && <span className="small">For Lina we'll also need her iqama and an exit and re-entry visa.</span>}
            </>
          ) : (
            <div className="chips">
              {f.options.map((o) => {
                const cur = [].concat(answers[f.k] || []);
                const on = cur.includes(o);
                return <button key={o} type="button" className="chip" aria-pressed={on ? 'true' : 'false'} onClick={() => {
                  buzz(HAPTIC.select);
                  setAnswers({ ...answers, [f.k]: f.multi ? (on ? cur.filter((x) => x !== o) : [...cur, o]) : [o] });
                }}>{o}</button>;
              })}
            </div>
          )}
        </div>
      ))}
      {done && (
        <div className="col rise" style={{ gap: 10 }}>
          <div className="row small"><span className="avatar sm green">F</span>Mada will {kind === 'visa' ? 'find the earliest appointment and prepare the forms' : 'confirm everything'} and reply here.</div>
          <button type="button" className="btn primary block" onClick={send}>Send to Mada</button>
        </div>
      )}
    </div>
  );
}

function PublishCta({ setCta, cta, deps }) {
  useEffect(() => { setCta(cta); }, deps);
  useEffect(() => () => setCta(null), []);
  return <div style={{ height: 60 }} />;
}

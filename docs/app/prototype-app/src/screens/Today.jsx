import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, buzz, HAPTIC, PEOPLE, fmt, tripTravellers, passportIssue } from '../store.jsx';
import { Icon, Sun, Route, Sheet, Avatar, useTicker, AirlineMark } from '../ui.jsx';

const SERVICES = [
  { id: 'flight', label: 'Flights', icon: 'flight' },
  { id: 'stay', label: 'Stays', icon: 'stay' },
  { id: 'visa', label: 'Visas', icon: 'visa' },
  { id: 'umrah', label: 'Umrah', icon: 'umrah' },
  { id: 'car', label: 'Cars', icon: 'car' },
  { id: 'food', label: 'Tables', icon: 'food' },
  { id: 'todo', label: 'Things to do', icon: 'star' },
];

function dateLine() {
  const now = new Date();
  const wd = now.toLocaleDateString('en-GB', { weekday: 'long' });
  const dm = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  let hijri = '';
  try {
    hijri = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'long' }).formatToParts(now)
      .filter((p) => p.type === 'day' || p.type === 'month').map((p) => p.value).join(' ');
  } catch (e) { /* calendar unsupported */ }
  return wd + ' ' + dm + (hijri ? ' · ' + hijri : '');
}

function eidLine() {
  const now = new Date();
  try {
    const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric' });
    for (let i = 1; i < 400; i++) {
      const parts = f.formatToParts(new Date(now.getTime() + i * 86400000));
      const get = (t) => Number((parts.find((p) => p.type === t) || {}).value);
      if (get('month') === 10 && get('day') === 1) return i <= 13 ? `Eid is ${i} days away.` : `Eid is ${Math.round(i / 7)} weeks away.`;
    }
  } catch (e) { /* calendar unsupported */ }
  return 'Eid al-Fitr is coming.';
}

function weeksUntilTrip() {
  const d = new Date(2027, 2, 9);
  const days = Math.round((d - new Date()) / 86400000);
  if (days <= 0) return 'This week';
  if (days < 14) return `In ${days} days`;
  return `In ${Math.round(days / 7)} weeks`;
}

/* The countdown follows the moment of the trip, not the calendar: the day before always reads "Tomorrow". */
function tripWhen(s) {
  const dep = s.trip?.flight?.dep;
  if (s.phase === 'daybefore') return dep ? `Tomorrow · ${dep}` : 'Tomorrow';
  if (['travelday', 'delayed', 'cancelled'].includes(s.phase)) return dep ? `Today · ${dep}` : 'Today';
  return weeksUntilTrip();
}

const addMin = (hhmm, m) => {
  const [h, mi] = hhmm.split(':').map(Number);
  const t = (h * 60 + mi + m + 1440) % 1440;
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
};
const minsBetween = (a, b) => { const [h1, m1] = a.split(':').map(Number); const [h2, m2] = b.split(':').map(Number); return h2 * 60 + m2 - (h1 * 60 + m1); };

/* A ring that fills on arrival. */
function Ring({ done, total, size = 56, stroke = 6, dark }) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const full = done >= total;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="td-ring" style={{ '--c': C }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={dark ? 'rgba(255,253,249,.14)' : '#efe9e0'} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={full ? '#3f9a63' : '#d9b77a'} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - done / total)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .6s var(--ease), stroke .3s ease' }} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontFamily="Inter Tight, sans-serif" fontSize={size * 0.27} fontWeight="600" fill={dark ? '#fffdf9' : '#1e352d'}>{full ? '✓' : `${done}/${total}`}</text>
    </svg>
  );
}

/* A quiet way to reach the named agent during the trip. Not a big button: a line with his face. */
function FaisalLine({ note = 'Faisal is with you today.', dark }) {
  const { push } = useStore();
  return (
    <button type="button" className={'td-faisal rise' + (dark ? ' dark' : '')} onClick={() => { buzz(HAPTIC.tap); push('support', { about: 'Istanbul trip' }); }}>
      <span className="td-face">F<i /></span>
      <span className="grow col" style={{ gap: 0 }}><span className="td-faisal-note">{note}</span><span className="td-faisal-cta">Talk to Faisal</span></span>
      <Icon name="chevron" size={18} />
    </button>
  );
}

function Wash() {
  const h = new Date().getHours();
  let c = 'rgba(255,248,236,.9)';
  if (h >= 5 && h < 8) c = 'rgba(240,200,160,.55)';
  else if (h >= 15 && h < 18) c = 'rgba(217,183,122,.45)';
  else if (h >= 18 || h < 5) c = 'rgba(30,53,45,.2)';
  return <div aria-hidden="true" style={{ position: 'absolute', inset: '0 0 auto 0', height: 360, background: `linear-gradient(180deg, ${c} 0%, rgba(233,226,216,0) 100%)`, pointerEvents: 'none' }} />;
}

function Header() {
  const { s, push } = useStore();
  return (
    <div className="spread" style={{ paddingTop: 54 }}>
      <span className="small" style={{ fontWeight: 500 }}>{dateLine()}</span>
      <span className="row" style={{ gap: 8 }}>
        {!s.guest && (
          <button type="button" className="avatar td-bell" aria-label="Notifications" onClick={() => { buzz(HAPTIC.tap); push('inbox'); }}>
            <Icon name="bell" size={19} />
            {(s.inbox || []).some((n) => !n.read) && <i className="td-bell-dot" aria-hidden="true" />}
          </button>
        )}
        <button type="button" className="avatar" aria-label="Profile and settings" onClick={() => { buzz(HAPTIC.tap); push('profile'); }} style={{ border: 0, background: '#f6f2ec' }}>
          {s.user?.name?.charAt(0) || <Icon name="user" size={18} />}
        </button>
      </span>
    </div>
  );
}

function Composer({ title = 'Where to next?' }) {
  const { push } = useStore();
  return (
    <div className="card rise" style={{ padding: 18, gap: 14, boxShadow: '0 18px 40px -28px rgba(30,53,45,.5)' }}>
      <button type="button" className="spread" onClick={() => { buzz(HAPTIC.tap); push('ask', {}); }} style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }}>
        <span className="col">
          <span className="display" style={{ fontSize: 30 }}>{title}</span>
          <span className="small">A place, a date, who's going. Any way you like.</span>
        </span>
        <span className="icon-btn dark" aria-hidden="true"><Icon name="mic" color="#f6f2ec" size={20} /></span>
      </button>
      <div className="chips scrollx" style={{ margin: '0 -18px', padding: '0 18px' }}>
        {SERVICES.map((sv) => (
          <button key={sv.id} type="button" className="chip" onClick={() => { buzz(HAPTIC.tap); push('ask', { intent: sv.id }); }}>
            <Icon name={sv.icon} size={18} />{sv.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RequestsCard() {
  const { s, go } = useStore();
  const open = s.requests.filter((r) => r.status !== 'done');
  if (!open.length) return null;
  const r = open[0];
  return (
    <button type="button" className="card tap rise" onClick={() => go('trips')}>
      <div className="row">
        <span className="avatar green">F</span>
        <div className="grow col">
          <span className="h3">{r.status === 'quote' ? `Mada has an answer on your ${r.short}` : `Mada is working on your ${r.short}`}</span>
          <span className="small">{r.status === 'quote' ? 'Tap to see it' : r.status === 'queued' ? 'Sends when you’re back online' : 'Usually within 2 hours'}</span>
        </div>
        <Icon name="chevron" />
      </div>
    </button>
  );
}

/* ---------- states ---------- */

function Nothing() {
  const { s, push, go } = useStore();
  return (
    <>
      <div className="col" style={{ gap: 8 }}>
        <h1 className="display rise" style={{ fontSize: 46 }}>Nowhere planned yet.</h1>
        <p className="body rise d1">{eidLine()} {s.pastTrips.length ? 'Last Eid, the four of you went to Baku.' : ''}</p>
      </div>
      <Composer />
      <RequestsCard />
      {!s.passportSaved && (
        <button type="button" className="notice rise" style={{ border: 0, textAlign: 'left' }} onClick={() => go('wallet')}>
          <Icon name="visa" color="#7d5d27" />
          <span className="grow"><span className="h3">Add your passport</span><span className="small">One scan and we'll fill it in on every booking.</span></span>
          <Icon name="chevron" />
        </button>
      )}
      <div className="rise d2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
        <button type="button" className="photo" style={{ height: 220, border: 0, padding: 0, gridRow: 'span 2' }} onClick={() => push('plan', { id: 'alula2' })}>
          <img className="drift" src="img/alula.jpg" alt="Sandstone rocks in AlUla" />
          <span className="shade" />
          <span className="over" style={{ textAlign: 'left' }}>
            <span className="display" style={{ fontSize: 28, color: '#fffdf9' }}>AlUla</span>
            <span className="small" style={{ color: 'rgba(255,253,249,.9)' }}>Two days, planned for you. 1h 20m from Riyadh.</span>
          </span>
        </button>
        <button type="button" className="card tap focal" style={{ height: 104, justifyContent: 'space-between' }} onClick={() => go('circles')}>
          <span className="spread"><img src="img/istanbul.jpg" alt="" style={{ width: 34, height: 34, borderRadius: 999, objectFit: 'cover', border: '2px solid #d9b77a' }} /><Icon name="chevron" color="#d9b77a" /></span>
          <span className="col" style={{ gap: 0 }}><span className="h3">8 places saved</span><span className="tiny" style={{ color: '#c9c1b4' }}>Istanbul</span></span>
        </button>
        <button type="button" className="card tap" style={{ height: 104, justifyContent: 'space-between' }} onClick={() => go('circles')}>
          <span className="stack"><span className="avatar sm green">A</span><span className="avatar sm gold">N</span></span>
          <span className="col" style={{ gap: 0 }}><span className="h3">Abdullah is back</span><span className="tiny">He saved 3 places for you</span></span>
        </button>
      </div>
    </>
  );
}

function Guest() {
  const { set } = useStore();
  const [q, setQ] = useState('');
  const [tracked, setTracked] = useState(null);
  const ok = /^[a-z]{2}\s?\d{2,4}$/i.test(q.trim());
  return (
    <>
      <h1 className="display rise" style={{ fontSize: 44 }}>Track any flight.</h1>
      <form className="card rise d1" onSubmit={(e) => { e.preventDefault(); if (ok) { setTracked(q.trim().toUpperCase().replace(/\s/, '')); buzz(HAPTIC.success); } }}>
        <div className="field">
          <label htmlFor="track">Flight number</label>
          <input id="track" className="input" placeholder="SV263" value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="characters" />
          {q && !ok && <span className="err">Two letters and the number, like SV263.</span>}
        </div>
        <button type="submit" className="btn primary block" disabled={!ok}>Track it</button>
      </form>
      {tracked && (
        <div className="card rise">
          <div className="spread"><span className="code">{tracked}</span><span className="pill ok"><span className="dot pulse" style={{ background: '#2f7a4b' }} />On time</span></div>
          <Route dep="09:40" arr="13:55" from="RUH" to="IST" dur="4h 15m" />
          <span className="tiny">Live from the airline · we'll alert you if it changes</span>
        </div>
      )}
      <div className="card well rise d2">
        <span className="h3">Want us to book and look after the whole trip?</span>
        <span className="small">Sign in to book flights, stays and visas with a named agent behind every booking.</span>
        <button type="button" className="btn secondary" onClick={() => set({ onboarded: false, guest: false })}>Sign in</button>
      </div>
    </>
  );
}

/* ---------- weeks before ---------- */

function TripHero({ height = 230, children }) {
  const { s, push } = useStore();
  const t = s.trip;
  const f = t.flight;
  return (
    <button type="button" className="photo td-hero rise" style={{ height, border: 0, padding: 0, width: '100%' }} onClick={() => { buzz(HAPTIC.tap); push('trip'); }} aria-label={`Istanbul, ${tripWhen(s)}. Open the trip`}>
      <img className="drift" src="img/istanbul.jpg" alt="" />
      <span className="td-veil" />
      <span className="td-hero-top">
        <span className="pill glass td-when">{tripWhen(s)}</span>
        {f && <span className="pill glass"><span className="code">{f.from}</span> → <span className="code">{f.to}</span></span>}
      </span>
      <span className="over" style={{ textAlign: 'left' }}>
        <span className="display" style={{ fontSize: 44, color: '#fffdf9' }}>Istanbul</span>
        <span className="td-hero-sub">{t.datesLong} · {t.travellers.length} travellers{f ? ' · ' + f.airline : ''}</span>
        {children}
      </span>
    </button>
  );
}

function readinessItems(s) {
  const t = s.trip;
  const people = tripTravellers(s);
  const n = people.length;
  const problem = people.map((p) => ({ p, issue: passportIssue(s, p.id) })).find((x) => x.issue?.blocking);
  return [
    t.flight
      ? { id: 'flight', ok: true, k: 'Flights', v: `${t.flight.code} · seats together` }
      : { id: 'flight', ok: false, k: 'No flights yet', v: 'The stay is booked. Add flights when you’re ready.', fix: 'Find flights', act: 'flight' },
    t.stay?.status === 'cancelled'
      ? { id: 'stay', ok: false, k: 'No stay yet', v: 'The rooms were cancelled. We can find another.', fix: 'Find a stay', act: 'stay' }
      : !t.stay
        ? { id: 'stay', ok: false, k: 'No stay yet', v: 'Want rooms near Galata? We can hold some.', fix: 'Find a stay', act: 'stay' }
        : { id: 'stay', ok: true, k: 'Stay', v: `${t.stay.name} · ${t.stay.nights} nights` },
    problem
      ? { id: 'pass', ok: false, k: `${problem.p.name}'s passport`, v: problem.issue.text, fix: `Fix ${problem.p.name}'s passport`, act: 'passport', urgent: true }
      : { id: 'pass', ok: true, k: 'Passports', v: `All ${n} valid for Türkiye` },
    { id: 'entry', ok: true, k: 'Entry rules', v: `Checked for all ${n}` },
    s.todayEsim
      ? { id: 'data', ok: true, k: 'Data on landing', v: `eSIM for ${s.todayEsim.count} · installs before you fly` }
      : { id: 'data', ok: false, k: 'Data on landing', v: `Phones work the minute you land. SAR 39 each.`, fix: 'Set it up', act: 'esim' },
    t.pickup
      ? { id: 'pickup', ok: true, k: 'Airport pickups', v: 'Both ways · driver waits 60 min' }
      : { id: 'pickup', ok: false, k: 'No airport pickup', v: 'A driver at arrivals with your name.', fix: 'Add a pickup', act: 'car' },
  ];
}

function Readiness() {
  const { s, go, push } = useStore();
  const [esim, setEsim] = useState(false);
  const [open, setOpen] = useState(false);
  const items = readinessItems(s);
  const todo = items.filter((i) => !i.ok).sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
  const done = items.length - todo.length;
  const next = todo[0];
  const act = (it) => {
    buzz(HAPTIC.tap);
    if (it.act === 'passport') go('wallet');
    else if (it.act === 'esim') setEsim(true);
    else push('ask', { intent: it.act });
  };
  return (
    <div className="card rise d1 td-ready">
      <div className="row" style={{ gap: 14 }}>
        <Ring done={done} total={items.length} />
        <div className="grow col" style={{ gap: 2 }}>
          <span className="h3" style={{ fontSize: 18 }}>{next ? `${done} of ${items.length} ready` : 'All set.'}</span>
          <span className="small">{next ? (todo.length === 1 ? `${next.k} is the last thing.` : `${todo.length} things left. Each takes a minute.`) : 'Nothing needs you until the day before.'}</span>
        </div>
      </div>
      {todo.map((it, i) => (
        <div key={it.id} className={'td-todo' + (i === 0 ? ' first' : '') + (it.urgent ? ' wide' : '')}>
          <span className="td-todo-mark" aria-hidden="true">{it.urgent ? '!' : ''}</span>
          <span className="grow col" style={{ gap: 2 }}><span className="h3" style={{ fontSize: 15 }}>{it.k}</span><span className="tiny">{it.v}</span></span>
          <button type="button" className={'btn small ' + (i === 0 ? 'gold' : 'secondary td-soft')} onClick={() => act(it)}>{it.fix}</button>
        </div>
      ))}
      <button type="button" className="td-done-toggle" aria-expanded={open ? 'true' : 'false'} onClick={() => { buzz(HAPTIC.tap); setOpen(!open); }}>
        <span className="td-ticks" aria-hidden="true">{items.filter((i) => i.ok).map((i) => <i key={i.id}><Icon name="check" size={11} color="#fffdf9" width={3} /></i>)}</span>
        <span className="grow">{done} done: {items.filter((i) => i.ok).map((i) => i.k.toLowerCase()).join(', ')}</span>
        <Icon name="chevron" size={16} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .25s var(--ease)' }} />
      </button>
      {open && (
        <div className="col td-done-list" style={{ gap: 10 }}>
          {items.filter((i) => i.ok).map((it) => (
            <div key={it.id} className="row" style={{ alignItems: 'flex-start' }}><Icon name="check" size={18} color="#2f7a4b" width={2.4} /><span className="col" style={{ gap: 0 }}><span className="small" style={{ fontWeight: 600, color: '#1e352d' }}>{it.k}</span><span className="tiny">{it.v}</span></span></div>
          ))}
        </div>
      )}
      {esim && <EsimSheet onClose={() => setEsim(false)} />}
    </div>
  );
}

/* Data in Türkiye: pick who needs it and pay with the saved card. The eSIM installs itself before the flight. */
function EsimSheet({ onClose }) {
  const { s, set, toast } = useStore();
  const people = tripTravellers(s);
  const [who, setWho] = useState(people.map((p) => p.id));
  const [busy, setBusy] = useState(false);
  const card = s.cards.find((c) => c.id === s.defaultCard) || s.cards[0];
  const total = 39 * who.length;
  return (
    <Sheet label="Data in Türkiye" onClose={onClose}>
      <h2 className="h2">Data in Türkiye</h2>
      <p className="small" style={{ marginTop: -8 }}>10 GB each for 7 days. It installs tonight and switches on when you land. Refundable until it’s installed.</p>
      <div className="col" style={{ gap: 8 }}>
        {people.map((p) => {
          const on = who.includes(p.id);
          return (
            <button key={p.id} type="button" className={'person-row' + (on ? ' on' : '')} aria-pressed={on ? 'true' : 'false'} onClick={() => { buzz(HAPTIC.select); setWho(on ? who.filter((x) => x !== p.id) : [...who, p.id]); }}>
              <Avatar person={p} size="sm" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{p.name}</span><span className="tiny">{p.role}</span></span>
              <span className={'tickbox' + (on ? ' on' : '')}>{on && <Icon name="check" size={14} color="#fffdf9" width={2.6} />}</span>
            </button>
          );
        })}
      </div>
      {s.demo.offline && <div className="notice warn"><span className="grow"><span className="h3">You’re offline.</span><span className="small">Connect to pay. Everything else is saved.</span></span></div>}
      <button type="button" className="btn primary block" disabled={!who.length || busy || s.demo.offline} onClick={() => {
        setBusy(true);
        setTimeout(() => {
          set({ todayEsim: { count: who.length, who } });
          buzz(HAPTIC.success);
          toast('Done. The eSIMs install before you fly.');
          onClose();
        }, 900);
      }}>{busy ? <span className="spinner light" /> : `Pay SAR ${fmt(total)} · ${card?.label || 'card'}`}</button>
    </Sheet>
  );
}

const NEXT_UP = [
  { id: 'cruise', title: 'Bosphorus dinner cruise', note: 'Hessa asked in the group. 4 of 6 voted yes.', img: 'img/istanbul.jpg', pos: '85% 40%', tag: 'Fri evening', go: ['group', { id: 'eid' }] },
  { id: 'kids', title: 'Three easy days with kids', note: 'Palaces, ferries and the best künefe.', img: 'img/istanbul.jpg', pos: '30% 60%', tag: 'A plan for you', go: ['plan', { id: 'istanbul3' }] },
  { id: 'table', title: 'A table in Karaköy', note: 'Halal, family seating, by the water.', img: 'img/istanbul.jpg', pos: '60% 85%', tag: 'Any night', go: ['ask', { intent: 'food' }] },
];

function Booked() {
  const { s, push, go } = useStore();
  return (
    <>
      <TripHero />
      <Readiness />
      <RequestsCard />
      <div className="spread" style={{ marginTop: 6 }}>
        <h2 className="h2" style={{ fontSize: 22 }}>Next for Istanbul</h2>
      </div>
      <div className="td-rail rise d2" role="list">
        {NEXT_UP.map((c) => (
          <button key={c.id} type="button" role="listitem" className="photo td-tile" onClick={() => { buzz(HAPTIC.tap); push(c.go[0], c.go[1]); }}>
            <img src={c.img} alt="" style={{ objectPosition: c.pos }} />
            <span className="td-veil" />
            <span className="pill glass" style={{ position: 'absolute', top: 12, left: 12 }}>{c.tag}</span>
            <span className="over" style={{ textAlign: 'left' }}>
              <span className="h3" style={{ color: '#fffdf9', fontSize: 17 }}>{c.title}</span>
              <span className="td-hero-sub" style={{ fontSize: 13 }}>{c.note}</span>
            </span>
          </button>
        ))}
      </div>
      <button type="button" className="card tap td-circle rise d3" onClick={() => { buzz(HAPTIC.tap); go('circles'); }}>
        <span className="stack"><span className="avatar sm gold">N</span><span className="avatar sm green">A</span></span>
        <span className="grow col" style={{ gap: 2 }}><span className="h3" style={{ fontSize: 15 }}>Noor was in Istanbul in May</span><span className="tiny">She left 8 tips for families. Abdullah saved 3 for you.</span></span>
        <Icon name="chevron" />
      </button>
    </>
  );
}

/* ---------- the day before ---------- */

const PICKUP_TIMES = ['06:45', '07:05', '07:20', '07:35'];
const BAG_DROP_CLOSES = '08:40';

function packList(s) {
  const people = tripTravellers(s);
  const n = people.length || 4;
  const kids = people.filter((p) => /daughter|son/i.test(p.role || '')).map((p) => p.name);
  const problem = people.map((p) => ({ p, issue: passportIssue(s, p.id) })).find((x) => x.issue?.blocking);
  return [
    { id: 'passports', t: `Passports ×${n}`, sub: problem ? `${problem.p.name}'s needs fixing first.` : `All ${n} valid for Türkiye. Checked against the Wallet.`, people, problem },
    { id: 'chargers', t: 'Chargers and a power bank', sub: 'Power banks go in hand luggage.' },
    { id: 'adapter', t: 'Plug adapter, type F', sub: 'Round two-pin plugs in Türkiye, 230 V.' },
    { id: 'umbrella', t: 'An umbrella', sub: 'Light rain when you land.' },
    { id: 'layer', t: 'A warm layer each', sub: '14° in Istanbul. About 28° here.' },
    { id: 'mat', t: 'Prayer mat', sub: 'The hotel is 2 minutes from a mosque.' },
    ...(kids.length ? [{ id: 'snacks', t: `Snacks for ${kids.join(' and ')}`, sub: '4h 15m in the air.' }] : []),
    { id: 'meds', t: 'Medicines', sub: 'In hand luggage, with the prescriptions.' },
    ...(s.todayPackExtra || []).map((x) => ({ id: x.id, t: x.t, sub: 'Added by you', own: true })),
  ];
}

function PackingList({ innerRef }) {
  const { s, set, go } = useStore();
  const [draft, setDraft] = useState('');
  const items = packList(s);
  const packed = (s.todayPacked || []).filter((id) => items.some((i) => i.id === id));
  const all = packed.length === items.length;
  const toggle = (id) => {
    const on = packed.includes(id);
    const nextPacked = on ? packed.filter((x) => x !== id) : [...packed, id];
    buzz(!on && nextPacked.length === items.length ? HAPTIC.success : HAPTIC.select);
    set({ todayPacked: nextPacked });
  };
  return (
    <div className="card rise td-pack" ref={innerRef}>
      <div className="row" style={{ gap: 14 }}>
        <Ring done={packed.length} total={items.length} size={52} />
        <div className="grow col" style={{ gap: 2 }}>
          <span className="h3" style={{ fontSize: 18 }}>{all ? 'Packed. Sleep well.' : 'Pack tonight'}</span>
          <span className="small">{all ? 'Everything’s in. We’ll handle the morning.' : `${packed.length} of ${items.length} in the bags. Ticks stay on this phone.`}</span>
        </div>
      </div>
      <div className="col" style={{ gap: 2 }} role="list">
        {items.map((it) => {
          const on = packed.includes(it.id);
          return (
            <div key={it.id} role="listitem" className={'td-pack-item' + (on ? ' on' : '')}>
              <button type="button" className="td-pack-tap" role="checkbox" aria-checked={on ? 'true' : 'false'} onClick={() => toggle(it.id)}>
                <span className={'td-check' + (on ? ' on' : '')} aria-hidden="true">{on && <Icon name="check" size={14} color="#fffdf9" width={2.8} />}</span>
                <span className="grow col" style={{ gap: 1 }}>
                  <span className="td-pack-t">{it.t}</span>
                  <span className={'tiny' + (it.problem ? ' td-warn' : '')}>{it.sub}</span>
                </span>
                {it.people && <span className="stack td-mini-stack" aria-hidden="true">{it.people.slice(0, 4).map((p) => <span key={p.id} className={'avatar sm' + (it.problem?.p.id === p.id ? ' td-bad' : '')}>{p.initial}</span>)}</span>}
              </button>
              {it.problem && <button type="button" className="btn gold small" style={{ alignSelf: 'flex-start', marginLeft: 38 }} onClick={() => go('wallet')}>Fix {it.problem.p.name}'s passport</button>}
              {it.own && <button type="button" className="td-x" aria-label={`Remove ${it.t}`} onClick={() => { buzz(HAPTIC.tap); set((p) => ({ todayPackExtra: (p.todayPackExtra || []).filter((x) => x.id !== it.id), todayPacked: (p.todayPacked || []).filter((x) => x !== it.id) })); }}><Icon name="close" size={14} /></button>}
            </div>
          );
        })}
      </div>
      <form className="td-add" onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (!t) return; buzz(HAPTIC.tap); set((p) => ({ todayPackExtra: [...(p.todayPackExtra || []), { id: 'x' + Date.now(), t: t.charAt(0).toUpperCase() + t.slice(1) }] })); setDraft(''); }}>
        <Icon name="plus" size={18} />
        <label htmlFor="td-pack-add" className="sr">Add something to pack</label>
        <input id="td-pack-add" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add something to pack" autoComplete="off" />
        {draft.trim() && <button type="submit" className="btn primary small" style={{ height: 34 }}>Add</button>}
      </form>
    </div>
  );
}

function PickupSheet({ onClose }) {
  const { s, set, toast } = useStore();
  const cur = s.todayPickup || '07:05';
  const [pick, setPick] = useState(cur);
  const at = addMin(pick, 35);
  const spare = minsBetween(at, BAG_DROP_CLOSES);
  return (
    <Sheet label="Change pickup time" onClose={onClose}>
      <h2 className="h2">When should Khalid come?</h2>
      <p className="small" style={{ marginTop: -8 }}>31 min to King Khalid at that hour. Bag drop for {s.trip.flight?.code || 'your flight'} closes at {BAG_DROP_CLOSES}.</p>
      <div className="col" style={{ gap: 8 }} role="radiogroup" aria-label="Pickup time">
        {PICKUP_TIMES.map((t) => {
          const sp = minsBetween(addMin(t, 35), BAG_DROP_CLOSES);
          return (
            <button key={t} type="button" role="radio" aria-checked={pick === t ? 'true' : 'false'} className={'td-time' + (pick === t ? ' on' : '')} onClick={() => { buzz(HAPTIC.select); setPick(t); }}>
              <span className="num td-time-t">{t}</span>
              <span className="grow col" style={{ gap: 0 }}><span className="small" style={{ fontWeight: 600, color: '#1e352d' }}>At T4 by {addMin(t, 35)}</span><span className="tiny">{sp >= 50 ? `${sp} min to spare` : `Only ${sp} min before bag drop closes`}{t === '07:05' ? ' · what we suggest' : ''}</span></span>
              {pick === t && <Icon name="check" size={18} width={2.4} />}
            </button>
          );
        })}
      </div>
      <span className="tiny">We’ll wake your phone at {addMin(pick, -45)}.</span>
      <button type="button" className="btn primary block" disabled={pick === cur} onClick={() => { set({ todayPickup: pick }); buzz(HAPTIC.success); toast(`We’ve told Khalid. Pickup at ${pick}.`); onClose(); }}>{pick === cur ? `Pickup stays at ${cur}` : `Move pickup to ${pick}`}</button>
      {spare < 50 && <span className="small td-warn">That’s tight on a weekday morning. Faisal would go earlier.</span>}
    </Sheet>
  );
}

function DayBefore() {
  const { s, go } = useStore();
  const t = s.trip;
  const f = t.flight;
  const [sheet, setSheet] = useState(null);
  const packRef = useRef(null);
  const pickup = s.todayPickup || '07:05';
  const items = packList(s);
  const packed = (s.todayPacked || []).filter((id) => items.some((i) => i.id === id)).length;
  const allPacked = packed === items.length;
  const plan = [
    { k: 'tonight', time: 'Tonight', t: allPacked ? 'Packed' : 'Pack the bags', sub: allPacked ? 'All in. Nothing left for the morning.' : `${packed} of ${items.length} done`, state: allPacked ? 'done' : 'now', act: allPacked ? null : ['See the list', () => packRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })] },
    { k: 'sleep', time: '22:30', t: 'Lights out', sub: `${Math.round(minsBetween('22:30', '24:00') / 60 + minsBetween('00:00', addMin(pickup, -45)) / 60)} hours before the alarm` },
    { k: 'wake', time: addMin(pickup, -45), t: 'We wake your phone', sub: 'A soft alarm, with the weather and the drive time' },
    { k: 'pickup', time: pickup, t: 'Khalid at your door', sub: 'Grey Lexus ES · he waits 10 min', act: ['Change pickup time', () => setSheet('pickup')] },
    { k: 'airport', time: addMin(pickup, 35), t: 'King Khalid, Terminal 4', sub: `Bag drop closes ${BAG_DROP_CLOSES}. You’re already checked in.` },
    { k: 'board', time: '08:55', t: 'Boarding, gate B12', sub: 'Seats 3A–3D, together' },
    { k: 'fly', time: f?.dep || '09:40', t: `${f?.code || 'Your flight'} to Istanbul`, sub: `Lands ${f?.arr || '13:55'}, same time as Riyadh` },
  ];
  return (
    <>
      <div className="col rise" style={{ gap: 6 }}>
        <span className="row td-status"><span className="dot pulse" style={{ background: '#2f7a4b' }} />{allPacked ? 'All set for tomorrow.' : 'All set, once you’ve packed.'}</span>
      </div>
      <TripHero height={210}>
        <span className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          <span className="pill glass"><Icon name="check" size={13} color="#d9b77a" width={2.6} />Checked in</span>
          <span className="pill glass">Seats 3A–3D</span>
          <span className="pill glass">{f?.bags || '2 × 23 kg'} each</span>
        </span>
      </TripHero>

      <div className="card rise d1 td-plan">
        <span className="eyebrow">The plan</span>
        <div className="td-timeline">
          {plan.map((p, i) => (
            <React.Fragment key={p.k}>
              {i === 1 && <span className="td-split" aria-hidden="true" />}
              {i === 3 && <span className="td-daymark">Tomorrow, Tue 9 Mar</span>}
              <div className={'td-tl ' + (p.state || 'todo')}>
                <span className="td-tl-time num">{p.time}</span>
                <span className="td-tl-rail" aria-hidden="true"><i /></span>
                <span className="grow col td-tl-body">
                  <span className="td-tl-t">{p.t}</span>
                  <span className="tiny">{p.sub}</span>
                  {p.act && <button type="button" className="td-link" onClick={() => { buzz(HAPTIC.tap); p.act[1](); }}>{p.act[0]}</button>}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="td-bento rise d2">
        <div className="td-weather" aria-label="Istanbul when you land: 14 degrees and light rain">
          {[14, 40, 66, 92, 118, 144].map((x, i) => <span key={x} className="td-drop" aria-hidden="true" style={{ left: x, animationDelay: `${i * 0.23}s` }} />)}
          <span className="tiny" style={{ color: '#3f4f48', position: 'relative' }}>Istanbul on landing</span>
          <span className="td-temp num">14°</span>
          <span className="small" style={{ color: '#1e352d', position: 'relative', fontWeight: 500 }}>Light rain. Dry by Thursday.</span>
        </div>
        <button type="button" className="td-oncall" onClick={() => { buzz(HAPTIC.tap); go('wallet'); }}>
          <span className="row" style={{ gap: 8 }}><Icon name="doc" size={20} color="#d9b77a" /><span className="tiny" style={{ color: '#c9c1b4' }}>4 boarding passes</span></span>
          <span className="h3" style={{ fontSize: 16, color: '#fffdf9' }}>Ready offline</span>
          <span className="td-link light">Open passes</span>
        </button>
      </div>

      <PackingList innerRef={packRef} />
      <FaisalLine note="Faisal is on call tonight." />
      {sheet === 'pickup' && <PickupSheet onClose={() => setSheet(null)} />}
    </>
  );
}

function LeaveCard() {
  const { s } = useStore();
  const start = useRef(Date.now());
  useTicker(1000);
  const mins = Math.max(0, Math.ceil((42 * 60000 - (Date.now() - start.current)) / 60000));
  return (
    <div className="photo rise" style={{ height: 184 }}>
      <img className="drift" src="img/riyadh.jpg" alt="Riyadh skyline at dawn" style={{ objectPosition: '50% 35%' }} />
      <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(100deg, rgba(15,26,22,.86) 0%, rgba(15,26,22,.5) 55%, rgba(15,26,22,.12) 100%)' }} />
      <div className="over" style={{ justifyContent: 'space-between', padding: '16px 16px 14px 20px' }}>
        <span className="small" style={{ color: 'rgba(255,253,249,.85)', fontWeight: 500 }}>Leave home in</span>
        <span className="row" style={{ alignItems: 'baseline', gap: 10 }}>
          <span className="num" style={{ fontSize: 88, fontWeight: 600, lineHeight: 0.8, letterSpacing: '-0.05em' }}>{mins}</span>
          <span style={{ fontSize: 26, fontWeight: 600 }}>min</span>
        </span>
        <span className="row" style={{ alignSelf: 'flex-start', height: 38, padding: '0 14px 0 6px', borderRadius: 999, background: 'rgba(255,253,249,.16)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid rgba(255,253,249,.18)', fontSize: 13, fontWeight: 500, gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 999, background: '#d9b77a', display: 'grid', placeItems: 'center' }}><Icon name="car" size={16} color="#1e352d" /></span>
          Khalid at {s.todayPickup || '07:05'} · 31 min to King Khalid
        </span>
      </div>
    </div>
  );
}

function FlightCard({ predicted }) {
  const { s, push, banner } = useStore();
  const f = s.trip.flight;
  const [gate, setGate] = useState(s.trip.gate || 'B12');
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (s.phase !== 'travelday' || s.trip.gate === 'C4' || s.trip.rebooked) return undefined;
    const t = setTimeout(() => {
      setGate('C4'); setChanged(true);
      banner({ title: 'Gate changed to C4', body: `${f.code} now boards from C4. It's a 6-minute walk.` });
    }, 6000);
    return () => clearTimeout(t);
  }, [s.phase]);
  return (
    <div className="card rise d1">
      <div className="spread"><span className="row" style={{ gap: 10 }}><AirlineMark flight={f} size={32} /><span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{f.airline}</span><span className="tiny"><span className="code">{f.code}</span> · {f.date}</span></span></span>{predicted ? <span className="pill" style={{ background: '#f3e6c9', color: '#7d5d27' }}>May leave late</span> : <span className="pill ok">On time</span>}</div>
      <Route dep={f.dep} arr={f.arr} from={f.from} to={f.to} dur={f.dur} big />
      <div className="cells">
        <div className="cell" style={changed ? { animation: 'flash 2.4s ease both' } : null}>
          <span className="k">Gate</span>
          <span className="v" key={gate} style={changed ? { animation: 'in .5s var(--ease) both' } : null}>{s.trip.rebooked ? 'D7' : gate}</span>
        </div>
        <div className="cell"><span className="k">Boards</span><span className="v">{s.trip.rebooked ? '09:45' : '08:55'}</span></div>
        <div className="cell"><span className="k">Seats</span><span className="v">3A–D</span></div>
      </div>
      <div className="row tiny">
        <span className="dot pulse" style={{ background: s.demo.offline ? '#b98f4a' : '#2f7a4b', width: 6, height: 6 }} />
        {s.demo.offline ? 'Offline · last update from the airline at 06:41' : changed ? 'Gate changed to C4 · 6-minute walk · live from the airline' : 'Live from the airline · updated just now'}
      </div>
      {predicted && (
        <div className="row rise" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div className="grow col" style={{ gap: 2 }}>
            <span className="h3" style={{ fontSize: 15 }}>The plane coming from Cairo is late.</span>
            <span className="tiny">Mada predicts a delay. Saudia hasn't said yet.</span>
          </div>
          <button type="button" className="btn gold small" style={{ whiteSpace: 'nowrap' }} onClick={() => push('disruption', { kind: 'delay' })}>See the plan</button>
        </div>
      )}
    </div>
  );
}

/* While a delay is only predicted: what we're watching, and what happens next, so nobody has to refresh. */
function DelayWatch() {
  const { s } = useStore();
  return (
    <div className="card rise d2">
      <span className="eyebrow">What happens next</span>
      <div className="td-steps">
        {[
          ['done', 'Seats held on the 10:25', 'For all ' + (s.trip.travellers.length || 4) + ', together. No cost to hold.'],
          ['now', 'Watching the plane from Cairo', 'It should land in Riyadh by 08:30. We check every 5 minutes.'],
          ['todo', 'Khalid hears from us', 'If you move flights, he comes later. Stay home until then.'],
        ].map(([st, h, sub]) => (
          <div key={h} className={'td-step ' + st + (st === 'now' ? ' now' : '')}>
            <span className="td-step-mark" aria-hidden="true">{st === 'done' ? <Icon name="check" size={13} color="#fffdf9" width={2.8} /> : <i />}</span>
            <span className="grow col" style={{ gap: 2 }}><span className="td-step-t">{h}</span><span className="tiny">{sub}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TravelDay({ predicted }) {
  const { s, go } = useStore();
  return (
    <>
      <div className="row rise" style={{ fontSize: 15, fontWeight: 600, color: predicted ? '#7d5d27' : '#2f7a4b' }}>
        <span className="dot pulse" style={{ background: predicted ? '#b98f4a' : '#2f7a4b' }} />
        {predicted ? 'One thing to look at.' : s.trip.rebooked ? 'All set on the new flight.' : 'All set.'}
      </div>
      {!predicted && <LeaveCard />}
      <FlightCard predicted={predicted} />
      {!predicted && (
        <div className="rise d2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
          <div className="card" style={{ height: 96, justifyContent: 'space-between', boxSizing: 'border-box' }}>
            <span className="row"><span className="avatar sm green">K</span><span className="h3" style={{ fontSize: 14 }}>Khalid · {s.todayPickup || '07:05'}</span></span>
            <span className="tiny">Grey Lexus ES. He'll wait at your door.</span>
          </div>
          <div className="card" style={{ height: 96, justifyContent: 'space-between', boxSizing: 'border-box', background: '#e7ecef', position: 'relative', overflow: 'hidden' }}>
            {[22, 54, 88, 118, 146].map((x, i) => <span key={x} aria-hidden="true" style={{ position: 'absolute', left: x, top: 4, width: 1.5, height: 14, borderRadius: 2, background: '#6f8fa6', animation: `rain 1.4s ${i * 0.3}s linear infinite` }} />)}
            <span className="h3" style={{ fontSize: 14, position: 'relative' }}>Istanbul · 14°</span>
            <span className="tiny" style={{ position: 'relative', color: '#3f4f48' }}>Light rain. Pack the umbrella.</span>
          </div>
        </div>
      )}
      {!predicted && <button type="button" className="btn primary block rise d3" onClick={() => go('wallet')}><Icon name="doc" color="#f6f2ec" size={20} />Boarding passes</button>}
      {predicted && <DelayWatch />}
      <FaisalLine note={predicted ? 'Faisal is watching the plane from Cairo.' : 'Faisal is with you today.'} />
    </>
  );
}

function Cancelled() {
  const { s, push } = useStore();
  return (
    <>
    <div className="card focal rise" style={{ padding: 22, gap: 14 }}>
      <span className="eyebrow" style={{ color: '#d9b77a' }}>{s.trip.flight.code} · Tue 9 Mar</span>
      <h1 className="h1" style={{ color: '#f6f2ec' }}>Saudia cancelled your flight.</h1>
      <p className="body" style={{ color: '#d6cfc3' }}>You're owed a full refund. We're already holding seats on the next flight for all {s.trip.travellers.length} of you.</p>
      <button type="button" className="btn gold block" onClick={() => push('disruption', { kind: 'cancel' })}>See your options</button>
    </div>
      <div className="card rise d1">
        <span className="eyebrow">Already taken care of</span>
        {[
          ['stay', 'The hotel knows', 'Rooms near Galata Tower are held, even if you land late.'],
          ['car', 'Pickups move with you', 'Khalid and Ahmet follow whichever flight you choose.'],
          ['refund', 'Or your money back', `SAR ${fmt(s.trip.flightPrice || 0)} for the flights, to your card in about 7 days.`],
        ].map(([ic, h, sub]) => (
          <div key={h} className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <span className="td-ic"><Icon name={ic} size={18} /></span>
            <span className="col" style={{ gap: 1 }}><span className="small" style={{ fontWeight: 600, color: '#1e352d' }}>{h}</span><span className="tiny">{sub}</span></span>
          </div>
        ))}
      </div>
      <FaisalLine note="Faisal is already on the phone with Saudia." />
    </>
  );
}

const PICKS = [
  { id: 'k1', title: 'Künefe near Galata Tower', note: 'Noor’s tip. Go before 8, it sells out.', img: 'img/istanbul.jpg', pos: '50% 70%', tag: 'Dessert · 4 min walk' },
  { id: 'k2', title: 'Sunset from the Galata Bridge', note: 'Fishermen, ferries and the old city in gold.', img: 'img/istanbul.jpg', pos: '20% 40%', tag: 'Free · 10 min walk' },
  { id: 'k3', title: 'Dinner with a Bosphorus view', note: 'Halal, family seating, table for 4 at 20:00.', img: 'img/istanbul.jpg', pos: '80% 30%', tag: 'Dinner · 15 min drive' },
  { id: 'k4', title: 'An early night', note: 'Room service, and a slow start tomorrow.', img: 'img/clouds.jpg', pos: '50% 50%', tag: 'Rest' },
];
const WORDS = [
  ['Hello', 'Merhaba', 'mer-ha-ba'],
  ['Thank you', 'Teşekkürler', 'teh-shek-kur-ler'],
  ['Please', 'Lütfen', 'lewt-fen'],
  ['The bill, please', 'Hesap, lütfen', 'heh-sap lewt-fen'],
  ['Where is…?', '… nerede?', 'neh-reh-deh'],
];

function SwipeDeck() {
  const { s, set, buzz: _b } = useStore();
  const picks = s.inflightPicks || [];
  const [i, setI] = useState(0);
  const [dx, setDx] = useState(0);
  const [drag, setDrag] = useState(null);
  const done = i >= PICKS.length;
  const decide = (yes) => {
    const card = PICKS[i];
    buzz(yes ? HAPTIC.select : HAPTIC.tap);
    if (yes) set((p) => ({ inflightPicks: [...(p.inflightPicks || []), card.id] }));
    setDx(yes ? 420 : -420);
    setTimeout(() => { setI((n) => n + 1); setDx(0); }, 260);
  };
  if (done) {
    const chosen = PICKS.filter((p) => picks.includes(p.id));
    return (
      <div className="card focal rise" style={{ gap: 8 }}>
        <span className="h3">{chosen.length ? `Your first evening: ${chosen.length} ${chosen.length === 1 ? 'pick' : 'picks'}.` : 'A free evening it is.'}</span>
        <span className="small">{chosen.length ? 'Saved on this phone. We’ll book them the moment you land and have signal.' : 'Nothing booked. You can always ask once you’re there.'}</span>
        {chosen.map((c) => <span key={c.id} className="row small" style={{ color: '#e9e2d8' }}><Icon name="check" size={16} color="#d9b77a" width={2.4} />{c.title}</span>)}
        <button type="button" className="link" style={{ color: '#d9b77a', alignSelf: 'flex-start', padding: 0 }} onClick={() => { set({ inflightPicks: [] }); setI(0); }}>Start over</button>
      </div>
    );
  }
  const card = PICKS[i];
  const next = PICKS[i + 1];
  const rot = dx / 18;
  return (
    <div className="col" style={{ gap: 12 }}>
      <div style={{ position: 'relative', height: 300 }}>
        {next && (
          <div className="story" style={{ position: 'absolute', inset: 0, minHeight: 0, transform: 'scale(.95) translateY(10px)', opacity: 0.7 }}>
            <img className="bg" src={next.img} alt="" style={{ objectPosition: next.pos }} /><span className="veil" />
          </div>
        )}
        <div className="story" role="group" aria-label={card.title}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(e.clientX); }}
          onPointerMove={(e) => { if (drag !== null) setDx(e.clientX - drag); }}
          onPointerUp={() => { if (drag === null) return; setDrag(null); if (dx > 90) decide(true); else if (dx < -90) decide(false); else setDx(0); }}
          style={{ position: 'absolute', inset: 0, minHeight: 0, touchAction: 'pan-y', cursor: 'grab', transform: `translateX(${dx}px) rotate(${rot}deg)`, transition: drag !== null ? 'none' : 'transform .3s var(--ease)' }}>
          <img className="bg" src={card.img} alt="" style={{ objectPosition: card.pos }} draggable="false" />
          <span className="veil" />
          <span className="top"><span className="pill glass">{card.tag}</span><span className="pill glass">{i + 1} of {PICKS.length}</span></span>
          {dx > 30 && <span className="pill" style={{ position: 'absolute', top: 60, left: 18, background: '#d9b77a', color: '#1e352d', transform: 'rotate(-8deg)' }}>Yes, book it</span>}
          {dx < -30 && <span className="pill" style={{ position: 'absolute', top: 60, right: 18, background: 'rgba(255,253,249,.9)', color: '#1e352d', transform: 'rotate(8deg)' }}>Skip</span>}
          <div className="body"><p className="quote">{card.title}</p><span className="small" style={{ color: 'rgba(255,253,249,.88)' }}>{card.note}</span></div>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'center', gap: 16 }}>
        <button type="button" className="icon-btn" aria-label="Skip" style={{ width: 56, height: 56 }} onClick={() => decide(false)}><Icon name="close" /></button>
        <button type="button" className="icon-btn dark" aria-label="Yes, book it when I land" style={{ width: 56, height: 56 }} onClick={() => decide(true)}><Icon name="check" color="#d9b77a" width={2.4} /></button>
      </div>
    </div>
  );
}

function Flashcards() {
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const w = WORDS[i];
  return (
    <div className="col" style={{ gap: 10 }}>
      <button type="button" onClick={() => { setFlip(!flip); buzz(HAPTIC.tap); }} aria-label={flip ? `${w[1]}, said ${w[2]}` : `${w[0]}. Tap to see it in Turkish`}
        style={{ height: 150, border: 0, borderRadius: 24, padding: 18, background: flip ? '#1e352d' : '#fffdf9', color: flip ? '#f6f2ec' : '#1e352d', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'background .3s ease, color .3s ease, transform .4s var(--ease)', transform: flip ? 'rotateX(360deg)' : 'none' }}>
        <span className="tiny" style={{ color: flip ? '#d9b77a' : undefined }}>{flip ? 'In Turkish' : 'In English'}</span>
        <span className="display" style={{ fontSize: 34 }}>{flip ? w[1] : w[0]}</span>
        <span className="small" style={{ color: flip ? '#c9c1b4' : undefined }}>{flip ? `say “${w[2]}”` : 'Tap to flip'}</span>
      </button>
      <div className="spread">
        <span className="row" style={{ gap: 6 }}>{WORDS.map((_, k) => <span key={k} className="dot" style={{ background: k === i ? '#1e352d' : '#d6cec2' }} />)}</span>
        <button type="button" className="btn secondary small" onClick={() => { setI((i + 1) % WORDS.length); setFlip(false); buzz(HAPTIC.tap); }}>{i === WORDS.length - 1 ? 'Start again' : 'Next word'}</button>
      </div>
    </div>
  );
}

function InAir() {
  const { s } = useStore();
  const [sheet, setSheet] = useState(false);
  const start = useRef(Date.now());
  useTicker(1000);
  const left = Math.max(0, 125 * 60 - Math.floor((Date.now() - start.current) / 1000));
  const progress = 1 - left / (255 * 60);
  const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60);
  const t = Math.min(1, Math.max(0, progress));
  const x = 20 + t * 300, y = 120 - Math.sin(t * Math.PI) * 80;
  return (
    <>
      <div className="story rise" style={{ minHeight: 0, height: 290, background: 'linear-gradient(170deg, #0e1c2b 0%, #1e352d 70%)' }}>
        <img className="bg" src="img/clouds.jpg" alt="" style={{ opacity: 0.45 }} />
        <span className="veil" />
        <svg viewBox="0 0 340 150" width="100%" height="150" aria-hidden="true" style={{ position: 'absolute', top: 18, left: 0 }}>
          <path d="M20 120 Q 170 -40 320 120" fill="none" stroke="rgba(255,253,249,.25)" strokeWidth="2" strokeDasharray="3 7" />
          <path d={`M20 120 Q 170 -40 320 120`} fill="none" stroke="#d9b77a" strokeWidth="2.5" strokeDasharray={`${t * 360} 999`} />
          <circle cx="20" cy="120" r="4" fill="#fffdf9" /><circle cx="320" cy="120" r="4" fill="#fffdf9" />
          <g transform={`translate(${x} ${y}) rotate(${(0.5 - t) * -60})`}><circle r="13" fill="#d9b77a" /><path d="M7 0c0-.4-.3-.7-.7-.7H2.6L.3-4.2h-.9l1.1 3.5H-1.6l-.7-.9h-.7l.5 1.6-.5 1.6h.7l.7-.9H.5l-1.1 3.5h.9l2.3-3.5h3.7c.4 0 .7-.3.7-.7z" fill="#1e352d" transform="scale(1.4)" /></g>
          <text x="30" y="124" fontFamily="Inter Tight, sans-serif" fontSize="11" fontWeight="600" fill="rgba(255,253,249,.8)">RUH</text>
          <text x="310" y="124" textAnchor="end" fontFamily="Inter Tight, sans-serif" fontSize="11" fontWeight="600" fill="rgba(255,253,249,.8)">IST</text>
        </svg>
        <div className="body" style={{ gap: 6 }}>
          <span className="small" style={{ color: '#d9b77a', fontWeight: 600 }}>In the air · estimated, no signal needed</span>
          <span className="num" style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1 }}>{h}h {String(m).padStart(2, '0')}m <span style={{ fontSize: 18, fontWeight: 500 }}>to Istanbul</span></span>
          <span className="small" style={{ color: 'rgba(255,253,249,.88)' }}>Look left in about 40 minutes: the Taurus Mountains.</span>
        </div>
      </div>

      <div className="col" style={{ gap: 4, marginTop: 6 }}>
        <h2 className="h2" style={{ fontSize: 22 }}>Plan your first evening</h2>
        <span className="small">Swipe right on what sounds good. We'll book it when you land.</span>
      </div>
      <SwipeDeck />

      <div className="col" style={{ gap: 4, marginTop: 6 }}>
        <h2 className="h2" style={{ fontSize: 22 }}>Five words for Istanbul</h2>
        <span className="small">For the taxi, the café and the kids.</span>
      </div>
      <Flashcards />

      <div className="card" style={{ marginTop: 6 }}>
        <span className="h3">When you land</span>
        {[['visa', 'Passport control, then bags'], ['bag', 'The carousel shows here as you land'], ['car', s.trip?.pickup ? 'Ahmet meets you at Door 3 with your name' : 'No car booked yet. Your options are below.']].map(([ic, t2]) => (
          <div key={t2} className="row small" style={{ color: '#1e352d' }}><Icon name={ic} size={18} />{t2}</div>
        ))}
        <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start', background: '#f6f2ec' }} onClick={() => { buzz(HAPTIC.tap); setSheet(true); }}>{s.trip?.pickup ? 'Hotel address for the driver' : 'Getting to the hotel'}</button>
      </div>
      <FaisalLine note="On-board Wi-Fi? Faisal can still reach you." />
      {sheet && <AddressSheet onClose={() => setSheet(false)} />}
    </>
  );
}

function arrivalSteps(s) {
  const pickup = s.trip?.pickup;
  const n = s.trip?.travellers?.length || 4;
  const bag = s.bagReport;
  return [
    { id: 'phone', t: 'Phone on', sub: s.todayEsim ? 'Your eSIM switches on by itself. 10 GB each.' : 'Free airport Wi-Fi for 1 hour. Turn on roaming only if you need it.' },
    { id: 'passport', t: 'Passport control', sub: `Foreign passports lane. Keep all ${n} together. Children stay with you.` },
    { id: 'bags', t: bag ? 'Bag reported missing' : 'Bags on carousel 7', sub: bag ? `Reference ${bag}. Faisal is chasing it with Saudia.` : 'About 20 minutes after you land.', bag: !bag },
    { id: 'money', t: 'Money', sub: 'Cards work almost everywhere. For small cash, the ATM by Door 8 beats the exchange desk.' },
    { id: 'driver', t: pickup ? 'Ahmet at Door 3' : 'Getting to the hotel', sub: pickup ? 'Sign says ALHARBI. He waits 60 min at no cost.' : 'No car booked. A pickup, a taxi or the metro.', address: true },
    { id: 'hotel', t: 'Rooms ready at 14:00', sub: 'Early check-in asked for. 45 min drive to Galata.' },
  ];
}

function Landed() {
  const { s, set, toast } = useStore();
  const [sheet, setSheet] = useState(null);
  const [ref, setRef] = useState('');
  const bag = s.bagReport;
  const steps = arrivalSteps(s);
  const doneIds = s.todayArrival || [];
  const cur = steps.find((st) => !doneIds.includes(st.id));
  const doneCount = steps.filter((st) => doneIds.includes(st.id)).length;
  const tick = (id) => { buzz(HAPTIC.select); set((p) => ({ todayArrival: [...new Set([...(p.todayArrival || []), id])] })); };
  const picks = s.inflightPicks || [];
  useEffect(() => { const t = setTimeout(() => buzz(HAPTIC.soft), 300); return () => clearTimeout(t); }, []);
  return (
    <>
      <div className="photo td-hero rise" style={{ height: 236 }}>
        <img className="drift" src="img/istanbul.jpg" alt="Galata Tower above Istanbul" style={{ objectPosition: '50% 40%' }} />
        <span className="td-veil" />
        <span className="td-hero-top">
          <span className="pill glass"><span className="dot" style={{ background: '#4fbf7a' }} />Landed 13:52 · IST</span>
          <span className="pill glass">Same time as Riyadh</span>
        </span>
        <span className="over" style={{ textAlign: 'left' }}>
          <span className="display" style={{ fontSize: 42, color: '#fffdf9' }}>Welcome to Istanbul.</span>
          <span className="td-hero-sub">14° and light rain. Umbrella out.</span>
        </span>
      </div>
      {picks.length > 0 && (
        <div className="notice rise d1"><span className="spinner" style={{ marginTop: 3 }} /><span className="grow"><span className="h3">Booking {picks.length === 1 ? 'your pick' : `your ${picks.length} picks`} for tonight</span><span className="small">The ones you chose in the air. Confirmation in about 5 minutes.</span></span></div>
      )}
      <div className="card rise d1 td-arrive">
        <div className="spread">
          <span className="h3" style={{ fontSize: 18 }}>{cur ? 'Now' : 'You’re through.'}</span>
          <span className="tiny num">{doneCount} of {steps.length}</span>
        </div>
        <div className="td-steps">
          {steps.map((st) => {
            const isDone = doneIds.includes(st.id);
            const isNow = cur && cur.id === st.id;
            return (
              <div key={st.id} className={'td-step' + (isDone ? ' done' : '') + (isNow ? ' now' : '')}>
                <span className="td-step-mark" aria-hidden="true">{isDone ? <Icon name="check" size={13} color="#fffdf9" width={2.8} /> : <i />}</span>
                <span className="grow col" style={{ gap: 3 }}>
                  <span className="td-step-t">{st.t}</span>
                  {(isNow || st.id === 'bags' && bag) && <span className="small">{st.sub}</span>}
                  {isNow && (
                    <span className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                      {st.address && <button type="button" className="btn gold small" onClick={() => setSheet('address')}>{s.trip?.pickup ? 'Hotel address' : 'Getting to the hotel'}</button>}
                      {st.bag && <button type="button" className="btn primary small" onClick={() => tick(st.id)}>Got the bags</button>}
                      {st.bag && <button type="button" className="btn secondary small td-soft" onClick={() => setSheet('bag')}>A bag didn’t arrive</button>}
                      {!st.bag && <button type="button" className={'btn small ' + (st.address ? 'secondary td-soft' : 'primary')} onClick={() => tick(st.id)}>{st.id === 'driver' ? 'With the driver' : st.id === 'hotel' ? 'At the hotel' : 'Done'}</button>}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {!cur && (
          <div className="col" style={{ gap: 8 }}>
            <span className="small">{picks.length ? 'Rest first. Your picks for tonight are being booked.' : 'Rest first. When you want dinner, ask us.'}</span>
            <button type="button" className="btn secondary small td-soft" style={{ alignSelf: 'flex-start' }} onClick={() => setSheet('address')}>Hotel address</button>
          </div>
        )}
        {!cur && <button type="button" className="td-link" style={{ alignSelf: 'flex-start' }} onClick={() => { buzz(HAPTIC.tap); set({ todayArrival: [] }); }}>Start the list again</button>}
      </div>
      <FaisalLine note="Faisal is watching your arrival." />
      {sheet === 'address' && <AddressSheet onClose={() => setSheet(null)} />}
      {sheet === 'bag' && (
        <Sheet label="Missing bag" onClose={() => setSheet(null)}>
          <h2 className="h2">Before you leave the baggage hall</h2>
          {['Go to the Saudia baggage desk next to carousel 7.', 'Show your bag tag (it’s on your boarding pass in the Wallet).', 'They give you a reference that looks like ISTSV12345. Type it below.'].map((t, i) => (
            <div key={t} className="row" style={{ alignItems: 'flex-start' }}><span className="avatar sm" style={{ flexShrink: 0 }}>{i + 1}</span><span className="body">{t}</span></div>
          ))}
          <div className="field"><label htmlFor="pir">Reference from the desk</label><input id="pir" className="input" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} placeholder="ISTSV12345" />
            {ref.length > 0 && !/^[A-Z]{5}\d{5}$/.test(ref) && <span className="err">It’s 5 letters then 5 numbers, like ISTSV12345.</span>}</div>
          <button type="button" className="btn primary block" disabled={!/^[A-Z]{5}\d{5}$/.test(ref)} onClick={() => { set((p) => ({ bagReport: ref, todayArrival: [...new Set([...(p.todayArrival || []), 'bags'])] })); setSheet(null); buzz(HAPTIC.success); toast('Faisal is chasing it with Saudia. Keep receipts for essentials, up to SAR 375 a day.'); }}>Let Mada chase it</button>
          <span className="tiny">Bags usually reach the hotel within 48 hours. Saudia pays for essentials while you wait.</span>
        </Sheet>
      )}
    </>
  );
}

/* ---------- back home ---------- */

function Stamp() {
  useEffect(() => { const t = setTimeout(() => buzz(HAPTIC.thunk), 520); return () => clearTimeout(t); }, []);
  return (
    <svg className="td-stamp" viewBox="0 0 120 120" width="104" height="104" role="img" aria-label="New passport stamp: Istanbul, 9 March">
      <defs><path id="td-arc" d="M60 60 m-41 0 a41 41 0 1 1 82 0 a41 41 0 1 1 -82 0" /></defs>
      <circle cx="60" cy="60" r="55" fill="rgba(255,253,249,.12)" stroke="#e8cf9c" strokeWidth="3" />
      <circle cx="60" cy="60" r="33" fill="none" stroke="#e8cf9c" strokeWidth="1.5" />
      <text fontFamily="Inter Tight, sans-serif" fontSize="10.5" fontWeight="700" letterSpacing="2.2" fill="#e8cf9c"><textPath href="#td-arc">İSTANBUL · TÜRKİYE · ENTRY ·</textPath></text>
      <text x="60" y="56" textAnchor="middle" fontFamily="Inter Tight, sans-serif" fontSize="13" fontWeight="700" fill="#fffdf9">09 MAR</text>
      <text x="60" y="72" textAnchor="middle" fontFamily="Inter Tight, sans-serif" fontSize="10" fontWeight="600" fill="#e8cf9c">2027 · IST</text>
    </svg>
  );
}

const IDEAS = {
  winter: [
    { id: 'alula', title: 'AlUla', note: 'Cool nights, warm days. 1h 20m away.', img: 'img/alula.jpg', pos: '50% 50%', go: ['plan', { id: 'alula2' }] },
    { id: 'season', title: 'Riyadh Season', note: 'A weekend at home, done properly.', img: 'img/riyadh.jpg', pos: '50% 40%', go: ['ask', { prefill: 'A weekend at Riyadh Season for the 4 of us' }] },
    { id: 'cool', title: 'Somewhere with snow', note: 'Gudauri or Erzurum, 4h away.', img: 'img/clouds.jpg', pos: '50% 60%', go: ['ask', { prefill: 'Somewhere with snow for the kids in January' }] },
  ],
  spring: [
    { id: 'alula', title: 'AlUla', note: 'The last cool weeks before summer.', img: 'img/alula.jpg', pos: '50% 50%', go: ['plan', { id: 'alula2' }] },
    { id: 'abha', title: 'Abha', note: 'Green mountains, 20° in May.', img: 'img/clouds.jpg', pos: '50% 60%', go: ['ask', { prefill: 'A long weekend in Abha' }] },
    { id: 'season', title: 'Riyadh', note: 'Staycation while it’s still mild.', img: 'img/riyadh.jpg', pos: '50% 40%', go: ['ask', { prefill: 'A staycation in Riyadh' }] },
  ],
  summer: [
    { id: 'abha', title: 'Abha', note: 'Escape the heat, 1h 40m away.', img: 'img/clouds.jpg', pos: '50% 60%', go: ['ask', { prefill: 'A week in Abha this summer' }] },
    { id: 'baku', title: 'Back to Baku', note: 'You loved it last Eid. 24° in July.', img: 'img/istanbul.jpg', pos: '20% 50%', go: ['ask', { prefill: 'Baku again this summer for the 4 of us' }] },
    { id: 'alula', title: 'AlUla in October', note: 'Book now, the season fills fast.', img: 'img/alula.jpg', pos: '50% 50%', go: ['plan', { id: 'alula2' }] },
  ],
};
const season = (m = new Date().getMonth()) => (m >= 9 || m <= 1 ? 'winter' : m <= 4 ? 'spring' : 'summer');

/* Photos are shrunk on the phone before they're kept, so three fit easily. */
function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 360 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    img.src = url;
  });
}

const RATE = [
  { id: 'hotel', q: 'Same hotel next time?', who: 'Rooms near Galata Tower', opts: [['yes', 'Yes, remember it'], ['no', 'Not this one']] },
  { id: 'driver', q: 'How were the drivers?', who: 'Khalid in Riyadh, Ahmet in Istanbul', opts: [['great', 'Great'], ['fine', 'Fine'], ['poor', 'Not good']] },
  { id: 'faisal', q: 'And Faisal?', who: 'Your agent for this trip', opts: [['great', 'Great'], ['fine', 'Fine'], ['poor', 'Not good']] },
];
const RATE_REPLY = { hotel: { yes: 'Saved. We’ll suggest it first next time.', no: 'Got it. We won’t suggest it again.' } };

function RateTrip() {
  const { s, set, toast } = useStore();
  const r = s.todayRating || {};
  const [note, setNote] = useState(r.note || '');
  const step = RATE.find((x) => !r[x.id]);
  const answer = (id, v) => { buzz(HAPTIC.select); set((p) => ({ todayRating: { ...(p.todayRating || {}), [id]: v } })); };
  if (r.sent) {
    return (
      <div className="card rise d2 td-rate">
        <span className="row" style={{ gap: 10 }}><span className="td-face">F</span><span className="h3" style={{ fontSize: 16 }}>Thank you. Faisal reads every one.</span></span>
        <span className="small">{RATE_REPLY.hotel[r.hotel] || ''} {r.note ? 'Your note went with it.' : ''}</span>
        <button type="button" className="td-link" style={{ alignSelf: 'flex-start' }} onClick={() => { buzz(HAPTIC.tap); set({ todayRating: {} }); setNote(''); }}>Change my answers</button>
      </div>
    );
  }
  const answered = RATE.filter((x) => r[x.id]).length;
  return (
    <div className="card rise d2 td-rate">
      <div className="spread">
        <span className="eyebrow">How was it</span>
        <span className="td-dots" aria-label={`${answered} of 3 answered`}>{RATE.map((x) => <i key={x.id} className={r[x.id] ? 'on' : step?.id === x.id ? 'now' : ''} />)}</span>
      </div>
      {step ? (
        <div className="col td-q" key={step.id} style={{ gap: 12 }}>
          <span className="col" style={{ gap: 2 }}><span className="display" style={{ fontSize: 28 }}>{step.q}</span><span className="small">{step.who}</span></span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {step.opts.map(([v, label], i) => <button key={v} type="button" className={'btn small ' + (i === 0 ? 'primary' : 'secondary td-soft')} onClick={() => answer(step.id, v)}>{label}</button>)}
          </div>
          {answered > 0 && <span className="tiny">{RATE_REPLY.hotel[r.hotel] || ''}</span>}
        </div>
      ) : (
        <div className="col td-q" style={{ gap: 10 }}>
          <span className="display" style={{ fontSize: 28 }}>Anything Faisal should know?</span>
          <label htmlFor="td-note" className="sr">A note for Faisal</label>
          <textarea id="td-note" className="input td-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional. The kids loved the ferry…" />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn primary small" onClick={() => { buzz(HAPTIC.success); set((p) => ({ todayRating: { ...(p.todayRating || {}), note: note.trim(), sent: true } })); toast('Sent to Faisal.'); }}>Send to Faisal</button>
            <button type="button" className="btn secondary small td-soft" onClick={() => { buzz(HAPTIC.tap); set((p) => ({ todayRating: { ...(p.todayRating || {}), [RATE[RATE.length - 1].id]: undefined } })); }}>Back</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Memories() {
  const { s, set, toast } = useStore();
  const photos = s.todayPhotos || [];
  const input = useRef(null);
  const add = async (files) => {
    const list = Array.from(files || []).filter((f) => /^image\//.test(f.type)).slice(0, 3 - photos.length);
    if (!list.length) return;
    try {
      const urls = await Promise.all(list.map(shrink));
      set((p) => ({ todayPhotos: [...(p.todayPhotos || []), ...urls].slice(0, 3) }));
      buzz(HAPTIC.success);
      if (photos.length + urls.length >= 3) toast('Added to the Istanbul trip.');
    } catch (e) { toast('That one didn’t open. Try another photo.'); }
  };
  return (
    <div className="card rise td-mem">
      <div className="col" style={{ gap: 2 }}>
        <span className="h3" style={{ fontSize: 17 }}>{photos.length >= 3 ? 'Three to remember it by.' : 'Add 3 favourite photos'}</span>
        <span className="small">{photos.length >= 3 ? 'They’re on the trip now, for the four of you.' : 'They go on the trip card, so the four of you can find them.'}</span>
      </div>
      <div className="td-polas">
        {[0, 1, 2].map((i) => photos[i] ? (
          <span key={i} className="td-pola" style={{ '--r': `${[-4, 2, 5][i]}deg` }}>
            <img src={photos[i]} alt={`Trip photo ${i + 1}`} />
            <button type="button" className="td-x" aria-label={`Remove photo ${i + 1}`} onClick={() => { buzz(HAPTIC.tap); set((p) => ({ todayPhotos: (p.todayPhotos || []).filter((_, k) => k !== i) })); }}><Icon name="close" size={12} /></button>
          </span>
        ) : (
          <button key={i} type="button" className="td-pola empty" style={{ '--r': `${[-4, 2, 5][i]}deg` }} aria-label="Add a photo" onClick={() => input.current?.click()}><Icon name="plus" size={22} /></button>
        ))}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} data-testid="td-photos" />
    </div>
  );
}

function Home() {
  const { s, push, go } = useStore();
  const t = s.trip;
  const total = (t?.flightPrice || 0) + (t?.stay?.status === 'booked' ? t.stay.price : 0) + (t?.pickup?.price || 0);
  const refunds = s.refunds.filter((r) => r.stage < 2);
  const credit = s.credit?.balance || 0;
  const ideas = IDEAS[season()];
  const photos = s.todayPhotos || [];
  const picks = (s.inflightPicks || []).length;
  return (
    <>
      <div className="col rise" style={{ gap: 6 }}>
        <h1 className="display" style={{ fontSize: 46 }}>Welcome home.</h1>
        <p className="body">Istanbul runs on Riyadh time, so no jet lag. Rest tonight. Nothing needs you.</p>
      </div>

      <div className="story td-recap rise d1">
        <img className="bg drift" src={photos[0] || 'img/istanbul.jpg'} alt="" />
        <span className="veil" />
        <span className="top"><span className="pill glass">{t?.dates || '9–15 Mar'}</span></span>
        <Stamp />
        <div className="body" style={{ gap: 12 }}>
          <span className="col" style={{ gap: 4 }}>
            <span className="display" style={{ fontSize: 36, lineHeight: 1 }}>6 nights in Istanbul</span>
            <span style={{ color: 'rgba(255,253,249,.88)', fontSize: 14 }}>New stamp: Türkiye. 15 countries now.</span>
          </span>
          <div className="td-stats">
            <span><b className="num">4,930</b>km flown</span>
            <span><b className="num">{8 + picks}</b>places</span>
            <span><b className="num">{t?.travellers?.length || 4}</b>of you</span>
          </div>
        </div>
      </div>

      <RateTrip />

      <div className="card rise td-money">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <span className="col" style={{ gap: 2 }}><span className="tiny">The whole trip</span><span className="num" style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-.02em' }}>SAR {fmt(total)}</span></span>
          <span className="pill ok">No extra charges</span>
        </div>
        <span className="tiny">Flights {fmt(t?.flightPrice || 0)} · Stay {fmt(t?.stay?.status === 'booked' ? t.stay.price : 0)} · Pickups {fmt(t?.pickup?.price || 0)}</span>
        {refunds.map((r) => (
          <div key={r.id} className="td-money-row"><Icon name="refund" size={20} color="#7d5d27" /><span className="grow col" style={{ gap: 1 }}><span className="small" style={{ fontWeight: 600, color: '#1e352d' }}>Refund on its way · SAR {fmt(r.amount)}</span><span className="tiny">{r.stage === 0 ? 'Requested from ' + (r.airline || 'the airline') : 'Approved. Sent to ' + (r.card || 'your card') + ' next.'}</span></span></div>
        ))}
        {credit > 0 && (
          <button type="button" className="td-money-row" onClick={() => { buzz(HAPTIC.tap); push('ask', {}); }}><PayMarkSun /><span className="grow col" style={{ gap: 1 }}><span className="small" style={{ fontWeight: 600, color: '#1e352d' }}>SAR {fmt(credit)} Mada credit</span><span className="tiny">Unused. It comes off your next booking by itself.</span></span><Icon name="chevron" size={18} /></button>
        )}
        <button type="button" className="btn secondary small td-soft" style={{ alignSelf: 'flex-start' }} onClick={() => { buzz(HAPTIC.tap); go('trips'); }}>Receipts in Trips</button>
      </div>

      <Memories />

      <div className="spread" style={{ marginTop: 6 }}>
        <h2 className="h2" style={{ fontSize: 22 }}>{season() === 'winter' ? 'Good this winter' : season() === 'spring' ? 'Good this spring' : 'Good this summer'}</h2>
        <button type="button" className="td-link" onClick={() => { buzz(HAPTIC.tap); push('ask', {}); }}>Plan the next one</button>
      </div>
      <div className="td-rail rise" role="list">
        {ideas.map((c) => (
          <button key={c.id} type="button" role="listitem" className="photo td-tile tall" onClick={() => { buzz(HAPTIC.tap); push(c.go[0], c.go[1]); }}>
            <img src={c.img} alt="" style={{ objectPosition: c.pos }} />
            <span className="td-veil" />
            <span className="over" style={{ textAlign: 'left' }}>
              <span className="display" style={{ color: '#fffdf9', fontSize: 28 }}>{c.title}</span>
              <span className="td-hero-sub" style={{ fontSize: 13 }}>{c.note}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function PayMarkSun() {
  return <span className="td-credit" aria-hidden="true"><Sun width={20} /></span>;
}

export default function Today() {
  const { s } = useStore();
  let body;
  if (s.guest) body = <Guest />;
  else if (!s.trip || s.phase === 'none') body = <Nothing />;
  else if (s.phase === 'booked') body = <Booked />;
  else if (s.phase === 'daybefore') body = <DayBefore />;
  else if (s.phase === 'travelday') body = <TravelDay />;
  else if (s.phase === 'delayed') body = <TravelDay predicted />;
  else if (s.phase === 'cancelled') body = <Cancelled />;
  else if (s.phase === 'inair') body = <InAir />;
  else if (s.phase === 'landed') body = <Landed />;
  else body = <Home />;
  return (
    <div className="screen">
      <Wash />
      <div className="scroll" style={{ position: 'relative' }}>
        <Header />
        {body}
      </div>
    </div>
  );
}

const ADDRESS = { local: 'Bereketzade Mah., Galata Kulesi Sk. No: 12, 34421 Beyoğlu/İstanbul', name: 'Rooms near Galata Tower', phone: '+90 212 000 0000' };

/* The hotel address, maps, and a way there whether or not a car is booked. Saved on the phone, so it works without signal. */
export function AddressSheet({ onClose }) {
  const { s, set, toast } = useStore();
  const [big, setBig] = useState(false);
  const [ride, setRide] = useState(null);
  const q = encodeURIComponent(ADDRESS.local);
  const pickup = s.trip?.pickup;
  if (big) return createPortal(
    <div className="address-big" role="dialog" aria-label="Address for the driver" onClick={() => setBig(false)}>
      <span className="eyebrow" style={{ color: '#7d5d27' }}>Lütfen bu adrese gidin · Please take me here</span>
      <span className="display" style={{ fontSize: 44, lineHeight: 1.05 }}>{ADDRESS.local}</span>
      <span className="small">Tap anywhere to close</span>
    </div>, document.querySelector('.phone') || document.body
  );
  return (
    <Sheet label="Hotel address" onClose={onClose}>
      <span className="eyebrow">{ADDRESS.name} · check-in from 14:00</span>
      <button type="button" className="address-card" onClick={() => setBig(true)} aria-label="Show the address full screen">
        <span className="display" style={{ fontSize: 26, lineHeight: 1.1 }}>{ADDRESS.local}</span>
        <span className="tiny">Tap to show it full screen to the driver</span>
      </button>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <a className="btn secondary small" href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noreferrer"><Icon name="pin" size={18} />Google Maps</a>
        <a className="btn secondary small" href={`https://maps.apple.com/?q=${q}`} target="_blank" rel="noreferrer"><Icon name="pin" size={18} />Apple Maps</a>
        <button type="button" className="btn secondary small" onClick={async () => { try { await navigator.clipboard.writeText(ADDRESS.local); toast('Address copied.'); } catch (e) { toast('Press and hold the address to copy it.'); } }}>Copy</button>
        <a className="btn secondary small" href={`tel:${ADDRESS.phone.replace(/\s/g, '')}`}>Call the hotel</a>
      </div>
      {pickup ? (
        <div className="card well" style={{ gap: 6 }}>
          <span className="h3" style={{ fontSize: 15 }}>Ahmet is meeting you</span>
          <span className="small">Door 3, arrivals hall, with a sign saying ALHARBI. Grey Mercedes Vito · 34 MDA 21. He waits 60 minutes after you land, at no cost.</span>
          <div className="row"><a className="btn primary small" href="tel:+905000000000">Call Ahmet</a><button type="button" className="btn secondary small" onClick={() => toast('Message sent. Ahmet replies in English or Turkish.')}>Message</button></div>
        </div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          <span className="eyebrow">No car booked. Three ways there</span>
          {[
            ['car', 'A Mada pickup', 'SAR 220 for the family · driver waits 60 min · paid now', 'pickup'],
            ['car', 'Taxi from the rank', 'About TRY 1,100 (SAR 125) · 45–60 min · yellow rank at Door 14. Ask for the meter: “taksimetre”.', 'taxi'],
            ['flight', 'Metro', 'M11 to Gayrettepe, then M2 to Şişhane · about 70 min · TRY 60 each · hard with big bags', 'metro'],
          ].map(([ic, t, sub, id]) => (
            <button key={id} type="button" className={'card tap well' + (ride === id ? ' selected' : '')} style={{ flexDirection: 'row', alignItems: 'flex-start' }} onClick={() => setRide(id)}>
              <Icon name={ic} /><span className="grow col" style={{ gap: 2 }}><span className="h3" style={{ fontSize: 15 }}>{t}</span><span className="tiny">{sub}</span></span>
            </button>
          ))}
          {ride === 'pickup' && <button type="button" className="btn primary block" onClick={() => { set((p) => ({ trip: p.trip ? { ...p.trip, pickup: { price: 220, status: 'booked' } } : p.trip })); buzz(HAPTIC.success); toast('Pickup booked. Ahmet will meet you at Door 3.'); }}>Book the pickup · SAR 220</button>}
          {ride === 'taxi' && <span className="small">Only take taxis from the rank. If a driver won’t use the meter, take the next one. Show them the address above.</span>}
          {ride === 'metro' && <a className="btn secondary block" href={`https://www.google.com/maps/dir/?api=1&origin=Istanbul+Airport&destination=${q}&travelmode=transit`} target="_blank" rel="noreferrer">Directions in Google Maps</a>}
        </div>
      )}
      <span className="tiny">Saved on this phone. Works without signal.</span>
    </Sheet>
  );
}

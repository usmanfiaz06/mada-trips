import React, { useEffect, useRef, useState } from 'react';
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
  if (days <= 0) return 'soon';
  if (days < 14) return `in ${days} days`;
  return `in ${Math.round(days / 7)} weeks`;
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
      <button type="button" className="avatar" aria-label="Profile and settings" onClick={() => { buzz(HAPTIC.tap); push('profile'); }} style={{ border: 0, background: '#f6f2ec' }}>
        {s.user?.name?.charAt(0) || <Icon name="user" size={18} />}
      </button>
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

function Readiness() {
  const { s, go, push } = useStore();
  const t = s.trip;
  const people = tripTravellers(s);
  const problem = people.map((p) => ({ p, issue: passportIssue(s, p.id) })).find((x) => x.issue?.blocking);
  const items = [
    { k: 'Flights', ok: true },
    { k: t.stay.status === 'cancelled' ? 'Stay cancelled' : 'Stay', ok: t.stay.status !== 'cancelled' },
    { k: problem ? `${problem.p.name}'s passport` : 'Passports', ok: !problem },
    { k: 'Entry rules for all ' + people.length, ok: true },
  ];
  const done = items.filter((i) => i.ok).length;
  const C = 2 * Math.PI * 22;
  return (
    <div className="card rise d1">
      <div className="row">
        <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
          <circle cx="28" cy="28" r="22" fill="none" stroke="#efe9e0" strokeWidth="6" />
          <circle cx="28" cy="28" r="22" fill="none" stroke={done === 4 ? '#3f9a63' : '#d9b77a'} strokeWidth="6" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - done / 4)} transform="rotate(-90 28 28)" />
        </svg>
        <div className="grow col">
          <span className="h3">{done === 4 ? 'All set.' : `${done} of 4 ready`}</span>
          <span className="small">{problem ? `${problem.p.name}'s passport is the last thing.` : 'Nothing needs you until the day before.'}</span>
        </div>
      </div>
      {problem && <button type="button" className="btn gold small" onClick={() => go('wallet')}>Fix {problem.p.name}'s passport</button>}
      <div className="chips">
        {items.map((i) => <span key={i.k} className="pill" style={i.ok ? null : { background: '#f3e6c9', color: '#7d5d27' }}>{i.ok ? '✓' : '!'} {i.k}</span>)}
      </div>
    </div>
  );
}

function TripHero() {
  const { s, push } = useStore();
  const t = s.trip;
  return (
    <button type="button" className="photo rise" style={{ height: 200, border: 0, padding: 0, width: '100%' }} onClick={() => push('trip')}>
      <img className="drift" src="img/istanbul.jpg" alt="Galata Tower above Istanbul" />
      <span className="shade" />
      <span className="over" style={{ textAlign: 'left' }}>
        <span className="pill gold" style={{ alignSelf: 'flex-start' }}>{weeksUntilTrip()}</span>
        <span className="display" style={{ fontSize: 40, color: '#fffdf9' }}>Istanbul</span>
        <span className="small" style={{ color: 'rgba(255,253,249,.9)' }}>{t.datesLong} · {t.travellers.length} travellers · {t.flight.airline}</span>
      </span>
    </button>
  );
}

function Booked() {
  const { s, push } = useStore();
  return (
    <>
      <TripHero />
      <Readiness />
      <RequestsCard />
      <span className="eyebrow" style={{ marginTop: 4 }}>Next for this trip</span>
      <button type="button" className="card tap rise d2" onClick={() => push('ask', { intent: 'esim' })}>
        <div className="row"><span className="icon-btn" style={{ background: '#f6f2ec' }}><Icon name="globe" /></span>
          <div className="grow col"><span className="h3">Data in Türkiye for all 4</span><span className="small">From SAR 39 each. Set up before you fly, works on landing.</span></div><Icon name="chevron" /></div>
      </button>
      <button type="button" className="card tap rise d3" onClick={() => push('group')}>
        <div className="row"><span className="icon-btn" style={{ background: '#f6f2ec' }}><Icon name="food" /></span>
          <div className="grow col"><span className="h3">Bosphorus dinner cruise?</span><span className="small">Hessa asked in the group. 4 of 6 voted.</span></div><Icon name="chevron" /></div>
      </button>
    </>
  );
}

function DayBefore() {
  const { s } = useStore();
  const t = s.trip;
  return (
    <>
      <TripHero />
      <div className="card focal rise d1">
        <span className="eyebrow" style={{ color: '#d9b77a' }}>Tomorrow</span>
        {[
          ['car', `Khalid picks you up at 07:05`],
          ['check', `Checked in · seats 3A–3D together`],
          ['bag', `${t.flight.bags} each · ${t.flight.code} from King Khalid`],
          ['rain', 'Istanbul 14° and light rain. Pack the umbrella.'],
          ['bell', 'We’ll wake your phone at 06:20.'],
        ].map(([ic, txt]) => (
          <div key={txt} className="row" style={{ fontSize: 15 }}><Icon name={ic} color="#d9b77a" size={20} />{txt}</div>
        ))}
      </div>
    </>
  );
}

function LeaveCard() {
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
          Khalid at 07:05 · 31 min to King Khalid
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
      <div className="spread"><span className="row" style={{ gap: 10 }}><AirlineMark flight={f} size={32} /><span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{f.airline}</span><span className="tiny"><span className="code">{f.code}</span> · {f.date}</span></span></span><span className="pill ok">On time</span></div>
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
          <button type="button" className="btn gold small" onClick={() => push('disruption', { kind: 'delay' })}>See the plan</button>
        </div>
      )}
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
            <span className="row"><span className="avatar sm green">K</span><span className="h3" style={{ fontSize: 14 }}>Khalid · 07:05</span></span>
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
    </>
  );
}

function Cancelled() {
  const { s, push } = useStore();
  return (
    <div className="card focal rise" style={{ padding: 22, gap: 14 }}>
      <span className="eyebrow" style={{ color: '#d9b77a' }}>{s.trip.flight.code} · Tue 9 Mar</span>
      <h1 className="h1" style={{ color: '#f6f2ec' }}>Saudia cancelled your flight.</h1>
      <p className="body" style={{ color: '#d6cfc3' }}>You're owed a full refund. We're already holding seats on the next flight for all {s.trip.travellers.length} of you.</p>
      <div className="row"><span className="avatar gold">F</span><span className="small" style={{ color: '#e9e2d8' }}>Faisal at Mada is on this with you.</span></div>
      <button type="button" className="btn gold block" onClick={() => push('disruption', { kind: 'cancel' })}>See your options</button>
    </div>
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
        {[['visa', 'Passport control, then bags'], ['bag', 'The carousel shows here as you land'], ['car', 'Ahmet meets you at Door 3 with your name']].map(([ic, t2]) => (
          <div key={t2} className="row small" style={{ color: '#1e352d' }}><Icon name={ic} size={18} />{t2}</div>
        ))}
        <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start', background: '#f6f2ec' }} onClick={() => { buzz(HAPTIC.tap); setSheet(true); }}>Hotel address for the driver</button>
      </div>
      {sheet && (
        <Sheet label="Hotel address" onClose={() => setSheet(false)}>
          <span className="eyebrow">Show this to the driver</span>
          <span className="display" style={{ fontSize: 34 }}>Bereketzade, Galata Kulesi Sk., Beyoğlu, İstanbul</span>
          <span className="small">Rooms near Galata Tower · check-in from 14:00</span>
          <button type="button" className="btn primary block" onClick={() => setSheet(false)}>Done</button>
        </Sheet>
      )}
    </>
  );
}

function Landed() {
  const { s } = useStore();
  return (
    <>
      <h1 className="display rise" style={{ fontSize: 46 }}>Welcome to Istanbul.</h1>
      {(s.inflightPicks || []).length > 0 && (
        <div className="notice rise"><span className="spinner" style={{ marginTop: 3 }} /><span className="grow"><span className="h3">Booking {(s.inflightPicks || []).length === 1 ? "your pick" : `your ${(s.inflightPicks || []).length} picks`} for tonight</span><span className="small">The ones you chose in the air. Confirmation in a few minutes.</span></span></div>
      )}
      <div className="card focal rise d1">
        {[['bag', 'Bags on carousel 7'], ['car', 'Ahmet is at Door 3 with your name on a sign'], ['globe', 'Your eSIM is on. 10 GB for each of you.'], ['stay', 'Rooms ready at 14:00. Early check-in requested.']].map(([ic, t]) => (
          <div key={t} className="row" style={{ fontSize: 15 }}><Icon name={ic} color="#d9b77a" size={20} />{t}</div>
        ))}
      </div>
    </>
  );
}

function Home() {
  const { s, set, toast } = useStore();
  const [answered, setAnswered] = useState(null);
  return (
    <>
      <h1 className="display rise" style={{ fontSize: 46 }}>Welcome home.</h1>
      <div className="photo rise d1" style={{ height: 170 }}>
        <img src="img/istanbul.jpg" alt="" />
        <span className="shade" />
        <span className="over">
          <span className="h3" style={{ color: '#fffdf9' }}>6 nights in Istanbul</span>
          <span className="small" style={{ color: 'rgba(255,253,249,.9)' }}>New stamp in your passport · 15 countries now</span>
        </span>
      </div>
      {s.refunds.filter((r) => r.stage < 2).map((r) => (
        <div key={r.id} className="notice"><Icon name="refund" /><span className="grow"><span className="h3">Refund on its way: SAR {fmt(r.amount)}</span><span className="small">{r.title}</span></span></div>
      ))}
      <div className="card rise d2">
        <span className="h3">Same hotel next time?</span>
        {answered ? <span className="small">{answered === 'yes' ? 'Saved. We’ll suggest it first next time.' : 'Got it. We won’t suggest it again.'}</span> : (
          <div className="row">
            <button type="button" className="btn primary small" onClick={() => { setAnswered('yes'); buzz(HAPTIC.select); }}>Yes, remember it</button>
            <button type="button" className="btn secondary small" onClick={() => { setAnswered('no'); buzz(HAPTIC.select); }}>Not this one</button>
          </div>
        )}
      </div>
    </>
  );
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

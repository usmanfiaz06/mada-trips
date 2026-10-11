import React, { useMemo, useState } from 'react';
import { useStore, buzz, HAPTIC, PEOPLE, addDays, dayLabel, stayOf, STAY_NIGHTS } from '../store.jsx';
import { Icon, TopBar, Sheet, EmptyState, ArtCompass } from '../ui.jsx';
import { en } from '../../../../../packages/shared/src/copy/index.ts';
import { MOCK_ACTIVITIES, MOCK_EXPERIENCES, mockEvents } from '../../../../../packages/shared/src/schemas/activities-data.ts';
import { filterActivities, localClock, moodOf, nextPrayer, openState, todayIdeas, utcOffsetMin } from '../../../../../packages/shared/src/schemas/activities-logic.ts';
import { googleMapsUrl, travelEstimate } from '../../../../../packages/shared/src/schemas/directions.ts';

/* Things to do (the app's components/things): on a city's page and inside the trip. The same sample data and rules as
   the app's mock mode (packages/shared activities-data.ts / activities-logic.ts): real places from open data with
   their hours read against the city's clock, today's weather turning a hot day indoors, prayer times, things Mada
   books (Hotelbeds first), what's on, and the sources. Words are the catalogue's (things.*), so Arabic follows. */

const w = (key, vars = {}) => String(en[key] || key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const TZ = { 745044: 'Europe/Istanbul', 108410: 'Asia/Riyadh', 108841: 'Asia/Riyadh', 292223: 'Asia/Dubai', 2643743: 'Europe/London' };
const CC = { 745044: 'TR', 108410: 'SA', 108841: 'SA', 292223: 'AE', 2643743: 'GB' };
const GALATA = { lat: 41.0262, lon: 28.9727 };
const sar = (h) => `SAR ${Math.round(h / 100).toLocaleString('en-US')}`;
const photo = (k) => (k ? `img/things/${k}.jpg` : null);
const KIND_ICON = { attraction: 'star', museum: 'globe', gallery: 'star', viewpoint: 'up', park: 'pin', theme_park: 'star', zoo: 'pin', aquarium: 'rain', water_park: 'rain', historic: 'stay', mosque: 'stay' };
const km = (a, b) => { const r = Math.PI / 180; const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2; return Math.round(6371 * 2 * Math.asin(Math.sqrt(x)) * 10) / 10; };
const dur = (m) => (!m ? '' : m >= 1440 ? w('things.duration.days', { n: Math.round(m / 1440) }) : m < 60 ? w('things.duration.min', { n: m }) : m % 60 ? w('things.duration.hm', { h: Math.floor(m / 60), m: m % 60 }) : w('things.duration.h', { n: m / 60 }));
const openText = (a) => (a.openNow === true ? (a.closesAt ? w('things.openUntil', { time: a.closesAt }) : w('things.openAllDay')) : a.openNow === false ? w('things.closedNow') : a.hours ? '' : w('things.hoursUnknown'));

/* Getting there (the app's components/things/go.tsx): where Directions goes, the "about" time from the hotel. */
const targetOf = (x, city) => {
  if (x._t === 'a') return { name: x.name, lat: x.lat, lon: x.lon, address: x.address || null };
  if (x._t === 'e') { const m = x.meetingPoint; return m && m.kind !== 'pickup' && (m.lat != null || m.address) ? { name: m.address || x.title, lat: m.lat, lon: m.lon, address: m.address } : null; }
  return x.venue ? { name: x.venue, lat: null, lon: null, address: `${x.venue}, ${city}` } : null;
};
const estimateOf = (t, near) => (t && near && t.lat != null ? travelEstimate(near, { lat: t.lat, lon: t.lon }) : null);
const minutesOf = (e) => w(e.mode === 'walk' ? 'things.go.minWalk' : 'things.go.minDrive', { n: e.min });

/** Everything for one city (and trip), the way GET /places/:id/things answers. */
export function thingsFor(cityId, { trip = null, day = null, filters = new Set() } = {}) {
  const id = String(cityId);
  const tz = TZ[id] || 'Asia/Riyadh';
  const clock = localClock(tz);
  const d = day || clock.day;
  const isToday = d === clock.day;
  const near = trip && id === '745044' && stayOf(trip) ? GALATA : null;
  const base = MOCK_ACTIVITIES[id] || [];
  let acts = base.map((a) => { const st = isToday ? openState(a.hours, clock) : { open: null, closesAt: null }; return { ...a, openNow: st.open, closesAt: st.closesAt, distanceKm: near ? km(near, a) : null }; });
  if (near && filters.has('near')) acts = [...acts].sort((a, b) => a.distanceKm - b.distanceKm);
  const lat = base.length ? base.reduce((n, a) => n + a.lat, 0) / base.length : 0;
  const lon = base.length ? base.reduce((n, a) => n + a.lon, 0) / base.length : 0;
  const gulf = ['SA', 'AE'].includes(CC[id]);
  const maxC = gulf ? 41 : lat > 50 ? 14 : 24;
  const weather = isToday ? { tempC: maxC - 3, maxC, rainChance: lat > 50 ? 70 : 5, code: lat > 50 ? 61 : 1 } : null;
  if (weather) { weather.mood = moodOf(weather); weather.indoorFirst = weather.mood !== 'fine'; }
  const kids = (trip?.travellers || []).filter((p) => /daughter|son/i.test(PEOPLE[p]?.role || '')).map((p) => (p === 'ahmed' ? 6 : 9));
  const prayer = base.length ? nextPrayer(d, isToday ? clock.minutes : 0, lat, lon, utcOffsetMin(tz)) : null;
  const today = isToday ? todayIdeas(acts, { day: d, minutes: clock.minutes, weather, family: filters.has('family') || kids.length > 0, prayer }) : null;
  const kind = filters.has('indoor') ? 'indoor' : filters.has('outdoor') ? 'outdoor' : filters.has('see') ? 'see' : 'all';
  const shown = filterActivities(acts, { open: isToday && filters.has('open'), family: filters.has('family'), ages: kids, kind });
  const youngest = kids.length ? Math.min(...kids) : null;
  const experiences = (MOCK_EXPERIENCES[id] || []).filter((e) => youngest === null || e.minAge === null || youngest >= e.minAge);
  const events = mockEvents(id, clock.day).filter((e) => e.endsOn >= d && e.startsOn <= (day ? d : addDays(d, 14)));
  return { id, clock, day: d, isToday, near, weather, today, acts, shown, experiences, events, kids };
}

function Photo({ k, kind, h = 118, r = 0 }) {
  const src = photo(k);
  return src ? <img className="th-photo" src={src} alt="" style={{ height: h, borderRadius: r }} />
    : <span className="th-photo th-none" style={{ height: h, borderRadius: r }} aria-hidden="true"><span><Icon name={KIND_ICON[kind] || 'star'} size={24} color="#7d5d27" /></span></span>;
}

function MiniMap({ name, onOpen }) {
  return (
    <button type="button" className="th-map" aria-label={w('things.mapA11y', { name })} onClick={() => { buzz(HAPTIC.tap); onOpen?.(); }}>
      <svg viewBox="0 0 320 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="320" height="120" fill="#e6eee6" />
        <path d="M-10 86 C 60 70, 110 98, 170 80 S 280 52, 340 66" stroke="#fffdf9" strokeWidth="9" fill="none" />
        <path d="M120 -10 C 128 40, 150 80, 140 130" stroke="#fffdf9" strokeWidth="6" fill="none" />
        <path d="M160 62 c -9 -10 -14 -16 -14 -24 a 14 14 0 0 1 28 0 c 0 8 -5 14 -14 24 z" fill="#b98f4a" stroke="#fffdf9" strokeWidth="2" />
        <circle cx="160" cy="38" r="5" fill="#fffdf9" />
      </svg>
      <span className="th-map-btn"><Icon name="pin" size={15} />{w('things.map')}</span>
    </button>
  );
}

/** A thing's sheet: photo, what it is, hours, the map, Add to my plan (in a trip) and Book with Mada. */
function GettingThere({ x, city, near, hotel, onDirections, onRide }) {
  const target = targetOf(x, city);
  const est = estimateOf(target, near);
  const address = x._t === 'a' ? x.address : x._t === 'w' ? x.venue : null;
  return (
    <div className="th-facts" data-testid="thing-getting-there">
      {address && <span className="row small" style={{ color: '#1e352d', alignItems: 'flex-start' }}><Icon name="pin" size={16} color="#7d5d27" /><span className="col" style={{ gap: 0 }}><span className="tiny" style={{ color: '#7d5d27' }}>{w('things.go.address')}</span><span>{address}</span></span></span>}
      {est && <span className="row small" style={{ color: '#1e352d', alignItems: 'flex-start' }}><Icon name={est.mode === 'walk' ? 'user' : 'car'} size={16} color="#7d5d27" /><span className="col" style={{ gap: 0 }}><b>{w(est.mode === 'walk' ? 'things.go.walk' : 'things.go.drive', { n: est.min })}</b><span className="tiny">{hotel ? w('things.go.fromHotel', { hotel }) : w('things.go.fromHotelPlain')}</span></span></span>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {target && <button type="button" className="btn primary small grow" onClick={onDirections}><Icon name="arrow" size={16} />{w('things.go.directions')}</button>}
        <button type="button" className="btn secondary small grow" onClick={onRide}><Icon name="car" size={16} />{w('things.go.withMada')}</button>
      </div>
    </div>
  );
}

function MeetingPoint({ x }) {
  const m = x.meetingPoint;
  const known = m && (m.address || m.kind === 'pickup');
  return (
    <div className="th-facts" data-testid="thing-meeting">
      <span className="row small" style={{ color: '#1e352d', alignItems: 'flex-start' }}><Icon name={m?.kind === 'pickup' ? 'car' : 'pin'} size={16} color="#7d5d27" />
        <span className="col" style={{ gap: 2 }}>
          <span className="eyebrow" style={{ color: '#7d5d27' }}>{w('things.meet.label')}</span>
          <b>{known ? (m.kind === 'pickup' && !m.address ? w('things.meet.pickup') : m.address) : w('things.meet.voucher')}</b>
          {known ? (m.note && <span className="tiny">{m.note}</span>) : <span className="tiny">{w('things.meet.voucherSub')}</span>}
        </span>
      </span>
    </div>
  );
}

/** The chooser. On the web (and here) that's Google Maps in a new tab; the app also offers Apple Maps, Waze, Uber, Careem. */
function DirectionsSheet({ x, city, near, hotel, onClose, onRide }) {
  const target = targetOf(x, city);
  const est = estimateOf(target, near);
  const title = x.name || x.title;
  const open = () => { buzz(HAPTIC.tap); window.open(googleMapsUrl(target, est?.mode || 'drive'), '_blank', 'noopener'); };
  return (
    <Sheet label={w('things.go.title', { name: title })} onClose={onClose}>
      <h2 className="h2">{w('things.go.title', { name: title })}</h2>
      {target.address && <span className="small">{target.address}</span>}
      {est && (
        <div className="th-facts" style={{ gap: 4 }}>
          <span className="eyebrow" style={{ color: '#7d5d27' }}>{hotel ? w('things.go.fromHotel', { hotel }) : w('things.go.fromHotelPlain')}</span>
          <span className="row small" style={{ color: '#1e352d' }}><Icon name="user" size={16} color="#7d5d27" />{est.mode === 'walk' ? <b>{w('things.go.walk', { n: est.walkMin })}</b> : w('things.go.walk', { n: est.walkMin })}</span>
          <span className="row small" style={{ color: '#1e352d' }}><Icon name="car" size={16} color="#7d5d27" />{est.mode === 'drive' ? <b>{w('things.go.drive', { n: est.driveMin })}</b> : w('things.go.drive', { n: est.driveMin })}</span>
          <span className="tiny">{w('things.go.estimate')}</span>
        </div>
      )}
      <span className="eyebrow">{w('things.go.openIn')}</span>
      <button type="button" className="th-app" onClick={open}>
        <span className="th-app-mark"><Icon name="pin" size={18} color="#7d5d27" /></span>
        <span className="grow col" style={{ gap: 1, minWidth: 0 }}><span className="h3" style={{ fontSize: 16 }}>{w('things.go.app.google')}</span><span className="tiny">{w('things.go.appWeb')}</span></span>
        <Icon name="chevron" size={18} color="#5f6b65" />
      </button>
      <div className="th-mada">
        <b className="small" style={{ color: '#1e352d' }}>{w('things.go.withMada')}</b>
        <span className="tiny">{w('things.go.withMadaSub')}</span>
        <button type="button" className="btn secondary small block" onClick={onRide}><Icon name="car" size={16} />{w('things.go.askCar')}</button>
      </div>
    </Sheet>
  );
}

const TIMES = Array.from({ length: 33 }, (_, i) => { const m = 7 * 60 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });

/** Get there with Mada: a car request to Faisal, like an airport pickup; the chat opens with their words. */
function RideSheet({ x, city, trip, day: initial, onClose }) {
  const { s, set, push } = useStore();
  const hotel = trip ? stayOf(trip)?.name || null : null;
  const today = new Date().toISOString().slice(0, 10);
  const days = trip ? tripDays(trip) : Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const [day, setDay] = useState(initial && days.includes(initial) ? initial : days.find((d) => d >= today) || days[0]);
  const [time, setTime] = useState('10:00');
  const [pickup, setPickup] = useState(hotel ? 'hotel' : 'other');
  const [where, setWhere] = useState('');
  const [n, setN] = useState(trip ? Math.min(6, (trip.travellers || []).length || 2) : 2);
  const [text, setText] = useState(null);
  const title = x.name || x.title;
  const from = pickup === 'hotel' ? hotel : where.trim() || '…';
  const who = n === 1 ? w('things.request.whoOne') : w('things.request.who', { n });
  const msg = text ?? w('things.ride.message', { name: title, day: dayLabel(day), time, from, who });
  const missing = pickup === 'other' && !where.trim();
  const timesRef = React.useRef(null);
  React.useEffect(() => { const el = timesRef.current?.querySelector('.chip.on'); if (el) el.scrollIntoView({ block: 'nearest', inline: 'center' }); }, []);
  const send = () => {
    const offline = !!s.demo.offline;
    const id = 'rd' + Date.now();
    const reqTitle = w('things.ride.requestTitle', { name: title });
    set((p) => ({
      requests: [...p.requests, { id, kind: 'car', short: 'ride', title: reqTitle, detail: `${from} → ${title} · ${dayLabel(day)} ${time} · ${who}`, status: offline ? 'queued' : 'sent', created: Date.now(), quote: 0, quoteText: `A car from ${from} to ${title} on ${dayLabel(day)} at ${time}. I’ll send you the price here first.` }],
      support: [...(p.support || []), { id: 'm' + Date.now(), at: Date.now(), from: 'me', text: msg, about: reqTitle, queued: offline, intent: 'free' }],
      tripsTab: 'requests',
    }));
    buzz(HAPTIC.success);
    onClose();
    if (!offline) setTimeout(() => set((p) => ({ support: [...(p.support || []), { id: 'm' + Date.now() + 'f', at: Date.now(), from: 'faisal', text: `On it. I’ll book a car to ${title} and send you the price here, usually within the hour.` }] })), 1600);
    push('support', { about: reqTitle });
  };
  return (
    <Sheet label={w('things.ride.title', { name: title })} onClose={onClose}>
      <h2 className="h2">{w('things.ride.title', { name: title })}</h2>
      <span className="eyebrow">{w('things.ride.day')}</span>
      <div className="chips">{days.slice(0, 10).map((d) => <button key={d} type="button" className={'chip' + (day === d ? ' on' : '')} onClick={() => { setDay(d); setText(null); }}>{dayLabel(d)}</button>)}</div>
      <span className="eyebrow">{w('things.ride.time')}</span>
      <div className="chips scrollx th-rail" ref={timesRef} data-testid="ride-times">{TIMES.map((tm) => <button key={tm} type="button" className={'chip' + (time === tm ? ' on' : '')} onClick={() => { setTime(tm); setText(null); }}>{tm}</button>)}</div>
      <span className="eyebrow">{w('things.ride.from')}</span>
      <div className="chips">
        {hotel && <button type="button" className={'chip' + (pickup === 'hotel' ? ' on' : '')} onClick={() => { setPickup('hotel'); setText(null); }}>{hotel}</button>}
        <button type="button" className={'chip' + (pickup === 'other' ? ' on' : '')} onClick={() => { setPickup('other'); setText(null); }}>{w('things.ride.elsewhere')}</button>
      </div>
      {pickup === 'other' && <input className="input" aria-label={w('things.ride.where')} placeholder={w('things.ride.where')} value={where} maxLength={160} onChange={(e) => { setWhere(e.target.value); setText(null); }} />}
      <span className="eyebrow">{w('things.ride.people')}</span>
      <div className="chips">{[1, 2, 3, 4, 5, 6].map((k) => <button key={k} type="button" className={'chip' + (n === k ? ' on' : '')} onClick={() => { setN(k); setText(null); }}>{k === 6 ? '6+' : k}</button>)}</div>
      <div className="field"><label htmlFor="rd-msg">{w('things.bookSheet.message')}</label><textarea id="rd-msg" className="input" style={{ height: 76, padding: 14, resize: 'none', lineHeight: 1.4 }} value={msg} onChange={(e) => setText(e.target.value)} /></div>
      <span className="tiny">{w('things.ride.note', { agent: 'Faisal' })}</span>
      {missing && <span className="small" style={{ color: '#7d5d27' }}>{w('things.ride.whereNeeded')}</span>}
      <button type="button" className="btn primary block" disabled={!msg.trim() || missing} onClick={send}>{w('things.ride.send')}</button>
    </Sheet>
  );
}

function ThingSheet({ x, data, trip, city, onClose, onBook, onDirections, onRide }) {
  const { s, set } = useStore();
  const [picking, setPicking] = useState(false);
  const planned = (s.plannedIdeas || []).find((i) => i.ref === x.id);
  const title = x.name || x.title;
  const days = trip ? tripDays(trip) : [];
  const add = (day) => { set((p) => ({ plannedIdeas: [...(p.plannedIdeas || []).filter((i) => i.ref !== x.id), { ref: x.id, day, title, sub: x.summary || x.venue || null }] })); buzz(HAPTIC.success); setPicking(false); };
  return (
    <Sheet label={title} onClose={onClose}>
      <Photo k={x.photo} kind={x.kind} h={180} r={18} />
      <span className="eyebrow" style={{ color: '#7d5d27' }}>{x._t === 'a' ? w(`things.kind.${x.kind}`) : x._t === 'e' ? w('things.via', { supplier: 'Hotelbeds' }) : x.source === 'desk' ? w('things.event.fromDesk') : 'Ticketmaster'}</span>
      <h2 className="h2" style={{ marginTop: -6 }}>{title}</h2>
      {(x.summary || x.body) && <p className="body" style={{ margin: 0, color: '#1e352d' }}>{x.summary || x.body}</p>}
      {x._t === 'a' && (<>
        <div className="th-facts">
          <span className="row small" style={{ color: '#1e352d', alignItems: 'flex-start' }}><Icon name="bell" size={16} color="#7d5d27" /><span className="col" style={{ gap: 0 }}><b>{openText(x) || w('things.hours')}</b>{x.hours && <span className="tiny" dir="ltr">{x.hours}</span>}{x.hours && <span className="tiny">{w('things.hoursNote')}</span>}</span></span>
          {x.distanceKm != null && <span className="row small" style={{ color: '#1e352d' }}><Icon name="pin" size={16} color="#7d5d27" />{w('things.kmFromHotel', { km: x.distanceKm })}</span>}
          {(x.family || x.indoor || x.free) && <span className="row small" style={{ color: '#1e352d' }}><Icon name="star" size={16} color="#7d5d27" />{[x.family && w('things.familyTag'), x.indoor && w('things.indoor'), x.free && w('things.free')].filter(Boolean).join(' · ')}</span>}
        </div>
        <MiniMap name={x.name} onOpen={() => onDirections(x)} />
        <GettingThere x={x} city={city} near={data.near} hotel={trip ? stayOf(trip)?.name : null} onDirections={() => onDirections(x)} onRide={() => onRide(x)} />
        <span className="tiny">© OpenStreetMap contributors, ODbL</span>
      </>)}
      {x._t === 'e' && (
        <div className="th-facts">
          <span className="row small" style={{ color: '#1e352d' }}><Icon name="card" size={16} color="#7d5d27" /><b>{w('things.from', { price: sar(x.priceFrom.amount) })}</b> <span className="tiny">{w('things.perPerson')}</span></span>
          {x.durationMin && <span className="row small" style={{ color: '#1e352d' }}><Icon name="bell" size={16} color="#7d5d27" />{dur(x.durationMin)}</span>}
          {x.rating && <span className="row small" style={{ color: '#1e352d' }}><Icon name="star" size={16} color="#7d5d27" />{w('things.rating', { rating: x.rating.toFixed(1), count: x.reviews })}</span>}
          {x.freeCancel && <span className="row small" style={{ color: '#1e352d' }}><Icon name="check" size={16} color="#7d5d27" />{w('things.freeCancel')}</span>}
        </div>
      )}
      {x._t === 'e' && <MeetingPoint x={x} />}
      {x._t === 'e' && x.meetingPoint?.lat != null && <MiniMap name={x.meetingPoint.address || x.title} onOpen={() => onDirections(x)} />}
      {x._t === 'e' && <GettingThere x={x} city={city} near={data.near} hotel={trip ? stayOf(trip)?.name : null} onDirections={() => onDirections(x)} onRide={() => onRide(x)} />}
      {x._t === 'w' && (
        <div className="th-facts">
          <span className="row small" style={{ color: '#1e352d' }}><Icon name="bell" size={16} color="#7d5d27" />{x.startsOn === x.endsOn ? dayLabel(x.startsOn) : w('things.event.dates', { from: dayLabel(x.startsOn), to: dayLabel(x.endsOn) })}</span>
          {(x.time || x.venue) && <span className="row small" style={{ color: '#1e352d' }}><Icon name="pin" size={16} color="#7d5d27" />{[x.time, x.venue].filter(Boolean).join(' · ')}</span>}
        </div>
      )}
      {x._t === 'w' && x.venue && <GettingThere x={x} city={city} near={data.near} hotel={trip ? stayOf(trip)?.name : null} onDirections={() => onDirections(x)} onRide={() => onRide(x)} />}
      {trip && (planned ? (
        <div className="th-planned"><Icon name="check" size={18} color="#2f7a4b" /><span className="grow small" style={{ color: '#1e352d' }}>{planned.day ? w('things.addedPlan', { day: dayLabel(planned.day) }) : w('things.addedPlanAny')}</span>
          <button type="button" className="link tiny" onClick={() => set((p) => ({ plannedIdeas: (p.plannedIdeas || []).filter((i) => i.ref !== x.id) }))}>{w('things.removePlan')}</button></div>
      ) : picking ? (
        <div className="col" style={{ gap: 8 }}>
          <span className="eyebrow">{w('things.pickDay')}</span>
          <div className="chips">{days.map((d) => <button key={d} type="button" className="chip" onClick={() => add(d)}>{dayLabel(d)}</button>)}<button type="button" className="chip" onClick={() => add(null)}>{w('things.day.any')}</button></div>
        </div>
      ) : <button type="button" className="btn secondary block" onClick={() => (data.day && days.includes(data.day) && !data.isToday ? add(data.day) : setPicking(true))}>{w('things.addPlan')}</button>)}
      <button type="button" className="btn primary block" onClick={() => onBook(x)}>{w('things.bookWith')}</button>
      <span className="tiny" style={{ textAlign: 'center' }}>{w('things.bookNote')}</span>
    </Sheet>
  );
}

function tripDays(t) {
  const start = t?.flight?.dateISO || stayOf(t)?.fromISO;
  if (!start) return [];
  const end = t.flight?.backDateISO || addDays(start, STAY_NIGHTS);
  const out = [];
  for (let d = start, i = 0; d <= end && i < 30; d = addDays(d, 1), i++) out.push(d);
  return out;
}

/** Book with Mada: a request to Faisal, like any other; the chat opens with their words. */
function BookSheet({ x, city, trip, day: initial, onClose }) {
  const { s, set, push } = useStore();
  const kidsAges = trip ? (trip.travellers || []).filter((p) => /daughter|son/i.test(PEOPLE[p]?.role || '')).map((p) => (p === 'ahmed' ? 6 : 9)) : [];
  const days = trip ? tripDays(trip) : Array.from({ length: 7 }, (_, i) => addDays(new Date().toISOString().slice(0, 10), i));
  const [day, setDay] = useState(initial || null);
  const [n, setN] = useState(trip ? Math.min(6, (trip.travellers || []).length || 2) : 2);
  const [text, setText] = useState(null);
  const title = x.name || x.title;
  const kids = kidsAges.slice(0, Math.max(0, n - 1));
  const adults = Math.max(1, n - kids.length);
  const who = kids.length ? w('things.request.whoKids', { adults, ages: kids.join(', ') }) : adults === 1 ? w('things.request.whoOne') : w('things.request.who', { n: adults });
  const msg = text ?? w('things.request.message', { name: title, city, who, when: day ? dayLabel(day) : w('things.request.dayOpen') });
  const send = () => {
    const offline = !!s.demo.offline;
    const id = 'th' + Date.now();
    const reqTitle = w('things.request.title', { name: title });
    set((p) => ({
      requests: [...p.requests, { id, kind: 'todo', short: 'plans', title: reqTitle, detail: `${city} · ${who} · ${day ? dayLabel(day) : w('things.request.dayOpen')}`, status: offline ? 'queued' : 'sent', created: Date.now(), quote: 0, quoteText: `I’ll book ${title} for ${who}${day ? ` on ${dayLabel(day)}` : ''} and send you the price here first.` }],
      support: [...(p.support || []), { id: 'm' + Date.now(), at: Date.now(), from: 'me', text: msg, about: reqTitle, queued: offline, intent: 'free' }],
      tripsTab: 'requests',
    }));
    buzz(HAPTIC.success);
    onClose();
    if (!offline) setTimeout(() => set((p) => ({ support: [...(p.support || []), { id: 'm' + Date.now() + 'f', at: Date.now(), from: 'faisal', text: `On it. I’ll check ${title} and send you the price here, usually within 30 minutes.` }] })), 1600);
    push('support', { about: reqTitle });
  };
  return (
    <Sheet label={w('things.bookSheet.title', { name: title })} onClose={onClose}>
      <h2 className="h2">{w('things.bookSheet.title', { name: title })}</h2>
      <span className="eyebrow">{w('things.bookSheet.when')}</span>
      <div className="chips">{days.slice(0, 10).map((d) => <button key={d} type="button" className={'chip' + (day === d ? ' on' : '')} onClick={() => { setDay(d); setText(null); }}>{dayLabel(d)}</button>)}<button type="button" className={'chip' + (day === null ? ' on' : '')} onClick={() => { setDay(null); setText(null); }}>{w('things.day.any')}</button></div>
      <span className="eyebrow">{w('things.bookSheet.who')}</span>
      <div className="chips">{[1, 2, 3, 4, 5, 6].map((k) => <button key={k} type="button" className={'chip' + (n === k ? ' on' : '')} onClick={() => { setN(k); setText(null); }}>{k === 6 ? '6+' : k}</button>)}</div>
      {kids.length > 0 && <span className="small">{w('things.bookSheet.kids', { ages: kids.join(', ') })}</span>}
      <div className="field"><label htmlFor="th-msg">{w('things.bookSheet.message')}</label><textarea id="th-msg" className="input" style={{ height: 76, padding: 14, resize: 'none', lineHeight: 1.4 }} value={msg} onChange={(e) => setText(e.target.value)} /></div>
      <span className="tiny">{w('things.bookSheet.byHand', { agent: 'Faisal' })}</span>
      <button type="button" className="btn primary block" disabled={!msg.trim()} onClick={send}>{w('things.bookSheet.send')}</button>
    </Sheet>
  );
}

const FILTERS = [['open', 'things.filter.open'], ['family', 'things.filter.family'], ['indoor', 'things.filter.indoor'], ['outdoor', 'things.filter.outdoor'], ['see', 'things.filter.see'], ['near', 'things.filter.near']];

/** The section on a city's page or in a trip, or the whole list (full). */
export function ThingsSection({ cityId, city, trip = null, full = false }) {
  const { push } = useStore();
  const [filters, setFilters] = useState(new Set());
  const [day, setDay] = useState(null);
  const [picked, setPicked] = useState(null);
  const [booking, setBooking] = useState(null);
  const [going, setGoing] = useState(null);
  const [riding, setRiding] = useState(null);
  const then = (close, open) => { close(); setTimeout(open, 250); };
  const data = useMemo(() => thingsFor(cityId, { trip, day, filters }), [cityId, trip, day, filters]);
  const toggle = (f) => setFilters((prev) => { const n = new Set(prev); if (n.has(f)) n.delete(f); else { n.add(f); if (['indoor', 'outdoor', 'see'].includes(f)) ['indoor', 'outdoor', 'see'].filter((x) => x !== f).forEach((x) => n.delete(x)); } return n; });
  const ids = data.today?.ids || [];
  const list = full ? data.shown : [...data.shown].sort((a, b) => (ids.includes(b.id) ? 1 : 0) - (ids.includes(a.id) ? 1 : 0));
  const days = trip ? tripDays(trip) : [];
  const none = !data.acts.length && !data.experiences.length && !data.events.length;
  return (
    <div className="col th" style={{ gap: 12 }} data-things={full ? 'full' : 'section'}>
      {!full && <div className="spread"><h2 className="h2" style={{ fontSize: 22 }}>{w('things.title')}</h2><button type="button" className="link" onClick={() => { buzz(HAPTIC.tap); push('things', { id: cityId, name: city, trip: !!trip }); }}>{w('things.seeAll')}</button></div>}
      {full && trip && days.length > 0 && <div className="chips scrollx th-rail">{[null, ...days].map((d) => <button key={d || 'any'} type="button" className={'chip' + (day === d ? ' on' : '')} onClick={() => setDay(d)}>{d ? dayLabel(d) : w('things.day.any')}</button>)}</div>}
      {full && <div className="chips scrollx th-rail">{FILTERS.filter(([f]) => (f !== 'near' || data.near) && (f !== 'open' || !day)).map(([f, k]) => <button key={f} type="button" className={'chip' + (filters.has(f) ? ' on' : '')} onClick={() => toggle(f)}>{f === 'family' && data.kids.length ? w('things.filter.kids', { ages: data.kids.join(', ') }) : w(k)}</button>)}</div>}
      {data.isToday && (data.weather || data.today) && (
        <div className="th-today">
          <span className="eyebrow" style={{ color: '#d9b77a' }}>{w('things.today.title')} · {data.clock.hhmm}</span>
          {data.weather && <span className="h3" style={{ color: '#fffdf9', fontSize: 17 }}>{w('things.today.weather', { temp: data.weather.tempC, max: data.weather.maxC })}</span>}
          {data.today && <span className="small" style={{ color: '#c9c1b4' }}>{w(`things.today.why.${data.today.why}`)}</span>}
          {data.today?.prayer && <span className="tiny" style={{ color: '#c9c1b4' }}>{w('things.today.prayer', { prayer: w(`things.prayer.${data.today.prayer.name}`), time: data.today.prayer.at })}</span>}
        </div>
      )}
      {none && (
        <EmptyState compact className="well" art={<ArtCompass />} title={w('things.none', { city })} action={<button type="button" className="btn secondary small" onClick={() => push('ask', { prefill: w('things.titleIn', { city }) })}>{w('things.noneAsk')}</button>} />
      )}
      {list.length > 0 && (full ? (
        <div className="col" style={{ gap: 10 }}>
          <span className="eyebrow">{w('things.places')}</span>
          {list.map((a) => (
            <button key={a.id} type="button" className="th-row" onClick={() => { buzz(HAPTIC.tap); setPicked({ ...a, _t: 'a' }); }}>
              <Photo k={a.photo} kind={a.kind} h={76} r={16} />
              <span className="grow col" style={{ gap: 2, minWidth: 0 }}><span className="h3" style={{ fontSize: 16 }}>{a.name}</span><span className="tiny">{[w(`things.kind.${a.kind}`), data.near ? minutesOf(travelEstimate(data.near, a)) : null, a.free ? w('things.free') : null].filter(Boolean).join(' · ')}</span>{openText(a) && <span className={'tiny ' + (a.openNow === false ? 'th-closed' : 'th-open')}>{openText(a)}</span>}</span>
              <Icon name="chevron" size={18} color="#5f6b65" />
            </button>
          ))}
        </div>
      ) : (
        <div className="th-rail scrollx">{list.slice(0, 8).map((a) => (
          <button key={a.id} type="button" className="th-card" onClick={() => { buzz(HAPTIC.tap); setPicked({ ...a, _t: 'a' }); }}>
            <Photo k={a.photo} kind={a.kind} />
            <span className="th-body"><span className="tiny" style={{ color: '#7d5d27' }}>{w(`things.kind.${a.kind}`)}</span><span className="h3" style={{ fontSize: 15 }}>{a.name}</span>{openText(a) && <span className={'tiny ' + (a.openNow === false ? 'th-closed' : 'th-open')}>{openText(a)}</span>}</span>
          </button>
        ))}</div>
      ))}
      {!list.length && data.acts.length > 0 && filters.size > 0 && <div className="card well" style={{ alignItems: 'center' }}><span className="small">{w('things.noMatch')}</span><button type="button" className="btn secondary small" onClick={() => setFilters(new Set())}>{w('things.clearFilters')}</button></div>}
      {data.experiences.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <span className="h3" style={{ fontSize: 18 }}>{w('things.book')}</span>
          <span className="tiny" style={{ marginTop: -4 }}>{w('things.bookSub')}</span>
          <div className="th-rail scrollx">{data.experiences.map((e) => (
            <button key={e.id} type="button" className={'th-card' + (full ? ' wide' : '')} onClick={() => { buzz(HAPTIC.tap); setPicked({ ...e, _t: 'e' }); }}>
              <span style={{ position: 'relative' }}><Photo k={e.photo} kind="attraction" h={full ? 150 : 118} />{e.freeCancel && <span className="th-badge">{w('things.freeCancel')}</span>}</span>
              <span className="th-body"><span className="h3" style={{ fontSize: 15 }}>{e.title}</span><span className="tiny">{[dur(e.durationMin), e.rating ? `★ ${e.rating.toFixed(1)}` : null].filter(Boolean).join(' · ')}</span><span><b className="th-price">{w('things.from', { price: sar(e.priceFrom.amount) })}</b> <span className="tiny">{w('things.perPerson')}</span></span></span>
            </button>
          ))}</div>
        </div>
      )}
      {data.events.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <span className="h3" style={{ fontSize: 18 }}>{day ? w('things.whatsOnDay', { day: dayLabel(day) }) : w('things.whatsOn')}</span>
          {(full ? data.events : data.events.slice(0, 3)).map((ev) => {
            const ongoing = ev.startsOn < data.clock.day && ev.endsOn > ev.startsOn;
            const shown = ongoing ? ev.endsOn : ev.startsOn;
            return (
              <button key={ev.id} type="button" className="th-row" onClick={() => { buzz(HAPTIC.tap); setPicked({ ...ev, _t: 'w' }); }}>
                <span className="th-date">{ongoing && <span className="tiny">{w('things.event.until')}</span>}<b>{Number(shown.slice(8))}</b><span className="tiny">{dayLabel(shown).split(' ').pop()}</span></span>
                <span className="grow col" style={{ gap: 2, minWidth: 0 }}><span className="h3" style={{ fontSize: 16 }}>{ev.title}</span><span className="tiny">{[ev.time, ev.venue].filter(Boolean).join(' · ')}</span><span className="tiny" style={{ color: '#7d5d27' }}>{ev.source === 'desk' ? w('things.event.fromDesk') : 'Ticketmaster'}</span></span>
                <Icon name="chevron" size={18} color="#5f6b65" />
              </button>
            );
          })}
        </div>
      )}
      {!none && <div className="col" style={{ gap: 4, padding: '0 4px' }}>
        <button type="button" className="link tiny" style={{ alignSelf: 'flex-start' }} onClick={() => push('thingsSources')}>{w('things.sourcesLink')}</button>
        <span className="tiny">© OpenStreetMap contributors, ODbL · Descriptions from Wikidata, CC0 · Places from GeoNames, CC BY 4.0</span>
      </div>}
      {picked && <ThingSheet x={picked} data={data} trip={trip} city={city} onClose={() => setPicked(null)} onBook={(x) => then(() => setPicked(null), () => setBooking(x))}
        onDirections={(x) => then(() => setPicked(null), () => setGoing(x))} onRide={(x) => then(() => setPicked(null), () => setRiding(x))} />}
      {booking && <BookSheet x={booking} city={city} trip={trip} day={day} onClose={() => setBooking(null)} />}
      {going && <DirectionsSheet x={going} city={city} near={data.near} hotel={trip ? stayOf(trip)?.name : null} onClose={() => { const x = going; then(() => setGoing(null), () => setPicked(x)); }} onRide={() => { const x = going; then(() => setGoing(null), () => setRiding(x)); }} />}
      {riding && <RideSheet x={riding} city={city} trip={trip} day={day} onClose={() => setRiding(null)} />}
    </div>
  );
}

/** The whole list: push('things', { id, name, trip }). */
export default function Things({ params = {} }) {
  const { s, pop } = useStore();
  const trip = params.trip ? s.trip : null;
  return (
    <div className="screen push">
      <TopBar onBack={pop} title={w('things.titleIn', { city: params.name || '' })} />
      <div className="scroll no-dock" style={{ paddingTop: 8 }}>
        <ThingsSection cityId={params.id} city={params.name} trip={trip} full />
      </div>
    </div>
  );
}

const SOURCES = ['things.source.osm', 'things.source.wikidata', 'things.source.wikipedia', 'things.source.wikivoyage', 'things.source.openmeteo', 'things.source.ticketmaster', 'things.source.geonames', 'things.source.partners', 'things.source.desk'];
export function ThingsSources() {
  const { pop } = useStore();
  return (
    <div className="screen push">
      <TopBar onBack={pop} title={w('things.sources')} />
      <div className="scroll no-dock" style={{ paddingTop: 8 }}>
        <h2 className="h2">{w('things.sourcesTitle')}</h2>
        <p className="body" style={{ margin: 0, color: '#1e352d' }}>{w('things.sourcesBody')}</p>
        {SOURCES.map((k) => <div key={k} className="card"><span className="small" style={{ color: '#1e352d' }}>{w(k)}</span></div>)}
      </div>
    </div>
  );
}

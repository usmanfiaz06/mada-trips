import React, { useEffect, useMemo, useState } from 'react';
import { useStore, buzz, HAPTIC, PEOPLE, FLIGHTS, fmt, addDays, daysBetween, dayLabel as isoDayLabel, weekday, dayOf, shortDay, fullDay, rangeLabel, toDate, seatText, pickupPlan, stayOf, stayEnd, signName, boardsAt, addMin as addMinS } from '../store.jsx';
import { Icon, TopBar, Sheet, SlideToConfirm, Tracker, AirlineMark, Steps, useTicker, PayMark, saveFile, calendarLink } from '../ui.jsx';

/* Trip management: itinerary, payments and VAT invoices, refunds, flight changes, hotel options and special requests.
   State this area owns: tripRequests (requests to Faisal with a live status), tripChangeLog (flight changes sent to pay).
   It also appends to s.requests (priced asks, paid through the quote flow), s.refunds and s.credit. */

/* ---------- reference ---------- */

export const TAX_PP = 312; /* airport and government taxes per person, per return ticket: refundable even on a fare that isn't */
const SERVICE_FEE = 100; /* Mada's service fee inside each flight payment; the only flight part with 15% VAT */
const SELLER = { name: 'Mada Trips', legal: 'Mada Travel and Tourism Co.', vat: '310245678900003', cr: 'CR 1010654321', address: 'King Fahd Rd, Al Olaya, Riyadh 12214' };
/* Days are ISO dates (2027-03-09). Labels come from them, so a moved flight moves every line. */
const dayLabel = (iso) => isoDayLabel(iso);
const addMin = addMinS;
const freeUntil = (iso) => shortDay(addDays(iso, -7));
const PICK_INFO = {
  k1: { title: 'Künefe near Galata Tower', time: '19:00', note: 'Noor’s tip. Go before 8, it sells out.' },
  k2: { title: 'Sunset from the Galata Bridge', time: '18:30', note: 'Ferries and the old city in gold. Free.' },
  k3: { title: 'Dinner with a Bosphorus view', time: '20:00', note: 'Halal, family seating, table for 4.' },
  k4: { title: 'An early night', time: '21:00', note: 'Room service, and a slow start tomorrow.' },
};
const PRAYER = 'Fajr 05:58 · Dhuhr 13:21 · Asr 16:37 · Maghrib 19:13 · Isha 20:36';

const cardLabel = (s) => { const c = s.cards.find((x) => x.id === s.trip?.card) || s.cards[0]; return c?.label || 'your card'; };
const cardBrandOf = (s) => { const c = s.cards.find((x) => x.id === s.trip?.card) || s.cards[0]; return String(c?.brand || 'visa').toLowerCase(); };
const nOf = (s) => s.trip?.travellers?.length || 1;
const names = (ids) => ids.map((id) => PEOPLE[id]?.name).filter(Boolean);
const joinNames = (arr) => (arr.length < 2 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
const sar = (n) => `SAR ${fmt(Math.abs(n))}`;
const credit0 = (p) => p.credit || { balance: 0, history: [] };
const addCredit = (p, amount, text) => { const c = credit0(p); return { credit: { ...c, balance: (c.balance || 0) + amount, history: [{ id: 'cr' + Date.now(), text, amount, at: Date.now() }, ...(c.history || [])] } }; };
const goRequests = (set) => set({ tab: 'trips', stack: [], tripsTab: 'requests' });

/* Fare rules read straight from the flight's own wording, so the numbers always match what was sold. */
export function fareRules(f) {
  const base = FLIGHTS.find((x) => x.iata === f?.iata) || FLIGHTS.find((x) => x.id === f?.id) || FLIGHTS[0];
  const num = (txt) => Number(((txt || '').match(/\d[\d,]*/) || ['0'])[0].replace(/,/g, ''));
  const refundable = !/not refundable/i.test(base.refund);
  return {
    base,
    changeFee: /free/i.test(base.change) ? 0 : num(base.change),
    refundable,
    refundFee: refundable ? num(base.refund) : null,
    bagFee: base.iata === 'XY' ? 180 : base.iata === 'TK' ? 220 : 250,
    bagKg: base.iata === 'XY' ? 20 : 23,
    bags: base.bags,
  };
}

/* Where the trip is in time decides every rule: free windows, 24-hour limits, what is already used. */
export function timing(s) {
  const ph = s.phase;
  return {
    early: ph === 'booked' || ph === 'none',
    within24: ['daybefore', 'travelday', 'delayed'].includes(ph),
    airlineCancelled: ph === 'cancelled',
    outUsed: ['inair', 'landed', 'home'].includes(ph),
    allUsed: ph === 'home',
  };
}

/* ---------- requests to Faisal ---------- */

const WITH = { airline: 'the airline', hotel: 'the hotel', faisal: 'Faisal' };
export function reqStatus(r, now = Date.now()) {
  if (r.queued) return 'queued';
  if (r.outcome === 'done') return 'done';
  const age = now - (r.created || now);
  if (age < 5000) return 'sent';
  if (age < 12000) return 'checking';
  return r.outcome === 'no' ? 'no' : 'yes';
}
export function reqLabel(r, now) {
  const st = reqStatus(r, now);
  const who = r.withName || WITH[r.with] || 'Faisal';
  return { queued: 'Waiting for a connection', sent: 'Sent to Faisal', checking: `Faisal is asking ${who}`, yes: r.with === 'faisal' ? 'Done' : `Confirmed by ${who}`, no: 'Can’t do it', done: 'Done' }[st];
}
export function ReqTracker({ r, now }) {
  const st = reqStatus(r, now);
  const who = r.withName || WITH[r.with] || 'Faisal';
  if (st === 'done' || st === 'yes') return null;
  return (
    <Tracker items={[
      { title: st === 'queued' ? 'Saved on this phone' : 'Sent to Faisal', sub: st === 'queued' ? 'Sends when you’re back online' : 'Today', state: st === 'queued' ? 'now' : 'done' },
      { title: `Faisal asks ${who}`, sub: st === 'checking' ? 'Usually within the hour' : st === 'sent' || st === 'queued' ? '' : 'Today', state: st === 'checking' ? 'now' : ['yes', 'no'].includes(st) ? 'done' : '' },
      { title: st === 'no' ? 'They can’t do it' : r.with === 'faisal' ? 'Done' : `Confirmed by ${who}`, sub: st === 'yes' ? r.yesText || 'Nothing to pay' : st === 'no' ? 'Faisal has another way, below' : '', state: st === 'yes' ? 'done' : st === 'no' ? 'now' : '' },
    ]} />
  );
}
/* Adds a request to Faisal. Offline, it waits on the phone and sends itself later (see Trips → Requests). */
export function useAskFaisal() {
  const { s, set } = useStore();
  return (r) => {
    const rec = { id: 'tr' + Date.now() + Math.floor(Math.random() * 99), created: Date.now(), with: 'faisal', outcome: 'yes', ...r, queued: !!s.demo.offline };
    set((p) => ({ tripRequests: [...(p.tripRequests || []), rec] }));
    return rec;
  };
}
/* Requests made offline wait on the phone; once there's signal they go, and the clock starts then. */
export function useUnqueue() {
  const { s, set } = useStore();
  const queued = (s.tripRequests || []).some((r) => r.queued);
  useEffect(() => {
    if (!s.demo.offline && queued) set((p) => ({ tripRequests: (p.tripRequests || []).map((r) => (r.queued ? { ...r, queued: false, created: Date.now() } : r)) }));
  }, [s.demo.offline, queued]);
}
/* A priced ask goes through the existing quote flow: Faisal confirms the price, then it can be paid from Trips → Requests. */
function useAskQuote() {
  const { s, set } = useStore();
  return (r) => set((p) => ({ requests: [...p.requests, { id: 'tq' + Date.now(), status: s.demo.offline ? 'queued' : 'sent', created: Date.now(), trip: p.trip?.id || 'ist', ...r }] }));
}

/* ---------- money ---------- */

const PAID_STATES = ['paid', 'done'];
function effStay(s) {
  const t = s.trip;
  if (!t?.stay) return null;
  let st = { ...t.stay };
  s.requests.filter((r) => r.stayPatch && PAID_STATES.includes(r.status)).forEach((r) => {
    const sp = r.stayPatch;
    st = { ...st, ...sp, nights: st.nights + (sp.addNights || 0), price: st.price + (sp.addPrice || 0) };
  });
  return st;
}
/* How the booking was paid: 'full' unless the traveller chose Tabby or Tamara at checkout. */
function payPlan(s) {
  return s.trip?.payPlan || 'full';
}
/* Monthly from the day it was booked. */
const bookedISO = (t) => new Date(t?.bookedAt || Date.now()).toISOString().slice(0, 10);
const bookedDate = (t) => { const d = new Date(t?.bookedAt || Date.now()); return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const bookedTime = (t) => { const d = new Date((t?.bookedAt || Date.now()) + 3 * 3600000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; }; /* Riyadh time */
function instalments(total, plan, s) {
  const count = plan === 'tamara' ? 3 : 4;
  const each = Math.ceil(total / count);
  const start = toDate(bookedISO(s.trip));
  const dates = Array.from({ length: count }, (_, i) => { const d = new Date(start); d.setUTCMonth(d.getUTCMonth() + i); return shortDay(d.toISOString().slice(0, 10)); });
  const paid = s.phase === 'home' ? 2 : 1;
  return dates.map((d, i) => ({ date: d, amount: i === count - 1 ? total - each * (count - 1) : each, paid: i < paid }));
}
export function isRefunded(s, key) {
  if (key === 'stay' && s.trip?.stay?.status === 'cancelled') return true;
  return s.refunds.some((r) => (r.items || []).includes(key) && r.stage !== -1);
}
function refundOf(s, key) {
  const r = s.refunds.find((x) => (x.items || []).includes(key) && x.stage !== -1);
  if (r) return r;
  if (key === 'stay' && s.trip?.stay?.status === 'cancelled') return s.refunds.find((x) => s.trip.stay.name && x.title.includes(s.trip.stay.name)) || { id: 'legacy', amount: s.trip.stay.price, title: s.trip.stay.name };
  return null;
}

/* Every payment for the trip, newest last, read from what was actually booked and paid.
   Lines carry their VAT rate so the invoice can show the split. */
export function tripPayments(s) {
  const t = s.trip;
  if (!t) return [];
  const n = nOf(s);
  const card = t.paid?.card && t.paid.card !== 'Mada credit' ? t.paid.card : cardLabel(s);
  const brand = /apple pay/i.test(card) ? 'applepay' : cardBrandOf(s);
  const plan = payPlan(s);
  const list = [];
  const f = t.flight;
  const date = bookedDate(t);
  const time = bookedTime(t);
  const yy = String(new Date(t.bookedAt || Date.now()).getUTCFullYear()).slice(2);
  const no = (k) => `MT-${yy}-${String((t.invoiceSeq || 4181) + k).padStart(6, '0')}`;
  const methodFor = (m) => (['tabby', 'tamara'].includes(m) ? m : brand);
  const promo = t.paid?.discount ? { text: t.paid.promo ? `Code ${t.paid.promo} · 10% off` : 'Discount', qty: 1, gross: -t.paid.discount, vat: 0, note: 'Taken off the fare' } : null;
  if (f && t.flightPrice) {
    const ways = f.back ? 'return' : 'one way';
    const cabin = f.cabin && f.cabin !== 'Economy' ? `${f.cabin}, ` : '';
    const babies = (t.lines || []).find((l) => l.key === 'infants');
    const tickets = t.flightPrice - (babies?.price || 0);
    const amount = t.flightPrice - (promo ? t.paid.discount : 0);
    list.push({
      id: 'flight', icon: 'flight', title: `Flights · ${f.airline}`, sub: `${f.back ? `${f.code} and ${f.back}` : `${f.code}, one way`} · ${n} ${n === 1 ? 'traveller' : 'travellers'}${f.cabin && f.cabin !== 'Economy' ? ' · ' + f.cabin : ''}`,
      amount, method: methodFor(plan), card, date, time, no: no(0),
      plan: ['tabby', 'tamara'].includes(plan) ? instalments(amount, plan, s) : null,
      credit: t.paid?.creditUsed || 0,
      lines: [
        { text: `Air tickets ${f.from}–${f.to} ${ways}, ${cabin}${n} × ${sar(Math.round((tickets - SERVICE_FEE) / n))}`, qty: 1, gross: tickets - SERVICE_FEE, vat: 0, note: 'International transport, zero-rated' },
        ...(babies ? [{ text: babies.text, qty: 1, gross: babies.price, vat: 0, note: 'Lap infant fare, zero-rated' }] : []),
        { text: 'Mada service fee', qty: 1, gross: SERVICE_FEE, vat: 15 },
        ...(promo ? [promo] : []),
      ],
    });
  }
  if (t.stay) {
    const st = effStay(s);
    const method = t.stay.plan || plan;
    const price = t.stay.price;
    list.push({
      id: 'stay', icon: 'stay', title: t.stay.name, sub: `${t.stay.nights} nights · from ${shortDay(t.stay.fromISO)}`, amount: price, method: methodFor(method), card, date, time, no: no(1),
      plan: ['tabby', 'tamara'].includes(method) ? instalments(price, method, s) : null,
      lines: [{ text: `${n > 2 ? 'Connecting rooms' : 'Room'}, ${t.stay.nights} nights × ${sar(Math.round(price / t.stay.nights))}`, qty: 1, gross: price, vat: 15 }],
      extended: st.nights !== t.stay.nights,
    });
  }
  if (t.pickup) {
    const pk = t.pickup;
    const rides = pk.arrivalOnly ? 1 : pk.oneway ? 2 : 4;
    list.push({ id: 'pickup', icon: 'car', title: pk.arrivalOnly ? 'Airport pickup on arrival' : pk.oneway ? 'Airport pickups on the way there' : 'Airport pickup both ways', sub: `${pk.home ? `${pk.home.driver} in Riyadh · ` : ''}${pk.arrive?.driver || 'Ahmet'} in Istanbul`, amount: pk.price, method: methodFor(plan), card, date, time, no: no(2), plan: ['tabby', 'tamara'].includes(plan) ? instalments(pk.price, plan, s) : null, lines: [{ text: `Private transfer${rides === 1 ? '' : 's'}, ${rides} ${rides === 1 ? 'ride' : 'rides'}`, qty: 1, gross: pk.price, vat: 15 }] });
  }
  (s.tripChangeLog || []).forEach((c, i) => {
    const applied = f && Object.keys(c.patch || {}).every((k) => f[k] === c.patch[k]);
    if (!applied || !(c.amount > 0)) return;
    list.push({ id: c.id, icon: 'flight', title: 'Flight change', sub: c.label, amount: c.amount, method: brand, card, date: c.at ? fullDay(new Date(c.at).toISOString().slice(0, 10)) : 'Today', time: '', no: `MT-27-00${4190 + i}`, lines: [{ text: c.label, qty: 1, gross: c.amount, vat: 0, note: 'Fare difference and change fee' }] });
  });
  s.requests.filter((r) => r.quote > 0 && PAID_STATES.includes(r.status) && (r.trip || ['food', 'todo', 'car'].includes(r.kind))).forEach((r, i) => {
    list.push({ id: 'x:' + r.id, icon: r.icon || (r.kind === 'food' ? 'food' : r.kind === 'car' ? 'car' : 'star'), title: r.title.replace(/^Booked: /, ''), sub: r.detail || 'Extra', amount: r.quote, method: brand, card, date: 'Today', time: '', no: `MT-27-00${4200 + i}`, lines: [{ text: r.title, qty: 1, gross: r.quote, vat: r.vat ?? 15 }], extra: true });
  });
  if (s.circles?.sharePaid) list.push({ id: 'share', icon: 'star', title: 'Your share of the cruise', sub: 'Paid to Abdullah’s booking', amount: 380, method: brand, card, date: 'Last week', time: '', no: 'MT-27-004177', lines: [{ text: 'Bosphorus dinner cruise, your share', qty: 1, gross: 380, vat: 15 }], extra: true });
  return list.map((p) => { const r = refundOf(s, p.id); return { ...p, refund: r ? { ...r, credited: r.perItem?.[p.id] ?? r.amount } : null }; });
}
const splitVat = (l) => { const net = l.vat ? l.gross / (1 + l.vat / 100) : l.gross; return { net, vat: l.gross - net }; };
const methodName = (p) => (p.method === 'tabby' ? 'Tabby · 4 payments' : p.method === 'tamara' ? 'Tamara · 3 payments' : p.card) + (p.credit ? ` and SAR ${fmt(p.credit)} Mada credit` : '');

/* What comes back if this item is cancelled now, and why. Every number traces to a rule the traveller was shown. */
export function refundQuote(s, key) {
  const t = s.trip;
  const tm = timing(s);
  const n = nOf(s);
  if (key === 'flight' && t.flight) {
    const f = t.flight;
    const R = fareRules(f);
    const price = t.flightPrice || f.pp * n;
    const oneway = !f.back;
    if (tm.allUsed || (oneway && tm.outUsed)) return { back: 0, paid: price, rule: oneway ? 'The flight is flown.' : 'Both flights are flown.', why: 'There’s nothing left on the tickets to refund.' };
    if (tm.airlineCancelled) return { back: price, paid: price, rule: `${f.airline} cancelled this flight.`, why: 'Under GACA rules you get the full price back, fees and all.', law: true };
    const part = tm.outUsed ? 0.5 : 1;
    const legs = oneway ? 'the flight' : tm.outUsed ? 'the way back' : 'both flights';
    const taxPP = oneway ? TAX_PP / 2 : TAX_PP;
    if (R.refundable) {
      const fee = R.refundFee * n * part;
      return { back: Math.round(price * part - fee), paid: price, rule: `${f.airline} fare: refund minus SAR ${R.refundFee} per person${tm.outUsed ? ', for the unused way back' : ''}.`, why: tm.outUsed ? 'You’ve flown the way there. The way back is unused, so that half comes back, minus the fee.' : `Fee for ${n}: ${sar(fee)}. Refunds ${legs}.`, fee };
    }
    return { back: Math.round(taxPP * n * part), paid: price, rule: `This ${f.airline} fare can’t be refunded. Airport taxes can: SAR ${taxPP} per person${tm.outUsed ? ' for the return' : ''}.`, why: 'The airline never pays those taxes if you don’t fly, so they come back to you. The fare itself doesn’t.', taxesOnly: true };
  }
  if (key === 'stay' && t.stay) {
    const st = t.stay;
    const night = st.night || Math.round(st.price / st.nights);
    if (tm.allUsed) return { back: 0, paid: st.price, rule: 'Your stay is over.', why: 'Every night was used.' };
    if (tm.airlineCancelled) return { back: st.price, paid: st.price, rule: 'Free, because the flight was cancelled.', why: 'The hotel waives its rule when the airline cancels. Faisal already told them.' };
    if (tm.outUsed) return { back: Math.max(0, st.price - night * 2), paid: st.price, rule: 'Tonight is used. The hotel keeps one more night as its fee.', why: `${st.nights - 1} unused nights, minus one night (${sar(night)}).` };
    if (tm.early) return { back: st.price, paid: st.price, rule: `Free to cancel until ${freeUntil(st.fromISO)}.`, why: 'Every riyal comes back.' };
    return { back: st.price - night, paid: st.price, rule: `After ${freeUntil(st.fromISO)} the hotel keeps the first night, ${sar(night)}.`, why: 'The other nights come back.' };
  }
  if (key === 'pickup' && t.pickup) {
    const p = t.pickup.price;
    if (tm.allUsed) return { back: 0, paid: p, rule: t.pickup.oneway ? 'Both rides are done.' : 'All four rides are done.', why: '' };
    if (tm.airlineCancelled) return { back: p, paid: p, rule: 'Free, because the flight was cancelled.', why: '' };
    if (tm.outUsed && t.pickup.oneway) return { back: 0, paid: p, rule: 'Both rides are done.', why: '' };
    if (tm.outUsed) return { back: Math.round(p / 2), paid: p, rule: 'The rides there are done. The rides home aren’t.', why: 'Half comes back.' };
    if (tm.within24) return { back: 0, paid: p, rule: 'Inside 24 hours, the driver is paid in full.', why: `${t.pickup.home?.driver || 'Your driver'} is booked for the morning. You can still ask Faisal.`, askAnyway: true };
    return { back: p, paid: p, rule: 'Free to cancel until 24 hours before.', why: '' };
  }
  if (key.startsWith('x:')) {
    const r = s.requests.find((x) => 'x:' + x.id === key);
    if (!r) return null;
    if (tm.early) return { back: r.quote, paid: r.quote, rule: 'Free to cancel until 48 hours before.', why: '' };
    return { back: 0, paid: r.quote, rule: 'Inside 48 hours this can’t be refunded.', why: 'The place is holding it for you. You can still ask Faisal.', askAnyway: true };
  }
  if (key === 'share') return { back: tm.early ? 380 : 0, paid: 380, rule: tm.early ? 'Free to cancel until 48 hours before.' : 'Inside 48 hours this can’t be refunded.', why: '', askAnyway: !tm.early };
  return null;
}

/* With instalments, what comes back is what was paid so far, less what the rule keeps; the payments left are cancelled. */
export function refundMoney(p, q) {
  if (p && q && ['tabby', 'tamara'].includes(p.method) && p.plan) {
    const paidSoFar = p.plan.filter((i) => i.paid).reduce((a, i) => a + i.amount, 0);
    const keep = p.amount - q.back;
    return { cash: Math.max(0, paidSoFar - keep), cancelled: p.amount - paidSoFar, count: p.plan.filter((i) => !i.paid).length, owe: Math.max(0, keep - paidSoFar) };
  }
  return { cash: q ? q.back : 0, cancelled: 0, count: 0, owe: 0 };
}

/* ---------- shared bits ---------- */

function Screen({ title, children, act, onBack }) {
  const { pop } = useStore();
  return (
    <div className="screen push tm">
      <TopBar onBack={onBack || pop} title={title} />
      <div className={'scroll no-dock' + (act ? ' tm-has-act' : '')}>{children}</div>
      {act && <div className="act tm-act">{act}</div>}
    </div>
  );
}
function NoTrip() {
  const { push } = useStore();
  return (
    <Screen title="">
      <div className="card well"><span className="h3">No trip booked.</span><span className="small">Once Faisal confirms a trip, everything about it lives here.</span>
        <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={() => push('ask', {})}>Plan a trip</button></div>
    </Screen>
  );
}
function Faisal({ children, dark }) {
  return (
    <div className={'tm-faisal' + (dark ? ' dark' : '')}>
      <span className="avatar sm green">F</span>
      <span className="small">{children}</span>
    </div>
  );
}
function Row({ icon, title, sub, right, onClick, label, tone }) {
  const inner = (
    <>
      {icon && <span className={'tm-ic' + (tone ? ' ' + tone : '')}><Icon name={icon} size={20} /></span>}
      <span className="grow col" style={{ gap: 1 }}><span className="tm-row-title">{title}</span>{sub && <span className="tiny">{sub}</span>}</span>
      {right}
      {onClick && <Icon name="chevron" size={18} color="#5f6b65" />}
    </>
  );
  return onClick
    ? <button type="button" className="tm-row" onClick={() => { buzz(HAPTIC.tap); onClick(); }} aria-label={label}>{inner}</button>
    : <div className="tm-row">{inner}</div>;
}
function Pick({ on, onClick, title, sub, right, disabled, note, radio }) {
  return (
    <button type="button" className={'card tap tm-pick' + (on ? ' on' : '')} role={radio ? 'radio' : 'checkbox'} aria-checked={on ? 'true' : 'false'} disabled={disabled} onClick={() => { buzz(HAPTIC.select); onClick(); }}>
      <span className="spread" style={{ alignItems: 'flex-start' }}>
        <span className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
          <span className={'tickbox' + (on ? ' on' : '')} style={radio ? { borderRadius: 99 } : null}>{on && <Icon name="check" size={14} color="#f6f2ec" width={2.6} />}</span>
          <span className="col" style={{ gap: 2 }}><span className="h3" style={{ fontSize: 15 }}>{title}</span>{sub && <span className="tiny">{sub}</span>}</span>
        </span>
        {right && <span className="num tm-amt">{right}</span>}
      </span>
      {note && <span className="small tm-pick-note">{note}</span>}
    </button>
  );
}

/* ================================================================
   1. Itinerary
   ================================================================ */

function useItinerary() {
  const { s } = useStore();
  const t = s.trip;
  if (!t) return [];
  const f = t.flight && !isRefunded(s, 'flight') ? t.flight : null;
  const st = t.stay && t.stay.status !== 'cancelled' ? effStay(s) : null;
  const n = nOf(s);
  const trq = (s.tripRequests || []).filter((r) => reqStatus(r) === 'yes' || r.outcome === 'done');
  const tags = (kind) => trq.filter((r) => r.kind === kind).map((r) => r.short || r.title);
  const R = f ? fareRules(f) : null;
  const outDay = f ? f.dateISO : st?.fromISO;
  const backDay = f ? f.backDateISO : null;
  const inDay = st ? st.fromISO || outDay : null;
  const outDayStay = st ? addDays(inDay, st.nights) : null;
  const firsts = [outDay, inDay].filter(Boolean).sort();
  const lasts = [backDay, outDayStay, outDay].filter(Boolean).sort();
  const first = firsts[0];
  const last = lasts[lasts.length - 1];
  const days = {};
  for (let d = first, i = 0; d <= last && i < 40; d = addDays(d, 1), i += 1) days[d] = { d, items: [], docs: [] };
  const add = (d, it) => { if (d && days[d]) days[d].items.push(it); };
  const pickup = t.pickup && !isRefunded(s, 'pickup') ? t.pickup : null;
  const pk = pickup ? pickupPlan(t) : null;
  const arrAirport = f?.to === 'SAW' ? 'Sabiha Gökçen' : 'Istanbul Airport';
  const tm = timing(s);
  const where = st ? st.name : t.noStay?.address ? t.noStay.address : null;

  if (f) {
    if (pk) add(pk.dateISO, { id: 'pk-ruh', time: pk.time, icon: 'car', kind: 'pickup', title: `${pk.driver} picks you up at home`, sub: `${pk.car} · ${pk.room}`, driver: pk.driver, phone: pk.phone, car: pk.car, status: tm.outUsed ? 'done' : null, warn: pk.dateISO !== f.dateISO ? `Still booked for ${dayLabel(pk.dateISO)}. Your flight is ${f.date}.` : null });
    add(outDay, {
      id: 'fl-out', time: f.dep, icon: 'flight', kind: 'flight', leg: 'out', title: `Riyadh → Istanbul · ${f.code}`,
      sub: `${f.airline}${f.cabin && f.cabin !== 'Economy' ? ' · ' + f.cabin : ''} · RUH ${f.terminal} · lands ${f.arr} at ${f.to}`, facts: [['Seats', seatText(f.seats)], ['Bags', `${R.bags} each`], ['Boarding', boardsAt(f)]],
      tags: [...tags('meal'), ...tags('wheelchair'), ...tags('seats'), ...tags('bags'), ...tags('sports')], status: tm.outUsed ? 'done' : tm.airlineCancelled ? 'cancelled' : null,
    });
    if (pickup) add(outDay, { id: 'pk-ist', time: addMin(f.arr, 45), icon: 'car', kind: 'pickup', title: `${pickup.arrive.driver} meets you at ${pickup.arrive.door}`, sub: where ? `${arrAirport} · sign with your name · ${st?.fromAirport || '45 min'} to ${st ? 'the hotel' : 'where you’re staying'}` : `${arrAirport} · sign with your name · tell us where you’re staying`, driver: pickup.arrive.driver, phone: pickup.arrive.phone, car: `${pickup.arrive.car} · ${pickup.arrive.plate}`, status: s.phase === 'landed' || s.phase === 'home' ? 'done' : null, warn: where ? null : 'No hotel booked. Where are you staying?' });
    if (!where && t.stay?.status === 'cancelled') add(outDay, { id: 'nostay', time: addMin(f.arr, 90), icon: 'stay', kind: 'nostay', title: 'No hotel booked. Where are you staying?', sub: 'Tell us, so the driver and Faisal know where you are.' });
    if (!st && t.noStay?.address) add(outDay, { id: 'stay-own', time: addMin(f.arr, 105), icon: 'stay', kind: 'own', title: `Staying at ${t.noStay.label || 'your own place'}`, sub: t.noStay.address });
  }
  if (st) {
    const early = trq.find((r) => r.kind === 'early');
    const late = trq.find((r) => r.kind === 'late');
    const arriveAt = f && f.dateISO === inDay ? addMin(f.arr, 105) : '14:00';
    const landsLater = f && f.dateISO > inDay;
    add(inDay, { id: 'h-in', time: early ? '10:00' : arriveAt < '14:00' ? '14:00' : arriveAt, icon: 'stay', kind: 'hotel', title: `Check in · ${st.name}`, sub: `${st.roomType || (n > 2 ? 'Connecting rooms' : 'A room')} · ${st.nights} nights${early ? ' · early check-in' : ''}`, tags: [...tags('celebration'), ...tags('prayer'), ...tags('room'), ...tags('bed'), ...tags('connecting')], warn: landsLater ? `You land on ${f.date}. This night is paid for but empty.` : null });
    add(outDayStay, { id: 'h-out', time: late ? late.until || '14:00' : '12:00', icon: 'stay', kind: 'hotel', title: 'Check out', sub: late ? 'Late checkout, confirmed' : 'Leave bags at the desk if you want to walk', warn: backDay && outDayStay < backDay ? `Your flight home is ${f.backDate}. No room for the last ${daysBetween(outDayStay, backDay) === 1 ? 'night' : daysBetween(outDayStay, backDay) + ' nights'}.` : null });
  }
  if (f && f.back) {
    const back = addMin(f.backDep, -210);
    if (pickup && !pickup.oneway) add(backDay, { id: 'pk-back', time: back, icon: 'car', kind: 'pickup', title: `${pickup.arrive.driver} takes you to the airport`, sub: `From ${st ? 'the hotel' : 'where you’re staying'} · ${f.to === 'SAW' ? 'about an hour' : '45 min'}`, driver: pickup.arrive.driver, phone: pickup.arrive.phone });
    add(backDay, { id: 'fl-back', time: f.backDep, icon: 'flight', kind: 'flight', leg: 'back', title: `Istanbul → Riyadh · ${f.back}`, sub: `${f.airline}${f.cabin && f.cabin !== 'Economy' ? ' · ' + f.cabin : ''} · lands ${f.backArr} at RUH`, facts: [['Seats', seatText(f.backSeats)], ['Bags', `${R.bags} each`], ['Boarding', addMin(f.backDep, -45)]], tags: [...tags('meal'), ...tags('wheelchair')], status: s.phase === 'home' ? 'done' : null });
    if (pickup && !pickup.oneway) add(backDay, { id: 'pk-home', time: addMin(f.backArr, 30), icon: 'car', kind: 'pickup', title: `${pickup.home.driver} drives you home`, sub: 'Meets you at arrivals, Door 2', driver: pickup.home.driver, phone: pickup.home.phone });
    Object.keys(f).filter((k) => k.startsWith('split_')).forEach((k) => {
      const who = PEOPLE[k.slice(6)]?.name || 'One of you';
      const d = parseDay(f[k]);
      add(d, { id: 'fl-' + k, time: f.backDep, icon: 'flight', kind: 'flight', leg: 'back', title: `${who} flies home · ${f.back}`, sub: `${f.airline} · ${f[k]} · lands ${f.backArr}`, facts: [['Seat', (f.backSeats || [])[0] || '16A'], ['Bags', R.bags]] });
    });
  }
  /* Booked extras: in-flight picks, plan items and tables. */
  const second = addDays(outDay, 1);
  const third = addDays(outDay, 2);
  (s.inflightPicks || []).forEach((id) => {
    const p = PICK_INFO[id];
    if (p) add(outDay, { id: 'pick-' + id, time: p.time, icon: id === 'k4' ? 'stay' : 'food', kind: 'pick', title: p.title, sub: p.note, status: s.phase === 'landed' || s.phase === 'home' ? 'booked' : 'pending', pendingText: 'Booking when you land' });
  });
  s.requests.filter((r) => ['food', 'todo', 'car'].includes(r.kind) && ['quote', 'paid', 'done'].includes(r.status)).forEach((r) => {
    const map = { food: [outDay, '19:30', 'food', `Table for ${n} by the window`, n > 2 ? 'Halal menu, family seating' : 'Halal menu'], todo: [second, '19:30', 'star', 'Bosphorus dinner cruise', 'Dinner included · from Kabataş pier'], car: [third, '09:00', 'car', '7-seat car with a child seat', 'Picked up at the hotel · 3 days'] }[r.kind];
    add(map[0], { id: 'rq-' + r.id, time: map[1], icon: map[2], kind: 'booked', title: map[3], sub: map[4], status: r.status === 'quote' ? 'pending' : 'booked', pendingText: 'Held · pay to confirm', reqId: r.id, refundKey: PAID_STATES.includes(r.status) && r.quote > 0 ? 'x:' + r.id : null });
  });
  if (s.circles?.sharePaid && !s.requests.some((r) => r.kind === 'todo' && ['quote', 'paid', 'done'].includes(r.status))) add(second, { id: 'cruise', time: '19:30', icon: 'star', kind: 'booked', title: 'Bosphorus dinner cruise', sub: 'With Abdullah’s family · from Kabataş pier', status: 'booked', refundKey: 'share' });
  trq.filter((r) => r.kind === 'celebration' && r.day).forEach((r) => add(typeof r.day === 'number' ? addDays(outDay, r.day - 9) : r.day, { id: 'cel-' + r.id, time: '20:00', icon: 'star', kind: 'note', title: r.short, sub: 'The hotel knows. Something small in the room.' }));

  /* Free days get gentle ideas, never filler. Friday is Jumu'ah; Sunday the Grand Bazaar is shut. */
  const kids = (t.travellers || []).some((id) => /daughter|son/i.test(PEOPLE[id]?.role || ''));
  const pool = [
    (d) => ['Hagia Sophia and the Blue Mosque', 'Go before 10, the queues are short. 8 min by tram.', `Tickets for Hagia Sophia on ${dayLabel(d)}`],
    (d) => ['Basilica Cistern', `Book a time slot and skip the line.${kids ? ' Kids love the fish.' : ''}`, `Tickets for the Basilica Cistern on ${dayLabel(d)}`],
    (d) => ['A day on Büyükada', 'The biggest of the Princes’ Islands. No cars, just bikes and walks.', `Ferry tickets to Büyükada on ${dayLabel(d)}`],
    (d) => (kids ? ['Miniaturk with the kids', 'All of Türkiye in miniature. 2 hours is plenty.', `Tickets for Miniaturk on ${dayLabel(d)}`] : ['Ferry from Eminönü to Kadıköy', '20 minutes on the water, about SAR 4 each.', null]),
  ];
  let k = 0;
  const lastFull = backDay ? addDays(backDay, -1) : outDayStay ? addDays(outDayStay, -1) : null;
  Object.values(days).forEach((day) => {
    const booked = day.items.filter((i) => ['flight', 'booked', 'pick'].includes(i.kind)).length;
    if (!booked && day.d !== outDay && day.d !== backDay) {
      const wd = weekday(day.d);
      const ideas = wd === 'Fri' ? [['Jumu’ah at Süleymaniye Mosque', 'Khutbah at 13:21. Be there by 12:45 for space inside.', null], ['Grand Bazaar', 'Open until 19:00. Closed on Sundays.', null]]
        : wd === 'Sun' ? [['Spice Bazaar', 'Open today, unlike the Grand Bazaar. Lokum to take home.', null]]
        : [pool[k++ % pool.length](day.d)];
      if (day.d === lastFull) ideas.push(['Pack tonight', f && f.back && pickup ? `${pickup.arrive.driver} picks you up at ${addMin(f.backDep, -210)} tomorrow.` : 'Check-out is at 12:00 tomorrow.', null]);
      ideas.forEach(([title, sub, ask], i) => day.items.push({ id: `idea-${day.d}-${i}`, time: null, icon: 'pin', kind: 'idea', title, sub, ask }));
    }
    day.items.sort((a, b) => ((a.time || '99') < (b.time || '99') ? -1 : 1));
    const hasFlight = day.items.some((i) => i.kind === 'flight');
    day.free = !day.items.some((i) => i.kind !== 'idea' && i.kind !== 'note');
    day.title = day.d === outDay && f ? 'You fly to Istanbul' : day.d === backDay ? 'Home' : day.free ? 'A free day' : 'In Istanbul';
    day.docs = hasFlight
      ? [`Passports for ${n === 1 ? 'you' : 'all ' + n}`, 'Boarding passes, in your Wallet', ...(day.d === outDay && st ? ['Hotel booking, shown at check-in'] : [])]
      : ['Passport copies are in your Wallet. Originals stay in the room safe.'];
  });
  return Object.values(days);
}
/* Old labels like "Sun 14 Mar" to an ISO day in the trip's year. */
const parseDay = (label) => { const m = /(\d{1,2})\s+([A-Z][a-z]{2})/.exec(label || ''); return m ? `2027-${String(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null; };

/* A real calendar file. Riyadh and Istanbul are both UTC+3 all year, so times convert the same way. */
function buildIcs(days, s) {
  const pad = (x) => String(x).padStart(2, '0');
  const stamp = (iso, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const [y, mo, d] = iso.split('-').map(Number); const dt = new Date(Date.UTC(y, mo - 1, d, h - 3, m)); return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00Z`; };
  const esc = (x) => String(x).replace(/[,;\\]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const st = stayOf(s?.trip);
  const evs = [];
  days.forEach((day) => day.items.filter((i) => i.time && i.kind !== 'idea').forEach((i) => {
    const mins = i.kind === 'flight' ? 255 : i.kind === 'pickup' ? 45 : 90;
    evs.push({ where: i.kind === 'flight' ? (i.leg === 'back' ? 'Istanbul Airport' : 'King Khalid International Airport, Riyadh') : i.kind === 'hotel' ? (st?.address || '') : '', uid: `${i.id}-${day.d}@madatrips.sa`, start: stamp(day.d, i.time), end: stamp(day.d, addMin(i.time, mins)), title: i.title, desc: i.sub || '', day: day.d, time: i.time });
  }));
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mada Trips//Itinerary//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Istanbul with Mada'];
  evs.forEach((e) => lines.push('BEGIN:VEVENT', `UID:${e.uid}`, 'DTSTAMP:20270214T074200Z', `DTSTART:${e.start}`, `DTEND:${e.end}`, `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(e.desc)}`, 'END:VEVENT'));
  lines.push('END:VCALENDAR');
  return { text: lines.join('\r\n'), events: evs };
}

function Itinerary() {
  const { s, pop } = useStore();
  const days = useItinerary();
  const [sheet, setSheet] = useState(null);
  const [item, setItem] = useState(null);
  const [dayIdx, setDayIdx] = useState(0);
  if (!s.trip) return <NoTrip />;
  const t = s.trip;
  const jump = (i) => {
    setDayIdx(i);
    buzz(HAPTIC.select);
    const el = document.getElementById('tm-day-' + days[i].d);
    const sc = el?.closest('.scroll');
    if (el && sc) sc.scrollTo({ top: el.offsetTop - sc.offsetTop - 8, behavior: 'smooth' });
  };
  return (
    <div className="screen push tm">
      <TopBar onBack={pop} title="Itinerary" right={<button type="button" className="icon-btn" aria-label="Share the itinerary" onClick={() => setSheet('share')}><Icon name="link" size={20} /></button>} />
      <div className="tm-daybar chips scrollx" role="tablist" aria-label="Days">
        {days.map((d, i) => (
          <button key={d.d} type="button" role="tab" aria-selected={dayIdx === i ? 'true' : 'false'} className={'tm-daychip' + (dayIdx === i ? ' on' : '')} onClick={() => jump(i)}>
            <span>{weekday(d.d)}</span><b className="num">{dayOf(d.d)}</b>
          </button>
        ))}
      </div>
      <div className="scroll no-dock" style={{ paddingTop: 6 }} onScroll={(e) => {
        const sc = e.currentTarget;
        const top = sc.scrollTop;
        let idx = 0;
        days.forEach((d, i) => { const el = document.getElementById('tm-day-' + d.d); if (el && el.offsetTop - sc.offsetTop - 60 <= top) idx = i; });
        if (idx !== dayIdx) setDayIdx(idx);
      }}>
        <div className="col rise" style={{ gap: 6 }}>
          <span className="eyebrow">{t.datesLong} · {days.length} days</span>
          <h1 className="display" style={{ fontSize: 40 }}>Istanbul, day by day</h1>
          {(t.flight && t.pickup && t.pickup.status !== 'cancelled' && t.pickup.dateISO !== t.flight.dateISO) || (t.flight && stayOf(t) && stayOf(t).fromISO !== t.flight.dateISO) ? <MoveNotice /> : null}
          <span className="row tiny"><Icon name="wifiOff" size={14} color="#5f6b65" />Saved on this phone. Works without signal.</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn secondary small" onClick={() => setSheet('cal')}><Icon name="bell" size={18} />Add to calendar</button>
          <button type="button" className="btn secondary small" onClick={() => setSheet('share')}><Icon name="link" size={18} />Share</button>
        </div>
        {days.map((day) => (
          <section key={day.d} id={'tm-day-' + day.d} className="tm-day rise" aria-label={dayLabel(day.d)}>
            <header className="tm-day-head">
              <span className="tm-day-date"><b className="num">{dayOf(day.d)}</b><span>{weekday(day.d)}</span></span>
              <span className="col" style={{ gap: 0 }}><span className="h3">{day.title}</span><span className="tiny">{dayLabel(day.d)} · {PRAYER.split(' · ').slice(1, 4).join(' · ')}</span></span>
            </header>
            <div className="tm-tl">
              {day.items.map((it) => (
                <button key={it.id} type="button" className={'tm-ev' + (it.kind === 'idea' ? ' idea' : '') + (it.status === 'done' ? ' past' : '')} onClick={() => { buzz(HAPTIC.tap); setItem({ ...it, day: day.d }); }}>
                  <span className="tm-ev-time num">{it.time || ''}</span>
                  <span className={'tm-ev-dot ' + it.kind} aria-hidden="true"><Icon name={it.icon} size={15} /></span>
                  <span className="tm-ev-body">
                    <span className="tm-ev-title">{it.title}</span>
                    {it.sub && <span className="tiny">{it.sub}</span>}
                    {it.facts && <span className="tm-facts">{it.facts.map(([k, v]) => <span key={k}><i>{k}</i>{v}</span>)}</span>}
                    {(it.tags || []).length > 0 && <span className="chips" style={{ gap: 4 }}>{it.tags.map((g) => <span key={g} className="pill ok" style={{ height: 22, fontSize: 11 }}>{g}</span>)}</span>}
                    {it.status === 'pending' && <span className="pill gold" style={{ alignSelf: 'flex-start', height: 22, fontSize: 11 }}>{it.pendingText}</span>}
                    {it.status === 'cancelled' && <span className="pill" style={{ alignSelf: 'flex-start', height: 22, fontSize: 11, color: '#8a3524' }}>Cancelled by the airline</span>}
                    {it.warn && <span className="tm-warn">{it.warn}</span>}
                  </span>
                </button>
              ))}
            </div>
            <div className="tm-docs"><Icon name="doc" size={16} /><span className="tiny"><b>Carry:</b> {day.docs.join(' · ')}</span></div>
          </section>
        ))}
        <span className="tiny" style={{ textAlign: 'center' }}>Times are local. Istanbul is on the same time as Riyadh.</span>
      </div>
      {item && <ItemSheet it={item} onClose={() => setItem(null)} />}
      {sheet === 'share' && <ShareSheet onClose={() => setSheet(null)} />}
      {sheet === 'cal' && <CalendarSheet days={days} onClose={() => setSheet(null)} />}
    </div>
  );
}

function ItemSheet({ it, onClose }) {
  const { s, push, go, toast } = useStore();
  const to = (name, params) => { onClose(); push(name, params); };
  return (
    <Sheet label={it.title} onClose={onClose}>
      <span className="eyebrow">{dayLabel(it.day)}{it.time ? ' · ' + it.time : ''}</span>
      <h2 className="h2">{it.title}</h2>
      {it.sub && <p className="body" style={{ marginTop: -8 }}>{it.sub}</p>}
      {it.facts && <div className="cells">{it.facts.map(([k, v]) => <div key={k} className="cell"><span className="k">{k}</span><span className="v" style={{ fontSize: 16 }}>{v}</span></div>)}</div>}
      {it.kind === 'flight' && (<>
        {it.tags?.length > 0 && <span className="small">Asked for: {it.tags.join(', ')}.</span>}
        <span className="small">Check-in opens 24 hours before. We do it for you and the boarding passes appear in your Wallet.</span>
        <button type="button" className="btn primary block" onClick={() => to('changeFlight', it.leg === 'back' ? { focus: 'return' } : {})}>Change this flight</button>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn secondary small grow" onClick={() => to('specialRequests', {})}>Special requests</button>
          <button type="button" className="btn secondary small grow" onClick={() => { onClose(); go('wallet'); }}>Boarding passes</button>
        </div>
      </>)}
      {it.kind === 'pickup' && (<>
        <Row icon="user" title={it.driver} sub={[it.car, it.phone].filter(Boolean).join(' · ')} />
        {it.warn && <span className="tm-warn">{it.warn}</span>}
        <span className="small">{it.driver} tracks your flight. If it’s late, he waits, at no cost.</span>
        <button type="button" className="btn primary block" onClick={() => toast(`In the app this calls ${it.driver}. He speaks Arabic and English.`)}>Call {it.driver}</button>
        <button type="button" className="btn ghost block" onClick={() => to('support', { about: 'Istanbul trip', topic: 'other' })}>Talk to Faisal</button>
      </>)}
      {it.kind === 'hotel' && (<>
        <Row icon="pin" title={stayOf(s.trip)?.short || 'The hotel'} sub={`${stayOf(s.trip)?.address || ''}${stayOf(s.trip)?.walk ? ' · ' + stayOf(s.trip).walk : ''}`} />
        {it.warn && <span className="tm-warn">{it.warn}</span>}
        <span className="small">Check-in from 14:00, check-out by 12:00. Your booking is under {PEOPLE[s.trip.travellers[0]]?.full || 'your name'}.</span>
        <button type="button" className="btn primary block" onClick={() => to('hotelOptions', {})}>Hotel options</button>
        <button type="button" className="btn ghost block" onClick={() => toast('The address in Turkish is saved for the driver.')}>Show the address in Turkish</button>
      </>)}
      {(it.kind === 'booked' || it.kind === 'pick') && (<>
        <span className="small">{it.status === 'pending' ? it.pendingText + '. Faisal holds it until then.' : 'Booked. Your confirmation is in your Wallet.'}</span>
        {it.status === 'pending' && it.reqId ? <button type="button" className="btn primary block" onClick={() => to('pay', { kind: 'quote', requestId: it.reqId })}>Pay to confirm</button> : null}
        {it.refundKey && <button type="button" className="btn secondary block" onClick={() => to('refund', { keys: [it.refundKey] })}>Ask for a refund</button>}
        <button type="button" className="btn ghost block" onClick={() => to('support', { about: 'Istanbul trip', topic: 'change' })}>Talk to Faisal</button>
      </>)}
      {it.kind === 'idea' && (<>
        <span className="small">Just an idea. Nothing is booked.</span>
        {it.ask ? <button type="button" className="btn primary block" onClick={() => to('ask', { prefill: it.ask })}>Ask Mada to book it</button> : null}
        <button type="button" className={it.ask ? 'btn ghost block' : 'btn primary block'} onClick={onClose}>Leave the day free</button>
      </>)}
      {it.kind === 'note' && <button type="button" className="btn primary block" onClick={onClose}>Close</button>}
      {(it.kind === 'nostay' || it.kind === 'own') && <NoStayChoices onDone={onClose} />}
    </Sheet>
  );
}

/* After a date change: the hotel and the home pickup are still on the old day until the traveller says. */
export function moveNeeded(t) {
  const f = t?.flight;
  if (!f) return null;
  const st = stayOf(t);
  const pk = t.pickup && t.pickup.status !== 'cancelled' ? t.pickup : null;
  const hotel = st && st.fromISO !== f.dateISO ? st : null;
  const pickup = pk && pk.dateISO !== f.dateISO ? pk : null;
  return hotel || pickup ? { hotel, pickup, to: f.dateISO, from: (hotel || pickup).fromISO || (hotel || pickup).dateISO } : null;
}
export function MoveNotice() {
  const { s } = useStore();
  const [open, setOpen] = useState(false);
  const m = moveNeeded(s.trip);
  if (!m) return null;
  const what = m.hotel && m.pickup ? 'Your hotel and pickup are' : m.hotel ? 'Your hotel is' : 'Your pickup is';
  return (
    <div className="notice warn tm-move rise">
      <Icon name="flight" color="#7d5d27" />
      <span className="grow col" style={{ gap: 2 }}>
        <span className="h3" style={{ fontSize: 15 }}>{what} still on {dayLabel(m.from)}.</span>
        <span className="small">Your flight is now {dayLabel(m.to)}.</span>
        <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => { buzz(HAPTIC.tap); setOpen(true); }}>Move {m.hotel && m.pickup ? 'them' : 'it'} to {weekday(m.to)} {dayOf(m.to)}</button>
      </span>
      {open && <MoveSheet onClose={() => setOpen(false)} />}
    </div>
  );
}
export function MoveSheet({ onClose, onDone }) {
  const { s, set, toast } = useStore();
  const askQuote = useAskQuote();
  const t = s.trip;
  const m = moveNeeded(t);
  if (!m) return null;
  const f = t.flight;
  const tm = timing(s);
  const st = m.hotel;
  const night = st ? Math.round(st.price / st.nights) : 0;
  const keepsCheckout = st && f.backDateISO && stayEnd(st) === f.backDateISO;
  const newNights = st ? Math.max(1, keepsCheckout ? daysBetween(m.to, f.backDateISO) : st.nights) : 0;
  const diffNights = st ? newNights - st.nights : 0;
  const freeNow = !!st && tm.early; /* before the hotel's free window closes */
  const diff = diffNights * night;
  const back = diff < 0 && freeNow ? -diff : 0;
  const pk = m.pickup ? pickupPlan(t) : null;
  const title = `Move the ${m.hotel && m.pickup ? 'hotel and pickup' : m.hotel ? 'hotel' : 'pickup'} to ${weekday(m.to)} ${dayOf(m.to)} too?`;
  const apply = () => {
    const label = `${m.hotel && m.pickup ? 'Hotel and pickup' : m.hotel ? 'Hotel' : 'Pickup'} moved to ${dayLabel(m.to)}`;
    set((p) => {
      const trip = { ...p.trip };
      if (m.pickup) trip.pickup = { ...trip.pickup, dateISO: m.to };
      if (st && diff <= 0) trip.stay = { ...trip.stay, fromISO: m.to, nights: newNights, price: trip.stay.price + (diff < 0 && freeNow ? diff : 0) };
      return {
        trip,
        refunds: back ? [...p.refunds, { id: 'rf' + Date.now(), title: `${st.name} · ${-diffNights === 1 ? 'one night' : -diffNights + ' nights'} less`, amount: back, stage: 0, card: cardLabel(p), dest: 'card', items: ['stay-night'], created: Date.now() }] : p.refunds,
        tripRequests: [...(p.tripRequests || []), { id: 'tr' + Date.now(), kind: 'move', area: 'hotel', title: label, short: 'Moved', detail: back ? `SAR ${fmt(back)} back to your card` : diff > 0 ? 'Extra night with Faisal' : 'No cost', with: m.hotel ? 'hotel' : 'faisal', outcome: 'yes', created: Date.now() }],
      };
    });
    if (st && diff > 0) askQuote({ kind: 'hotel', area: 'hotel', short: 'earlier check-in', title: `Check in on ${dayLabel(m.to)} instead`, detail: `${st.name} · ${diffNights === 1 ? 'one more night' : diffNights + ' more nights'}`, quote: diff, icon: 'stay', stayPatch: { fromISO: m.to, addNights: diffNights, addPrice: diff }, quoteText: `The hotel can take you from ${dayLabel(m.to)}. ${diffNights === 1 ? 'One more night' : diffNights + ' more nights'}, SAR ${fmt(diff)}.` });
    buzz(HAPTIC.success);
    toast(back ? `Moved. SAR ${fmt(back)} is on its way back.` : diff > 0 ? 'Pickup moved. The extra night is with Faisal.' : 'Moved. No cost.');
    (onDone || onClose)();
  };
  return (
    <Sheet label="Move the hotel and pickup" onClose={onClose}>
      <h2 className="h2">{title}</h2>
      <p className="small" style={{ marginTop: -8 }}>Your flight is now {f.date} at {f.dep}.</p>
      <div className="card well tm-move-list">
        {st && (
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <span className="row" style={{ alignItems: 'flex-start' }}><Icon name="stay" size={20} /><span className="col" style={{ gap: 1 }}><span className="h3" style={{ fontSize: 15 }}>{st.name}</span><span className="tiny">Check in {dayLabel(st.fromISO)} → {dayLabel(m.to)} · {newNights} {newNights === 1 ? 'night' : 'nights'}</span></span></span>
            <span className="num small" style={{ fontWeight: 600, color: '#1e352d', whiteSpace: 'nowrap' }}>{diff === 0 ? 'No cost' : diff > 0 ? `+SAR ${fmt(diff)}` : back ? `−SAR ${fmt(back)}` : 'Nothing back'}</span>
          </div>
        )}
        {pk && (
          <div className="spread" style={{ alignItems: 'flex-start' }}>
            <span className="row" style={{ alignItems: 'flex-start' }}><Icon name="car" size={20} /><span className="col" style={{ gap: 1 }}><span className="h3" style={{ fontSize: 15 }}>{pk.driver} at your door</span><span className="tiny">{dayLabel(m.pickup.dateISO)} → {dayLabel(m.to)} · {pk.time}</span></span></span>
            <span className="num small" style={{ fontWeight: 600, color: '#1e352d' }}>No cost</span>
          </div>
        )}
      </div>
      {st && diff < 0 && !back && <span className="small">After {freeUntil(st.fromISO)} the hotel keeps the night you drop.</span>}
      {st && diff > 0 && <span className="small">The hotel needs to say yes to the extra night. You pay once they do.</span>}
      <button type="button" className="btn primary block" onClick={apply}>{st && pk ? 'Move both' : 'Move it'}{back ? ` · SAR ${fmt(back)} back` : diff > 0 ? ` · +SAR ${fmt(diff)}` : ''}</button>
      <button type="button" className="btn ghost block" onClick={onClose}>Keep them as they are</button>
    </Sheet>
  );
}

/* No hotel any more: ask where they're staying, so the driver and Faisal know. */
export function NoStayChoices({ onDone }) {
  const { s, set, push, toast } = useStore();
  const [mode, setMode] = useState(null);
  const [addr, setAddr] = useState(s.trip?.noStay?.address || '');
  if (mode === 'own') return (
    <form className="col" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); if (addr.trim().length < 6) return; set((p) => ({ trip: { ...p.trip, noStay: { label: 'family or friends', address: addr.trim() } } })); buzz(HAPTIC.success); toast('Saved. The driver has the address.'); onDone && onDone(); }}>
      <div className="field"><label htmlFor="ns-addr">Where are you staying?</label><input id="ns-addr" className="input" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Street, area, İstanbul" autoComplete="street-address" />{addr && addr.trim().length < 6 && <span className="err">Add the street and the area.</span>}</div>
      <button type="submit" className="btn primary block" disabled={addr.trim().length < 6}>Save the address</button>
    </form>
  );
  return (
    <div className="col" style={{ gap: 8 }}>
      <button type="button" className="card tap well" style={{ flexDirection: 'row', alignItems: 'center' }} onClick={() => { onDone && onDone(); push('ask', { intent: 'stay' }); }}><Icon name="stay" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Find a hotel</span><span className="tiny">For the same dates</span></span><Icon name="chevron" /></button>
      <button type="button" className="card tap well" style={{ flexDirection: 'row', alignItems: 'center' }} onClick={() => setMode('own')}><Icon name="user" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>With family or friends</span><span className="tiny">Add the address for the driver</span></span><Icon name="chevron" /></button>
      <button type="button" className="btn ghost block" onClick={() => onDone && onDone()}>Decide later</button>
    </div>
  );
}

function ShareSheet({ onClose }) {
  const { s, toast } = useStore();
  const link = 'madatrips.sa/i/ist-8q4w';
  const copy = async () => { try { await navigator.clipboard.writeText('https://' + link); toast('Link copied. Paste it in WhatsApp.'); } catch (e) { toast('Select the link above to copy it.'); } buzz(HAPTIC.tap); };
  return (
    <Sheet label="Share the itinerary" onClose={onClose}>
      <h2 className="h2">Share the itinerary</h2>
      <p className="small" style={{ marginTop: -8 }}>Anyone with the link sees the plan, read-only. It updates when the trip changes.</p>
      <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Itinerary link" />
      <div className="tm-see">
        <span className="eyebrow">What they see</span>
        {['Flight times and numbers', 'Hotel name and address', 'Driver names and pickup times', 'Booked tables and tours'].map((x) => <span key={x} className="row small"><Icon name="check" size={16} color="#2f7a4b" width={2.4} />{x}</span>)}
        <span className="eyebrow" style={{ marginTop: 6 }}>What they don’t</span>
        {['Passport numbers', 'What you paid, and how', 'Your booking code'].map((x) => <span key={x} className="row small"><Icon name="close" size={16} color="#8a3524" width={2.2} />{x}</span>)}
      </div>
      <button type="button" className="btn primary block" onClick={copy}><Icon name="link" color="#f6f2ec" />Copy the link</button>
      <button type="button" className="btn ghost block" onClick={() => { toast('Link turned off. Old copies show nothing now.'); onClose(); }}>Turn off old links</button>
    </Sheet>
  );
}

function CalendarSheet({ days, onClose }) {
  const { s } = useStore();
  const ics = useMemo(() => buildIcs(days, s), [days]);
  const [fileState, setFileState] = useState(null);
  const [added, setAdded] = useState([]);
  /* The moments worth a reminder: flights, pickups and check-in. Each opens in the calendar, one by one. */
  const key = ics.events.filter((e) => /SV|XY|TK|picks you up|meets you|takes you|Check in/.test(e.title));
  const all = async () => {
    buzz(HAPTIC.tap);
    const r = await saveFile('Istanbul-with-Mada.ics', ics.text);
    setFileState(r);
    if (r === 'saved') buzz(HAPTIC.success);
  };
  return (
    <Sheet label="Add to calendar" onClose={onClose}>
      <h2 className="h2">Add to your calendar</h2>
      <p className="small" style={{ marginTop: -8 }}>The {key.length} moments that matter. Free-day ideas stay out.</p>
      <div className="col tm-evlist" style={{ gap: 0 }}>
        {key.map((e) => (
          <div key={e.uid} className="spread tm-evrow" style={{ alignItems: 'center' }}>
            <span className="col grow" style={{ gap: 1 }}><span className="small" style={{ color: '#1e352d', fontWeight: 600 }}>{e.title}</span><span className="tiny num">{dayLabel(e.day)} · {e.time}</span></span>
            <a className={'btn small tm-add' + (added.includes(e.uid) ? ' on' : '')} href={calendarLink({ title: e.title, start: e.start, end: e.end, details: e.desc, location: e.where || '' })} target="_blank" rel="noopener noreferrer" aria-label={`Add ${e.title} to your calendar`} onClick={() => { buzz(HAPTIC.tap); setAdded((a) => [...a, e.uid]); }}>
              {added.includes(e.uid) ? <><Icon name="check" size={16} width={2.4} />Added</> : 'Add'}
            </a>
          </div>
        ))}
      </div>
      <button type="button" className="btn secondary block" onClick={all}>Add all as a file</button>
      {fileState === 'saved' && <span className="small" style={{ color: '#2f7a4b', fontWeight: 600 }}>Saved. Open it and your calendar adds all {ics.events.length}.</span>}
      {fileState && fileState !== 'saved' && <div className="notice warn"><span className="grow"><span className="small" style={{ color: '#1e352d' }}>Your calendar app can’t take a file here. Add them one by one above.</span></span></div>}
    </Sheet>
  );
}

/* ================================================================
   2. Payments and invoices
   ================================================================ */

function Payments() {
  const { s, push } = useStore();
  const list = tripPayments(s);
  if (!s.trip) return <NoTrip />;
  const paid = list.reduce((a, p) => a + p.amount, 0);
  const refunded = list.reduce((a, p) => a + (p.refund ? p.refund.credited : 0), 0);
  const upcoming = list.flatMap((p) => (p.plan && !p.refund ? p.plan.filter((i) => !i.paid).map((i) => ({ ...i, what: p.title, method: p.method })) : []));
  const next = upcoming[0];
  const credit = credit0(s);
  return (
    <Screen title="Payments">
      <div className="col rise" style={{ gap: 4 }}>
        <span className="eyebrow">Istanbul · booking {s.trip.ref || s.trip.pnr}</span>
        <span className="num tm-big">SAR {fmt(paid)}</span>
        <span className="small">The trip in total{refunded ? `, with SAR ${fmt(refunded)} refunded` : ''}. Tap any payment for its VAT invoice.</span>
      </div>
      {next && (
        <div className="card focal rise d1">
          <span className="row"><PayMark brand={next.method} size={22} /><span className="h3">Next payment: SAR {fmt(next.amount)} on {next.date}</span></span>
          <span className="small">{next.what}. {upcoming.length} {upcoming.length === 1 ? 'payment' : 'payments'} left, taken from {cardLabel(s)}. No interest, no fees.</span>
        </div>
      )}
      {credit.balance > 0 && <div className="card well rise d1" style={{ flexDirection: 'row', alignItems: 'center' }}><PayMark brand="credit" size={22} /><span className="grow small" style={{ color: '#1e352d' }}>Mada credit: <b>SAR {fmt(credit.balance)}</b>. It comes off your next booking.</span></div>}
      <div className="card rise d2 tm-list" style={{ padding: 6, gap: 0 }}>
        {list.map((p) => (
          <button key={p.id} type="button" className="tm-pay" onClick={() => { buzz(HAPTIC.tap); push('invoice', { id: p.id }); }} aria-label={`${p.title}, SAR ${fmt(p.amount)}, open the invoice`}>
            <span className="tm-ic"><Icon name={p.icon} size={20} /></span>
            <span className="grow col" style={{ gap: 2 }}>
              <span className="tm-row-title">{p.title}</span>
              <span className="tiny">{p.date} · {methodName(p)}</span>
              {p.refund && <span className="pill ok" style={{ alignSelf: 'flex-start', height: 22, fontSize: 11 }}>Credited SAR {fmt(p.refund.credited)} · credit note</span>}
              {p.plan && !p.refund && (
                <span className="tm-inst" aria-label={`${p.plan.filter((i) => i.paid).length} of ${p.plan.length} paid`}>
                  {p.plan.map((i) => <span key={i.date} className={i.paid ? 'on' : ''} title={`${i.date} · SAR ${fmt(i.amount)}`} />)}
                  <i className="tiny">{p.plan.filter((i) => i.paid).length} of {p.plan.length} paid</i>
                </span>
              )}
            </span>
            <span className="col" style={{ alignItems: 'flex-end', gap: 2 }}><span className="num tm-amt">{fmt(p.amount)}</span><span className="tiny">Invoice</span></span>
          </button>
        ))}
      </div>
      {upcoming.length > 0 && (
        <div className="card rise d3">
          <span className="h3">Payment plan</span>
          {list.filter((p) => p.plan && !p.refund).map((p) => (
            <div key={p.id} className="col" style={{ gap: 6 }}>
              <span className="row small"><PayMark brand={p.method} size={18} />{p.title}</span>
              {p.plan.map((i, k) => (
                <div key={i.date} className="spread tm-instrow">
                  <span className="small" style={{ color: '#1e352d' }}>{k === 0 ? 'At booking' : `Payment ${k + 1}`} · {i.date}</span>
                  <span className={'num small' + (i.paid ? ' tm-paid' : '')}>{i.paid ? 'Paid' : 'Due'} · SAR {fmt(i.amount)}</span>
                </div>
              ))}
            </div>
          ))}
          <span className="tiny">If you cancel, the payments left are cancelled too. Nothing more is taken.</span>
        </div>
      )}
      <button type="button" className="btn secondary block" onClick={() => push('refund', {})}>Ask for a refund</button>
    </Screen>
  );
}

/* A ZATCA QR is a TLV payload in a QR code. This draws a stand-in grid, stable for each invoice number. */
function QrMark({ seed, size = 104 }) {
  const N = 25;
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
  const finder = (x, y) => (x < 7 && y < 7) || (x >= N - 7 && y < 7) || (x < 7 && y >= N - 7);
  const cells = [];
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) if (!finder(x, y) && rnd() > 0.52) cells.push(<rect key={x + '-' + y} x={x} y={y} width="1" height="1" />);
  const F = ({ x, y }) => <g><rect x={x} y={y} width="7" height="7" /><rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" /><rect x={x + 2} y={y + 2} width="3" height="3" /></g>;
  return (
    <svg width={size} height={size} viewBox={`-1 -1 ${N + 2} ${N + 2}`} role="img" aria-label="Invoice QR code" shapeRendering="crispEdges" style={{ background: '#fff', borderRadius: 8 }}>
      <g fill="#1e352d">{cells}<F x={0} y={0} /><F x={N - 7} y={0} /><F x={0} y={N - 7} /></g>
    </svg>
  );
}

function invoiceHtml(doc) {
  const rows = doc.lines.map((l) => `<tr><td>${l.text}</td><td>${l.vatRate}%</td><td>${l.gross < 0 ? '−' : ''}${fmt2(l.net)}</td><td>${fmt2(l.vat)}</td><td>${l.gross < 0 ? '−' : ''}${fmt2(l.gross)}</td></tr>`).join('');
  const buyer = doc.company ? `Buyer: ${doc.company.name}<br>VAT ${doc.company.vat} · CR ${doc.company.cr}<br>${doc.company.address}` : `Customer: ${doc.buyer}`;
  return `<!doctype html><meta charset="utf-8"><title>${doc.kind} ${doc.no}</title><style>body{font:14px system-ui;margin:40px;color:#1e352d}table{width:100%;border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid #ddd;text-align:left}</style>
<h1>${doc.kind}</h1><p>${SELLER.legal} · VAT ${SELLER.vat} · ${SELLER.cr}<br>${SELLER.address}</p><p>No. ${doc.no} · ${doc.date}<br>${buyer}</p>
<table><tr><th>Item</th><th>VAT</th><th>Net</th><th>VAT</th><th>Total</th></tr>${rows}</table><p><b>Total ${doc.sign}SAR ${fmt2(doc.total)}</b> (VAT ${doc.sign}SAR ${fmt2(doc.vat)})</p>`;
}
const fmt2 = (n) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Saudi VAT numbers: 15 digits, starting and ending with 3. CR numbers: 10 digits. */
export function companyErrors(c) {
  const vat = (c.vat || '').replace(/\D/g, '');
  const cr = (c.cr || '').replace(/\D/g, '');
  return {
    name: (c.name || '').trim().length < 2 ? 'Add the company name as it’s registered.' : null,
    vat: !vat ? 'Add the company’s VAT number.' : vat.length !== 15 ? `A Saudi VAT number has 15 digits (this has ${vat.length}).` : !/^3\d{13}3$/.test(vat) ? 'It starts and ends with 3, like 300000000000003.' : null,
    cr: !cr ? 'Add the commercial registration number.' : cr.length !== 10 ? `A CR number has 10 digits (this has ${cr.length}).` : null,
    address: (c.address || '').trim().length < 10 ? 'Add the street, the district and the city.' : null,
  };
}

function CompanySheet({ onClose }) {
  const { s, set, toast } = useStore();
  const cur = s.trip?.company || {};
  const [c, setC] = useState({ name: cur.name || '', vat: cur.vat || '', cr: cur.cr || '', address: cur.address || '' });
  const [touched, setTouched] = useState({});
  const errs = companyErrors(c);
  const ok = !Object.values(errs).some(Boolean);
  const field = (k, label, props = {}) => (
    <div className="field">
      <label htmlFor={'co-' + k}>{label}</label>
      <input id={'co-' + k} className={'input' + (touched[k] && errs[k] ? ' bad' : '')} value={c[k]} onBlur={() => setTouched({ ...touched, [k]: true })} onChange={(e) => setC({ ...c, [k]: props.digits ? e.target.value.replace(/\D/g, '').slice(0, props.digits) : e.target.value })} {...(props.digits ? { inputMode: 'numeric' } : {})} placeholder={props.ph} autoComplete={props.ac} />
      {touched[k] && errs[k] && <span className="err" role="alert">{errs[k]}</span>}
    </div>
  );
  return (
    <Sheet label="Invoice for a company" onClose={onClose}>
      <h2 className="h2">Invoice for a company</h2>
      <p className="small" style={{ marginTop: -8 }}>We issue a full tax invoice with your company’s details, for every payment on this trip. Check them before you issue it.</p>
      <form className="col" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); setTouched({ name: true, vat: true, cr: true, address: true }); if (!ok) return; set((p) => ({ trip: { ...p.trip, company: { ...c, vat: c.vat.replace(/\D/g, ''), cr: c.cr.replace(/\D/g, ''), savedAt: Date.now(), issuedAt: null } } })); buzz(HAPTIC.success); toast('Saved. Check it, then issue the tax invoice.'); onClose(); }}>
        {field('name', 'Company name', { ph: 'As on the commercial registration', ac: 'organization' })}
        {field('vat', 'VAT number', { digits: 15, ph: '3XXXXXXXXXXXXX3' })}
        {field('cr', 'CR number', { digits: 10, ph: '10 digits' })}
        {field('address', 'Address', { ph: 'Street, district, city', ac: 'street-address' })}
        <button type="submit" className="btn primary block">Save company details</button>
      </form>
    </Sheet>
  );
}

function Invoice({ params }) {
  const { s, set, toast } = useStore();
  const ask = useAskFaisal();
  const p = tripPayments(s).find((x) => x.id === params.id);
  const [view, setView] = useState(params.credit ? 'credit' : 'invoice');
  const [sheet, setSheet] = useState(params.company ? 'company' : null);
  if (!s.trip) return <NoTrip />;
  if (!p) return <Screen title="Invoice"><div className="card well"><span className="h3">This payment isn’t on the trip any more.</span><span className="small">Faisal can send you a copy of any invoice.</span></div></Screen>;
  const lead = PEOPLE[s.trip.travellers[0]];
  const buyer = lead && lead.full !== 'You' ? lead.full : (s.user?.full || 'The traveller');
  const co = s.trip.company || null;
  const issued = !!co?.issuedAt;
  const isCredit = view === 'credit' && p.refund;
  const ratio = isCredit ? p.refund.credited / p.amount : 1;
  const lines = p.lines.map((l) => { const g = l.gross * ratio; const { net, vat } = splitVat({ ...l, gross: g }); return { text: l.text, note: l.note, vatRate: l.vat, gross: g, net, vat }; });
  const total = lines.reduce((a, l) => a + l.gross, 0);
  const vat = lines.reduce((a, l) => a + l.vat, 0);
  const no = isCredit ? p.no.replace('MT-', 'CN-') : co ? p.no.replace('MT-', 'TI-') : p.no;
  const kind = isCredit ? 'Credit note' : co ? 'Tax invoice' : 'Simplified tax invoice';
  const doc = { kind, no, date: isCredit ? 'Today' : `${p.date}${p.time ? ' ' + p.time : ''}`, buyer, company: co, lines, total, vat, sign: isCredit ? '−' : '' };
  /* The file is the main path; printing to PDF is the fallback where files can't be handed over. */
  const share = async () => {
    buzz(HAPTIC.tap);
    const r = await saveFile(`${no}.html`, invoiceHtml(doc));
    if (r === 'saved') { toast('Saved. Open it and print to PDF to share.'); return; }
    try { window.print(); toast('Choose “Save as PDF” to keep a copy.'); } catch (e) { toast('Couldn’t save here. Use Email it to me.'); }
  };
  const email = () => { buzz(HAPTIC.success); toast(s.demo.offline ? 'Saved. It sends when you’re back online.' : `Sent to ${s.account?.email?.address || 'your email'}. Usually there within a minute.`); };
  const draft = co && !issued && !isCredit;
  return (
    <Screen title={isCredit ? 'Credit note' : co ? 'Tax invoice' : 'VAT invoice'} act={draft ? <>
      <button type="button" className="btn primary block" onClick={() => { set((x) => ({ trip: { ...x.trip, company: { ...x.trip.company, issuedAt: Date.now() } } })); buzz(HAPTIC.success); toast('Issued. The tax invoice is final now.'); }}>Issue the tax invoice</button>
      <button type="button" className="btn secondary block" onClick={() => setSheet('company')}>Edit company details</button>
    </> : <>
      <button type="button" className="btn primary block" onClick={share}><Icon name="doc" color="#f6f2ec" size={20} />Share PDF</button>
      <button type="button" className="btn secondary block" onClick={email}>Email it to me</button>
    </>}>
      {p.refund && (
        <div className="chips" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'invoice' ? 'true' : 'false'} className={'chip' + (view === 'invoice' ? ' on' : '')} onClick={() => setView('invoice')}>Invoice</button>
          <button type="button" role="tab" aria-selected={view === 'credit' ? 'true' : 'false'} className={'chip' + (view === 'credit' ? ' on' : '')} onClick={() => setView('credit')}>Credit note</button>
        </div>
      )}
      {draft && <div className="notice tm-draft"><Icon name="doc" size={20} /><span className="grow col" style={{ gap: 2 }}><span className="h3" style={{ fontSize: 15 }}>Draft. Check the company details.</span><span className="small">Once it’s issued it can’t be edited. Only Faisal can reissue it.</span></span></div>}
      <article className={'tm-invoice rise' + (draft ? ' draft' : '')} aria-label={doc.kind}>
        <header className="spread" style={{ alignItems: 'flex-start' }}>
          <span className="col" style={{ gap: 2 }}>
            <span className="tm-inv-kind">{doc.kind}{draft ? ' · draft' : ''}</span>
            <span className="tm-inv-ar" lang="ar" dir="rtl">{isCredit ? 'إشعار دائن' : co ? 'فاتورة ضريبية' : 'فاتورة ضريبية مبسطة'}</span>
          </span>
          <QrMark seed={no} size={92} />
        </header>
        <div className="tm-inv-grid">
          <span><i>Seller</i>{SELLER.name}<br /><span className="tiny">{SELLER.legal}</span></span>
          <span><i>VAT number</i><b className="num">{SELLER.vat}</b></span>
          <span><i>{isCredit ? 'Credit note' : 'Invoice'} no.</i><b className="num">{no}</b></span>
          <span><i>Date</i>{doc.date}</span>
          {co ? (<>
            <span><i>Buyer</i>{co.name}<br /><span className="tiny">{co.address}</span></span>
            <span><i>Buyer VAT · CR</i><b className="num">{co.vat}</b><br /><span className="tiny num">CR {co.cr}</span></span>
            <span><i>Traveller</i>{buyer}</span>
          </>) : <span><i>Customer</i>{buyer}</span>}
          <span><i>{isCredit ? 'Against invoice' : 'Paid with'}</i>{isCredit ? p.no : methodName(p)}</span>
        </div>
        <div className="tm-inv-lines">
          {lines.map((l) => (
            <div key={l.text} className="tm-inv-line">
              <span className="grow col" style={{ gap: 1 }}><span className="small" style={{ color: '#1e352d' }}>{l.text}</span><span className="tiny">VAT {l.vatRate}%{l.note ? ' · ' + l.note : ''}</span></span>
              <span className="num small" style={{ color: '#1e352d' }}>{l.gross < 0 ? '−' : doc.sign}{fmt2(l.gross)}</span>
            </div>
          ))}
        </div>
        <div className="tm-inv-tot">
          <div className="spread"><span className="small">Total before VAT</span><span className="num small">{doc.sign}{fmt2(total - vat)}</span></div>
          <div className="spread"><span className="small">VAT 15%</span><span className="num small">{doc.sign}{fmt2(vat)}</span></div>
          <div className="spread"><span className="h3">Total</span><span className="num h3">{doc.sign}SAR {fmt2(total)}</span></div>
        </div>
        <span className="tiny">{SELLER.cr} · {SELLER.address}. Prices include VAT. International flights are zero-rated.</span>
        {isCredit && <span className="tiny">Refund {p.refund.dest === 'credit' ? 'added to your Mada credit' : `sent to ${p.refund.card || cardLabel(s)}`}.</span>}
      </article>
      {p.refund && view === 'invoice' && <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setView('credit')}>See the credit note for the refund</button>}
      {!isCredit && !co && (
        <button type="button" className="card tap well" style={{ flexDirection: 'row', alignItems: 'center' }} onClick={() => setSheet('company')}>
          <Icon name="card" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Invoice for a company</span><span className="tiny">A full tax invoice with your company’s VAT number</span></span><Icon name="chevron" />
        </button>
      )}
      {issued && !isCredit && (
        <div className="card well" style={{ gap: 6 }}>
          <span className="row small" style={{ color: '#1e352d', fontWeight: 600 }}><Icon name="lock" size={16} />Issued to {co.name}, {fullDay(new Date(co.issuedAt).toISOString().slice(0, 10))}</span>
          <span className="small">A tax invoice can’t be edited once it’s issued. Faisal can cancel it with a credit note and issue a new one.</span>
          <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => { ask({ kind: 'invoice', title: 'Reissue the tax invoice', short: 'Invoice reissued', detail: co.name, with: 'faisal', outcome: 'yes', yesText: 'New tax invoice in Payments' }); buzz(HAPTIC.success); toast('Sent to Faisal. Tell him what to change in the chat.'); }}>Ask Faisal to reissue</button>
        </div>
      )}
      {sheet === 'company' && <CompanySheet onClose={() => setSheet(null)} />}
    </Screen>
  );
}

/* ================================================================
   3. Refunds
   ================================================================ */

const REASONS = [['plans', 'Plans changed'], ['ill', 'Someone is ill'], ['docs', 'Visa or passport problem'], ['airline', 'The airline changed it'], ['else', 'Found something else'], ['other', 'Other']];

function Refund({ params }) {
  const { s, set, pop, push, toast } = useStore();
  const payments = tripPayments(s);
  const tm = timing(s);
  const [keys, setKeys] = useState(params.keys || []);
  const [reason, setReason] = useState(tm.airlineCancelled ? 'airline' : null);
  const [dest, setDest] = useState('card');
  const [sent, setSent] = useState(null);
  useTicker(1000);
  if (!s.trip) return <NoTrip />;
  const items = payments.map((p) => ({ p, q: refundQuote(s, p.id) })).filter((x) => x.q);
  const chosen = items.filter((x) => keys.includes(x.p.id));
  /* With instalments, what comes back is what was paid so far, less what the rule keeps; the payments left are cancelled. */
  const money = (x) => refundMoney(x.p, x.q);
  const back = chosen.reduce((a, x) => a + money(x).cash, 0);
  const credited = chosen.reduce((a, x) => a + x.q.back, 0);
  const cancelledTotal = chosen.reduce((a, x) => a + money(x).cancelled, 0);
  const asking = chosen.reduce((a, x) => a + x.q.paid, 0);
  const anyway = chosen.length > 0 && back === 0;
  const tabbyItems = chosen.filter((x) => ['tabby', 'tamara'].includes(x.p.method));
  const card = cardLabel(s);
  const toggle = (id) => setKeys(keys.includes(id) ? keys.filter((k) => k !== id) : [...keys, id]);
  const title = joinNames(chosen.map((x) => (x.p.id === 'flight' ? 'flights' : x.p.id === 'stay' ? 'the stay' : x.p.id === 'pickup' ? 'the pickup' : x.p.title.toLowerCase())));

  const confirm = () => {
    const id = 'rf' + Date.now();
    const tabbyNote = tabbyItems.length ? { left: money(tabbyItems[0]).cancelled, count: money(tabbyItems[0]).count } : null;
    const rec = {
      id, title: `Istanbul · ${title}`, amount: anyway ? asking : back, perItem: Object.fromEntries(chosen.map((x) => [x.p.id, anyway ? 0 : x.q.back])), items: chosen.map((x) => x.p.id), card, created: Date.now(),
      dest: anyway ? 'card' : tabbyItems.length === chosen.length && tabbyItems.length ? 'tabby' : dest, reason, tabby: tabbyNote,
      law: chosen.some((x) => x.q.law),
    };
    if (anyway) {
      rec.stage = -1;
      rec.reject = chosen[0].p.id === 'pickup'
        ? `${s.trip.pickup?.home?.driver || 'The driver'}’s company charges in full inside 24 hours, and he has turned down other work for your morning. I asked twice.`
        : 'The place is already holding the booking for you and won’t release it this close. I asked twice.';
      rec.alt = chosen[0].p.id === 'pickup' ? 'I can move the ride to another day in the next 3 months instead, free.' : 'I can move it to another day this trip, free.';
    } else if (rec.dest === 'credit') {
      rec.stage = 2; rec.t = Date.now();
    } else rec.stage = 0;
    set((p) => {
      const out = { refunds: [...p.refunds, rec] };
      if (chosen.some((x) => x.p.id === 'stay') && !anyway) out.trip = { ...p.trip, stay: { ...p.trip.stay, status: 'cancelled' } };
      return rec.dest === 'credit' ? { ...out, ...addCredit(p, back, `Refund · ${title}`) } : out;
    });
    buzz(HAPTIC.success);
    setSent(rec);
  };

  if (sent) {
    const live = s.refunds.find((r) => r.id === sent.id) || sent;
    return (
      <Screen title="Refund" act={<>
        <button type="button" className="btn primary block" onClick={() => goRequests(set)}>See it in Trips</button>
        <button type="button" className="btn ghost block" onClick={pop}>Done</button>
      </>}>
        <span className="tm-check rise"><Icon name="check" color="#f6f2ec" size={28} width={2.4} /></span>
        <h1 className="h1 rise d1">{anyway ? 'Sent to Faisal.' : live.dest === 'credit' ? `SAR ${fmt(back)} is in your Mada credit.` : `SAR ${fmt(back)} is on its way back.`}</h1>
        <p className="body rise d2">{anyway ? 'The rule says nothing comes back, but Faisal will ask. You’ll hear within a day.' : live.dest === 'credit' ? 'Ready to use now, on any booking. It doesn’t expire.' : live.dest === 'tabby' ? 'We tell Tabby today. What you paid goes back to your card, and the payments left are cancelled.' : `Back to your ${card}, usually in 5–10 working days.`}</p>
        <div className="card rise d3"><RefundTracker r={live} /></div>
        <Faisal>{anyway ? '“I’ll ask, and tell you either way.”' : live.dest === 'credit' ? '“Done. It’s there now.”' : '“I’ll keep an eye on it until it’s in your account.”'}</Faisal>
      </Screen>
    );
  }

  if (tm.allUsed && !items.some((x) => x.q.back > 0 || x.q.askAnyway)) {
    return (
      <Screen title="Refund">
        <h1 className="h1">Your trip is done.</h1>
        <p className="body">Every flight and night was used, so nothing is left to refund. If something went wrong on the trip, tell Faisal. He’ll take it up with the airline or hotel.</p>
        <button type="button" className="btn primary block" onClick={() => push('support', { about: 'Istanbul trip', topic: 'refund' })}>Talk to Faisal</button>
      </Screen>
    );
  }

  const ready = chosen.length > 0 && reason;
  return (
    <Screen title="Ask for a refund" act={
      <SlideToConfirm disabled={!ready} label={!chosen.length ? 'Pick what to refund' : !reason ? 'Pick a reason' : anyway ? 'Slide to ask Faisal anyway' : `Slide to ask for SAR ${fmt(back)}`} onConfirm={confirm} />
    }>
      <h1 className="h1 rise">What should we refund?</h1>
      {tm.airlineCancelled && (
        <div className="card focal rise">
          <span className="h3">{s.trip.flight?.airline} cancelled {s.trip.flight?.code}.</span>
          <span className="small">Under GACA rules you get the full price of the flights back, fees and all. Your stay and pickup are free to cancel too.</span>
        </div>
      )}
      {tm.outUsed && !tm.allUsed && <div className="notice"><Icon name="flight" size={20} /><span className="grow"><span className="h3" style={{ fontSize: 15 }}>Part of the trip is used.</span><span className="small">Only what you haven’t used yet can come back.</span></span></div>}
      <div className="col" style={{ gap: 10 }}>
        {items.map(({ p, q }) => {
          const done = !!p.refund;
          const on = keys.includes(p.id);
          return (
            <Pick key={p.id} on={on} disabled={done || (q.back === 0 && !q.askAnyway)} onClick={() => toggle(p.id)}
              title={p.title} sub={done ? 'Already refunded' : q.rule}
              right={done ? 'Refunded' : money({ p, q }).cash > 0 ? `+${fmt(money({ p, q }).cash)}` : q.back > 0 ? 'Payments stop' : 'Nothing back'}
              note={on ? <>{q.why}{q.back > 0 && q.back < q.paid ? ` You paid ${sar(q.paid)}.` : ''}{money({ p, q }).count ? ` You’ve paid ${sar(p.amount - money({ p, q }).cancelled)} so far, and that comes back. The ${money({ p, q }).count} ${p.method === 'tabby' ? 'Tabby' : 'Tamara'} payments left (${sar(money({ p, q }).cancelled)}) are cancelled.` : ''}{money({ p, q }).owe ? ` ${p.method === 'tabby' ? 'Tabby' : 'Tamara'} still takes ${sar(money({ p, q }).owe)} for the hotel’s fee.` : ''}</> : null} />
          );
        })}
      </div>
      {chosen.length > 0 && (<>
        <span className="h3">Why?</span>
        <div className="chips">{REASONS.map(([id, label]) => <button key={id} type="button" className={'chip' + (reason === id ? ' on' : '')} aria-pressed={reason === id ? 'true' : 'false'} onClick={() => { setReason(id); buzz(HAPTIC.select); }}>{label}</button>)}</div>
        {reason === 'ill' && <span className="small">Send Faisal a doctor’s note. Some airlines waive the fee with one, and he’ll ask.</span>}
        {reason === 'airline' && !tm.airlineCancelled && <span className="small">If {s.trip.flight?.airline} moved your flight by more than 3 hours, GACA rules give you a full refund. Faisal will check the schedule.</span>}
        {!anyway && (<>
          <span className="h3">Where should it go?</span>
          {tabbyItems.length > 0 && tabbyItems.length === chosen.length ? (
            <div className="card well" style={{ gap: 6 }}>
              <span className="row"><PayMark brand={tabbyItems[0].p.method} size={22} /><span className="h3" style={{ fontSize: 15 }}>Back through {tabbyItems[0].p.method === 'tabby' ? 'Tabby' : 'Tamara'}</span></span>
              <span className="small">You paid with instalments, so the refund goes the way you paid: what you’ve paid so far back to your card, and the payments left cancelled.</span>
            </div>
          ) : (
            <div className="col" role="radiogroup" aria-label="Refund to" style={{ gap: 10 }}>
              <Pick radio on={dest === 'card'} onClick={() => setDest('card')} title={`Back to your ${card}`} sub="5–10 working days" />
              <Pick radio on={dest === 'credit'} onClick={() => setDest('credit')} title="Mada credit" sub="Instant · the same amount · for any booking, no expiry" />
              {tabbyItems.length > 0 && <span className="tiny">The part paid with {tabbyItems[0].p.method === 'tabby' ? 'Tabby' : 'Tamara'} goes back through them, and the payments left are cancelled.</span>}
            </div>
          )}
        </>)}
        <div className="tm-sum">
          <span className="small">{anyway ? `The rules say nothing comes back. Faisal can ask anyway.` : 'You get back'}</span>
          {!anyway && <span className="num tm-big">SAR {fmt(back)}</span>}
          {!anyway && cancelledTotal > 0 && <span className="small">and SAR {fmt(cancelledTotal)} of payments you won’t make. SAR {fmt(credited)} in all.</span>}
        </div>
      </>)}
    </Screen>
  );
}

/* Requested → Approved by Faisal → Sent → In your bank. Credit is instant; Tabby goes back through Tabby; a no comes with a reason. */
export function RefundTracker({ r, onTalk }) {
  const now = Date.now();
  const dest = r.dest || 'card';
  if (r.stage === -1) {
    const decided = now - (r.created || now) > 7000;
    return (
      <div className="col" style={{ gap: 10 }}>
        <Tracker items={[
          { title: 'Requested', sub: 'Today', state: 'done' },
          { title: decided ? 'Faisal couldn’t get it approved' : 'Faisal is asking', sub: decided ? '' : 'Usually within a day', state: decided ? 'done' : 'now' },
        ]} />
        {decided && <div className="card well" style={{ gap: 8 }}>
          <div className="row"><span className="avatar sm green">F</span><span className="h3" style={{ fontSize: 14 }}>Faisal · your Mada agent</span></div>
          <span className="small" style={{ color: '#1e352d' }}>“{r.reject}”</span>
          {r.alt && <span className="small" style={{ color: '#1e352d' }}>“{r.alt}”</span>}
          {onTalk && <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={onTalk}>Talk to Faisal</button>}
        </div>}
      </div>
    );
  }
  if (dest === 'credit') {
    return <Tracker items={[{ title: 'Requested', sub: 'Today', state: 'done' }, { title: 'Approved by Faisal', sub: 'Today', state: 'done' }, { title: `Added to your Mada credit · SAR ${fmt(r.amount)}`, sub: 'Ready to use now', state: 'done' }]} />;
  }
  const inBank = r.stage >= 2 && r.t && now - r.t > 30000;
  const bankName = dest === 'tabby' ? 'Back on your card' : 'In your bank';
  return (
    <Tracker items={[
      { title: 'Requested', sub: 'Today', state: 'done' },
      { title: r.items ? 'Approved by Faisal' : r.airline ? `Approved by ${r.airline}` : 'Approved', sub: r.stage >= 1 ? 'Today' : 'Usually 1–3 days', state: r.stage >= 1 ? 'done' : 'now' },
      { title: dest === 'tabby' ? 'Sent to Tabby' : `Sent to your ${r.card || 'card'}`, sub: r.stage >= 2 ? (dest === 'tabby' && r.tabby ? `${r.tabby.count} payments left cancelled` : 'Today') : r.law ? 'Within 7 days, by law' : 'Usually 7–14 days', state: r.stage >= 2 ? 'done' : r.stage === 1 ? 'now' : '' },
      { title: bankName, sub: inBank ? 'Arrived' : '5–10 working days after it’s sent, in riyals', state: inBank ? 'done' : r.stage >= 2 ? 'now' : '' },
    ]} />
  );
}

/* ================================================================
   4. Change flight
   ================================================================ */

const CHANGE_KINDS = [
  ['date', 'Another day', 'Same airline. Your seats move with you.', 'out'],
  ['time', 'Another time, same day', (f) => `Earlier or later on ${f.date}.`, 'out'],
  ['return', 'Only the way back', 'Stay longer, or come home sooner.', 'back'],
  ['one', 'Just one traveller', 'One of you flies home on another day.', 'back'],
  ['airline', 'Another airline', 'A new ticket, not a change.', 'out'],
  ['name', 'Fix a name spelling', 'Small fixes, so the ticket matches the passport.', 'any'],
];

/* Options around the booked dates, so a June trip gets June days. */
function changeOptions(kind, f, n) {
  const out = f.dateISO;
  const back = f.backDateISO;
  const code = Number(f.code.replace(/\D/g, ''));
  const backSub = back ? ` Back on ${dayLabel(back)}.` : ' One way.';
  if (kind === 'date') return [
    { id: 'dm1', title: `${dayLabel(addDays(out, -1))} · ${f.dep}`, sub: `A day earlier.${backSub}`, diffPP: 120, say: `You fly on ${dayLabel(addDays(out, -1))}`, patch: { dateISO: addDays(out, -1) } },
    { id: 'dp1', title: `${dayLabel(addDays(out, 1))} · ${f.dep}`, sub: `A day later.${backSub}`, diffPP: 0, say: `You fly on ${dayLabel(addDays(out, 1))}`, patch: { dateISO: addDays(out, 1) } },
    { id: 'dp2', title: `${dayLabel(addDays(out, 2))} · ${f.dep}`, sub: `No ${n} seats left on this flight.`, soldOut: true },
  ].filter((o) => !back || !o.patch || o.patch.dateISO < back);
  if (kind === 'time') return [
    { id: 't1', title: `${f.iata}${code - 2} · 06:30 → 10:45`, sub: 'Earliest, and the lowest fare. Lands in time for lunch.', diffPP: -380, say: `You’re on ${f.iata}${code - 2} at 06:30`, patch: { code: `${f.iata}${code - 2}`, dep: '06:30', arr: '10:45' } },
    { id: 't2', title: `${f.iata}${code + 4} · 18:20 → 22:35`, sub: 'Evening. A slow morning at home.', diffPP: 0, say: `You’re on ${f.iata}${code + 4} at 18:20`, patch: { code: `${f.iata}${code + 4}`, dep: '18:20', arr: '22:35' } },
  ];
  if (kind === 'return' && back) return [
    { id: 'rm1', title: `${dayLabel(addDays(back, -1))} · ${f.backDep}`, sub: 'A day sooner. The hotel keeps one night as its fee.', diffPP: -80, say: `You come home on ${dayLabel(addDays(back, -1))}`, patch: { backDateISO: addDays(back, -1) } },
    { id: 'rp1', title: `${dayLabel(addDays(back, 1))} · ${f.backDep}`, sub: 'A day longer. Add a night at the hotel too.', diffPP: 80, say: `You come home on ${dayLabel(addDays(back, 1))}`, patch: { backDateISO: addDays(back, 1) }, longer: true },
    { id: 'rl', title: `${dayLabel(back)} · 21:40 · ${f.iata}${Number(f.back.replace(/\D/g, '')) + 2}`, sub: 'Same day, later. Lands 01:50.', diffPP: 0, say: 'You come home at 21:40 instead', patch: { back: `${f.iata}${Number(f.back.replace(/\D/g, '')) + 2}`, backDep: '21:40', backArr: '01:50' } },
  ].filter((o) => !o.patch.backDateISO || o.patch.backDateISO > out);
  if (kind === 'one' && back) return [
    { id: 'o1', title: `${dayLabel(addDays(back, -1))} · ${f.backDep}`, sub: 'A day sooner.', diffPP: -80, day: dayLabel(addDays(back, -1)) },
    { id: 'o2', title: `${dayLabel(addDays(back, -2))} · ${f.backDep}`, sub: 'Two days sooner.', diffPP: 0, day: dayLabel(addDays(back, -2)) },
  ].filter((o) => o.day > '');
  return [];
}

function ChangeFlight({ params }) {
  const { s, set, pop, push, reset, toast } = useStore();
  const ask = useAskFaisal();
  const askQuote = useAskQuote();
  const t = s.trip;
  const tm = timing(s);
  const [kind, setKind] = useState(params.focus || null);
  const [who, setWho] = useState(null);
  const [pick, setPick] = useState(null);
  const [stage, setStage] = useState('choose');
  const [result, setResult] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);
  if (!t) return <NoTrip />;
  const f = t.flight;
  if (!f || isRefunded(s, 'flight')) return (
    <Screen title="Change flight"><div className="card well"><span className="h3">No flights on this trip.</span><span className="small">{isRefunded(s, 'flight') ? 'The flights were refunded.' : 'You booked the stay only.'} Mada can add flights any time.</span>
      <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={() => push('ask', { prefill: `Flights to Istanbul, ${t.dates || ''}`.trim() })}>Find flights</button></div></Screen>
  );
  const R = fareRules(f);
  const n = nOf(s);
  const count = kind === 'one' ? 1 : n;
  const opts = s.demo.noResults ? [] : changeOptions(kind, f, count);
  const cur = opts.find((o) => o.id === pick);
  const fee = R.changeFee * count;
  const fareDiff = cur ? cur.diffPP * count : 0;
  const escort = kind === 'one' && who && Number(PEOPLE[who]?.born) > 2014 ? 350 : 0;
  const total = fee + fareDiff + escort;

  /* Hard stops first: the airline cancelled, too close to departure, or already flown. */
  if (tm.airlineCancelled) return (
    <Screen title="Change flight">
      <div className="card focal rise"><span className="h3">{f.airline} cancelled {f.code}.</span><span className="small">You don’t pay anything to change. We’re holding seats on two other flights for all {n} of you.</span>
        <button type="button" className="btn gold block" onClick={() => push('disruption', { kind: 'cancel' })}>See your options</button></div>
    </Screen>
  );
  if (tm.allUsed) return <Screen title="Change flight"><h1 className="h1">Both flights are flown.</h1><p className="body">Welcome home. Nothing left to change.</p></Screen>;
  if (tm.within24) return (
    <Screen title="Change flight" act={<button type="button" className="btn primary block" onClick={() => { ask({ kind: 'call', title: 'Call me about a flight change', short: 'Call about a change', detail: `${f.code} · less than a day to go`, with: 'faisal', outcome: 'done' }); push('support', { about: 'Istanbul trip', topic: 'change' }); }}>Ask Faisal to call me</button>}>
      <span className="eyebrow">{f.code} · {f.date} · {f.dep}</span>
      <h1 className="h1 rise">Less than a day to go.</h1>
      <p className="body rise d1">Inside 24 hours, {f.airline} only changes tickets by phone. Faisal calls you, then calls them, and stays on until it’s done.</p>
      <div className="card well rise d2"><span className="h3" style={{ fontSize: 15 }}>The rules still apply</span><span className="small">Change fee {R.changeFee ? `SAR ${R.changeFee} per person` : 'free'}, plus any difference in fare. You see the price before anything changes.</span></div>
    </Screen>
  );

  const send = () => {
    const label = kind === 'one' ? `${PEOPLE[who]?.name} flies home ${cur.day}` : cur.say;
    const patch = kind === 'one' ? { ['split_' + who]: cur.day } : cur.patch;
    if (total > 0) {
      set((p) => ({ tripChangeLog: [...(p.tripChangeLog || []), { id: 'ch' + Date.now(), label, amount: total, patch, at: Date.now() }] }));
      push('pay', { kind: 'change', label, amount: total, patch });
      return;
    }
    setStage('working');
    buzz(HAPTIC.knock);
    setTimeout(() => {
      set((p) => {
        const out = { trip: { ...p.trip, flight: { ...p.trip.flight, ...patch } }, tripRequests: [...(p.tripRequests || []), { id: 'tr' + Date.now(), kind: 'change', title: label, short: 'Flight changed', detail: total < 0 ? `SAR ${fmt(-total)} back as Mada credit` : 'No cost', with: 'faisal', outcome: 'done', created: Date.now() }] };
        return total < 0 ? { ...out, ...addCredit(p, -total, `Flight change · ${label}`) } : out;
      });
      setResult({ label, total });
      setStage('done');
      if (patch.dateISO) setMoveOpen(true);
      buzz(HAPTIC.success);
    }, 2400);
  };

  if (stage === 'working') return (
    <div className="screen push tm"><TopBar onBack={null} />
      <div className="col" style={{ padding: '40px 28px', gap: 24 }}>
        <span className="avatar green" style={{ width: 72, height: 72, fontSize: 28 }}>F</span>
        <h1 className="h1">Faisal is changing it.</h1>
        <Steps items={[{ text: 'New seats held', state: 'done' }, { text: `Changing the tickets with ${f.airline}`, state: 'now' }, { text: 'Moving your pickups', state: 'todo' }]} />
      </div>
    </div>
  );
  if (stage === 'done') return (
    <Screen title="" act={<button type="button" className="btn primary block" onClick={() => { pop(); }}>Back to the trip</button>}>
      <span className="tm-check rise"><Icon name="check" color="#f6f2ec" size={28} width={2.4} /></span>
      <h1 className="h1 rise d1">Done. {result.label}.</h1>
      <p className="body rise d2">{result.total < 0 ? `The fare is lower, so SAR ${fmt(-result.total)} is in your Mada credit now.` : 'No cost to you.'} New boarding passes reach your Wallet when check-in opens.</p>
      <MoveNotice />
      <Faisal>“Changed with {f.airline}. {n > 1 ? 'Same seats together.' : 'Same seat.'}”</Faisal>
      {moveOpen && moveNeeded(t) && <MoveSheet onClose={() => setMoveOpen(false)} />}
    </Screen>
  );

  const allowed = (side) => !(tm.outUsed && side === 'out');
  const ready = kind === 'one' ? who && cur : cur;
  const act = kind && !['airline', 'name'].includes(kind) && opts.length > 0 ? (
    total > 0
      ? <button type="button" className="btn primary block" disabled={!ready} onClick={send}>{ready ? `Review · SAR ${fmt(total)}` : 'Pick a flight'}</button>
      : <SlideToConfirm disabled={!ready} label={!ready ? 'Pick a flight' : total < 0 ? `Slide to change · SAR ${fmt(-total)} back` : 'Slide to change · no cost'} onConfirm={send} />
  ) : null;

  return (
    <Screen title="Change flight" act={act}>
      <div className="card rise" style={{ flexDirection: 'row', alignItems: 'center' }}>
        <AirlineMark flight={f} size={36} />
        <span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{f.code} · {f.date} · {f.dep}</span><span className="tiny">{f.back ? `Back ${f.back} · ${f.backDate} · ${f.backDep}` : 'One way'} · {n} {n === 1 ? 'traveller' : 'travellers'}</span></span>
      </div>
      <div className="tm-rules rise d1">
        <span><i>Change fee</i>{R.changeFee ? `SAR ${R.changeFee} pp` : 'Free'}</span>
        <span><i>Refund</i>{R.refundable ? `Minus SAR ${R.refundFee} pp` : 'Taxes only'}</span>
        <span><i>Bags</i>{R.bags}</span>
      </div>
      {!kind && (<>
        <h1 className="h2">What would you like to change?</h1>
        <div className="card tm-list" style={{ padding: 6, gap: 0 }}>
          {CHANGE_KINDS.filter(([, , , side]) => f.back || side !== 'back').map(([id, title, sub, side]) => (
            allowed(side)
              ? <Row key={id} icon={id === 'name' ? 'user' : id === 'airline' ? 'globe' : 'flight'} title={title} sub={typeof sub === 'function' ? sub(f) : sub} onClick={() => { setKind(id); setPick(null); }} label={title} />
              : <Row key={id} icon="flight" title={title} sub="You’ve flown this one already." tone="muted" />
          ))}
        </div>
        {tm.outUsed && <span className="small">You’re in Istanbul, so only the way home can change.</span>}
      </>)}
      {kind && (
        <button type="button" className="link" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => { setKind(null); setPick(null); setWho(null); }}>← Something else</button>
      )}
      {kind === 'one' && (<>
        <h2 className="h2">Who flies home on another day?</h2>
        <div className="chips">{t.travellers.map((id) => <button key={id} type="button" className={'chip' + (who === id ? ' on' : '')} aria-pressed={who === id ? 'true' : 'false'} onClick={() => { setWho(id); buzz(HAPTIC.select); }}>{PEOPLE[id]?.name}</button>)}</div>
        {who && PEOPLE[who]?.born && Number(PEOPLE[who].born) > 2014 && <div className="notice warn"><span className="grow"><span className="h3" style={{ fontSize: 15 }}>{PEOPLE[who].name} is under 12.</span><span className="small">Children under 12 fly alone only with {f.airline}’s escort, who stays with them door to door. SAR 350, included below.</span></span></div>}
      </>)}
      {kind && !['airline', 'name'].includes(kind) && (kind !== 'one' || who) && (<>
        <h2 className="h2">{kind === 'return' || kind === 'one' ? 'Pick the flight home' : 'Pick the new flight'}</h2>
        {opts.length === 0 ? (
          <div className="card well">
            <span className="h3">No seats for {count === 1 ? 'one' : `all ${count}`} on those flights.</span>
            <span className="small">Faisal can look wider: other airports, or a waitlist on the day you want.</span>
            <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={() => { ask({ kind: 'change', title: 'Find another flight', short: 'Wider search', detail: `${f.code} · any day near ${f.date}`, with: 'faisal', outcome: 'yes', yesText: 'Two options sent to your chat' }); toast('Sent to Faisal. Track it in Trips → Requests.'); pop(); }}>Ask Faisal to look wider</button>
          </div>
        ) : opts.map((o) => {
          const d = o.diffPP * count;
          const tot = fee + d + escort;
          return (
            <Pick radio key={o.id} on={pick === o.id} disabled={o.soldOut} onClick={() => setPick(o.id)} title={o.title} sub={o.sub}
              right={o.soldOut ? 'Full' : tot > 0 ? `+${fmt(tot)}` : tot < 0 ? `−${fmt(-tot)}` : 'No cost'} />
          );
        })}
        {cur && (
          <div className="card rise tm-breakdown">
            <div className="spread"><span className="small">Change fee · {R.changeFee ? `SAR ${R.changeFee} × ${count}` : 'free on this fare'}</span><span className="num small">{fee ? '+' + fmt(fee) : '0'}</span></div>
            {escort > 0 && <div className="spread"><span className="small">Escort for {PEOPLE[who].name}, door to door</span><span className="num small">+{fmt(escort)}</span></div>}
            <div className="spread"><span className="small">Fare difference</span><span className="num small">{fareDiff > 0 ? '+' + fmt(fareDiff) : fareDiff < 0 ? '−' + fmt(-fareDiff) : 'Same fare'}</span></div>
            <div className="divider" />
            <div className="spread"><span className="h3">{total > 0 ? 'You pay' : total < 0 ? 'You get back' : 'Total'}</span><span className="num h3">{total === 0 ? 'No cost' : `SAR ${fmt(Math.abs(total))}`}</span></div>
            {total < 0 && <span className="tiny">The fare is lower than the fee, so the difference comes back as Mada credit, straight away.</span>}
            {kind === 'date' && (stayOf(t) || t.pickup) && <span className="tiny">Next, we’ll ask if your {stayOf(t) && t.pickup ? 'hotel and pickup move' : stayOf(t) ? 'hotel moves' : 'pickup moves'} too.</span>}
            {kind === 'return' && cur.longer && stayOf(t) && <span className="tiny">You’ll need one more night. Add it in Hotel options.</span>}
            <span className="tiny">The new tickets keep the same rules. Faisal confirms with {f.airline}.</span>
          </div>
        )}
      </>)}
      {kind === 'airline' && <SwitchAirline f={f} n={n} R={R} onSend={(o, net) => { askQuote({ kind: 'change', short: 'airline switch', title: `Switch to ${o.airline}`, detail: `${o.code} · ${o.dep} · ${n} travellers`, quote: Math.max(0, net), vat: 0, icon: 'flight', quoteText: `I can hold ${n} seats on ${o.code} at ${o.dep}. After your ${f.airline} refund, the difference is SAR ${fmt(Math.max(0, net))}. Pay and I’ll swap the tickets.` }); toast('Sent to Faisal. Track it in Trips → Requests.'); pop(); }} />}
      {kind === 'name' && <NameFix f={f} onSend={(r) => { ask(r); toast('Sent to Faisal. Track it in Trips → Requests.'); pop(); }} />}
    </Screen>
  );
}

function SwitchAirline({ f, n, R, onSend }) {
  const [pick, setPick] = useState(null);
  const back = R.refundable ? (f.pp - R.refundFee) * n : TAX_PP * n;
  const others = FLIGHTS.filter((x) => x.iata !== f.iata);
  return (<>
    <div className="notice warn"><span className="grow">
      <span className="h3" style={{ fontSize: 15 }}>Tickets can’t move to another airline.</span>
      <span className="small">We’d refund your {f.airline} tickets under their rules and buy new ones. {R.refundable ? `You’d get SAR ${fmt(back)} back.` : `This fare isn’t refundable, so only taxes come back: SAR ${fmt(back)}. Changing the day on ${f.airline} costs less: SAR ${R.changeFee} per person.`}</span>
    </span></div>
    {others.map((o) => {
      const net = o.pp * n - back;
      return <Pick radio key={o.id} on={pick === o.id} onClick={() => setPick(o.id)} title={`${o.airline} · ${o.code} · ${o.dep}`} sub={`${o.from} → ${o.to} · ${o.bags} · ${o.refund}`} right={net > 0 ? `+${fmt(net)}` : `−${fmt(-net)}`} />;
    })}
    <span className="tiny">Price after your refund, for all {n}. Faisal checks seats before you pay anything.</span>
    <button type="button" className="btn primary block" disabled={!pick} onClick={() => { const o = others.find((x) => x.id === pick); onSend(o, o.pp * n - back); }}>Ask Faisal to swap it</button>
  </>);
}

const lev = (a, b) => { const m = a.length; const n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j += 1) d[0][j] = j; for (let i = 1; i <= m; i += 1) for (let j = 1; j <= n; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; };

function NameFix({ f, onSend }) {
  const { s } = useStore();
  const [who, setWho] = useState(s.trip.travellers[0]);
  const p = PEOPLE[who];
  const [given, setGiven] = useState((p?.full || '').split(' ').slice(0, -1).join(' ').toUpperCase());
  const [sur, setSur] = useState((p?.full || '').split(' ').slice(-1)[0]?.toUpperCase() || '');
  useEffect(() => { const q = PEOPLE[who]; setGiven((q?.full || '').split(' ').slice(0, -1).join(' ').toUpperCase()); setSur((q?.full || '').split(' ').slice(-1)[0]?.toUpperCase() || ''); }, [who]);
  const before = (p?.full || '').toUpperCase().replace(/\s+/g, ' ');
  const after = `${given} ${sur}`.toUpperCase().replace(/\s+/g, ' ').trim();
  const d = lev(before.replace(/ /g, ''), after.replace(/ /g, ''));
  const state = !after || d === 0 ? 'same' : d <= 3 ? 'ok' : 'too';
  return (<>
    <h2 className="h2">Whose name?</h2>
    <div className="chips">{s.trip.travellers.map((id) => <button key={id} type="button" className={'chip' + (who === id ? ' on' : '')} aria-pressed={who === id ? 'true' : 'false'} onClick={() => setWho(id)}>{PEOPLE[id]?.name}</button>)}</div>
    <div className="card well" style={{ gap: 4 }}><span className="tiny">On the ticket now</span><span className="num code" style={{ fontSize: 15 }}>{(p?.full || '').split(' ').slice(-1)[0]?.toUpperCase()}/{(p?.full || '').split(' ').slice(0, -1).join(' ').toUpperCase()}</span></div>
    <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
      <div className="field grow"><label htmlFor="nf-given">Given names</label><input id="nf-given" className={'input' + (state === 'too' ? ' bad' : '')} value={given} onChange={(e) => setGiven(e.target.value.toUpperCase())} autoCapitalize="characters" /></div>
      <div className="field grow"><label htmlFor="nf-sur">Surname</label><input id="nf-sur" className={'input' + (state === 'too' ? ' bad' : '')} value={sur} onChange={(e) => setSur(e.target.value.toUpperCase())} autoCapitalize="characters" /></div>
    </div>
    {state === 'same' && <span className="small">Type it exactly as on the passport. Airlines allow small fixes only: up to 3 letters.</span>}
    {state === 'ok' && <span className="small" style={{ color: '#2f7a4b', fontWeight: 600 }}>A small fix ({d} {d === 1 ? 'letter' : 'letters'}). {f.airline} does this free. Faisal sends it with a photo of the passport page.</span>}
    {state === 'too' && <div className="field"><span className="err">That’s more than a spelling fix. Airlines allow up to 3 letters changed. A different name means a new ticket, so the fare rules apply.</span></div>}
    <button type="button" className="btn primary block" disabled={state !== 'ok'} onClick={() => onSend({ kind: 'name', title: `Name fix for ${p.name}`, short: 'Name fixed', detail: `${before} → ${after}`, with: 'airline', withName: f.airline, outcome: 'yes', yesText: 'New ticket number in your Wallet' })}>Send to Faisal</button>
    {state === 'too' && <button type="button" className="btn ghost block" onClick={() => onSend({ kind: 'name', title: `Name change for ${p.name}`, short: 'Name change', detail: `${before} → ${after} · needs a new ticket`, with: 'faisal', outcome: 'no', alt: 'Faisal will call you with the price of a new ticket.' })}>Ask Faisal what it would cost</button>}
  </>);
}

/* ================================================================
   5. Hotel options
   ================================================================ */

const ROOMS = [
  { id: 'family', title: 'Family suite', sub: 'One big room, two bathrooms', perNight: 220 },
  { id: 'view', title: 'Rooms with a Bosphorus view', sub: 'Two rooms side by side, 7th floor', perNight: 380 },
  { id: 'two', title: 'Two standard rooms', sub: 'Not connecting, on the same floor', perNight: -120 },
];

function HotelOptions() {
  const { s, push, toast } = useStore();
  const [sheet, setSheet] = useState(null);
  const t = s.trip;
  if (!t) return <NoTrip />;
  const st = t.stay && t.stay.status !== 'cancelled' ? effStay(s) : null;
  if (!st) return (
    <Screen title="Hotel options">
      <div className="card well"><span className="h3">{t.stay ? 'The stay is cancelled.' : 'No hotel on this trip.'}</span><span className="small">{t.noStay?.address ? `You’re staying at ${t.noStay.address}.` : 'Rooms near Galata Tower, for the same dates?'}</span>
        <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={() => push('ask', { intent: 'stay' })}>Find a place to stay</button></div>
    </Screen>
  );
  const mine = (s.tripRequests || []).filter((r) => r.area === 'hotel');
  const pending = s.requests.filter((r) => r.area === 'hotel');
  const lastDay = stayEnd(st);
  return (
    <Screen title="Hotel options">
      <div className="card rise">
        <span className="row"><span className="tm-ic"><Icon name="stay" size={20} /></span><span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{st.name}</span><span className="tiny">{st.roomType || (nOf(s) > 2 ? 'Connecting rooms' : 'A room')} · {rangeLabel(st.fromISO, lastDay)} · {st.nights} nights</span></span></span>
        <span className="tiny">Free to cancel or shorten until {freeUntil(st.fromISO)}. After that, the hotel keeps one night.</span>
      </div>
      <div className="card tm-list rise d1" style={{ padding: 6, gap: 0 }}>
        <Row icon="stay" title="Change the room" sub="Suite, view, or separate rooms" onClick={() => setSheet('room')} />
        <Row icon="plus" title="Add or remove nights" sub={`Now ${st.nights} nights, out on ${dayLabel(lastDay)}`} onClick={() => setSheet('nights')} />
        <Row icon="bell" title="Early check-in or late checkout" sub="If a room is ready. Prices shown first." onClick={() => setSheet('times')} />
        <Row icon="user" title="A cot or an extra bed" sub="Cots are free" onClick={() => setSheet('bed')} />
        {nOf(s) > 1 && <Row icon="link" title="Connecting rooms" sub={(st.roomType || (nOf(s) > 2 ? 'Connecting' : '')).startsWith('Connecting') ? 'In your booking' : 'Ask the hotel'} onClick={() => setSheet('connect')} />}
        <Row icon="globe" title="Switch hotel" sub="See other places for the same dates" onClick={() => push('ask', { prefill: `A different hotel in Istanbul, ${rangeLabel(st.fromISO, lastDay)}`, intent: 'stay' })} />
      </div>
      {(mine.length > 0 || pending.length > 0) && (
        <div className="card rise d2">
          <span className="h3">Asked so far</span>
          {pending.map((r) => <div key={r.id} className="spread"><span className="small" style={{ color: '#1e352d' }}>{r.title}</span><span className={'pill' + (r.status === 'quote' ? ' gold' : PAID_STATES.includes(r.status) ? ' ok' : '')}>{r.status === 'quote' ? 'Price ready' : PAID_STATES.includes(r.status) ? 'Booked' : 'With Faisal'}</span></div>)}
          {mine.map((r) => <div key={r.id} className="spread"><span className="small" style={{ color: '#1e352d' }}>{r.title}</span><StatusPill r={r} /></div>)}
          <button type="button" className="link" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => push('support', { about: 'Istanbul hotel', topic: 'change' })}>Talk to Faisal</button>
        </div>
      )}
      {sheet && <HotelSheet kind={sheet} st={st} onClose={() => setSheet(null)} onDone={(msg) => { setSheet(null); buzz(HAPTIC.success); toast(msg); }} />}
    </Screen>
  );
}

function StatusPill({ r }) {
  useTicker(1000);
  const st = reqStatus(r);
  return <span className={'pill' + (st === 'yes' || st === 'done' ? ' ok' : st === 'no' ? ' warn' : '')}>{reqLabel(r)}</span>;
}

function HotelSheet({ kind, st, onClose, onDone }) {
  const { s, set } = useStore();
  const ask = useAskFaisal();
  const askQuote = useAskQuote();
  const tm = timing(s);
  const [pick, setPick] = useState(null);
  const f = s.trip.flight;
  const n = nOf(s);
  const night = st.night || Math.round(st.price / st.nights);
  const sent = 'Sent to Faisal. Track it in Trips → Requests.';
  if (kind === 'room') {
    const cur = ROOMS.find((r) => r.id === pick);
    const diff = cur ? cur.perNight * st.nights : 0;
    return (
      <Sheet label="Change the room" onClose={onClose}>
        <h2 className="h2">Change the room</h2>
        {ROOMS.map((r) => <Pick radio key={r.id} on={pick === r.id} onClick={() => setPick(r.id)} title={r.title} sub={`${r.sub} · ${r.perNight > 0 ? '+' : '−'}SAR ${Math.abs(r.perNight)} a night`} right={`${r.perNight > 0 ? '+' : '−'}${fmt(Math.abs(r.perNight * st.nights))}`} />)}
        {cur && <span className="small">{diff > 0 ? `SAR ${fmt(diff)} more for ${st.nights} nights. You pay once the hotel says yes.` : `SAR ${fmt(-diff)} back to your card once the hotel confirms.`}</span>}
        <button type="button" className="btn primary block" disabled={!cur} onClick={() => {
          if (diff > 0) askQuote({ kind: 'hotel', area: 'hotel', short: 'room change', title: `${cur.title} instead`, detail: `${st.name} · ${st.nights} nights`, quote: diff, icon: 'stay', stayPatch: { roomType: cur.title, addPrice: diff }, quoteText: `The hotel has the ${cur.title.toLowerCase()} for all ${st.nights} nights. SAR ${fmt(diff)} more. Pay and I’ll swap it.` });
          else ask({ kind: 'room', area: 'hotel', title: `${cur.title} instead`, short: cur.title, detail: `SAR ${fmt(-diff)} back once confirmed`, with: 'hotel', outcome: 'yes', yesText: `SAR ${fmt(-diff)} refund on its way` });
          onDone(sent);
        }}>{cur ? (diff > 0 ? `Ask the hotel · +SAR ${fmt(diff)}` : 'Ask the hotel') : 'Pick a room'}</button>
      </Sheet>
    );
  }
  if (kind === 'nights') {
    const lastDay = stayEnd(st);
    const shortenBack = tm.early ? night : 0;
    const free = freeUntil(st.fromISO);
    const opts = [
      { id: 'add', title: `Stay until ${dayLabel(addDays(lastDay, 1))}`, sub: `One more night · SAR ${fmt(night)}`, right: `+${fmt(night)}` },
      { id: 'cut', title: `Leave on ${dayLabel(addDays(lastDay, -1))}`, sub: tm.early ? `One night less · free to shorten until ${free}` : `After ${free} the hotel keeps the night you drop`, right: shortenBack ? `−${fmt(shortenBack)}` : 'Nothing back', disabled: st.nights <= 1 || tm.outUsed && st.nights <= 2 },
    ];
    const flightBack = f ? f.backDateISO : null;
    return (
      <Sheet label="Add or remove nights" onClose={onClose}>
        <h2 className="h2">Add or remove nights</h2>
        {opts.map((o) => <Pick radio key={o.id} on={pick === o.id} disabled={o.disabled} onClick={() => setPick(o.id)} title={o.title} sub={o.sub} right={o.right} />)}
        {pick === 'add' && f && flightBack && flightBack <= lastDay && <div className="notice warn"><span className="grow"><span className="small">Your flight home is still {f.backDate}. Move it too in Change flight, or the extra night goes unused.</span></span></div>}
        {pick === 'cut' && f && flightBack && flightBack >= lastDay && <div className="notice warn"><span className="grow"><span className="small">Your flight home is {f.backDate}, so you’d need somewhere for the last night.</span></span></div>}
        <button type="button" className="btn primary block" disabled={!pick} onClick={() => {
          if (pick === 'add') {
            askQuote({ kind: 'hotel', area: 'hotel', short: 'extra night', title: `One more night, until ${dayLabel(addDays(lastDay, 1))}`, detail: st.name, quote: night, icon: 'stay', stayPatch: { addNights: 1, addPrice: night }, quoteText: `The hotel can keep your rooms one more night, until ${dayLabel(addDays(lastDay, 1))}. Same rooms, SAR ${fmt(night)}.` });
            onDone(sent);
          } else {
            set((p) => ({
              trip: { ...p.trip, stay: { ...p.trip.stay, nights: p.trip.stay.nights - 1, price: p.trip.stay.price - night } },
              refunds: shortenBack ? [...p.refunds, { id: 'rf' + Date.now(), title: `${st.name} · one night less`, amount: shortenBack, stage: 0, card: cardLabel(p), dest: 'card', items: ['stay-night'], created: Date.now() }] : p.refunds,
              tripRequests: [...(p.tripRequests || []), { id: 'tr' + Date.now(), kind: 'nights', area: 'hotel', title: `Leave on ${dayLabel(addDays(lastDay, -1))}`, short: 'One night less', detail: shortenBack ? `SAR ${fmt(shortenBack)} back to your card` : 'The hotel keeps the night', with: 'hotel', outcome: 'yes', created: Date.now() }],
            }));
            onDone(shortenBack ? `Shortened. SAR ${fmt(shortenBack)} is on its way back.` : 'Shortened. The hotel keeps that night, as per the rule.');
          }
        }}>{pick === 'add' ? `Ask the hotel · +SAR ${fmt(night)}` : pick === 'cut' ? 'Leave a night sooner' : 'Pick one'}</button>
      </Sheet>
    );
  }
  if (kind === 'times') {
    const reach = f ? addMin(f.arr, 105) : null;
    const leave = f ? addMin(f.backDep, -210) : null;
    const half = Math.round(night / 2);
    const opts = [
      { id: 'early-free', kind: 'early', title: 'Early check-in, if a room is ready', sub: 'Free. The hotel decides on the morning.', right: 'Free', outcome: 'no', alt: 'Rooms are full the night before. Leave your bags at the desk; the hotel has a family lounge with prayer space.' },
      { id: 'early-paid', kind: 'early', title: 'Early check-in at 10:00, guaranteed', sub: `Half a night, SAR ${fmt(half)}`, right: `+${fmt(half)}`, price: half },
      { id: 'late-free', kind: 'late', title: 'Late checkout until 14:00', sub: 'Free, if the hotel has space', right: 'Free', outcome: 'yes', until: '14:00' },
      { id: 'late-paid', kind: 'late', title: 'Late checkout until 18:00', sub: `Half a night, SAR ${fmt(half)}`, right: `+${fmt(half)}`, price: half, until: '18:00' },
    ];
    const cur = opts.find((o) => o.id === pick);
    return (
      <Sheet label="Check-in and checkout" onClose={onClose}>
        <h2 className="h2">Check-in and checkout</h2>
        {f && <span className="small" style={{ marginTop: -6 }}>You land at {f.arr} and reach the hotel about {reach}. Check-in is from 14:00{reach >= '14:00' ? ', so you may not need it' : ''}.{f.back && s.trip.pickup ? ` ${s.trip.pickup.arrive?.driver || 'Your driver'} collects you at ${leave} on your last day; checkout is 12:00.` : ' Checkout is 12:00.'}</span>}
        {opts.map((o) => <Pick radio key={o.id} on={pick === o.id} onClick={() => setPick(o.id)} title={o.title} sub={o.sub} right={o.right} />)}
        <span className="tiny">Subject to the hotel having rooms. You only pay if they say yes.</span>
        <button type="button" className="btn primary block" disabled={!cur} onClick={() => {
          if (cur.price) askQuote({ kind: 'hotel', area: 'hotel', short: cur.kind === 'early' ? 'early check-in' : 'late checkout', title: cur.title, detail: st.name, quote: cur.price, icon: 'stay', quoteText: `The hotel says yes: ${cur.title.toLowerCase()}. SAR ${fmt(cur.price)}.` });
          else ask({ kind: cur.kind, area: 'hotel', title: cur.title, short: cur.kind === 'early' ? 'Early check-in' : `Late checkout ${cur.until}`, until: cur.until, detail: st.name, with: 'hotel', outcome: cur.outcome, alt: cur.alt });
          onDone(sent);
        }}>{cur ? (cur.price ? `Ask the hotel · +SAR ${fmt(cur.price)}` : 'Ask the hotel') : 'Pick one'}</button>
      </Sheet>
    );
  }
  if (kind === 'bed') {
    const baby = s.trip.travellers.some((id) => Number(PEOPLE[id]?.born) >= 2024);
    const bed = 150 * st.nights;
    return (
      <Sheet label="A cot or an extra bed" onClose={onClose}>
        <h2 className="h2">A cot or an extra bed</h2>
        <Pick radio on={pick === 'cot'} disabled={!baby} onClick={() => setPick('cot')} title="A cot" sub={baby ? 'Free. Set up before you arrive.' : 'For babies under 2. No one on this trip is that young.'} right="Free" />
        <Pick radio on={pick === 'bed'} onClick={() => setPick('bed')} title="An extra bed" sub={`SAR 150 a night · ${st.nights} nights`} right={`+${fmt(bed)}`} />
        <button type="button" className="btn primary block" disabled={!pick} onClick={() => {
          if (pick === 'bed') askQuote({ kind: 'hotel', area: 'hotel', short: 'extra bed', title: 'An extra bed', detail: `${st.name} · ${st.nights} nights`, quote: bed, icon: 'stay', quoteText: `The hotel will set up an extra bed in the second room. SAR ${fmt(bed)} for ${st.nights} nights.` });
          else ask({ kind: 'bed', area: 'hotel', title: 'A cot', short: 'Cot in the room', detail: st.name, with: 'hotel', outcome: 'yes' });
          onDone(sent);
        }}>{pick === 'bed' ? `Ask the hotel · +SAR ${fmt(bed)}` : 'Ask the hotel'}</button>
      </Sheet>
    );
  }
  /* connecting rooms */
  const has = (st.roomType || (n > 2 ? 'Connecting' : '')).startsWith('Connecting');
  return (
    <Sheet label="Connecting rooms" onClose={onClose}>
      <h2 className="h2">Connecting rooms</h2>
      {has
        ? <p className="body" style={{ marginTop: -8 }}>Already in your booking. The hotel confirmed two connecting rooms on the 4th floor.</p>
        : <p className="body" style={{ marginTop: -8 }}>Your rooms aren’t connecting now. The hotel can try; it depends on who checks out before you.</p>}
      {has ? <button type="button" className="btn primary block" onClick={onClose}>Good</button>
        : <button type="button" className="btn primary block" onClick={() => { ask({ kind: 'connecting', area: 'hotel', title: 'Connecting rooms', short: 'Connecting rooms', detail: st.name, with: 'hotel', outcome: 'yes' }); onDone(sent); }}>Ask the hotel</button>}
    </Sheet>
  );
}

/* ================================================================
   6. Special requests
   ================================================================ */

const SPECIALS = [
  { id: 'wheelchair', icon: 'user', title: 'Wheelchair', sub: 'To the gate, or to the seat', per: true },
  { id: 'meal', icon: 'food', title: 'Meals', sub: 'Halal on every flight. Child, vegetarian, diabetic.', per: true },
  { id: 'bassinet', icon: 'stay', title: 'Bassinet', sub: 'For a baby under 2', per: true },
  { id: 'seats', icon: 'flight', title: 'Seats together', sub: 'Keep the family side by side', per: false },
  { id: 'celebration', icon: 'star', title: 'A celebration', sub: 'Birthday or anniversary, a note to the hotel', per: true },
  { id: 'prayer', icon: 'globe', title: 'Prayer', sub: 'Prayer mat and qibla in the room', per: false },
  { id: 'bags', icon: 'bag', title: 'Extra bags', sub: 'Cheaper now than at the airport', per: true },
  { id: 'sports', icon: 'bag', title: 'Sports equipment', sub: 'Golf, bikes, skis', per: true },
  { id: 'pet', icon: 'pin', title: 'Travelling with a pet', sub: 'What’s allowed', per: false },
];

function SpecialRequests() {
  const { s, push } = useStore();
  const [forWho, setForWho] = useState('all');
  const [open, setOpen] = useState(null);
  useTicker(1000);
  const t = s.trip;
  if (!t) return <NoTrip />;
  const mine = (s.tripRequests || []).filter((r) => r.area === 'special');
  const priced = s.requests.filter((r) => r.area === 'special');
  return (
    <Screen title="Special requests">
      <h1 className="h1 rise">Anything you need?</h1>
      <p className="body rise d1" style={{ marginTop: -8 }}>Faisal passes it to {t.flight?.airline || 'the airline'} and the hotel, and tells you when they confirm.</p>
      <div className="chips rise d1" role="radiogroup" aria-label="For">
        {[['all', 'Everyone'], ...t.travellers.map((id) => [id, PEOPLE[id]?.name])].map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={forWho === id ? 'true' : 'false'} className={'chip' + (forWho === id ? ' on' : '')} onClick={() => { setForWho(id); buzz(HAPTIC.select); }}>{label}</button>
        ))}
      </div>
      <div className="tm-grid rise d2">
        {SPECIALS.map((x) => (
          <button key={x.id} type="button" className="tm-tile" onClick={() => { buzz(HAPTIC.tap); setOpen(x.id); }}>
            <span className="tm-ic"><Icon name={x.icon} size={20} /></span>
            <span className="tm-row-title">{x.title}</span>
            <span className="tiny">{x.sub}</span>
          </button>
        ))}
      </div>
      {(mine.length > 0 || priced.length > 0) && (
        <div className="card rise">
          <span className="h3">Asked so far</span>
          {priced.map((r) => <div key={r.id} className="spread"><span className="small" style={{ color: '#1e352d' }}>{r.title}</span><span className={'pill' + (r.status === 'quote' ? ' gold' : PAID_STATES.includes(r.status) ? ' ok' : '')}>{r.status === 'quote' ? 'Price ready' : PAID_STATES.includes(r.status) ? 'Booked' : 'With Faisal'}</span></div>)}
          {mine.map((r) => (
            <div key={r.id} className="col" style={{ gap: 4 }}>
              <div className="spread"><span className="small" style={{ color: '#1e352d' }}>{r.title}</span><StatusPill r={r} /></div>
              {reqStatus(r) === 'no' && r.alt && <span className="tiny">{r.alt}</span>}
            </div>
          ))}
        </div>
      )}
      <button type="button" className="btn ghost block" onClick={() => push('support', { about: 'Istanbul trip', topic: 'other' })}>Something else? Talk to Faisal</button>
      {open && <SpecialSheet id={open} forWho={forWho} onClose={() => setOpen(null)} />}
    </Screen>
  );
}

function SpecialSheet({ id, forWho, onClose }) {
  const { s, push, toast } = useStore();
  const ask = useAskFaisal();
  const askQuote = useAskQuote();
  const t = s.trip;
  const f = t.flight;
  const R = f ? fareRules(f) : null;
  const airline = f?.airline || 'the airline';
  const whoIds = forWho === 'all' ? t.travellers : [forWho];
  const whoTxt = forWho === 'all' ? 'everyone' : PEOPLE[forWho]?.name;
  const [opt, setOpt] = useState(null);
  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');
  const tripDays = (() => { const a = stayOf(t)?.fromISO || f?.dateISO; const b = f?.backDateISO || stayEnd(stayOf(t)); const out = []; for (let d = a, i = 0; a && b && d <= b && i < 30; d = addDays(d, 1), i += 1) out.push(d); return out; })();
  const [day, setDay] = useState(tripDays[2] || tripDays[0] || null);
  const legs = f && f.back ? 'Both flights' : 'The flight';
  const meta = SPECIALS.find((x) => x.id === id);
  const done = (r) => { ask({ area: 'special', ...r }); buzz(HAPTIC.success); toast('Sent to Faisal. Track it in Trips → Requests.'); onClose(); };
  const needsFlight = ['wheelchair', 'meal', 'bassinet', 'seats', 'bags', 'sports'].includes(id);
  let body;
  if (needsFlight && !f) body = <><p className="body">There are no flights on this trip, so there’s nothing to ask {airline} for.</p><button type="button" className="btn primary block" onClick={onClose}>Close</button></>;
  else if (id === 'wheelchair') body = (<>
    <span className="small">For {whoTxt}. Free. {airline} needs it 48 hours before.</span>
    <Pick radio on={opt === 'gate'} onClick={() => setOpt('gate')} title="To the gate" sub="Can manage the aircraft steps and walk to the seat" />
    <Pick radio on={opt === 'seat'} onClick={() => setOpt('seat')} title="All the way to the seat" sub="Can’t manage steps. Carried on with an aisle chair." />
    <Pick radio on={opt === 'own'} onClick={() => setOpt('own')} title="Bringing our own wheelchair" sub="Goes in the hold free, taken at the aircraft door" />
    <button type="button" className="btn primary block" disabled={!opt} onClick={() => done({ kind: 'wheelchair', title: `Wheelchair ${opt === 'gate' ? 'to the gate' : opt === 'seat' ? 'to the seat' : '(own chair)'}${forWho === 'all' ? '' : ' · ' + whoTxt}`, short: `Wheelchair · ${whoTxt}`, detail: legs, with: 'airline', withName: airline, outcome: 'yes' })}>Send to Faisal</button>
  </>);
  else if (id === 'meal') {
    const kids = whoIds.filter((x) => Number(PEOPLE[x]?.born) >= 2014);
    body = (<>
      <span className="small">Every meal on {airline} is halal already. For {whoTxt}:</span>
      {[['child', 'Child meal', kids.length ? `For ${joinNames(names(kids))}` : 'For ages 2 to 11', !kids.length && forWho !== 'all'], ['veg', 'Vegetarian', 'No meat or fish'], ['diabetic', 'Diabetic', 'Low sugar, measured carbs'], ['gluten', 'Gluten-free', '']].map(([k, title, sub, dis]) => (
        <Pick radio key={k} on={opt === k} disabled={!!dis} onClick={() => setOpt(k)} title={title} sub={dis ? 'Only for children under 12' : sub} />
      ))}
      <span className="tiny">Free. Needs 24 hours before the flight.</span>
      <button type="button" className="btn primary block" disabled={!opt} onClick={() => { const label = { child: 'Child meal', veg: 'Vegetarian meal', diabetic: 'Diabetic meal', gluten: 'Gluten-free meal' }[opt]; done({ kind: 'meal', title: `${label} · ${opt === 'child' && forWho === 'all' ? joinNames(names(kids)) || whoTxt : whoTxt}`, short: `${label}`, detail: legs, with: 'airline', withName: airline, outcome: 'yes' }); }}>Send to Faisal</button>
    </>);
  } else if (id === 'bassinet') {
    const baby = t.travellers.some((x) => Number(PEOPLE[x]?.born) >= 2024);
    body = baby ? (<>
      <span className="small">A bassinet clips to the wall in front of the first row. For babies under 11 kg. Free, but there are only a few on each plane.</span>
      <button type="button" className="btn primary block" onClick={() => done({ kind: 'bassinet', title: 'Bassinet seat', short: 'Bassinet', detail: legs, with: 'airline', withName: airline, outcome: 'no', alt: 'The bassinet row is taken on the way there. Faisal moved you to row 14 with a spare seat beside you instead.' })}>Send to Faisal</button>
    </>) : (<>
      <p className="body">Bassinets are for babies under 2 and under 11 kg. No one on this trip is that young.</p>
      <span className="small">Travelling with a baby after all? Add them in the Wallet first, then come back.</span>
      <button type="button" className="btn primary block" onClick={onClose}>Close</button>
    </>);
  } else if (id === 'seats') body = (<>
    <span className="small">You’re in {seatText(f.seats)} going{f.back ? ` and ${seatText(f.backSeats)} coming back` : ''}{t.travellers.length > 1 ? ', side by side' : ''}.</span>
    <Pick radio on={opt === 'keep'} onClick={() => setOpt('keep')} title="Keep us together, whatever changes" sub="If the plane changes, Faisal re-seats you together first" />
    <Pick radio on={opt === 'kids'} onClick={() => setOpt('kids')} title="Children next to a parent" sub="Never across the aisle" />
    <button type="button" className="btn primary block" disabled={!opt} onClick={() => done({ kind: 'seats', title: opt === 'keep' ? `Seats together${f.back ? ', both ways' : ''}` : 'Children beside a parent', short: 'Seats together', detail: legs, with: 'airline', withName: airline, outcome: f.iata === 'XY' ? 'no' : 'yes', alt: 'flynas only guarantees seats together with paid seat selection, SAR 35 each. Faisal can add it.' })}>Send to Faisal</button>
  </>);
  else if (id === 'celebration') body = (<>
    <span className="small">The hotel will do something small in the room. What exactly is up to them.</span>
    <div className="chips">{['Birthday', 'Anniversary', 'Something else'].map((k) => <button key={k} type="button" className={'chip' + (opt === k ? ' on' : '')} aria-pressed={opt === k ? 'true' : 'false'} onClick={() => setOpt(k)}>{k}</button>)}</div>
    <div className="chips">{tripDays.map((d) => <button key={d} type="button" className={'chip' + (day === d ? ' on' : '')} aria-pressed={day === d ? 'true' : 'false'} onClick={() => setDay(d)}>{weekday(d)} {dayOf(d)}</button>)}</div>
    <div className="field"><label htmlFor="cel-note">A note for the hotel (optional)</label><input id="cel-note" className="input" value={note} maxLength={80} onChange={(e) => setNote(e.target.value)} placeholder={forWho === 'all' ? 'Who, and what for' : `${whoTxt} turns …`} /></div>
    <button type="button" className="btn primary block" disabled={!opt} onClick={() => done({ kind: 'celebration', title: `${opt} · ${dayLabel(day)}`, short: `${opt}${forWho !== 'all' ? ' · ' + whoTxt : ''}`, detail: note || 'A note to the hotel', day, with: 'hotel', outcome: 'yes' })}>Send to Faisal</button>
  </>);
  else if (id === 'prayer') body = (<>
    <span className="small">Istanbul on {shortDay(f?.dateISO || stayOf(t)?.fromISO)}: {PRAYER}. The times for each day are in your itinerary.</span>
    <Pick on={opt === 'mat'} onClick={() => setOpt(opt === 'mat' ? null : 'mat')} title="Prayer mats and the qibla direction in the room" sub="Qibla from Galata is south-east, about 152°" />
    <span className="tiny">Mosques near the hotel: Arap Camii (6 min walk), Kılıç Ali Paşa (10 min).</span>
    <button type="button" className="btn primary block" disabled={!opt} onClick={() => done({ kind: 'prayer', title: 'Prayer mats and qibla in the room', short: 'Prayer mats', detail: t.stay?.name || 'Hotel', with: 'hotel', outcome: 'yes' })}>Send to Faisal</button>
  </>);
  else if (id === 'bags') {
    const people = forWho === 'all' ? t.travellers.length : 1;
    const legsN = f.back ? 2 : 1;
    const price = R.bagFee * count * legsN;
    body = (<>
      <span className="small">{R.bags} each is included on {airline}. An extra {R.bagKg} kg bag is SAR {R.bagFee} each way now, about double at the airport.</span>
      <div className="spread card well" style={{ flexDirection: 'row' }}>
        <span className="small" style={{ color: '#1e352d' }}>Extra bags {forWho === 'all' ? 'in total' : `for ${whoTxt}`}</span>
        <span className="row" style={{ gap: 6 }}>
          <button type="button" className="icon-btn" aria-label="One fewer bag" disabled={count <= 1} onClick={() => setCount(Math.max(1, count - 1))}><span style={{ fontSize: 22, lineHeight: 1 }}>−</span></button>
          <span className="num h3" aria-live="polite" style={{ minWidth: 20, textAlign: 'center' }}>{count}</span>
          <button type="button" className="icon-btn" aria-label="One more bag" disabled={count >= people * 2} onClick={() => setCount(Math.min(people * 2, count + 1))}><Icon name="plus" size={18} /></button>
        </span>
      </div>
      <div className="spread"><span className="small">{count} × SAR {R.bagFee}{legsN === 2 ? ' × 2 flights' : ''}</span><span className="num h3">SAR {fmt(price)}</span></div>
      <button type="button" className="btn primary block" onClick={() => { askQuote({ kind: 'bags', area: 'special', short: 'extra bags', title: `${count} extra ${count === 1 ? 'bag' : 'bags'}${legsN === 2 ? ', both ways' : ''}`, detail: `${airline} · ${R.bagKg} kg each`, quote: price, vat: 0, icon: 'bag', quoteText: `${airline} has added ${count} extra ${count === 1 ? 'bag' : 'bags'} of ${R.bagKg} kg${legsN === 2 ? ', both ways' : ''}. SAR ${fmt(price)}.` }); buzz(HAPTIC.success); toast('Sent to Faisal. You pay once it’s added.'); onClose(); }}>Ask for SAR {fmt(price)}</button>
    </>);
  } else if (id === 'sports') body = (<>
    <span className="small">Packed and under {R.bagKg} kg, it counts as one of your bags. Heavier or longer than 2 m costs SAR 300 each way.</span>
    {[['golf', 'Golf clubs', 'Usually 15–20 kg'], ['bike', 'A bike in a box', 'Usually 25–32 kg'], ['ski', 'Skis or a snowboard', 'Usually 8–12 kg']].map(([k, title, sub]) => <Pick radio key={k} on={opt === k} onClick={() => setOpt(k)} title={title} sub={sub} />)}
    <button type="button" className="btn primary block" disabled={!opt} onClick={() => done({ kind: 'sports', title: `${{ golf: 'Golf clubs', bike: 'A bike', ski: 'Skis' }[opt]}${forWho === 'all' ? '' : ' · ' + whoTxt}`, short: { golf: 'Golf clubs', bike: 'Bike box', ski: 'Skis' }[opt], detail: legs, with: 'airline', withName: airline, outcome: opt === 'bike' ? 'no' : 'yes', alt: `The bike box is too long for ${airline}’s hold on this plane. Faisal can send it by air cargo for SAR 410; it arrives a day before you.` })}>Send to Faisal</button>
  </>);
  else body = (<>
    <p className="body">Pets can’t fly with you to Istanbul on {airline}, in the cabin or the hold, and Mada can’t book pet travel.</p>
    <span className="small">Guide and assistance dogs are the exception. They fly free in the cabin with the right papers. Tell Faisal and he’ll arrange it.</span>
    <button type="button" className="btn primary block" onClick={() => { onClose(); push('support', { about: 'Istanbul trip', topic: 'other' }); }}>Talk to Faisal</button>
  </>);
  return (
    <Sheet label={meta.title} onClose={onClose}>
      <span className="row"><span className="tm-ic"><Icon name={meta.icon} size={20} /></span><h2 className="h2">{meta.title}</h2></span>
      {body}
    </Sheet>
  );
}

export const SCREENS = { itinerary: Itinerary, invoices: Payments, invoice: Invoice, refund: Refund, changeFlight: ChangeFlight, hotelOptions: HotelOptions, specialRequests: SpecialRequests };

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, buzz, HAPTIC, PEOPLE, FLIGHTS, HOTELS, STAY_NIGHTS, PICKUP, fmt, seedTrip } from '../store.jsx';
import { Icon, Sun, TopBar, Sheet, SlideToConfirm, Steps, useTicker } from '../ui.jsx';
import { PLANS } from './Plan.jsx';

/* Builds the lines, total and rules for anything the traveller can pay for. */
function useOrder(params, travellers) {
  const { s } = useStore();
  const n = travellers.length;
  if (params.kind === 'trip') {
    const f = FLIGHTS.find((x) => x.id === params.flightId);
    const hotelFactor = n > 2 ? 1 : 0.55;
    const stay = HOTELS[0].night * STAY_NIGHTS * hotelFactor;
    const lines = [{ icon: 'flight', text: `${n} ${n === 1 ? 'traveller' : 'travellers'} · ${f.airline}, direct`, price: f.pp * n }];
    if (params.bundle) {
      lines.push({ icon: 'stay', text: `${n > 2 ? 'Connecting rooms' : 'A room'} near Galata Tower · 6 nights`, price: stay });
      lines.push({ icon: 'car', text: 'Airport pickup both ways', price: PICKUP });
    }
    return { title: `Istanbul · ${params.flex ? '10–15' : '9–15'} Mar`, lines, rule: f.refund === 'Not refundable' ? 'Flights can’t be refunded. Changes cost ' + f.change + '.' : 'Free to cancel until 2 Mar. After that, SAR 400 per person.', agent: true, people: true };
  }
  if (params.kind === 'stay') {
    const h = HOTELS.find((x) => x.id === params.hotelId);
    const factor = n > 2 ? 1 : 0.55;
    return { title: `${h.name}`, lines: [{ icon: 'stay', text: `${n > 2 ? '2 connecting rooms' : '1 room'} · 9–15 Mar · 6 nights`, price: h.night * STAY_NIGHTS * factor }], rule: 'Free to cancel until 2 Mar. After that, the first night.', agent: true, people: true };
  }
  if (params.kind === 'package') {
    const pl = PLANS[params.planId];
    const lines = [];
    if (pl.price.flights) lines.push({ icon: 'flight', text: `Flights for ${n} · Riyadh ⇄ ${pl.city}`, price: pl.price.flights * n / 2 });
    if (pl.price.stay) lines.push({ icon: 'stay', text: `${n > 2 ? 'Connecting rooms' : 'A room'} · ${pl.days - 1 || 1} night${pl.days > 2 ? 's' : ''}`, price: pl.price.stay });
    lines.push({ icon: 'star', text: `Tickets, tours and tables for ${n}`, price: pl.price.experiences * n / 4 });
    return { title: pl.title, lines, rule: 'Free to cancel until 7 days before. Tours refunded in full until 48 hours before.', agent: true, people: true };
  }
  if (params.kind === 'esim') return { title: 'Data in Türkiye', lines: [{ icon: 'globe', text: `10 GB for 7 days × ${params.count}`, price: 39 * params.count }], rule: 'Refundable until it’s installed.', agent: false };
  if (params.kind === 'quote') {
    const r = s.requests.find((x) => x.id === params.requestId);
    return { title: r?.title || 'Request', lines: [{ icon: 'doc', text: r?.kind === 'visa' ? 'Appointment, forms and checklist' : 'As agreed with Faisal', price: r?.quote || 0 }], rule: 'Refunded in full if Faisal can’t deliver it.', agent: false, requestId: params.requestId };
  }
  if (params.kind === 'share') return { title: 'Your share of the cruise', lines: [{ icon: 'star', text: 'Bosphorus dinner cruise · Abdullah’s family', price: params.amount }], rule: 'Free to cancel until 48 hours before.', agent: false };
  if (params.kind === 'change') return { title: 'Change your flight', lines: [{ icon: 'flight', text: params.label, price: params.amount }], rule: 'The new fare follows the same rules.', agent: true };
  return { title: 'Payment', lines: [], rule: '', agent: false };
}

export default function Pay({ params }) {
  const { s, set, pop, replace, push, toast } = useStore();
  const [travellers, setTravellers] = useState(params.travellers || []);
  const order = useOrder(params, travellers);
  const base = order.lines.reduce((a, l) => a + l.price, 0);
  const [bump, setBump] = useState(0);
  const total = base + bump;
  const [card, setCard] = useState(s.defaultCard);
  const [plan, setPlan] = useState('full');
  const [sheet, setSheet] = useState(null);
  const [busy, setBusy] = useState(false);
  const [priceSeen, setPriceSeen] = useState(false);
  const holdEnds = useRef(Date.now() + 20 * 60000);
  const [holdSkip, setHoldSkip] = useState(0);
  useTicker(1000);
  const left = Math.max(0, holdEnds.current - Date.now() - holdSkip);
  const expired = left === 0;
  const cardObj = s.cards.find((c) => c.id === card) || s.cards[0];
  const tabby = Math.ceil(total / 4);
  const tamara = Math.ceil(total / 3);
  const slideLabel = plan === 'tabby' ? `Slide to book · 4 × SAR ${fmt(tabby)}` : plan === 'tamara' ? `Slide to book · 3 × SAR ${fmt(tamara)}` : `Slide to book · SAR ${fmt(total)}`;

  const confirm = () => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      if (s.demo.offline) { setSheet('offline'); buzz(HAPTIC.soft); return; }
      if (s.demo.decline && card === s.cards[0].id && plan === 'full') { setSheet('declined'); buzz(HAPTIC.soft); return; }
      if (s.demo.priceUp && !priceSeen && order.agent) { setSheet('price'); buzz(HAPTIC.soft); return; }
      done();
    }, 1300);
  };

  const done = () => {
    if (order.agent) {
      replace('waiting', { ...params, travellers, total, card: cardObj.label, plan });
      return;
    }
    buzz(HAPTIC.success);
    if (params.kind === 'quote') set((p) => ({ requests: p.requests.map((r) => (r.id === params.requestId ? { ...r, status: 'paid' } : r)) }));
    if (params.kind === 'share') set((p) => ({ circles: { ...p.circles, sharePaid: true } }));
    pop();
    toast(params.kind === 'esim' ? 'Done. The eSIMs install before you fly.' : params.kind === 'share' ? 'Paid. Abdullah sees it in the group.' : 'Paid. Faisal takes it from here.');
  };

  return (
    <div className="screen push" style={{ background: '#0f1a16' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 240 }}>
        <img className="drift" src="img/istanbul.jpg" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(15,26,22,.4), rgba(15,26,22,.55))' }} />
      </div>
      <div style={{ position: 'relative' }}><TopBar onBack={pop} dark backLabel="Back" /></div>
      <div className="sheet" style={{ position: 'absolute', top: 128, maxHeight: 'none', zIndex: 5, animation: 'sheetUp .5s var(--ease) both' }}>
        <div className="grab" />
        <div className="sheet-body" style={{ paddingBottom: 150, gap: 14 }}>
          <div className="spread">
            <h1 className="h2">{order.title}</h1>
            <span className={'pill num' + (expired ? '' : ' ok')} aria-live="polite">{expired ? 'Hold ended' : `Held ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`}</span>
          </div>
          {order.lines.map((l) => (
            <div key={l.text} className="spread" style={{ fontSize: 15 }}>
              <span className="row"><Icon name={l.icon} size={20} />{l.text}</span>
              <span className="num small" style={{ color: '#1e352d' }}>{fmt(l.price)}</span>
            </div>
          ))}
          {order.people && (
            <div className="spread card well" style={{ padding: '12px 14px', flexDirection: 'row' }}>
              <span className="small">{travellers.map((id) => PEOPLE[id].name).join(', ')} · window seats · halal meals</span>
              <button type="button" className="link" onClick={() => setSheet('people')}>Edit</button>
            </div>
          )}
          <div className="divider" />
          <div className="col" style={{ gap: 2 }}>
            <span className="num" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.05 }}>SAR {fmt(total)}</span>
            <span className="small">Everything included. No fees later.</span>
            <span className="small">{order.rule}</span>
          </div>
          <div className="spread">
            <span className="row" style={{ fontSize: 15, fontWeight: 500 }}><span className="pill" style={{ background: '#1e352d', color: '#f6f2ec', fontSize: 10 }}>{cardObj.brand}</span>{cardObj.label}</span>
            <button type="button" className="link" onClick={() => setSheet('cards')}>Change</button>
          </div>
          {total >= 1000 && (
            <div className="chips" role="radiogroup" aria-label="How to pay">
              {[['full', 'Pay in full'], ['tabby', `Tabby · 4 × ${fmt(tabby)}`], ['tamara', `Tamara · 3 × ${fmt(tamara)}`]].map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={plan === id ? 'true' : 'false'} className={'chip' + (plan === id ? ' on' : '')} onClick={() => { setPlan(id); buzz(HAPTIC.select); }}>{label}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="act" style={{ zIndex: 6 }}>
        {expired ? (
          <button type="button" className="btn primary block" onClick={() => { holdEnds.current = Date.now() + 20 * 60000; setHoldSkip(0); buzz(HAPTIC.tap); toast('Price checked again. Same price, held for 20 minutes.'); }}>Check the price again</button>
        ) : (
          <SlideToConfirm label={slideLabel} busy={busy} busyLabel="Checking with your bank" onConfirm={confirm} />
        )}
        <p className="act-note">{order.agent ? 'You’re only charged once it’s confirmed.' : 'Charged now.'} <button type="button" className="link" style={{ fontSize: 12, padding: 0 }} onClick={() => setHoldSkip(20 * 60000)}>(demo: end the hold)</button></p>
      </div>

      {sheet === 'people' && (
        <Sheet label="Who's travelling" onClose={() => setSheet(null)}>
          <h2 className="h2">Who's travelling?</h2>
          <div className="chips">
            {(s.household.length ? s.household : ['omar']).map((id) => {
              const on = travellers.includes(id);
              return <button key={id} type="button" className="chip" aria-pressed={on ? 'true' : 'false'} onClick={() => { if (on && travellers.length === 1) return; setTravellers(on ? travellers.filter((x) => x !== id) : [...travellers, id]); buzz(HAPTIC.select); }}>{PEOPLE[id].name}</button>;
            })}
          </div>
          <span className="small">The price updates as you change it.</span>
          <button type="button" className="btn primary block" onClick={() => setSheet(null)}>Done · SAR {fmt(total)}</button>
        </Sheet>
      )}
      {sheet === 'cards' && <CardsSheet current={card} onPick={(id) => { setCard(id); setSheet(null); }} onClose={() => setSheet(null)} />}
      {sheet === 'offline' && (
        <Sheet label="Offline" onClose={() => setSheet(null)}>
          <h2 className="h2">You're offline.</h2>
          <p className="body">Nothing was charged. Your price stays held while the timer runs. Try again once you're connected.</p>
          <button type="button" className="btn primary block" onClick={() => setSheet(null)}>Okay</button>
        </Sheet>
      )}
      {sheet === 'declined' && (
        <Sheet label="Card declined" onClose={() => setSheet(null)}>
          <h2 className="h2">Your bank said no.</h2>
          <p className="body">Nothing was charged. Banks sometimes block large travel payments. Try another card, or call your bank and come back. The price stays held.</p>
          <button type="button" className="btn primary block" onClick={() => setSheet('cards')}>Use another card</button>
          <button type="button" className="btn ghost block" onClick={() => setSheet(null)}>Try again</button>
        </Sheet>
      )}
      {sheet === 'price' && (
        <Sheet label="Price changed" onClose={() => setSheet(null)}>
          <h2 className="h2">The price went up SAR 140 while we checked.</h2>
          <p className="body">Airlines change fares minute to minute. Nothing was charged.</p>
          <button type="button" className="btn primary block" onClick={() => { setBump(140); setPriceSeen(true); setSheet(null); buzz(HAPTIC.tap); }}>Book at SAR {fmt(base + 140)}</button>
          <button type="button" className="btn ghost block" onClick={() => pop()}>See other options</button>
        </Sheet>
      )}
    </div>
  );
}

export function CardsSheet({ current, onPick, onClose }) {
  const { s, set } = useStore();
  const [adding, setAdding] = useState(false);
  const [num, setNum] = useState('');
  const digits = num.replace(/\D/g, '');
  const ok = digits.length >= 15 && digits.length <= 16;
  return (
    <Sheet label="Payment method" onClose={onClose}>
      <h2 className="h2">Pay with</h2>
      {s.cards.map((c) => (
        <button key={c.id} type="button" className={'card tap well' + (c.id === current ? ' selected' : '')} onClick={() => { buzz(HAPTIC.select); onPick(c.id); }} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <span className="pill" style={{ background: '#1e352d', color: '#f6f2ec', fontSize: 10 }}>{c.brand}</span>
          <span className="grow h3" style={{ fontSize: 15 }}>{c.label}</span>
          {c.id === current && <Icon name="check" color="#2f7a4b" width={2.4} />}
        </button>
      ))}
      <button type="button" className="card tap well" style={{ flexDirection: 'row', alignItems: 'center' }} onClick={() => { buzz(HAPTIC.select); onPick('applepay'); }}>
        <span className="pill" style={{ background: '#0f1a16', color: '#fff', fontSize: 10 }}>Pay</span><span className="grow h3" style={{ fontSize: 15 }}>Apple Pay</span>
      </button>
      {adding ? (
        <form className="col" style={{ gap: 10 }} onSubmit={(e) => {
          e.preventDefault(); if (!ok) return;
          const id = 'card' + Date.now();
          const label = (digits.startsWith('4') ? 'Visa' : digits.startsWith('5') ? 'Mastercard' : 'mada') + ' ending ' + digits.slice(-2);
          set((p) => ({ cards: [...p.cards, { id, label, brand: label.split(' ')[0].toUpperCase() }] }));
          onPick(id);
        }}>
          <div className="field">
            <label htmlFor="cardnum">Card number</label>
            <input id="cardnum" className="input num" inputMode="numeric" value={num} onChange={(e) => setNum(e.target.value)} placeholder="4000 0000 0000 0000" autoComplete="cc-number" />
            {num && !ok && <span className="err">Card numbers have 15 or 16 digits.</span>}
          </div>
          <button type="submit" className="btn primary block" disabled={!ok}>Add card</button>
        </form>
      ) : <button type="button" className="btn secondary block" onClick={() => setAdding(true)}><Icon name="plus" />Add a card</button>}
    </Sheet>
  );
}

/* ---------- with Faisal, then confirmed ---------- */

export function Waiting({ params }) {
  const { s, set, reset, replace, push, go } = useStore();
  const [step, setStep] = useState(0);
  const [question, setQuestion] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const asked = useRef(false);
  const labels = params.kind === 'package' ? ['Seats held', 'Rooms held', 'Booking tours and tables'] : params.kind === 'change' ? ['Seats held', 'Fare checked', 'Changing tickets'] : ['Seats held', 'Price checked', params.kind === 'stay' ? 'Confirming rooms' : 'Issuing tickets'];

  useEffect(() => { buzz(HAPTIC.knock); }, []);
  useEffect(() => {
    if (confirmed) return undefined;
    if (step === 1 && s.demo.agentQuestion && !asked.current) { asked.current = true; setQuestion(true); buzz(HAPTIC.knock); return undefined; }
    if (question && !answered) return undefined;
    const t = setTimeout(() => {
      if (step < 3) setStep(step + 1);
      else { setConfirmed(true); buzz(HAPTIC.success); commit(); }
    }, 1200);
    return () => clearTimeout(t);
  }, [step, question, answered, confirmed]);

  const commit = () => {
    if (params.kind === 'trip') {
      set((p) => {
        const t = seedTrip({ ...p, household: params.travellers });
        const f = FLIGHTS.find((x) => x.id === params.flightId);
        t.travellers = params.travellers;
        t.flightId = f.id;
        t.flight = { ...f, date: params.flex ? 'Wed 10 Mar' : 'Tue 9 Mar', backDep: '15:10', backArr: '19:20', backDate: 'Mon 15 Mar' };
        t.flightPrice = f.pp * params.travellers.length;
        if (!params.bundle) { t.stay = null; t.pickup = null; }
        return { trip: t, phase: 'booked' };
      });
    } else if (params.kind === 'stay') {
      set((p) => {
        const h = HOTELS.find((x) => x.id === params.hotelId);
        const stay = { ...h, nights: STAY_NIGHTS, price: params.total, status: 'booked' };
        if (p.trip) return { trip: { ...p.trip, stay } };
        const t = seedTrip({ ...p, household: params.travellers });
        return { trip: { ...t, travellers: params.travellers, flight: null, flightPrice: 0, stay, pickup: null }, phase: 'booked' };
      });
    } else if (params.kind === 'package') {
      const pl = PLANS[params.planId];
      set((p) => ({ requests: [...p.requests, { id: 'pk' + Date.now(), kind: 'package', short: pl.title, title: `Booked: ${pl.title}`, detail: `${params.travellers.length} travellers · confirmed by Faisal`, status: 'done', created: Date.now(), quote: 0 }] }));
    } else if (params.kind === 'change') {
      set((p) => ({ trip: { ...p.trip, flight: { ...p.trip.flight, ...params.patch } } }));
    }
  };

  const steps = labels.map((text, i) => ({ text, state: i < step ? 'done' : i === step ? 'now' : 'todo' }));
  const city = params.kind === 'package' ? `You're going to ${PLANS[params.planId].city}.` : params.kind === 'stay' ? 'Your rooms are booked.' : params.kind === 'change' ? 'Your flight is changed.' : "You're going to Istanbul.";

  if (!confirmed) return (
    <div className="screen push">
      <div style={{ padding: '0 32px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28, flex: 1 }}>
        <div style={{ position: 'relative', width: 96, height: 96 }}>
          <span className="pulse" style={{ position: 'absolute', inset: -8, borderRadius: 999, border: '2px solid #d9b77a' }} />
          <span className="avatar green" style={{ width: 96, height: 96, fontSize: 36 }}>F</span>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <h1 className="h1">With Faisal</h1>
          <p className="body">Faisal is {params.kind === 'stay' ? 'confirming your rooms with the hotel' : 'confirming your seats with ' + (FLIGHTS.find((f) => f.id === params.flightId)?.airline || 'the airline')}. Usually 4 minutes.</p>
        </div>
        <Steps items={steps} />
        {question && (
          <div className="card rise" style={{ gap: 12 }}>
            <div className="row"><span className="avatar sm green">F</span><span className="h3" style={{ fontSize: 15 }}>Faisal · Mada</span></div>
            <span className="body" style={{ color: '#1e352d' }}>Sara's passport shows her given names as “SARA OMAR”. Should her ticket say exactly that?</span>
            {answered ? <span className="small" style={{ color: '#2f7a4b', fontWeight: 600 }}>Thanks. Carrying on.</span> : (
              <div className="row">
                <button type="button" className="btn primary small" onClick={() => { setAnswered(true); buzz(HAPTIC.tap); }}>Yes, as on the passport</button>
                <button type="button" className="btn secondary small" onClick={() => { setAnswered(true); buzz(HAPTIC.tap); }}>Call me</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="screen push" style={{ background: 'radial-gradient(120% 70% at 50% 30%, rgba(217,183,122,.38) 0%, rgba(233,226,216,0) 70%), #e9e2d8' }}>
      <div style={{ height: 300, display: 'grid', placeItems: 'center', position: 'relative', marginTop: 60 }}>
        <svg width="260" height="260" viewBox="-130 -130 260 260" aria-hidden="true" style={{ position: 'absolute', animation: 'burst .9s cubic-bezier(.15,.7,.2,1) both' }}>
          <g stroke="#d9b77a" strokeWidth="5" strokeLinecap="round">
            {Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return <line key={i} x1={Math.cos(a) * 62} y1={Math.sin(a) * 62} x2={Math.cos(a) * 112} y2={Math.sin(a) * 112} />; })}
          </g>
        </svg>
        <div style={{ animation: 'pop .7s cubic-bezier(.2,.9,.25,1.2) both' }}><Sun width={120} color="#b98f4a" className="breathe" /></div>
      </div>
      <div style={{ padding: '0 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h1 className="display rise d1" style={{ fontSize: 46 }}>{city}</h1>
        <div className="row rise d2"><span className="avatar sm green">F</span><span className="small num">Confirmed by Faisal{params.kind === 'trip' ? ' · ' + (FLIGHTS.find((f) => f.id === params.flightId)?.code || '') : ''} · <b style={{ color: '#1e352d', letterSpacing: '.04em' }}>X7K2QD</b></span></div>
        <div className="chips rise d3">
          {params.kind !== 'stay' && <span className="pill" style={{ background: '#fffdf9' }}>Tickets in your Wallet</span>}
          {(params.bundle || params.kind === 'stay') && <span className="pill" style={{ background: '#fffdf9' }}>Rooms booked</span>}
          <span className="pill" style={{ background: '#fffdf9' }}>{params.plan === 'tabby' ? 'Tabby: first of 4 paid' : params.plan === 'tamara' ? 'Tamara: first of 3 paid' : `Paid with ${params.card}`}</span>
          {params.kind !== 'stay' && <span className="pill" style={{ background: '#fffdf9' }}>We're watching the flight</span>}
        </div>
      </div>
      <div className="act">
        <button type="button" className="btn primary block" onClick={() => { reset('today'); }}>See the trip</button>
      </div>
    </div>
  );
}

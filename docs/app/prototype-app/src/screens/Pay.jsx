import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, buzz, HAPTIC, PEOPLE, FLIGHTS, HOTELS, STAY_NIGHTS, fmt, isoDate, addDays, daysBetween, dayLabel, shortDay, rangeLabel, TRIP_YEAR, MONTHS, makeFlight, makePickup, seatsFor, seatText, bundleQuote, stayOf, NUM_WORD } from '../store.jsx';
import { Icon, Sun, TopBar, Sheet, SlideToConfirm, Steps, Toggle, useTicker, AddPersonSheet, InviteSheet, PayMark, cardBrand, luhn, BRAND_NAME } from '../ui.jsx';
import { passportStatus } from './Account.jsx';
import { PLANS } from './Plan.jsx';
import { MEALS, ageBand } from './Account.jsx';

/* What the traveller picked in Ask, as real dates. Flex on Eid moves the 9th to the 10th, the way Ask shows it. */
export function searchDates(params) {
  const sr = params.search || {};
  const oneway = sr.type === 'oneway';
  let outISO; let backISO;
  if (sr.depISO) { outISO = sr.depISO; backISO = oneway ? null : sr.retISO || null; }
  else {
    const month = MONTHS.includes(sr.month) ? sr.month : 'Mar';
    const year = sr.year || TRIP_YEAR;
    outISO = isoDate(year, month, sr.dep ?? 9);
    backISO = oneway ? null : isoDate(sr.retYear || year, MONTHS.includes(sr.retMonth) ? sr.retMonth : month, sr.ret ?? 15);
  }
  if (params.flex && !oneway && backISO && daysBetween(addDays(outISO, 1), backISO) > 0) outISO = addDays(outISO, 1);
  return { outISO, backISO, oneway, cabin: sr.cabin || 'Economy', infants: sr.infants || 0 };
}
/* Free to cancel until a week before the first night or flight. */
const freeUntil = (iso) => shortDay(addDays(iso, -7));

/* Builds the lines, total and rules for anything the traveller can pay for. */
function useOrder(params, travellers) {
  const { s } = useStore();
  const n = travellers.length;
  if (params.kind === 'trip') {
    const f = FLIGHTS.find((x) => x.id === params.flightId) || FLIGHTS[0];
    const sr = params.search || {};
    const d = searchDates(params);
    const x = (d.cabin === 'Business' ? 3.2 : d.cabin === 'Premium' ? 1.7 : 1) * (d.oneway ? 0.55 : 1);
    const pp = Math.round(f.pp * x);
    const lines = [{ key: 'flight', icon: 'flight', text: `${n} ${n === 1 ? 'traveller' : 'travellers'} · ${f.airline}, direct${d.cabin !== 'Economy' ? ' · ' + d.cabin : ''}${d.oneway ? ' · one way' : ''}`, price: pp * n }];
    if (d.infants) lines.push({ key: 'infants', icon: 'flight', text: `${d.infants} ${d.infants === 1 ? 'baby' : 'babies'} on a lap`, price: Math.round(pp * 0.1) * d.infants });
    if (params.bundle) {
      const b = bundleQuote(n, { type: sr.type, nights: sr.nights || (d.backISO ? daysBetween(d.outISO, d.backISO) : 0) });
      lines.push({ key: 'stay', icon: 'stay', text: `${n > 2 ? 'Connecting rooms' : 'A room'} near Galata Tower · ${b.nights} nights`, price: b.stay, nights: b.nights });
      lines.push({ key: 'pickup', icon: 'car', text: d.oneway ? 'Airport pickups on the way there' : 'Airport pickup both ways', price: b.pickup });
    }
    /* The same rules the refund screen applies later, with this trip's own dates. */
    const refundable = f.refund !== 'Not refundable';
    const rule = (refundable
      ? `If you cancel, the flights come back minus ${f.refund.replace(/^Refund minus /, '')}.`
      : `Flights can’t be refunded, only the airport taxes. Changes cost ${f.change}.`)
      + (params.bundle ? ` Rooms and pickups are free to cancel until ${freeUntil(d.outISO)}.` : '');
    return { title: `Istanbul · ${rangeLabel(d.outISO, d.backISO)}`, lines, rule, agent: true, people: true, img: 'img/istanbul.jpg', dates: d };
  }
  if (params.kind === 'stay') {
    const h = HOTELS.find((x) => x.id === params.hotelId) || HOTELS[0];
    const factor = n > 2 ? 1 : 0.55;
    /* Rooms for the trip's own dates when there is one. */
    const t = s.trip;
    const fromISO = t?.flight?.dateISO || isoDate(TRIP_YEAR, 'Mar', 9);
    const nights = t?.flight?.backDateISO ? Math.max(1, daysBetween(fromISO, t.flight.backDateISO)) : STAY_NIGHTS;
    return { title: `${h.name}`, lines: [{ key: 'stay', icon: 'stay', text: `${n > 2 ? '2 connecting rooms' : '1 room'} · ${rangeLabel(fromISO, addDays(fromISO, nights))} · ${nights} nights`, price: Math.round(h.night * nights * factor), nights }], rule: `Free to cancel until ${freeUntil(fromISO)}. After that, the first night.`, agent: true, people: true, img: 'img/istanbul.jpg', stayDates: { fromISO, nights } };
  }
  if (params.kind === 'package') {
    const pl = PLANS[params.planId];
    const lines = [];
    if (pl.price.flights) lines.push({ icon: 'flight', text: `Flights for ${n} · Riyadh ⇄ ${pl.city}`, price: pl.price.flights * n / 2 });
    if (pl.price.stay) lines.push({ icon: 'stay', text: `${n > 2 ? 'Connecting rooms' : 'A room'} · ${pl.days - 1 || 1} night${pl.days > 2 ? 's' : ''}`, price: pl.price.stay });
    lines.push({ icon: 'star', text: `Tickets, tours and tables for ${n}`, price: pl.price.experiences * n / 4 });
    return { title: pl.title, lines, rule: 'Free to cancel until 7 days before. Tours refunded in full until 48 hours before.', agent: true, people: true, img: pl.img };
  }
  if (params.kind === 'esim') return { title: 'Data in Türkiye', lines: [{ icon: 'globe', text: `10 GB for 7 days × ${params.count}`, price: 39 * params.count }], rule: 'Refundable until it’s installed.', agent: false, img: 'img/istanbul.jpg' };
  if (params.kind === 'quote') {
    const r = s.requests.find((x) => x.id === params.requestId);
    return { title: r?.title || 'Request', lines: [{ icon: 'doc', text: r?.kind === 'visa' ? 'Appointment, forms and checklist' : 'As agreed with Mada', price: r?.quote || 0 }], rule: 'Refunded in full if we can’t deliver it.', agent: false, requestId: params.requestId, img: r?.trip || ['food', 'todo', 'car', 'hotel'].includes(r?.kind) ? (s.trip?.img || 'img/istanbul.jpg') : 'img/clouds.jpg' };
  }
  if (params.kind === 'share') return { title: params.title ? `Your share · ${params.title}` : 'Your share of the cruise', lines: [{ icon: 'star', text: params.title ? `${params.title}${params.payee ? ` · paid to ${params.payee}` : ''}` : 'Bosphorus dinner cruise · Abdullah’s family', price: params.amount }], rule: 'Free to cancel until 48 hours before.', agent: false, img: 'img/istanbul.jpg' };
  if (params.kind === 'change') return { title: 'Change your flight', lines: [{ icon: 'flight', text: params.label, price: params.amount }], rule: 'The new fare follows the same rules.', agent: true, img: s.trip?.img || 'img/istanbul.jpg' };
  return { title: 'Payment', lines: [], rule: '', agent: false, img: 'img/clouds.jpg' };
}

/* Seats, meals and help from the traveller's own preferences, per person where they differ. Solo travellers get solo words. */
export function prefsLine(s, travellers) {
  const p = s.account?.prefs || {};
  const n = travellers.length;
  const out = [];
  const seat = p.seat === 'window' ? 'window' : p.seat === 'aisle' ? 'aisle' : null;
  if (n === 1) { if (seat) out.push(`${seat} seat`); }
  else if (p.together !== false) out.push(seat ? `${seat} seats together` : 'seats together');
  else if (seat) out.push(`${seat} seats`);
  const mealOf = (id) => {
    const own = id === 'omar' ? p.meal : s.account?.people?.[id]?.meal;
    if (own) return own;
    if (id !== 'omar' && ageBand(id)?.short === 'Child') return 'child';
    return p.meal || null;
  };
  const byMeal = {};
  travellers.forEach((id) => { const m = mealOf(id); if (m) (byMeal[m] = byMeal[m] || []).push(id); });
  const name = (m) => ((MEALS.find((x) => x[0] === m) || [])[1] || m).toLowerCase().replace(/ meal$/, '');
  const kinds = Object.keys(byMeal).sort((a, b) => byMeal[b].length - byMeal[a].length);
  kinds.forEach((m, i) => {
    const ids = byMeal[m];
    if (i === 0 && kinds.length === 1 && ids.length === n) out.push(n === 1 ? `${name(m)} meal` : `${name(m)} meals`);
    else if (i === 0 && ids.length > 1) out.push(`${name(m)} meals`);
    else out.push(`${name(m)} ${ids.length > 1 ? 'meals' : 'meal'} for ${ids.map((id) => (id === 'omar' ? 'you' : PEOPLE[id]?.name)).join(' and ')}`);
  });
  const assist = p.assist || [];
  if (assist.includes('wchc')) out.push('wheelchair to the seat');
  else if (assist.includes('wchr')) out.push('wheelchair to the gate');
  if (assist.includes('bassinet')) out.push('bassinet');
  return out;
}

export default function Pay({ params }) {
  const { s, set, pop, replace, push, toast } = useStore();
  const [travellers, setTravellers] = useState(params.travellers || []);
  const order = useOrder(params, travellers);
  const base = order.lines.reduce((a, l) => a + l.price, 0);
  const [bump, setBump] = useState(0);
  const [promo, setPromo] = useState(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeErr, setCodeErr] = useState(null);
  const discount = promo ? Math.min(300, Math.round((base + bump) * 0.1)) : 0;
  const balance = s.credit?.balance || 0;
  const [useCredit, setUseCredit] = useState(balance > 0);
  const creditUsed = useCredit ? Math.min(balance, base + bump - discount) : 0;
  const total = base + bump - discount - creditUsed;
  const [otp, setOtp] = useState('');
  const [otpTries, setOtpTries] = useState(0);
  const tryCode = () => {
    const c = code.trim().toUpperCase();
    if (c === 'EID10') { setPromo(c); setCodeErr(null); setPromoOpen(false); buzz(HAPTIC.success); }
    else if (c === 'RAMADAN') setCodeErr('That code ended on 30 March.');
    else if (!c) setCodeErr(null);
    else setCodeErr('We don’t know that code. Check the spelling. (Demo: EID10)');
  };
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
  const APPLE = { id: 'applepay', label: 'Apple Pay', brand: 'applepay' };
  const cardObj = card === 'applepay' ? APPLE : (s.cards.find((c) => c.id === card) || s.cards[0] || APPLE);
  const tabby = Math.ceil(total / 4);
  const tamara = Math.ceil(total / 3);
  const slideLabel = total === 0 ? 'Slide to book · paid with credit' : plan === 'tabby' ? `Slide to book · 4 × SAR ${fmt(tabby)}` : plan === 'tamara' ? `Slide to book · 3 × SAR ${fmt(tamara)}` : `Slide to book · SAR ${fmt(total)}`;

  const confirm = () => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      if (s.demo.offline) { setSheet('offline'); buzz(HAPTIC.soft); return; }
      if (s.demo.decline && s.cards[0] && card === s.cards[0].id && plan === 'full') { setSheet('declined'); buzz(HAPTIC.soft); return; }
      if (s.demo.priceUp && !priceSeen && order.agent) { setSheet('price'); buzz(HAPTIC.soft); return; }
      if (total === 0) { done(); return; }
      if (cardObj.id === 'applepay') { setSheet('applepay'); return; }
      if (s.demo.needs3ds || cardObj.fresh) { setOtp(''); setOtpTries(0); setSheet('3ds'); buzz(HAPTIC.knock); return; }
      done();
    }, 1300);
  };

  const done = () => {
    if (creditUsed > 0) set((p) => ({ credit: { balance: p.credit.balance - creditUsed, history: [{ id: 'cr' + Date.now(), text: order.title, amount: -creditUsed, at: Date.now() }, ...p.credit.history] } }));
    if (order.agent) {
      /* Everything that was on this screen goes with the booking: each line as priced, the code, the credit, the plan. */
      const lines = order.lines.map((l, i) => (i === 0 ? { ...l, price: l.price + bump } : l));
      replace('waiting', { ...params, travellers, total, card: total === 0 ? 'Mada credit' : cardObj.label, cardId: cardObj.id, plan: total >= 1000 && cardObj.id !== 'applepay' ? plan : 'full', creditUsed, discount, promo, lines, subtotal: base + bump, bookedAt: Date.now() });
      return;
    }
    buzz(HAPTIC.success);
    if (params.kind === 'quote') set((p) => ({ requests: p.requests.map((r) => (r.id === params.requestId ? { ...r, status: 'paid' } : r)) }));
    if (params.kind === 'share') set((p) => ({ circles: { ...p.circles, sharePaid: true }, ...(params.circle ? { circlePay: { ...(p.circlePay || {}), [params.circle]: true } } : {}) }));
    pop();
    toast(params.kind === 'esim' ? 'Done. The eSIMs install before you fly.' : params.kind === 'share' ? `Paid. ${params.payee || 'Abdullah'} sees it in the group.` : 'Paid. We’ll take it from here.');
  };

  return (
    <div className="screen push" style={{ background: '#0f1a16' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 240 }}>
        <img className="drift" src={order.img || 'img/istanbul.jpg'} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
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
              <span className="small">{travellers.length === 1 && travellers[0] === 'omar' ? 'Just you' : travellers.map((id) => PEOPLE[id]?.name).join(', ')}{params.kind === 'trip' || params.kind === 'package' ? prefsLine(s, travellers).map((x) => ' · ' + x).join('') : ''}</span>
              <button type="button" className="link" onClick={() => setSheet('people')}>Edit</button>
            </div>
          )}
          {discount > 0 && <div className="spread" style={{ fontSize: 15 }}><span className="row"><Icon name="star" size={20} />Code {promo} · 10% off <button type="button" className="link" style={{ fontSize: 13 }} onClick={() => { setPromo(null); setCode(''); }}>Remove</button></span><span className="num small" style={{ color: '#2f7a4b' }}>−{fmt(discount)}</span></div>}
          {balance > 0 && (
            <div className="spread" style={{ fontSize: 15 }}>
              <span className="row"><PayMark brand="credit" size={20} />Mada credit · SAR {fmt(balance)}</span>
              <span className="row" style={{ gap: 10 }}>{creditUsed > 0 && <span className="num small" style={{ color: '#2f7a4b' }}>−{fmt(creditUsed)}</span>}<Toggle checked={useCredit} label="Use Mada credit" onChange={setUseCredit} /></span>
            </div>
          )}
          {!promo && (promoOpen ? (
            <div className="field">
              <div className="row"><input className="input grow" aria-label="Promo code" placeholder="Promo code" value={code} onChange={(e) => { setCode(e.target.value); setCodeErr(null); }} autoCapitalize="characters" /><button type="button" className="btn secondary small" onClick={tryCode}>Apply</button></div>
              {codeErr && <span className="err" role="alert">{codeErr}</span>}
            </div>
          ) : <button type="button" className="link" style={{ alignSelf: 'flex-start', fontSize: 14 }} onClick={() => setPromoOpen(true)}>Have a promo code?</button>)}
          {order.people && (params.kind === 'trip' || params.kind === 'package') && (() => {
            const missing = travellers.filter((id) => passportStatus(s, id).key === 'none');
            if (!missing.length) return null;
            const names = missing.map((id) => (id === 'omar' ? 'you' : PEOPLE[id]?.name || 'someone'));
            return (
              <div className="notice" style={{ alignItems: 'flex-start' }}>
                <Icon name="visa" color="#7d5d27" />
                <span className="grow col" style={{ gap: 4 }}>
                  <span className="h3" style={{ fontSize: 15 }}>Passports for {names.join(', ').replace(/, ([^,]*)$/, ' and $1')}</span>
                  <span className="small">Book now and add them after. Faisal holds the seats and issues the tickets once they’re in, any time in the next 48 hours.</span>
                  <button type="button" className="link" style={{ alignSelf: 'flex-start', fontSize: 14 }} onClick={() => (missing[0] === 'omar' ? push('passportSetup', { later: true }) : push('householdPerson', { id: missing[0] }))}>Scan {missing[0] === 'omar' ? 'yours' : names[0] + '’s'} now</button>
                </span>
              </div>
            );
          })()}
          <div className="divider" />
          <div className="col" style={{ gap: 2 }}>
            <span className="num" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1.05 }}>SAR {fmt(total)}</span>
            <span className="small">Everything included. No fees later.</span>
            <span className="small">{order.rule}</span>
          </div>
          <div className="spread">
            <span className="row" style={{ fontSize: 15, fontWeight: 500 }}>{total === 0 ? <><PayMark brand="credit" />Paid with Mada credit</> : <><PayMark brand={cardObj.brand} />{cardObj.label}</>}</span>
            <button type="button" className="link" onClick={() => setSheet('cards')}>Change</button>
          </div>
          {total >= 1000 && cardObj.id !== 'applepay' && (
            <div className="chips" role="radiogroup" aria-label="How to pay">
              {[['full', 'Pay in full'], ['tabby', `Tabby · 4 × ${fmt(tabby)}`], ['tamara', `Tamara · 3 × ${fmt(tamara)}`]].map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={plan === id ? 'true' : 'false'} className={'chip' + (plan === id ? ' on' : '')} onClick={() => { setPlan(id); buzz(HAPTIC.select); }}>{id !== 'full' && <PayMark brand={id} size={16} />}{label}</button>
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
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn secondary small" style={{ background: '#f6f2ec' }} onClick={() => setSheet('addPerson')}><Icon name="plus" size={18} />Add someone</button>
            <button type="button" className="btn secondary small" style={{ background: '#f6f2ec' }} onClick={() => setSheet('invite')}><Icon name="link" size={18} />Invite with a link</button>
          </div>
          <span className="small">The price updates as you change it.</span>
          <button type="button" className="btn primary block" onClick={() => setSheet(null)}>Done · SAR {fmt(total)}</button>
        </Sheet>
      )}
      {sheet === 'addPerson' && <AddPersonSheet onClose={() => setSheet('people')} onAdded={(p) => { setTravellers((t) => [...t, p.id]); setSheet('people'); }} />}
      {sheet === 'invite' && <InviteSheet what="the Istanbul trip" onClose={() => setSheet('people')} />}
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
      {sheet === '3ds' && (
        <Sheet label="Bank check" onClose={() => { setSheet(null); toast('Cancelled. Nothing was charged.'); }}>
          <div className="row"><PayMark brand={cardObj.brand} size={32} /><span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Your bank wants to check it’s you</span><span className="tiny">{cardObj.label} · SAR {fmt(plan === 'tabby' ? tabby : plan === 'tamara' ? tamara : total)}</span></span></div>
          <p className="body">They sent a code to the number your bank has. It isn’t from Mada.</p>
          <div className="field">
            <label htmlFor="otp3ds">Code from your bank</label>
            <input id="otp3ds" className={'input otp' + (otpTries ? ' bad' : '')} inputMode="numeric" maxLength={6} value={otp} disabled={otpTries >= 3} onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6); setOtp(v);
              if (v.length === 6) { if (v === '123456') { setSheet(null); buzz(HAPTIC.success); done(); } else { setOtpTries(otpTries + 1); setOtp(''); buzz(HAPTIC.warn); } }
            }} />
            {otpTries > 0 && otpTries < 3 && <span className="err" role="alert">That code doesn’t match. {3 - otpTries} {3 - otpTries === 1 ? 'try' : 'tries'} left.</span>}
            {otpTries >= 3 && <span className="err" role="alert">Your bank stopped this payment. Nothing was charged. Use another card or call your bank.</span>}
          </div>
          {otpTries >= 3 ? <button type="button" className="btn primary block" onClick={() => setSheet('cards')}>Use another card</button> : <span className="tiny">Demo code: 123456</span>}
        </Sheet>
      )}
      {sheet === 'applepay' && <ApplePaySheet amount={plan === 'full' ? total : total} label={order.title} fail={s.demo.faceIdFails} onDone={() => { setSheet(null); done(); }} onClose={() => { setSheet(null); toast('Cancelled. Nothing was charged.'); }} />}
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
  const [exp, setExp] = useState('');
  const [cvv, setCvv] = useState('');
  const [name, setName] = useState('');
  const [save, setSave] = useState(true);
  const [touched, setTouched] = useState({});
  const digits = num.replace(/\D/g, '');
  const brand = cardBrand(digits);
  const amex = /^3[47]/.test(digits);
  const numOk = !!brand && digits.length === 16 && luhn(digits);
  const [mm, yy] = exp.split('/').map((x) => Number(x));
  const now = new Date(); const cy = now.getFullYear() % 100; const cm = now.getMonth() + 1;
  const expOk = /^\d{2}\/\d{2}$/.test(exp) && mm >= 1 && mm <= 12 && (yy > cy || (yy === cy && mm >= cm));
  const cvvOk = /^\d{3}$/.test(cvv);
  const nameOk = name.trim().length >= 3;
  const ok = numOk && expOk && cvvOk && nameOk;
  const numErr = amex ? 'We can’t take American Express yet. Use Visa, Mastercard or mada.' : digits.length >= 16 && !luhn(digits) ? 'That number doesn’t look right. Check each digit.' : digits.length > 0 && digits.length < 16 && touched.num ? 'Card numbers have 16 digits.' : digits.length >= 6 && !brand ? 'We take Visa, Mastercard and mada.' : null;
  const expErr = touched.exp && exp && !expOk ? (/^\d{2}\/\d{2}$/.test(exp) ? 'This card has expired.' : 'Use MM/YY, like 08/28.') : null;
  return (
    <Sheet label="Payment method" onClose={onClose}>
      <h2 className="h2">Pay with</h2>
      {(s.credit?.balance || 0) > 0 && <div className="row small" style={{ color: '#1e352d' }}><PayMark brand="credit" size={22} />You have SAR {fmt(s.credit.balance)} Mada credit. It’s used first.</div>}
      {s.cards.map((c) => (
        <button key={c.id} type="button" className={'card tap well' + (c.id === current ? ' selected' : '')} onClick={() => { buzz(HAPTIC.select); onPick(c.id); }} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <PayMark brand={c.brand} size={30} />
          <span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{c.label}</span>{c.exp && <span className="tiny">Expires {c.exp}</span>}</span>
          {c.id === current && <Icon name="check" color="#2f7a4b" width={2.4} />}
        </button>
      ))}
      <button type="button" className={'card tap well' + (current === 'applepay' ? ' selected' : '')} style={{ flexDirection: 'row', alignItems: 'center' }} onClick={() => { buzz(HAPTIC.select); onPick('applepay'); }}>
        <PayMark brand="applepay" size={30} /><span className="grow h3" style={{ fontSize: 15 }}>Apple Pay</span>{current === 'applepay' && <Icon name="check" color="#2f7a4b" width={2.4} />}
      </button>
      {adding ? (
        <form className="col" style={{ gap: 12 }} onSubmit={(e) => {
          e.preventDefault(); if (!ok) return;
          const id = 'card' + Date.now();
          const label = BRAND_NAME[brand] + ' ending ' + digits.slice(-2);
          set((p) => ({ cards: [...p.cards, { id, label, brand, exp, fresh: true, temp: !save }] }));
          onPick(id);
        }}>
          <div className="field">
            <label htmlFor="cardnum">Card number</label>
            <div style={{ position: 'relative' }}>
              <input id="cardnum" className={'input num' + (numErr ? ' bad' : '')} inputMode="numeric" value={num} onBlur={() => setTouched({ ...touched, num: true })} onChange={(e) => setNum(e.target.value.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 '))} placeholder="4000 0000 0000 0000" autoComplete="cc-number" style={{ paddingRight: 70 }} />
              {brand && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}><PayMark brand={brand} size={24} /></span>}
            </div>
            {numErr && <span className="err">{numErr}</span>}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field grow"><label htmlFor="cardexp">Expiry</label><input id="cardexp" className={'input num' + (expErr ? ' bad' : '')} inputMode="numeric" placeholder="MM/YY" value={exp} onBlur={() => setTouched({ ...touched, exp: true })} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setExp(v.length > 2 ? v.slice(0, 2) + '/' + v.slice(2) : v); }} autoComplete="cc-exp" />{expErr && <span className="err">{expErr}</span>}</div>
            <div className="field grow"><label htmlFor="cardcvv">Security code</label><input id="cardcvv" className="input num" inputMode="numeric" placeholder="3 digits" value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 3))} autoComplete="cc-csc" /></div>
          </div>
          <div className="field"><label htmlFor="cardname">Name on the card</label><input id="cardname" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="cc-name" placeholder="OMAR ALHARBI" /></div>
          <label className="row small" style={{ color: '#1e352d' }}><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />Save this card for next time</label>
          <span className="tiny">Card details go straight to the payment provider. Mada never sees the full number. Test card: 4242 4242 4242 4242.</span>
          <button type="submit" className="btn primary block" disabled={!ok}>Use this card</button>
        </form>
      ) : <button type="button" className="btn secondary block" onClick={() => setAdding(true)}><Icon name="plus" />Add a card</button>}
    </Sheet>
  );
}

/* Apple Pay, the way the system sheet behaves: double-click, Face ID, done. */
function ApplePaySheet({ amount, label, fail, onDone, onClose }) {
  const { s } = useStore();
  const walletCard = (s.cards.find((c) => c.id !== 'applepay') || {}).label || 'Your card';
  const [stage, setStage] = useState('wait');
  useEffect(() => {
    if (stage !== 'wait') return undefined;
    const t = setTimeout(() => { if (fail) { setStage('failed'); buzz(HAPTIC.warn); } else { setStage('ok'); buzz(HAPTIC.success); setTimeout(onDone, 700); } }, 1600);
    return () => clearTimeout(t);
  }, [stage]);
  return (
    <Sheet label="Apple Pay" onClose={onClose}>
      <div className="spread"><PayMark brand="applepay" size={30} /><button type="button" className="link" onClick={onClose}>Cancel</button></div>
      <div className="spread small" style={{ color: '#1e352d' }}><span>{walletCard} · in Wallet</span><span className="num">SAR {fmt(amount)}</span></div>
      <span className="tiny">Pay Mada Trips for {label}</span>
      <div className="col" style={{ alignItems: 'center', gap: 10, padding: '14px 0' }}>
        <span className={'faceid' + (stage === 'ok' ? ' ok' : stage === 'failed' ? ' bad' : '')} aria-hidden="true">
          {stage === 'ok' ? <Icon name="check" size={34} color="#2f7a4b" width={2.4} /> : <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 9v1M15 9v1M12 9v4h-1M9 16c1.6 1.2 4.4 1.2 6 0" /></svg>}
        </span>
        <span className="h3" style={{ fontSize: 15 }}>{stage === 'ok' ? 'Done' : stage === 'failed' ? 'Face not recognised' : 'Double-click to pay'}</span>
      </div>
      {stage === 'failed' && <div className="row"><button type="button" className="btn primary small" onClick={() => setStage('wait')}>Try again</button><button type="button" className="btn secondary small" onClick={() => { setStage('ok'); buzz(HAPTIC.success); setTimeout(onDone, 500); }}>Pay with passcode</button></div>}
    </Sheet>
  );
}

/* ---------- with Faisal, then confirmed ---------- */

/* Writes a confirmed booking into the traveller's state. Used by Waiting, and in the background if they close it.
   The trip keeps exactly what was chosen and paid: dates or one way, cabin, babies, each line's price, the code,
   the credit, the payment plan, the card, the booking reference and when it was booked. */
export function buildBookedTrip(p, params) {
  const f = FLIGHTS.find((x) => x.id === params.flightId) || FLIGHTS[0];
  const d = searchDates(params);
  const travellers = params.travellers?.length ? params.travellers : ['omar'];
  const n = travellers.length;
  const lines = (params.lines || []).map((l) => ({ ...l }));
  const extra = params.extra || 0; /* the fare went up while Faisal held the seats, and they said yes */
  const flightLine = lines.find((l) => l.key === 'flight');
  if (flightLine && extra) flightLine.price += extra;
  const sum = (keys) => lines.filter((l) => keys.includes(l.key)).reduce((a, l) => a + l.price, 0);
  const stayLine = lines.find((l) => l.key === 'stay');
  const pickupLine = lines.find((l) => l.key === 'pickup');
  const card = (p.cards || []).find((c) => c.id === params.cardId);
  const subtotal = lines.reduce((a, l) => a + l.price, 0);
  return {
    id: 'ist-' + (params.ref || 'new').toLowerCase(), city: 'Istanbul', country: 'Türkiye', img: 'img/istanbul.jpg',
    travellers, flightId: f.id, cabin: d.cabin, infants: d.infants, oneway: d.oneway,
    flight: makeFlight(f, { outISO: d.outISO, backISO: d.backISO, cabin: d.cabin, n }),
    stay: stayLine ? { ...HOTELS[0], nights: stayLine.nights || STAY_NIGHTS, fromISO: d.outISO, price: stayLine.price, status: 'booked' } : null,
    pickup: pickupLine ? makePickup(n, pickupLine.price, { outISO: d.outISO, oneway: d.oneway }) : null,
    flightPrice: sum(['flight', 'infants']),
    lines,
    paid: { subtotal, discount: params.discount || 0, promo: params.promo || null, creditUsed: params.creditUsed || 0, charged: (params.total || 0) + extra, card: params.card || card?.label || 'Apple Pay' },
    payPlan: params.plan || 'full',
    ref: params.ref, pnr: params.ref,
    bookedAt: params.bookedAt || Date.now(),
    invoiceSeq: 4300 + Math.floor(((params.bookedAt || Date.now()) / 1000) % 5000) * 4,
    card: params.cardId || p.defaultCard,
  };
}

export function commitBooking(set, params) {
  if (params.kind === 'trip') {
    set((p) => ({ trip: buildBookedTrip(p, params), phase: 'booked' }));
  } else if (params.kind === 'stay') {
    set((p) => {
      const h = HOTELS.find((x) => x.id === params.hotelId) || HOTELS[0];
      const line = (params.lines || [])[0] || {};
      const fromISO = p.trip?.flight?.dateISO || isoDate(TRIP_YEAR, 'Mar', 9);
      const stay = { ...h, nights: line.nights || STAY_NIGHTS, fromISO, price: line.price || params.total, status: 'booked', plan: params.plan || 'full', bookedAt: params.bookedAt || Date.now(), ref: params.ref };
      if (p.trip) return { trip: { ...p.trip, stay, noStay: null } };
      const travellers = params.travellers?.length ? params.travellers : ['omar'];
      return {
        trip: { id: 'ist-' + (params.ref || 'stay').toLowerCase(), city: 'Istanbul', country: 'Türkiye', img: 'img/istanbul.jpg', travellers, flight: null, flightPrice: 0, stay, pickup: null, lines: params.lines || [], paid: { subtotal: params.subtotal || params.total, discount: params.discount || 0, creditUsed: params.creditUsed || 0, charged: params.total, card: params.card }, payPlan: params.plan || 'full', ref: params.ref, pnr: params.ref, bookedAt: params.bookedAt || Date.now(), invoiceSeq: 4300 + Math.floor(((params.bookedAt || Date.now()) / 1000) % 5000) * 4, card: params.cardId || p.defaultCard },
        phase: 'booked',
      };
    });
  } else if (params.kind === 'package') {
    const pl = PLANS[params.planId];
    set((p) => ({ requests: [...p.requests, { id: 'pk' + Date.now(), kind: 'package', short: pl.title, title: `Booked: ${pl.title}`, detail: `${params.travellers.length} travellers · confirmed by Mada`, status: 'done', created: Date.now(), quote: 0 }] }));
  } else if (params.kind === 'change') {
    set((p) => ({ trip: { ...p.trip, flight: { ...p.trip.flight, ...params.patch } } }));
  }
};


const elapsedLabel = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export function Waiting({ params }) {
  const { s, set, reset, replace, push, go } = useStore();
  const [step, setStep] = useState(0);
  const [question, setQuestion] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const asked = useRef(false);
  const [problem, setProblem] = useState(null); // 'fare' | 'ticketing' | null
  const [extra, setExtra] = useState(0);
  const [calling, setCalling] = useState(false);
  const failed = useRef({});
  const ref = useRef(params.ref || Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join(''));
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { if (confirmed) return undefined; const t = setInterval(() => setElapsed((e) => e + 1), 1000); return () => clearInterval(t); }, [confirmed]);
  const labels = params.kind === 'package' ? ['Seats held', 'Rooms held', 'Booking tours and tables'] : params.kind === 'change' ? ['Seats held', 'Fare checked', 'Changing tickets'] : ['Seats held', 'Price checked', params.kind === 'stay' ? 'Confirming rooms' : 'Issuing tickets'];

  useEffect(() => { buzz(HAPTIC.knock); }, []);
  useEffect(() => {
    if (confirmed) return undefined;
    if (step === 1 && s.demo.agentQuestion && !asked.current) { asked.current = true; setQuestion(true); buzz(HAPTIC.knock); return undefined; }
    if (question && !answered) return undefined;
    if (problem || calling) return undefined;
    if (step === 0 && s.demo.fareGone && !failed.current.fare && params.kind === 'trip') { failed.current.fare = true; const t0 = setTimeout(() => { setProblem('fare'); buzz(HAPTIC.warn); }, 1100); return () => clearTimeout(t0); }
    if (step === 2 && s.demo.ticketingFails && !failed.current.ticketing) { failed.current.ticketing = true; const t0 = setTimeout(() => { setProblem('ticketing'); buzz(HAPTIC.warn); }, 1100); return () => clearTimeout(t0); }
    const t = setTimeout(() => {
      if (step < 3) setStep(step + 1);
      else { setConfirmed(true); buzz(HAPTIC.success); commit(); }
    }, s.demo.slowAgent ? 4200 : 1200);
    return () => clearTimeout(t);
  }, [step, question, answered, confirmed, problem, calling]);
  const slow = elapsed >= 8 && !confirmed && !problem;
  /* Faisal's question is about someone actually on this booking. */
  const askId = (params.travellers || []).find((id) => id !== 'omar') || (params.travellers || [])[0] || 'omar';
  const askP = PEOPLE[askId] || {};
  const askAbout = { name: askP.name || 'You', given: ((askP.full || '').split(' ')[0] + ' ' + (PEOPLE.omar.name !== 'You' ? PEOPLE.omar.name : '')).trim().toUpperCase() };
  const n = params.travellers?.length || (params.kind === 'change' ? s.trip?.travellers?.length : 0) || 1;
  /* Close and carry on: the booking finishes in the background and a banner says so. */
  const hide = () => { set({ pendingBooking: { ...params, ref: ref.current, total: params.total || 0, extra, at: Date.now() } }); reset('today'); };
  const cancelAll = () => { reset('today'); };

  const commit = () => commitBooking(set, { ...params, ref: ref.current, total: params.total || 0, extra });

  const steps = labels.map((text, i) => ({ text, state: i < step ? 'done' : i === step ? 'now' : 'todo' }));
  const city = params.kind === 'package' ? `You're going to ${PLANS[params.planId].city}.` : params.kind === 'stay' ? 'Your rooms are booked.' : params.kind === 'change' ? 'Your flight is changed.' : "You're going to Istanbul.";

  if (!confirmed) {
    const f = FLIGHTS.find((x) => x.id === params.flightId);
    const d = params.kind === 'trip' ? searchDates(params) : null;
    /* The same seats the trip will carry once it's booked. */
    const seatList = params.kind === 'change' ? (s.trip?.flight?.seats || []) : seatsFor(n, d?.cabin || 'Economy');
    const seats = seatList.join(', ');
    const hero = params.kind === 'package' ? PLANS[params.planId].img : 'img/istanbul.jpg';
    const place = params.kind === 'package' ? PLANS[params.planId].city : 'Istanbul';
    const withWhom = params.kind === 'stay' ? 'the hotel' : params.kind === 'package' ? 'the hotel and guides' : (f?.airline || 'the airline');
    const nWord = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][n] || String(n);
    const total = params.total ? `SAR ${fmt(params.total)}` : 'Your price';
    const rows = params.kind === 'package' ? [
      ['Holding seats', `${nWord} seats together, ${seats}`],
      ['Holding rooms', 'Connecting rooms, quiet side'],
      ['Booking tours and tables', 'Hegra at 4 pm · dinner at 8'],
    ] : params.kind === 'stay' ? [
      ['Asking the hotel', 'Connecting rooms, 4th floor'],
      ['Locking the price', `${total}, it can’t go up now`],
      ['Confirming rooms', 'Early check-in requested'],
    ] : params.kind === 'change' ? [
      ['Holding the new seats', n > 1 ? `${nWord} seats together, ${seats}` : `Seat ${seats}`],
      ['Checking the fare', 'Same rules as before'],
      ['Changing tickets', 'Old tickets released'],
    ] : [
      [`Holding ${n === 1 ? 'your seat' : nWord.toLowerCase() + ' seats together'}`, `${n === 1 ? 'Seat' : 'Seats'} ${seats}${d?.cabin && d.cabin !== 'Economy' ? ', ' + d.cabin.toLowerCase() : ''}`],
      ['Locking the price', `${total}, it can’t go up now`],
      [`Issuing ${n === 1 ? 'your ticket' : n + ' tickets'}`, `${f?.code || ''} · 065 2214 3301${n > 1 ? ' and ' + (n - 1) + ' more' : ''}`],
    ];
    const live = question && !answered ? 'Has a question for you' : step >= 3 ? 'Almost done' : `On the line with ${withWhom}`;
    return (
      <div className="screen push wait">
        <img className="wait-bg" src={hero} alt="" />
        <div className="wait-veil" />
        <div className="wait-top">
          <span className="wait-agent">
            <span className="avatar sm green" style={{ position: 'relative' }}>F<i className="wait-dot" /></span>
            <span className="col" style={{ gap: 0 }}>
              <b>Faisal at Mada</b>
              <span key={live} className="wait-live">{live}<span className="dots" aria-hidden="true"><i /><i /><i /></span></span>
            </span>
          </span>
          <span className="row" style={{ gap: 8 }}>
            <span className="wait-clock num" aria-label="Time so far">{elapsedLabel(elapsed)}</span>
            <button type="button" className="wait-clock" style={{ border: 0, color: '#fffdf9', fontWeight: 600 }} onClick={hide}>Close</button>
          </span>
        </div>
        <div className="wait-hero">
          <span className="eyebrow" style={{ color: '#d9b77a' }}>{params.kind === 'change' ? 'Changing your flight' : 'Booking now'}</span>
          <h1 className="display" style={{ fontSize: 52, color: '#fffdf9', lineHeight: .95 }}>{place}<span style={{ color: '#d9b77a' }}>.</span></h1>
          <span className="wait-sub">{params.kind === 'package' ? PLANS[params.planId].sub : params.kind === 'stay' ? `${(params.lines || [])[0]?.text?.split(' · ').slice(1).join(' · ') || ''}` : params.kind === 'change' ? params.label : `${dayLabel(d.outISO)} · ${f?.dep || ''} from Riyadh${d.oneway ? ' · one way' : ''}`}</span>
        </div>
        <div className="wait-panel" role="status" aria-live="polite">
          {rows.map(([doing, done], i) => {
            const state = i < step ? 'done' : i === step ? 'now' : 'todo';
            return (
              <div key={i} className={'wait-row ' + state}>
                <span className="wait-mark" aria-hidden="true">{state === 'done' ? <Icon name="check" size={14} color="#1e352d" /> : state === 'now' ? <i /> : null}</span>
                <span className="col" style={{ gap: 1 }}>
                  <span className="wait-doing">{state === 'done' ? doing.replace(/^Holding/, 'Held:').replace(/^Locking the price/, 'Price locked').replace(/^Issuing/, 'Issued:').replace(/^Asking the hotel/, 'Hotel said yes').replace(/^Confirming rooms/, 'Rooms confirmed').replace(/^Booking tours and tables/, 'Tours and tables booked').replace(/^Checking the fare/, 'Fare checked').replace(/^Changing tickets/, 'Tickets changed') : doing}</span>
                  {state === 'done' && <span className="wait-done rise">{done}</span>}
                </span>
              </div>
            );
          })}
          {problem === 'fare' && (
            <div className="wait-q rise">
              <span className="small" style={{ color: '#d9b77a', fontWeight: 600 }}>Faisal says</span>
              <span className="body" style={{ color: '#fffdf9' }}>Saudia sold the last seats at that price a minute ago. The same flight is now SAR 120 more each, SAR {fmt(120 * n)} in all. Nothing has been charged.</span>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn small" style={{ background: '#d9b77a', color: '#1e352d' }} onClick={() => { setExtra(120 * n); setProblem(null); buzz(HAPTIC.tap); }}>Book at SAR {fmt((params.total || 0) + 120 * n)}</button>
                <button type="button" className="glass-btn" onClick={() => replace('ask', { prefill: 'Flights to Istanbul for Eid' })}>See other flights</button>
                <button type="button" className="glass-btn" onClick={cancelAll}>Stop</button>
              </div>
            </div>
          )}
          {problem === 'ticketing' && (
            <div className="wait-q rise">
              <span className="small" style={{ color: '#d9b77a', fontWeight: 600 }}>The airline didn’t issue the tickets</span>
              <span className="body" style={{ color: '#fffdf9' }}>Saudia’s system timed out. Nothing was charged and the hold on your card is released. Your seats are still held for 2 hours.</span>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn small" style={{ background: '#d9b77a', color: '#1e352d' }} onClick={() => { setProblem(null); buzz(HAPTIC.tap); }}>Faisal tries by phone</button>
                <button type="button" className="glass-btn" onClick={cancelAll}>Cancel the booking</button>
              </div>
              <span className="tiny" style={{ color: 'rgba(255,253,249,.6)' }}>By phone usually takes 15 minutes. You can close the app.</span>
            </div>
          )}
          {slow && !question && <span className="small rise" style={{ color: '#e6c88f' }}>Taking longer than usual. Saudia’s system is slow today. You can close the app; we’ll tell you the moment it’s done.</span>}
          {question && (
            <div className="wait-q rise">
              <span className="small" style={{ color: '#d9b77a', fontWeight: 600 }}>Faisal asks</span>
              <span className="body" style={{ color: '#fffdf9' }}>{askAbout.name === 'You' ? 'Your' : askAbout.name + '’s'} passport has more than one given name: “{askAbout.given}”. Should the ticket say exactly that?</span>
              {calling ? <span className="small" style={{ color: '#e6c88f', fontWeight: 600 }}>Faisal is calling {s.account?.phone?.digits ? `+966 5• ••• ${s.account.phone.digits.slice(-4)}` : 'you'} now…</span> : answered ? <span className="small" style={{ color: '#9fd3b0', fontWeight: 600 }}>Thanks. Carrying on.</span> : (
                <div className="row">
                  <button type="button" className="btn small" style={{ background: '#d9b77a', color: '#1e352d' }} onClick={() => { setAnswered(true); buzz(HAPTIC.tap); }}>Yes, as on the passport</button>
                  <button type="button" className="glass-btn" onClick={() => { setCalling(true); buzz(HAPTIC.tap); setTimeout(() => { setCalling(false); setAnswered(true); }, 3000); }}>Call me</button>
                </div>
              )}
            </div>
          )}
          <span className="wait-note">Nothing leaves your card until it’s confirmed. You can close the app; we’ll tell you the moment it’s done.</span>
        </div>
      </div>
    );
  }

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
        <div className="row rise d2"><span className="avatar sm green">F</span><span className="small num">Confirmed by Faisal at Mada{params.kind === 'trip' ? ' · ' + (FLIGHTS.find((f) => f.id === params.flightId)?.code || '') : ''} · <b style={{ color: '#1e352d', letterSpacing: '.04em' }}>{ref.current}</b></span></div>
        <div className="chips rise d3">
          {params.kind !== 'stay' && <span className="pill" style={{ background: '#fffdf9' }}>Tickets in your Wallet</span>}
          {(params.bundle || params.kind === 'stay') && <span className="pill" style={{ background: '#fffdf9' }}>Rooms booked</span>}
          <span className="pill" style={{ background: '#fffdf9' }}>{params.plan === 'tabby' ? 'Tabby: first of 4 paid' : params.plan === 'tamara' ? 'Tamara: first of 3 paid' : `Paid with ${params.card}`}</span>
          {params.creditUsed > 0 && <span className="pill" style={{ background: '#fffdf9' }}>SAR {fmt(params.creditUsed)} from credit</span>}
          <span className="pill" style={{ background: '#fffdf9' }}>VAT invoice in Trips</span>
          {params.kind !== 'stay' && <span className="pill" style={{ background: '#fffdf9' }}>We're watching the flight</span>}
        </div>
        {s.notifications == null && params.kind !== 'stay' && (
          <div className="card rise d3" style={{ gap: 10 }}>
            <span className="h3" style={{ fontSize: 15 }}>Want gate changes on this phone?</span>
            <span className="small">Only things you need to act on: gate changes, delays, the moment your driver arrives. Never offers.</span>
            <div className="row"><button type="button" className="btn primary small" onClick={() => { set({ notifications: true }); buzz(HAPTIC.success); }}>Allow alerts</button><button type="button" className="btn ghost small" onClick={() => set({ notifications: false })}>Not now</button></div>
          </div>
        )}
        {s.notifications === true && <span className="small rise" style={{ color: '#2f7a4b', fontWeight: 600 }}>Alerts are on for this trip.</span>}
        <div style={{ display: 'none' }}>
        </div>
      </div>
      <div className="act">
        <button type="button" className="btn primary block" onClick={() => { if (params.kind === 'trip' || params.kind === 'stay') { set({ tab: 'trips', stack: [{ name: 'trip', params: {}, key: Date.now() }] }); } else reset(params.kind === 'package' ? 'trips' : 'today'); }}>{params.kind === 'trip' || params.kind === 'stay' ? 'See the trip' : 'Done'}</button>
      </div>
    </div>
  );
}

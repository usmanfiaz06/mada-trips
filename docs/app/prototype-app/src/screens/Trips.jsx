import React, { useEffect, useState } from 'react';
import { RequestThread, QuoteBreakdown } from './Ask.jsx';
import { useStore, buzz, HAPTIC, PEOPLE, fmt, forwardAddress, rangeLabel, stayEnd, stayOf, dayLabel, shortDay, addDays, ofYou } from '../store.jsx';
import { Icon, TopBar, Route, Sheet, AirlineMark, useTicker, DepartureBoard, EmptyPassport, PaperPlane, EmptyState, NetStale } from '../ui.jsx';
import { UploadSheet } from './Wallet.jsx';
import { RefundTracker, ReqTracker, reqStatus, reqLabel, refundQuote, isRefunded, timing, useUnqueue, tripPayments, refundMoney, MoveNotice, NoStayChoices } from './TripManage.jsx';
import { TrackedFlights } from './Today.jsx';

const REQ_STAGES = [
  ['queued', 'Waiting for a connection'],
  ['sent', 'Sent to Mada'],
  ['reviewing', 'Mada is on it'],
  ['quote', 'Answer ready'],
  ['paid', 'Paid · we’re finishing it'],
  ['done', 'Done'],
];

function stageIndex(status) { return REQ_STAGES.findIndex(([k]) => k === status); }

export function openCount(s) {
  const now = Date.now();
  return s.requests.filter((r) => r.status !== 'done').length
    + (s.tripRequests || []).filter((r) => !['yes', 'no', 'done'].includes(reqStatus(r, now))).length;
}

export default function Trips() {
  const { s, set, push } = useStore();
  const [tab, setTab] = useState(s.tripsTab || (s.requests.length && !s.trip ? 'requests' : 'upcoming'));
  useEffect(() => { if (s.tripsTab) { setTab(s.tripsTab); set({ tripsTab: null }); } }, [s.tripsTab]);
  useTicker(2000);
  useUnqueue();
  const openReq = openCount(s);
  return (
    <div className="screen">
      <div className="scroll">
        <div style={{ paddingTop: 54 }} className="spread">
          <h1 className="h1">Trips</h1>
          <button type="button" className="icon-btn dark" aria-label="Plan a trip" onClick={() => push('ask', {})}><Icon name="plus" color="#f6f2ec" /></button>
        </div>
        <NetStale />
        <div className="chips" role="tablist">
          {[['upcoming', 'Upcoming'], ['requests', `Requests${openReq ? ' · ' + openReq : ''}`], ['past', 'Past']].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id ? 'true' : 'false'} className={'chip' + (tab === id ? ' on' : '')} onClick={() => { setTab(id); buzz(HAPTIC.select); }}>{label}</button>
          ))}
        </div>
        {tab === 'upcoming' && <Upcoming />}
        {tab === 'requests' && <Requests />}
        {tab === 'past' && <Past />}
      </div>
    </div>
  );
}

/* Where to forward a booking made elsewhere: the traveller's own address, never someone else's. */
function ForwardLine({ lead = '' }) {
  const { s } = useStore();
  const addr = forwardAddress(s);
  return addr
    ? <>{lead}Forward the confirmation email to <b style={{ color: '#1e352d' }}>{addr}</b>, or upload the PDF. We'll track it like any Mada trip.</>
    : <>{lead}Upload the PDF and we'll track it like any Mada trip. Your own forwarding address appears once you've signed in.</>;
}

function Imports() {
  const { s, set, toast } = useStore();
  const [open, setOpen] = useState(false);
  const names = s.household.map((id) => PEOPLE[id]?.name).filter((x) => x && x !== 'You');
  return (
    <>
      {(s.imports || []).map((im) => (
        <div key={im.id} className="card rise" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="flight" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{im.title}</span><span className="tiny">{im.sub} · booked elsewhere, watched by Mada</span></span>
        </div>
      ))}
      <div className="card well">
        <span className="h3" style={{ fontSize: 15 }}>Booked somewhere else?</span>
        <span className="small"><ForwardLine /></span>
        <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>Upload a booking</button>
      </div>
      {open && <UploadSheet title="Add a booking" allowScan={false}
        found={[['Airline', 'Emirates · EK 818'], ['Route', 'Riyadh → Dubai'], ['When', 'Thu 3 Jun · 10:15'], ['Travellers', names.slice(0, 2).join(', ') || 'You']]}
        onSave={() => { set((p) => ({ imports: [...(p.imports || []), { id: 'im' + Date.now(), title: 'Dubai · Emirates EK 818', sub: `Thu 3 Jun · ${Math.max(1, Math.min(2, names.length))} ${Math.min(2, names.length) > 1 ? 'travellers' : 'traveller'}` }] })); setOpen(false); buzz(HAPTIC.success); toast('Added. We’ll watch EK 818 for you.'); }}
        onClose={() => setOpen(false)} />}
    </>
  );
}

function Upcoming() {
  const { s, push } = useStore();
  const tracked = (s.trackedFlights || []).length > 0;
  if (!s.trip) return (<>
    <div className="empty-hero rise">
      <DepartureBoard from={({ RUH: 'Riyadh', JED: 'Jeddah', DMM: 'Dammam' })[s.account?.home || 'RUH'] || 'Riyadh'} onPick={(city) => push('ask', { prefill: `Flights to ${city.charAt(0) + city.slice(1).toLowerCase()}` })} />
      <h2 className="display">Your name’s not on the board yet.</h2>
      <span className="small">Tap a city to see it, or tell us where. Faisal books it and stays with you until you’re home.</span>
      <button type="button" className="btn primary block" onClick={() => push('ask', {})}>Where to?</button>
    </div>
    <span className="eyebrow rise d1">Easy from here this winter</span>
    <div className="idea-row rise d1">
      {[['img/istanbul.jpg', 'Istanbul', '4h · cool and cosy', 'Flights to Istanbul'], ['img/alula.jpg', 'AlUla', '1h 20 · stars and rock', 'A weekend in AlUla'], ['img/riyadh.jpg', 'Riyadh Season', 'No flight needed', 'Things to do in Riyadh this weekend']].map(([img, t, sub, q]) => (
        <button key={t} type="button" className="es-idea" onClick={() => push('ask', { prefill: q })}><img src={img} alt="" /><span>{t}<small>{sub}</small></span></button>
      ))}
    </div>
    {tracked && <TrackedFlights title="Flights you’re tracking" />}
    <Imports />
  </>);
  const t = s.trip;
  const f = t.flight;
  const who = t.travellers.map((id) => PEOPLE[id]?.name).filter(Boolean);
  return (<>
    <div className="tm-tripcard rise">
      <button type="button" className="photo" style={{ height: 210, border: 0, padding: 0, width: '100%', display: 'block' }} onClick={() => push('trip')} aria-label={`${t.city} trip`}>
        <img src={t.img || 'img/istanbul.jpg'} alt={t.city} />
        <span className="shade" />
        <span className="over" style={{ textAlign: 'start' }}>
          <span className="display" style={{ fontSize: 36, color: '#fffdf9' }}>{t.city}</span>
          <span className="small" style={{ color: 'rgba(255,253,249,.9)' }}>{t.datesLong} · {who.length === 1 && t.travellers[0] === 'omar' ? 'Just you' : who.join(', ')}</span>
        </span>
      </button>
      <div className="tm-tripcard-foot">
        <span className="tiny grow">{f ? `${f.code} · ${f.date} · ${f.dep}${f.back ? '' : ' · one way'}` : t.stay ? `${t.stay.name}` : 'Booked'}</span>
        <button type="button" className="btn secondary small" onClick={() => push('itinerary')}><Icon name="trips" size={18} />Itinerary</button>
        <button type="button" className="btn secondary small" onClick={() => push('invoices')}><Icon name="card" size={18} />Payments</button>
      </div>
    </div>
    {tracked && <TrackedFlights title="Flights you’re tracking" />}
    <Imports />
  </>);
}

function Requests() {
  const { s, push } = useStore();
  const now = Date.now();
  const mine = (s.tripRequests || []);
  if (!s.requests.length && !s.refunds.length && !mine.length) return (
    <EmptyState art={<PaperPlane />} title="Nothing waiting on Faisal."
      body="Send him anything: a visa, a table tonight, a car for the day. It lands here and you watch it move."
      action={<button type="button" className="btn primary block" onClick={() => push('ask', {})}>Send Mada a request</button>}
      ideas={['A Schengen visa', 'A table for tonight', 'A car with a driver', 'Umrah in Ramadan'].map((q) => [q, () => push('ask', { prefill: q })])} />
  );
  const talk = (topic) => push('support', { about: 'Istanbul trip', topic });
  const items = [
    ...s.refunds.map((r) => ({ type: 'refund', r, at: r.created || r.t || 0 })),
    ...s.requests.map((r) => ({ type: 'req', r, at: r.created || 0 })),
    ...mine.map((r) => ({ type: 'trip', r, at: r.created || now })),
  ].sort((a, b) => b.at - a.at);
  return (
    <>
      {items.map(({ type, r }) => {
        if (type === 'refund') {
          const rejected = r.stage === -1 && now - (r.created || now) > 7000;
          const credit = r.dest === 'credit';
          const pill = rejected ? 'Not approved' : r.stage === -1 ? 'With Faisal' : credit ? 'In your credit' : r.stage === 2 ? 'Sent' : 'On its way';
          return (
            <div key={r.id} className="card rise">
              <div className="spread"><span className="h3">Refund · SAR {fmt(r.amount)}</span><span className={'pill' + (rejected ? ' warn' : r.stage === 2 ? ' ok' : '')}>{pill}</span></div>
              <span className="small">{r.title}</span>
              <RefundTracker r={r} onTalk={() => talk('refund')} />
            </div>
          );
        }
        if (type === 'trip') {
          const st = reqStatus(r, now);
          return (
            <div key={r.id} className="card rise">
              <div className="spread" style={{ alignItems: 'flex-start' }}><span className="h3">{r.title}</span><span className={'pill' + (st === 'yes' || st === 'done' ? ' ok' : st === 'no' ? ' warn' : '')} style={{ flexShrink: 0 }}>{reqLabel(r, now)}</span></div>
              {r.detail && <span className="small">{r.detail}</span>}
              <ReqTracker r={r} now={now} />
              {(st === 'yes' || st === 'done') && <span className="row tiny"><Icon name="check" size={14} color="#2f7a4b" width={2.4} />{r.yesText || (st === 'done' ? 'Done by Faisal today' : 'Confirmed today. Nothing to pay.')}</span>}
              {st === 'no' && (
                <div className="card well" style={{ gap: 8 }}>
                  <div className="row"><span className="avatar sm green">F</span><span className="h3" style={{ fontSize: 14 }}>Faisal · your Mada agent</span></div>
                  <span className="small" style={{ color: '#1e352d' }}>{r.alt || 'They can’t do it this time. Let’s find another way.'}</span>
                  <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={() => talk('other')}>Talk to Mada</button>
                </div>
              )}
              {st === 'queued' && <span className="tiny">Saved on this phone. Sends when you're back online.</span>}
            </div>
          );
        }
        const idx = stageIndex(r.status);
        return (
          <div key={r.id} className="card rise">
            <div className="spread"><span className="h3">{r.title}</span><span className={'pill' + (r.status === 'quote' ? ' gold' : r.status === 'done' ? ' ok' : '')}>{REQ_STAGES[idx]?.[1]}</span></div>
            <span className="small">{r.detail}</span>
            {r.status === 'quote' && (
              <div className="card well" style={{ gap: 8 }}>
                <div className="row"><span className="avatar sm green">F</span><span className="h3" style={{ fontSize: 14 }}>Faisal · your Mada agent</span></div>
                <span className="small" style={{ color: '#1e352d' }}>{quoteText(r)}</span>
                <QuoteBreakdown r={r} />
                {r.quote > 0
                  ? <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={() => push('pay', { kind: 'quote', requestId: r.id })}>Pay SAR {fmt(r.quote)}</button>
                  : <span className="tiny">No charge from Mada.</span>}
              </div>
            )}
            {r.note && <span className="small" style={{ color: '#3f4f48' }}>“{r.note}”</span>}
            {r.status === 'queued' && <span className="tiny">Saved on this phone. Sends when you're back online.</span>}
            {['quote', 'reviewing', 'paid', 'done'].includes(r.status) && <RequestThread requestId={r.id} />}
          </div>
        );
      })}
    </>
  );
}

function quoteText(r) {
  if (r.quoteText) return r.quoteText;
  if (r.kind === 'visa' && /renewal/i.test(r.title)) return 'Absher has a passport appointment on Sunday at 10:20. I can book it and prepare the forms. SAR 150 service fee.';
  if (r.kind === 'visa') return 'The earliest appointment is Tue 14 Jan, 10:20 at VFS Riyadh. I’ll book it and prepare every form. Service fee SAR 450, plus the embassy fee paid on the day.';
  if (r.kind === 'umrah') return 'Flights to Madinah, 3 nights steps from the Haram, the Haramain train and transfers for all of you: SAR 6,900. Nusuk permits are yours to get; I’ll remind you.';
  if (r.kind === 'car') return 'A 7-seat Hyundai Staria with a child seat, picked up at the hotel. SAR 980 for 3 days, insurance included.';
  if (r.kind === 'food') return 'Table for 6 at 19:30 by the window, halal menu, family seating. Held until tomorrow noon. Nothing to pay now.';
  if (r.kind === 'todo') return 'Cruise for 6 on Wednesday at 19:30, dinner included: SAR 1,140 for everyone.';
  return 'I’ve found good options. Here’s what I suggest; reply here if you want changes.';
}

function Past() {
  const { s, push } = useStore();
  if (!(s.pastTrips || []).length) return (
    <div className="empty-hero rise">
      <EmptyPassport />
      <h2 className="display">Every trip leaves a stamp.</h2>
      <span className="small">Your first one goes right there. Trips stay here with every receipt, so the next one takes a minute.</span>
      <button type="button" className="btn primary block" onClick={() => push('ask', {})}>Earn the first stamp</button>
    </div>
  );
  return s.pastTrips.map((t) => (
    <div key={t.id} className="card rise">
      <div className="spread"><span className="h3">{t.city}</span><span className="tiny">{t.dates}</span></div>
      <span className="small">{t.note}</span>
      <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => push('ask', { prefill: `${t.city} again, like ${t.when ? t.when.toLowerCase() : 'last time'}` })}>Same again</button>
    </div>
  ));
}

/* ---------- trip detail ---------- */

export function TripDetail() {
  const { s, set, pop, push, toast } = useStore();
  const [sheet, setSheet] = useState(null);
  useTicker(2000);
  useUnqueue();
  const t = s.trip;
  if (!t) return (
    <div className="screen push"><TopBar onBack={pop} /><div className="scroll no-dock"><span className="h2">This trip has ended.</span></div></div>
  );
  const f = t.flight;
  const flightGone = isRefunded(s, 'flight');
  const tm = timing(s);
  const stayQ = t.stay ? refundQuote(s, 'stay') : null;
  const open = openCount(s);
  const payments = tripPayments(s);
  const nextDue = payments.flatMap((p) => (p.plan && !p.refund ? p.plan.filter((i) => !i.paid) : []))[0];
  const stayPay = payments.find((p) => p.id === 'stay');
  const stayMoney = stayQ ? refundMoney(stayPay, stayQ) : null;
  const cancelStay = () => {
    const back = stayMoney ? stayMoney.cash : t.stay.price;
    set((p) => ({
      trip: { ...p.trip, stay: { ...p.trip.stay, status: 'cancelled' } },
      refunds: [...p.refunds, { id: 'f' + Date.now(), title: `${p.trip.stay.name} · ${p.trip.stay.nights} nights`, amount: back, perItem: { stay: stayQ ? stayQ.back : t.stay.price }, stage: 0, card: stayPay?.card || 'your card', items: ['stay'], dest: stayMoney?.count ? 'tabby' : 'card', tabby: stayMoney?.count ? { left: stayMoney.cancelled, count: stayMoney.count } : null, created: Date.now() }],
    }));
    buzz(HAPTIC.success);
    toast('Cancelled. Your refund is on its way.');
    /* The driver needs somewhere to take them now. */
    setSheet(t.flight && t.pickup ? 'nostay' : null);
  };
  const manage = [
    ['itinerary', 'trips', 'Full itinerary', 'Day by day, with times and documents'],
    ['invoices', 'card', 'Payments and invoices', nextDue ? `Next payment SAR ${fmt(nextDue.amount)} on ${nextDue.date}` : 'VAT invoices for every payment'],
    ['changeFlight', 'flight', 'Change flight', tm.within24 ? 'Less than a day to go: Faisal calls you' : 'Date, time, way back, a name spelling'],
    ['hotelOptions', 'stay', 'Hotel options', stayOf(t) ? 'Room, nights, check-in and checkout' : 'Find a place to stay'],
    ['specialRequests', 'star', 'Special requests', 'Wheelchair, meals, bags, a celebration'],
    ['refund', 'refund', 'Ask for a refund', 'See exactly what comes back first'],
  ];
  return (
    <div className="screen push">
      <div className="photo" style={{ height: 230, borderRadius: 0, flexShrink: 0 }}>
        <img src={t.img || 'img/istanbul.jpg'} alt={t.city} />
        <span className="shade" />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 }}><TopBar onBack={pop} dark /></div>
        <span className="over"><span className="display" style={{ fontSize: 40, color: '#fffdf9' }}>{t.city}</span><span className="small" style={{ color: 'rgba(255,253,249,.9)' }}>{t.datesLong} · booking {t.ref || t.pnr}</span></span>
      </div>
      <div className="scroll no-dock" style={{ paddingTop: 16 }}>
        {open > 0 && (
          <button type="button" className="tm-strip rise" onClick={() => set({ tab: 'trips', stack: [], tripsTab: 'requests' })}>
            <span className="avatar sm green">F</span>
            <span className="grow small" style={{ color: '#1e352d' }}><b>{open} {open === 1 ? 'request' : 'requests'} with Faisal.</b> See where each one is.</span>
            <Icon name="chevron" size={18} />
          </button>
        )}
        <MoveNotice />
        {f && (
          <div className="card">
            <div className="spread"><span className="row" style={{ gap: 10 }}><AirlineMark flight={f} size={32} /><span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{f.back ? 'Going' : 'One way'} · {f.date}</span><span className="tiny">{f.airline} · {f.code}{f.cabin && f.cabin !== 'Economy' ? ' · ' + f.cabin : ''}{t.infants ? ` · ${t.infants} on a lap` : ''}</span></span></span>
              {flightGone ? <span className="pill">Refunded</span> : <button type="button" className="link" onClick={() => push('changeFlight')}>Change</button>}</div>
            <Route dep={f.dep} arr={f.arr} from={f.from} to={f.to} dur={f.dur} />
            {f.back ? (<>
              <div className="divider" />
              <div className="spread"><span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Back · {f.backDate}</span><span className="tiny">{f.airline} · {f.back}</span></span></div>
              <Route dep={f.backDep} arr={f.backArr} from={f.to} to="RUH" dur="4h 10m" />
            </>) : <span className="tiny">No flight home booked. Faisal can add one any time.</span>}
          </div>
        )}
        {t.stay && (
          <div className="card">
            <div className="spread">
              <span className="row"><Icon name="stay" /><span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{t.stay.name}</span><span className="tiny">{rangeLabel(t.stay.fromISO, stayEnd(t.stay))} · {t.stay.nights} nights</span></span></span>
              {t.stay.status === 'cancelled' ? <span className="pill">Cancelled</span> : tm.allUsed ? <span className="pill ok">Stayed</span> : <button type="button" className="link" onClick={() => setSheet('cancel')}>Cancel</button>}
            </div>
            {t.stay.status === 'cancelled' && <span className="small">Refund on its way. Track it in Trips → Requests.</span>}
          </div>
        )}
        {!stayOf(t) && f && (
          <div className="card well tm-nostay">
            <span className="row"><Icon name="stay" /><span className="h3" style={{ fontSize: 15 }}>{t.noStay?.address ? `Staying with ${t.noStay.label || 'family or friends'}` : 'No hotel booked. Where are you staying?'}</span></span>
            {t.noStay?.address ? <span className="small">{t.noStay.address}{t.pickup ? `. ${t.pickup.arrive?.driver || 'The driver'} takes you there.` : ''}</span> : <span className="small">{t.pickup ? `${t.pickup.arrive?.driver || 'The driver'} needs an address after the airport.` : 'So Faisal knows where to reach you.'}</span>}
            <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => setSheet('nostay')}>{t.noStay?.address ? 'Change' : 'Tell us'}</button>
          </div>
        )}
        {!t.stay && !f && (
          <button type="button" className="card tap well" onClick={() => push('ask', { intent: 'stay' })} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="stay" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Add a place to stay</span><span className="small">Rooms near Galata Tower, for the same dates</span></span><Icon name="chevron" />
          </button>
        )}
        {t.pickup && <div className="card" style={{ flexDirection: 'row', alignItems: 'center' }}><Icon name="car" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{t.pickup.arrivalOnly ? 'Airport pickup on arrival' : t.pickup.oneway ? 'Airport pickups on the way there' : 'Airport pickup both ways'}</span><span className="tiny">{t.pickup.home ? `${t.pickup.home.driver} in Riyadh · ` : ''}{t.pickup.arrive?.driver} in Istanbul{!stayOf(t) && !t.noStay?.address ? ' · needs your address' : ''}</span></span>{isRefunded(s, 'pickup') && <span className="pill">Refunded</span>}</div>}

        <span className="eyebrow" style={{ marginTop: 8 }}>Manage</span>
        <div className="card tm-list" style={{ padding: 6, gap: 0 }}>
          {manage.map(([name, icon, title, sub], i) => (
            <button key={name} type="button" className={'tm-row' + (i === 0 ? ' lead' : '')} onClick={() => { buzz(HAPTIC.tap); push(name); }}>
              <span className={'tm-ic' + (i === 0 ? ' gold' : '')}><Icon name={icon} size={20} /></span>
              <span className="grow col" style={{ gap: 1 }}><span className="tm-row-title">{title}</span><span className="tiny">{sub}</span></span>
              <Icon name="chevron" size={18} color="#5f6b65" />
            </button>
          ))}
        </div>

        <div className="card">
          <span className="h3">Travellers</span>
          <div className="row" style={{ flexWrap: 'wrap' }}>{t.travellers.map((id) => <span key={id} className="pill">{id === 'omar' ? (PEOPLE.omar.name === 'You' ? 'You' : `${PEOPLE.omar.name} (you)`) : PEOPLE[id]?.name}</span>)}</div>
        </div>
        {(s.groups || []).some((g) => g.id === 'eid') && <button type="button" className="btn secondary block" onClick={() => push('group', { id: 'eid' })}>Open the trip group</button>}
      </div>

      {sheet === 'nostay' && (
        <Sheet label="Where are you staying" onClose={() => setSheet(null)}>
          <h2 className="h2">No hotel booked. Where are you staying?</h2>
          <p className="small" style={{ marginTop: -8 }}>{t.pickup ? `${t.pickup.arrive?.driver || 'Your driver'} meets you at ${t.flight?.to === 'SAW' ? 'Sabiha Gökçen' : 'Istanbul Airport'} on ${t.flight?.date}. Tell us where to take you.` : 'So Faisal knows where you are.'}</p>
          <NoStayChoices onDone={() => setSheet(null)} />
        </Sheet>
      )}
      {sheet === 'cancel' && (
        <Sheet label="Cancel the stay" onClose={() => setSheet(null)}>
          <h2 className="h2">Cancel the stay?</h2>
          <p className="body">You'll get <b style={{ color: '#1e352d' }}>SAR {fmt(stayMoney ? stayMoney.cash : t.stay.price)}</b> back. {stayQ?.rule} Your flights stay as they are.</p>
          {stayMoney?.count > 0 && <span className="small">That’s what you’ve paid so far with {stayPay.method === 'tabby' ? 'Tabby' : 'Tamara'}{stayQ.back < t.stay.price ? ', less the hotel’s fee' : ''}. The {stayMoney.count} payments left (SAR {fmt(stayMoney.cancelled)}) are cancelled.</span>}
          {stayQ && !stayMoney?.count && stayQ.back < t.stay.price && <span className="small">You paid SAR {fmt(t.stay.price)}. {stayQ.why}</span>}
          <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={cancelStay}>Cancel the stay</button>
          <button type="button" className="btn primary block" onClick={() => setSheet(null)}>Keep it</button>
        </Sheet>
      )}
    </div>
  );
}

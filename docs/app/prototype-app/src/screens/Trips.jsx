import React, { useState } from 'react';
import { useStore, buzz, HAPTIC, PEOPLE, fmt } from '../store.jsx';
import { Icon, TopBar, Route, Sheet, SlideToConfirm, Tracker, AirlineMark } from '../ui.jsx';
import { UploadSheet } from './Wallet.jsx';

const REQ_STAGES = [
  ['queued', 'Waiting for a connection'],
  ['sent', 'Sent to Mada'],
  ['reviewing', 'Mada is on it'],
  ['quote', 'Answer ready'],
  ['paid', 'Paid · we’re finishing it'],
  ['done', 'Done'],
];

function stageIndex(status) { return REQ_STAGES.findIndex(([k]) => k === status); }

export default function Trips() {
  const { s, push } = useStore();
  const [tab, setTab] = useState(s.requests.length && !s.trip ? 'requests' : 'upcoming');
  const openReq = s.requests.filter((r) => r.status !== 'done').length;
  return (
    <div className="screen">
      <div className="scroll">
        <div style={{ paddingTop: 54 }} className="spread">
          <h1 className="h1">Trips</h1>
          <button type="button" className="icon-btn dark" aria-label="Plan a trip" onClick={() => push('ask', {})}><Icon name="plus" color="#f6f2ec" /></button>
        </div>
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

function Imports() {
  const { s, set, toast } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <>
      {(s.imports || []).map((im) => (
        <div key={im.id} className="card rise" style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="flight" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{im.title}</span><span className="tiny">{im.sub} · booked elsewhere, watched by Mada</span></span>
        </div>
      ))}
      <div className="card well">
        <span className="h3" style={{ fontSize: 15 }}>Booked somewhere else?</span>
        <span className="small">Forward the confirmation email to <b style={{ color: '#1e352d' }}>omar@trips.madatrips.sa</b>, or upload the PDF. We'll track it like any Mada trip.</span>
        <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>Upload a booking</button>
      </div>
      {open && <UploadSheet title="Add a booking" allowScan={false}
        found={[['Airline', 'Emirates · EK 818'], ['Route', 'Riyadh → Dubai'], ['When', 'Thu 3 Jun · 10:15'], ['Travellers', 'Omar, Hessa']]}
        onSave={() => { set((p) => ({ imports: [...(p.imports || []), { id: 'im' + Date.now(), title: 'Dubai · Emirates EK 818', sub: 'Thu 3 Jun · 2 travellers' }] })); setOpen(false); buzz(HAPTIC.success); toast('Added. We’ll watch EK 818 for you.'); }}
        onClose={() => setOpen(false)} />}
    </>
  );
}

function Upcoming() {
  const { s, push } = useStore();
  if (!s.trip) return (<>
    <div className="card well rise" style={{ alignItems: 'flex-start' }}>
      <span className="h3">No trips yet.</span>
      <span className="small">Tell us where, or forward a booking to <b style={{ color: '#1e352d' }}>omar@trips.madatrips.sa</b> and it appears here.</span>
      <button type="button" className="btn primary small" onClick={() => push('ask', {})}>Plan a trip</button>
    </div>
    <Imports />
  </>);
  const t = s.trip;
  return (<>
    <button type="button" className="photo rise" style={{ height: 210, border: 0, padding: 0 }} onClick={() => push('trip')}>
      <img src="img/istanbul.jpg" alt="Istanbul" />
      <span className="shade" />
      <span className="over" style={{ textAlign: 'left' }}>
        <span className="display" style={{ fontSize: 36, color: '#fffdf9' }}>Istanbul</span>
        <span className="small" style={{ color: 'rgba(255,253,249,.9)' }}>{t.datesLong} · {t.travellers.map((id) => PEOPLE[id].name).join(', ')}</span>
      </span>
    </button>
    <Imports />
  </>);
}

function Requests() {
  const { s, push } = useStore();
  if (!s.requests.length && !s.refunds.length) return (
    <div className="card well rise"><span className="h3">Nothing waiting.</span><span className="small">Visas, Umrah, cars and tables you ask for show up here while Mada works on them.</span></div>
  );
  return (
    <>
      {s.refunds.map((r) => (
        <div key={r.id} className="card rise">
          <div className="spread"><span className="h3">Refund · SAR {fmt(r.amount)}</span><span className={'pill' + (r.stage === 2 ? ' ok' : '')}>{r.stage === 2 ? 'Sent' : 'On its way'}</span></div>
          <span className="small">{r.title}</span>
          <Tracker items={[
            { title: 'Requested', sub: 'Today', state: 'done' },
            { title: r.airline ? `Approved by ${r.airline}` : 'Approved', sub: r.stage >= 1 ? 'Today' : 'Usually 1–3 days', state: r.stage >= 1 ? 'done' : 'now' },
            { title: `Sent to your ${r.card || 'card'}`, sub: r.stage >= 2 ? 'Arrives in 5–10 days, in riyals' : 'Usually 7–14 days', state: r.stage >= 2 ? 'done' : r.stage === 1 ? 'now' : '' },
          ]} />
        </div>
      ))}
      {s.requests.slice().reverse().map((r) => {
        const idx = stageIndex(r.status);
        return (
          <div key={r.id} className="card rise">
            <div className="spread"><span className="h3">{r.title}</span><span className={'pill' + (r.status === 'quote' ? ' gold' : r.status === 'done' ? ' ok' : '')}>{REQ_STAGES[idx]?.[1]}</span></div>
            <span className="small">{r.detail}</span>
            {r.status === 'quote' && (
              <div className="card well" style={{ gap: 8 }}>
                <div className="row"><span className="avatar sm green">F</span><span className="h3" style={{ fontSize: 14 }}>Faisal · your Mada agent</span></div>
                <span className="small" style={{ color: '#1e352d' }}>{quoteText(r)}</span>
                {r.quote > 0
                  ? <button type="button" className="btn primary small" style={{ alignSelf: 'flex-start' }} onClick={() => push('pay', { kind: 'quote', requestId: r.id })}>Pay SAR {fmt(r.quote)}</button>
                  : <span className="tiny">No charge from Mada.</span>}
              </div>
            )}
            {r.status === 'queued' && <span className="tiny">Saved on this phone. Sends when you're back online.</span>}
          </div>
        );
      })}
    </>
  );
}

function quoteText(r) {
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
  return s.pastTrips.map((t) => (
    <div key={t.id} className="card rise">
      <div className="spread"><span className="h3">{t.city}</span><span className="tiny">{t.dates}</span></div>
      <span className="small">{t.note}</span>
      <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => push('ask', { prefill: 'Same as last Eid' })}>Same again</button>
    </div>
  ));
}

/* ---------- trip detail ---------- */

export function TripDetail() {
  const { s, set, pop, push, toast } = useStore();
  const [sheet, setSheet] = useState(null);
  const t = s.trip;
  if (!t) return (
    <div className="screen push"><TopBar onBack={pop} /><div className="scroll no-dock"><span className="h2">This trip has ended.</span></div></div>
  );
  const f = t.flight;
  const cancelStay = () => {
    set((p) => ({
      trip: { ...p.trip, stay: { ...p.trip.stay, status: 'cancelled' } },
      refunds: [...p.refunds, { id: 'f' + Date.now(), title: `${p.trip.stay.name} · 6 nights`, amount: p.trip.stay.price, stage: 0, card: 'Visa ending 41' }],
    }));
    setSheet(null);
    buzz(HAPTIC.success);
    toast('Cancelled. Your refund is on its way.');
  };
  return (
    <div className="screen push">
      <div className="photo" style={{ height: 230, borderRadius: 0, flexShrink: 0 }}>
        <img src="img/istanbul.jpg" alt="Istanbul" />
        <span className="shade" />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 }}><TopBar onBack={pop} dark /></div>
        <span className="over"><span className="display" style={{ fontSize: 40, color: '#fffdf9' }}>Istanbul</span><span className="small" style={{ color: 'rgba(255,253,249,.9)' }}>{t.datesLong} · booking {t.pnr}</span></span>
      </div>
      <div className="scroll no-dock" style={{ paddingTop: 16 }}>
        {f && (
          <div className="card">
            <div className="spread"><span className="row" style={{ gap: 10 }}><AirlineMark flight={f} size={32} /><span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Going · {f.date}</span><span className="tiny">{f.airline} · {f.code}</span></span></span><button type="button" className="link" onClick={() => setSheet('change')}>Change</button></div>
            <Route dep={f.dep} arr={f.arr} from={f.from} to={f.to} dur={f.dur} />
            <div className="divider" />
            <div className="spread"><span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Back · {f.backDate}</span><span className="tiny">{f.airline} · {f.back}</span></span></div>
            <Route dep={f.backDep} arr={f.backArr} from={f.to} to="RUH" dur="4h 10m" />
          </div>
        )}
        {t.stay && (
          <div className="card">
            <div className="spread">
              <span className="row"><Icon name="stay" /><span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{t.stay.name}</span><span className="tiny">9–15 Mar · 6 nights</span></span></span>
              {t.stay.status === 'cancelled' ? <span className="pill">Cancelled</span> : <button type="button" className="link" onClick={() => setSheet('cancel')}>Cancel</button>}
            </div>
            {t.stay.status === 'cancelled' && <span className="small">Refund of SAR {fmt(t.stay.price)} on its way. Track it in Trips → Requests.</span>}
          </div>
        )}
        {!t.stay && (
          <button type="button" className="card tap well" onClick={() => push('ask', { intent: 'stay' })} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="stay" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Add a place to stay</span><span className="small">Connecting rooms near Galata, like last time</span></span><Icon name="chevron" />
          </button>
        )}
        {t.pickup && <div className="card" style={{ flexDirection: 'row', alignItems: 'center' }}><Icon name="car" /><span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Airport pickup both ways</span><span className="tiny">Ahmet in Istanbul · Khalid in Riyadh</span></span></div>}
        <div className="card">
          <span className="h3">Travellers</span>
          <div className="row" style={{ flexWrap: 'wrap' }}>{t.travellers.map((id) => <span key={id} className="pill">{PEOPLE[id].name}</span>)}</div>
        </div>
        <button type="button" className="btn secondary block" onClick={() => push('group')}>Open the trip group</button>
      </div>

      {sheet === 'cancel' && (
        <Sheet label="Cancel the stay" onClose={() => setSheet(null)}>
          <h2 className="h2">Cancel the stay?</h2>
          <p className="body">You'll get <b style={{ color: '#1e352d' }}>SAR {fmt(t.stay.price)}</b> back. It's free to cancel until 2 Mar. Your flights stay as they are.</p>
          <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={cancelStay}>Cancel the stay</button>
          <button type="button" className="btn primary block" onClick={() => setSheet(null)}>Keep it</button>
        </Sheet>
      )}
      {sheet === 'change' && <ChangeSheet onClose={() => setSheet(null)} />}
    </div>
  );
}

function ChangeSheet({ onClose }) {
  const { s, push } = useStore();
  const opts = [
    { id: 'later', label: 'Leave a day later · Wed 10 Mar, 09:40', amount: 480, patch: { date: 'Wed 10 Mar' } },
    { id: 'back', label: 'Come back a day later · Tue 16 Mar, 15:10', amount: 320, patch: { backDate: 'Tue 16 Mar' } },
    { id: 'early', label: 'Earlier the same day · flynas 06:15', amount: 0, patch: null, note: 'Different airline, so we rebook it as a new ticket.' },
  ];
  const [pick, setPick] = useState(null);
  const cur = opts.find((o) => o.id === pick);
  return (
    <Sheet label="Change flight" onClose={onClose}>
      <h2 className="h2">What would you like to change?</h2>
      {opts.map((o) => (
        <button key={o.id} type="button" className={'card tap well' + (pick === o.id ? ' selected' : '')} onClick={() => { setPick(o.id); buzz(HAPTIC.select); }}>
          <span className="spread"><span className="h3" style={{ fontSize: 15 }}>{o.label}</span><span className="num small" style={{ color: '#1e352d', fontWeight: 600 }}>{o.amount ? '+SAR ' + fmt(o.amount) : 'Ask Mada'}</span></span>
          {o.note && <span className="tiny">{o.note}</span>}
        </button>
      ))}
      <span className="small">Prices include the change fee and the fare difference for everyone.</span>
      <button type="button" className="btn primary block" disabled={!cur} onClick={() => {
        if (cur.patch) push('pay', { kind: 'change', label: cur.label, amount: cur.amount, patch: cur.patch });
        else push('ask', { prefill: 'Move us to the flynas 06:15 on 9 Mar' });
        onClose();
      }}>{cur ? (cur.patch ? `Review · SAR ${fmt(cur.amount)}` : 'Ask Mada') : 'Pick one'}</button>
    </Sheet>
  );
}

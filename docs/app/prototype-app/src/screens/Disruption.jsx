import React, { useEffect, useState } from 'react';
import { useStore, buzz, HAPTIC, FLIGHTS, fmt } from '../store.jsx';
import { Icon, TopBar, AirlineMark, Steps } from '../ui.jsx';
import { DESK, DESK_TEL, PhoneIcon } from './Support.jsx';

/* A delay, a cancellation, or a cancellation late at night at the airport.
   State this file owns: disruptionQueue (a choice made offline, sent when back online),
   disruptionVouchers (hotel and meal vouchers from a night cancellation, for the Wallet). */

function optionsFor(kind, t) {
  const flynas = FLIGHTS.find((f) => f.id === 'low');
  const saudia = FLIGHTS.find((f) => f.id === 'best');
  const city = t?.city || 'Istanbul';
  if (kind === 'night') return [
    { id: 'morning', flight: saudia, title: 'Saudia SV261 · tomorrow', times: 'Leaves 07:15 · lands 11:30 at Istanbul', note: 'The first flight out. Same seats together. A hotel near the airport tonight, paid by the airline.', patch: { code: 'SV261', dep: '07:15', arr: '11:30', date: 'Tomorrow' } },
    { id: 'xy', flight: flynas, title: 'flynas XY127 · tomorrow', times: 'Leaves 09:50 · lands 14:30 at Sabiha Gökçen', note: 'A longer sleep. Same hotel tonight. Your pickup moves with you.', patch: { ...flynas, code: 'XY127', dep: '09:50', arr: '14:30', to: 'SAW', date: 'Tomorrow' } },
    { id: 'refund', title: 'Go home and get a refund', times: `SAR ${fmt(t?.flightPrice || 8640)} back to your card`, note: 'Your stay and pickup are cancelled for free too. The airline pays the taxi home.' },
  ];
  if (kind === 'cancel') return [
    { id: 'next', flight: saudia, title: 'Saudia SV265 · direct', times: `Leaves 13:30 · lands 17:45 at ${city}`, note: 'Same seats together. No extra cost.', patch: { code: 'SV265', dep: '13:30', arr: '17:45' } },
    { id: 'xy', flight: flynas, title: 'flynas XY125 · direct', times: 'Leaves 10:25 · lands 15:05 at Sabiha Gökçen', note: 'Earlier. No extra cost to you. Your pickup moves with you.', patch: { ...flynas, code: 'XY125', dep: '10:25', arr: '15:05', to: 'SAW' } },
    { id: 'refund', title: 'Get a refund instead', times: `SAR ${fmt(t?.flightPrice || 8640)} back to your card`, note: 'Your stay and pickup are cancelled for free too.' },
  ];
  return [
    { id: 'xy', flight: flynas, title: 'flynas XY125 · direct', times: 'Leaves 10:25 · lands 15:05 at Sabiha Gökçen', note: 'No extra cost to you. Your pickup moves with you.', patch: { ...flynas, code: 'XY125', dep: '10:25', arr: '15:05', to: 'SAW' } },
    { id: 'stay', flight: saudia, title: `Stay on ${t?.flight?.code || 'SV263'}`, times: 'Likely leaves 12:40 · lands 16:55', note: 'Same seats, same airport. You land 3 hours later.' },
  ];
}

/* Applies a choice to the trip. Exported so a choice queued offline can be sent from anywhere once the phone reconnects. */
export function applyDisruptionChoice(set, { kind, pick }) {
  set((p) => {
    const t = p.trip;
    const cur = optionsFor(kind, t).find((o) => o.id === pick);
    if (!cur) return { disruptionQueue: null };
    const vouchers = kind === 'night' && pick !== 'refund' ? {
      disruptionVouchers: [
        { id: 'v-hotel', kind: 'hotel', title: 'Hotel tonight · airport hotel', body: 'Paid by Saudia. Shuttle from Door 4 every 20 minutes.', code: 'SVH-48213' },
        { id: 'v-meal', kind: 'meal', title: `Meal vouchers · SAR 75 each × ${(t?.travellers || []).length || 1}`, body: 'Any café in the terminal or at the hotel. Valid until 10:00.', code: 'SVM-48213' },
      ],
    } : {};
    if (pick === 'refund') {
      const amount = (t?.flightPrice || 0) + (t?.stay?.status === 'booked' ? t.stay.price : 0) + (t?.pickup?.price || 0);
      return { disruptionQueue: null, refunds: [...p.refunds, { id: 'rf' + Date.now(), title: `${t?.flight?.code || 'Flight'} cancelled · flights, stay and pickup`, amount, stage: 0, airline: 'Saudia', card: 'Visa ending 41', created: Date.now() }], trip: null, phase: 'none' };
    }
    if (cur.patch && t) return { disruptionQueue: null, ...vouchers, trip: { ...t, rebooked: true, flight: { ...t.flight, ...cur.patch, date: cur.patch.date || t.flight.date || 'Tue 9 Mar' } }, phase: 'travelday' };
    return { disruptionQueue: null, ...vouchers, phase: 'travelday' };
  });
}

function CallLink({ label = 'Call', dark }) {
  return (
    <a className={'dz-call' + (dark ? ' dark' : '')} href={DESK_TEL} aria-label={`Call the Mada desk on ${DESK}`}>
      <PhoneIcon size={18} color={dark ? '#f6f2ec' : '#1e352d'} />{label}
    </a>
  );
}

export default function Disruption({ params }) {
  const { s, set, pop, reset } = useStore();
  const kind = params.kind === 'night' ? 'night' : params.kind === 'cancel' ? 'cancel' : 'delay';
  const night = kind === 'night';
  const cancel = kind !== 'delay';
  const t = s.trip;
  const n = t?.travellers?.length || 1;
  const code = t?.flight?.code || 'SV263';
  const options = optionsFor(kind, t);
  const queuedHere = s.disruptionQueue && s.disruptionQueue.kind === kind ? s.disruptionQueue : null;
  const [pick, setPick] = useState(queuedHere?.pick || options[0].id);
  const [stage, setStage] = useState(queuedHere ? 'queued' : 'choose');
  const [refundAmount, setRefundAmount] = useState(0);
  const cur = options.find((o) => o.id === pick) || options[0];
  const everyone = n === 1 ? 'you' : `all ${n} of you`;

  const run = () => {
    buzz(HAPTIC.knock);
    setStage('working');
    setTimeout(() => {
      if (cur.id === 'refund') setRefundAmount((t?.flightPrice || 0) + (t?.stay?.status === 'booked' ? t.stay.price : 0) + (t?.pickup?.price || 0));
      applyDisruptionChoice(set, { kind, pick: cur.id });
      setStage('done');
      buzz(HAPTIC.success);
    }, 2200);
  };
  const confirm = () => {
    if (s.demo.offline) {
      /* Nothing has left the phone. Say so, keep the choice, and send it the moment there's a connection. */
      set({ disruptionQueue: { kind, pick: cur.id, at: Date.now() } });
      setStage('queued');
      buzz(HAPTIC.soft);
      return;
    }
    run();
  };
  useEffect(() => { if (stage === 'queued' && !s.demo.offline) run(); }, [s.demo.offline, stage]);

  const top = (onBack, label) => <TopBar onBack={onBack} backLabel={label} right={<CallLink />} />;
  const shell = (children, extra = '') => <div className={'screen push dz' + (s.demo.offline ? ' is-offline' : '') + extra}>{children}</div>;

  if (stage === 'working') return shell(<>
    <TopBar onBack={null} right={<CallLink />} />
    <div className="dz-pad" style={{ paddingTop: 40 }}>
      <span className="avatar green" style={{ width: 72, height: 72, fontSize: 28 }}>{night ? 'N' : 'F'}</span>
      <h1 className="h1">Mada is on it.</h1>
      <Steps items={[{ text: 'Seats held', state: 'done' }, { text: cur.id === 'refund' ? 'Asking Saudia for the refund' : 'Moving your tickets', state: 'now' }, { text: night && cur.id !== 'refund' ? 'Booking the hotel and meal vouchers' : 'Moving the pickup', state: 'todo' }]} />
    </div>
  </>);

  if (stage === 'queued') return shell(<>
    {top(() => { set({ disruptionQueue: null }); setStage('choose'); }, 'Choose again')}
    <div className="dz-pad">
      <span className="dz-wait" aria-hidden="true"><Icon name="wifiOff" size={28} /></span>
      <h1 className="h1">Saved on your phone. It sends when you're back online.</h1>
      <p className="body">Your choice: <b style={{ color: '#1e352d' }}>{cur.title}</b>. Nothing has reached us yet. The moment your phone reconnects, it goes to {night ? 'the night desk' : 'Faisal'} and we make the change. Seats stay held until {night ? '05:30' : '09:30'}.</p>
      <div className="row small" role="status" style={{ gap: 8 }}><span className="dots" style={{ color: '#7a857f' }}><i /><i /><i /></span>Waiting for a connection</div>
      <p className="body">In a hurry? Call the desk and we'll do it by phone. {DESK}, any hour.</p>
    </div>
    <div className="act">
      <a className="btn primary block" href={DESK_TEL}>Call the desk</a>
      <button type="button" className="btn ghost block" onClick={() => reset('today')}>Back to today</button>
    </div>
  </>);

  if (stage === 'done') return shell(<>
    <div className="dz-pad" style={{ paddingTop: 150 }}>
      <span className="dz-tick"><Icon name="check" color="#f6f2ec" size={30} width={2.4} /></span>
      <h1 className="h1 rise">{cur.id === 'refund' ? `Refund on its way: SAR ${fmt(refundAmount)}.` : cur.id === 'stay' ? `Done. You’re staying on ${code}.` : `Done. ${n === 1 ? 'You’re' : `All ${n} of you are`} on ${cur.title.split(' ·')[0].replace(/^\w+ /, '')}.`}</h1>
      <p className="body rise d1">{cur.id === 'refund' ? `Usually 7–14 days back to your Visa ending 41. Track it in Trips → Requests.${night ? ' Saudia pays the taxi home: keep the receipt.' : ''}` : cur.id === 'stay' ? 'We’ll keep watching the plane. If it gets later, we’ll have another option ready before Saudia announces it.' : night ? `Your room is booked at the airport hotel, 8 minutes on the shuttle from Door 4. The hotel and meal vouchers are in your Wallet. We'll message you at ${cur.id === 'morning' ? '05:15' : '07:30'} to get up.` : 'Khalid now collects you at 07:50. Your pickup at the other end moves too. New boarding passes are in your Wallet.'}</p>
      <div className="row rise d2"><span className="avatar green">{night ? 'N' : 'F'}</span><span className="body" style={{ color: '#1e352d' }}>{cur.id === 'refund' ? '“I’ve asked Saudia for the refund and cancelled the rest. I’ll tell you when it’s sent.”' : night ? '“I’ve moved your tickets and booked the room. Get some sleep.”' : '“I’ve moved everything. Have a good trip.”'}</span></div>
    </div>
    <div className="act"><button type="button" className="btn primary block" onClick={() => reset('today')}>Back to today</button></div>
  </>);

  const headline = night ? `Saudia cancelled ${code} at 23:40.` : cancel ? `Saudia cancelled ${code}.` : `${code} will likely leave 3 hours late.`;
  const sub = night
    ? `You don't need to sort tonight out yourself. We've held a room near the airport and seats for ${everyone} on the first flight tomorrow.`
    : cancel ? `You're owed a full refund. We're holding seats for ${everyone} on two other flights today.`
      : `The plane coming from Cairo landed late. Saudia hasn't announced it yet. We're holding seats for ${everyone} on an earlier flight.`;

  return shell(<>
    {top(pop, 'Today')}
    <div className="scroll no-dock dz-scroll">
      <div className="col" style={{ gap: 12 }}>
        <h1 className="h1" style={{ fontSize: 32 }}>{headline}</h1>
        <p className="body" style={{ color: '#3f4f48', fontSize: 17 }}>{sub}</p>
      </div>
      {night && (
        <div className="card well dz-tonight rise" aria-label="Tonight">
          <span className="eyebrow">Tonight</span>
          {[
            ['stay', 'Hotel near the airport tonight', 'The airline pays. Your voucher goes to your Wallet. Shuttle from Door 4 every 20 minutes.'],
            ['food', 'Meal vouchers', `SAR 75 each for ${everyone}, at any café in the terminal or at the hotel.`],
            ['flight', 'Next flight 07:15', 'Saudia SV261, seats held together. Or pick another below.'],
          ].map(([icon, title, body]) => (
            <div key={title} className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
              <span className="dz-ic"><Icon name={icon} size={18} /></span>
              <span className="col" style={{ gap: 2 }}><span className="h3" style={{ fontSize: 15 }}>{title}</span><span className="small">{body}</span></span>
            </div>
          ))}
        </div>
      )}
      <div role="radiogroup" aria-label="Choose what to do" className="col" style={{ gap: 10 }}>
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={pick === o.id ? 'true' : 'false'} className={'card tap' + (pick === o.id ? ' selected' : '')} onClick={() => { setPick(o.id); buzz(HAPTIC.select); }} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
            <span className="dz-radio"><span style={{ background: pick === o.id ? '#1e352d' : 'transparent' }} /></span>
            <span className="col grow" style={{ gap: 4 }}>
              <span className="row" style={{ gap: 8 }}>{o.flight && <AirlineMark flight={o.flight} size={26} />}<span className="h3" style={{ fontSize: 17 }}>{o.title}</span></span>
              <span className="num" style={{ fontSize: 15, fontWeight: 500 }}>{o.times}</span>
              <span className="small">{o.note}</span>
            </span>
          </button>
        ))}
      </div>
      {night && (
        <div className="card dz-rights rise">
          <span className="h3" style={{ fontSize: 16 }}>What the rules give you</span>
          <span className="tiny">Saudi aviation rules (GACA), in plain words</span>
          <ul>
            <li><b>Care while you wait.</b> Meals and drinks, a hotel room when it runs overnight, and the ride there and back. The airline pays.</li>
            <li><b>Your choice of the next flight or your money back.</b> A full refund, even on a fare that says non-refundable.</li>
            <li><b>Compensation on top</b> when the airline cancels with less than 14 days’ notice. We claim it for you. You don’t need to fill in anything.</li>
          </ul>
        </div>
      )}
      <div className="row">
        <span className="avatar green">{night ? 'N' : 'F'}</span>
        <span className="col grow" style={{ gap: 2 }}>
          <span className="h3" style={{ fontSize: 15 }}>{night ? 'Noura on the night desk is on this with you.' : 'Faisal at Mada is on this with you.'}</span>
          <span className="tiny">{night ? 'Saudia confirmed the cancellation at 23:40' : cancel ? 'Saudia confirmed the cancellation at 06:12' : 'Predicted from the inbound plane at 08:02'}</span>
        </span>
      </div>
      <a className="btn secondary block dz-callrow" href={DESK_TEL}><PhoneIcon size={18} color="#1e352d" />Rather talk? Call {DESK}</a>
    </div>
    <div className="act dz-act">
      {s.demo.offline && <span className="act-note">You're offline. We'll save your choice and send it the moment you're back.</span>}
      <button type="button" className="btn primary block" style={{ height: 60, fontSize: 18 }} onClick={confirm}>
        {cur.id === 'refund' ? 'Get the refund' : cur.id === 'stay' ? `Stay on ${code}` : `Take the ${cur.times.match(/\d\d:\d\d/)[0]}`}
      </button>
    </div>
  </>);
}

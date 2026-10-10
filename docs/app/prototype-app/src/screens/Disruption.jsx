import React, { useState } from 'react';
import { useStore, buzz, HAPTIC, FLIGHTS, fmt } from '../store.jsx';
import { Icon, TopBar, AirlineMark, Steps } from '../ui.jsx';

export default function Disruption({ params }) {
  const { s, set, pop, reset, toast } = useStore();
  const cancel = params.kind === 'cancel';
  const t = s.trip;
  const n = t?.travellers.length || 4;
  const flynas = FLIGHTS.find((f) => f.id === 'low');
  const saudia = FLIGHTS.find((f) => f.id === 'best');
  const options = cancel
    ? [
        { id: 'next', flight: saudia, title: 'Saudia SV265 · direct', times: 'Leaves 13:30 · lands 17:45 at Istanbul', note: 'Same seats together. No extra cost.', patch: { code: 'SV265', dep: '13:30', arr: '17:45' } },
        { id: 'xy', flight: flynas, title: 'flynas XY125 · direct', times: 'Leaves 10:25 · lands 15:05 at Sabiha Gökçen', note: 'Earlier. No extra cost to you. Your pickup moves with you.', patch: { ...flynas, code: 'XY125', dep: '10:25', arr: '15:05', to: 'SAW' } },
        { id: 'refund', title: 'Get a refund instead', times: `SAR ${fmt(t?.flightPrice || 8640)} back to your card`, note: 'Your stay and pickup are cancelled for free too.' },
      ]
    : [
        { id: 'xy', flight: flynas, title: 'flynas XY125 · direct', times: 'Leaves 10:25 · lands 15:05 at Sabiha Gökçen', note: 'No extra cost to you. Your pickup moves with you.', patch: { ...flynas, code: 'XY125', dep: '10:25', arr: '15:05', to: 'SAW' } },
        { id: 'stay', flight: saudia, title: 'Stay on SV263', times: 'Likely leaves 12:40 · lands 16:55', note: 'Same seats, same airport. You land 3 hours later.' },
      ];
  const [pick, setPick] = useState(options[0].id);
  const [stage, setStage] = useState('choose');
  const [refundAmount, setRefundAmount] = useState(0);
  const cur = options.find((o) => o.id === pick);

  const confirm = () => {
    buzz(HAPTIC.knock);
    setStage('working');
    setTimeout(() => {
      if (s.demo.offline) { setStage('offline'); buzz(HAPTIC.soft); return; }
      if (cur.id === 'refund') {
        setRefundAmount((t?.flightPrice || 0) + (t?.stay?.status === 'booked' ? t.stay.price : 0) + (t?.pickup?.price || 0));
        set((p) => ({ refunds: [...p.refunds, { id: 'rf' + Date.now(), title: `${p.trip.flight.code} cancelled · flights, stay and pickup`, amount: (p.trip.flightPrice || 0) + (p.trip.stay?.status === 'booked' ? p.trip.stay.price : 0) + (p.trip.pickup?.price || 0), stage: 0, airline: 'Saudia', card: 'Visa ending 41' }], trip: null, phase: 'none' }));
      } else if (cur.patch) {
        set((p) => ({ trip: { ...p.trip, rebooked: true, flight: { ...p.trip.flight, ...cur.patch, date: 'Tue 9 Mar' } }, phase: 'travelday' }));
      } else {
        set({ phase: 'travelday' });
      }
      setStage('done');
      buzz(HAPTIC.success);
    }, 2200);
  };

  if (stage === 'working') return (
    <div className="screen push">
      <TopBar onBack={null} />
      <div style={{ padding: '60px 28px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <span className="avatar green" style={{ width: 72, height: 72, fontSize: 28 }}>F</span>
        <h1 className="h1">Mada is on it.</h1>
        <Steps items={[{ text: 'Seats held', state: 'done' }, { text: cur.id === 'refund' ? 'Asking Saudia for the refund' : 'Moving your tickets', state: 'now' }, { text: 'Moving the pickup', state: 'todo' }]} />
      </div>
    </div>
  );

  if (stage === 'offline') return (
    <div className="screen push">
      <TopBar onBack={() => setStage('choose')} />
      <div style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h1 className="h1">You're offline, so we'll do it for you.</h1>
        <p className="body">Your choice reached us before the connection dropped. Your Mada agent is making the change and will text you when it's done.</p>
        <button type="button" className="btn primary block" onClick={() => { set({ phase: 'travelday' }); reset('today'); }}>Back to today</button>
      </div>
    </div>
  );

  if (stage === 'done') return (
    <div className="screen push">
      <div style={{ padding: '150px 24px 0', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <span style={{ width: 64, height: 64, borderRadius: 999, background: '#2f7a4b', display: 'grid', placeItems: 'center', animation: 'pop .6s var(--spring) both' }}><Icon name="check" color="#f6f2ec" size={30} width={2.4} /></span>
        <h1 className="h1 rise">{cur.id === 'refund' ? `Refund on its way: SAR ${fmt(refundAmount)}.` : cur.id === 'stay' ? 'Done. You’re staying on SV263.' : `Done. All ${n} of you are on ${cur.title.split(' ·')[0]}.`}</h1>
        <p className="body rise d1">{cur.id === 'refund' ? 'Usually 7–14 days back to your Visa ending 41. Track it in Trips → Requests.' : cur.id === 'stay' ? 'We’ll keep watching the plane. If it gets later, we’ll have another option ready before Saudia announces it.' : 'Khalid now collects you at 07:50. Your Istanbul pickup moves too. New boarding passes are in your Wallet.'}</p>
        <div className="row rise d2"><span className="avatar green">F</span><span className="body" style={{ color: '#1e352d' }}>{cur.id === 'refund' ? '“I’ve asked Saudia for the refund and cancelled the rest. I’ll tell you when it’s sent.”' : '“I’ve moved everything. Have a good trip.”'}</span></div>
      </div>
      <div className="act"><button type="button" className="btn primary block" onClick={() => reset('today')}>Back to today</button></div>
    </div>
  );

  return (
    <div className="screen push">
      <TopBar onBack={pop} backLabel="Today" />
      <div className="scroll no-dock">
        <div className="col" style={{ gap: 12 }}>
          <h1 className="h1" style={{ fontSize: 32 }}>{cancel ? 'Saudia cancelled SV263.' : 'SV263 will likely leave 3 hours late.'}</h1>
          <p className="body" style={{ color: '#3f4f48', fontSize: 17 }}>{cancel ? `You're owed a full refund. We're holding seats for all ${n} of you on two other flights today.` : `The plane coming from Cairo landed late. Saudia hasn't announced it yet. We're holding seats for all ${n} of you on an earlier flight.`}</p>
        </div>
        <div role="radiogroup" aria-label="Choose what to do" className="col" style={{ gap: 10 }}>
          {options.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={pick === o.id ? 'true' : 'false'} className={'card tap' + (pick === o.id ? ' selected' : '')} onClick={() => { setPick(o.id); buzz(HAPTIC.select); }} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
              <span style={{ width: 22, height: 22, borderRadius: 999, border: '2px solid #1e352d', display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 2 }}><span style={{ width: 10, height: 10, borderRadius: 999, background: pick === o.id ? '#1e352d' : 'transparent' }} /></span>
              <span className="col grow" style={{ gap: 4 }}>
                <span className="row" style={{ gap: 8 }}>{o.flight && <AirlineMark flight={o.flight} size={26} />}<span className="h3" style={{ fontSize: 17 }}>{o.title}</span></span>
                <span className="num" style={{ fontSize: 15, fontWeight: 500 }}>{o.times}</span>
                <span className="small">{o.note}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="row"><span className="avatar green">F</span><span className="col" style={{ gap: 2 }}><span className="h3" style={{ fontSize: 15 }}>Faisal at Mada is on this with you.</span><span className="tiny">{cancel ? 'Saudia confirmed the cancellation at 06:12' : 'Predicted from the inbound plane at 08:02'}</span></span></div>
      </div>
      <div className="act">
        <button type="button" className="btn primary block" style={{ height: 60, fontSize: 18 }} onClick={confirm}>
          {cur.id === 'refund' ? 'Get the refund' : cur.id === 'stay' ? 'Stay on SV263' : `Take the ${cur.times.match(/\d\d:\d\d/)[0]}`}
        </button>
      </div>
    </div>
  );
}

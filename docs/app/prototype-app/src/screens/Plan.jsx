import React, { useState } from 'react';
import { useStore, buzz, HAPTIC, PEOPLE, fmt } from '../store.jsx';
import { Icon, TopBar } from '../ui.jsx';

export const PLANS = {
  alula2: {
    id: 'alula2', title: 'Two days in AlUla', sub: 'Old Town, Hegra and a desert sunset', img: 'img/alula.jpg', city: 'AlUla', days: 2,
    price: { flights: 1380, stay: 1650, experiences: 870 },
    plan: [
      { day: 'Day 1', stops: [
        { time: '07:30', icon: 'flight', title: 'Riyadh → AlUla', note: '1h 20m direct. Window seats on the right for the canyon view.' },
        { time: '10:00', icon: 'stay', title: 'Check in at a desert resort', note: 'Two connecting rooms. Pool, family dining.' },
        { time: '16:00', icon: 'star', title: 'AlUla Old Town', note: 'Mud-brick lanes, 900 rooms. Comfortable shoes.' },
        { time: '18:10', icon: 'star', title: 'Elephant Rock at sunset', note: 'Lounge seating. Arrive 30 minutes before.' },
        { time: '20:00', icon: 'food', title: 'Dinner under the stars', note: 'Halal, family seating. Table held for 4.' },
      ] },
      { day: 'Day 2', stops: [
        { time: '09:00', icon: 'star', title: 'Hegra guided tour', note: '2.5 hours. Tickets for all 4, timed entry.' },
        { time: '13:00', icon: 'food', title: 'Lunch in the oasis', note: 'Shade and farm-to-table. Kids’ menu.' },
        { time: '15:30', icon: 'star', title: 'Harrat Viewpoint', note: 'The whole valley from above. 20 minutes by car.' },
        { time: '19:40', icon: 'flight', title: 'AlUla → Riyadh', note: 'Home by 21:00.' },
      ] },
    ],
  },
  istanbul3: {
    id: 'istanbul3', title: 'Three easy days in Istanbul with kids', sub: 'Palaces, ferries and the best künefe', img: 'img/istanbul.jpg', city: 'Istanbul', days: 3,
    price: { flights: 0, stay: 0, experiences: 2140 },
    plan: [
      { day: 'Day 1', stops: [
        { time: '10:00', icon: 'star', title: 'Topkapı Palace, skip the line', note: 'Closed Tuesdays. 2 hours is enough with kids.' },
        { time: '13:00', icon: 'food', title: 'Lunch in Sultanahmet', note: 'Halal, outdoor tables.' },
        { time: '19:30', icon: 'star', title: 'Bosphorus dinner cruise', note: 'From Kabataş pier. Booked for 6.' },
      ] },
      { day: 'Day 2', stops: [
        { time: '10:30', icon: 'car', title: 'Ferry to Kadıköy', note: '20 minutes. Kids feed the gulls.' },
        { time: '11:00', icon: 'food', title: 'Kadıköy food walk', note: 'Tastings for 4, about 3 hours.' },
      ] },
      { day: 'Day 3', stops: [
        { time: '10:00', icon: 'star', title: 'Princes’ Islands day trip', note: 'No cars on the islands. Bikes and carriages.' },
        { time: '19:00', icon: 'food', title: 'Künefe near Galata Tower', note: 'Noor’s tip: go before 8.' },
      ] },
    ],
  },
};

/* Plan notes are written for a family of four. Say them for who's actually going. */
function fitNote(note, n, kids) {
  let t = note.replace(/\b(for|all) 4\b/g, (m, w) => (n === 1 ? (w === 'all' ? 'you' : 'one') : `${w} ${n}`)).replace('Tickets for all you', 'Your ticket').replace('Tastings for one', 'Tastings for one').replace('Booked for 6', `Booked for ${n}`);
  if (n <= 2) t = t.replace('Two connecting rooms', n === 1 ? 'A room' : 'A double room');
  if (!kids) t = t.replace(/ Kids\u2019 menu\.| Kids feed the gulls\.|, family dining| 2 hours is enough with kids\./g, (m) => (m.includes('2 hours') ? ' 2 hours is enough.' : ''));
  return t;
}

export default function Plan({ params }) {
  const { s, set, pop, push, toast } = useStore();
  const plan = PLANS[params.id] || PLANS.alula2;
  const [day, setDay] = useState(0);
  const saved = (s.savedPlans || []).includes(plan.id);
  const n = Math.max(1, (s.household.length ? s.household : ['omar']).filter((id) => id !== 'lina').length);
  const kids = s.household.some((id) => /daughter|son|child/i.test(PEOPLE[id]?.role || ''));
  const total = plan.price.flights * n / 2 + plan.price.stay + plan.price.experiences * n / 4;
  return (
    <div className="screen push">
      <div className="photo" style={{ height: 250, borderRadius: 0, flexShrink: 0 }}>
        <img className="drift" src={plan.img} alt={plan.city} />
        <span className="shade" />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 }}><TopBar onBack={pop} dark /></div>
        <span className="over" style={{ gap: 4 }}>
          <span className="pill glass" style={{ alignSelf: 'flex-start' }}>Planned by Mada · {plan.days} days</span>
          <span className="display" style={{ fontSize: 36, color: '#fffdf9' }}>{plan.title}</span>
          <span className="small" style={{ color: 'rgba(255,253,249,.9)' }}>{plan.sub}</span>
        </span>
      </div>
      <div className="scroll no-dock" style={{ paddingTop: 14, paddingBottom: 170 }}>
        <div className="chips" role="tablist">
          {plan.plan.map((d, i) => <button key={d.day} type="button" role="tab" aria-selected={day === i ? 'true' : 'false'} className={'chip' + (day === i ? ' on' : '')} onClick={() => { setDay(i); buzz(HAPTIC.select); }}>{d.day}</button>)}
        </div>
        <div className="tracker" key={day}>
          {plan.plan[day].stops.map((st, i, arr) => (
            <div key={st.title} className="t-item rise" style={{ animationDelay: `${i * 0.05}s` }}>
              <div className="rail" style={{ width: 44 }}>
                <span className="icon-btn" style={{ width: 36, height: 36, background: '#fffdf9' }}><Icon name={st.icon} size={18} /></span>
                {i < arr.length - 1 && <span className="bar" />}
              </div>
              <div className="t-text" style={{ paddingBottom: 18 }}>
                <span className="tiny num" style={{ fontWeight: 600, color: '#7d5d27' }}>{st.time}</span>
                <span className="h3">{st.title}</span>
                <span className="small">{fitNote(st.note, n, kids)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="card well">
          <span className="h3">Make it yours</span>
          <span className="small">Change a day, swap a stop, or add your own. Ask, and we'll rework the plan.</span>
          <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => push('ask', { prefill: `Change the ${plan.title} plan` })}>Change something</button>
        </div>
      </div>
      <div className="act" style={{ flexDirection: 'row' }}>
        <button type="button" className="btn primary" style={{ flex: '1 1 auto' }} onClick={() => push('pay', { kind: 'package', planId: plan.id, travellers: (s.household.length ? s.household : ['omar']).filter((id) => id !== 'lina'), amount: total })}>
          Book it all · SAR {fmt(total)}
        </button>
        <button type="button" className={'btn ' + (saved ? 'primary' : 'secondary')} style={{ width: 56, padding: 0, flexShrink: 0 }} aria-label={saved ? 'Saved. Tap to remove' : 'Save for later'} aria-pressed={saved ? 'true' : 'false'} onClick={() => {
          set((p) => ({ savedPlans: saved ? (p.savedPlans || []).filter((x) => x !== plan.id) : [...(p.savedPlans || []), plan.id] }));
          buzz(HAPTIC.select); toast(saved ? 'Removed from your saves.' : 'Saved. It’s in Circles → Your circles → Saved.');
        }}><svg width="22" height="22" viewBox="0 0 24 24" fill={saved ? '#f6f2ec' : 'none'} stroke={saved ? '#f6f2ec' : '#1e352d'} strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg></button>
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { useStore, buzz, HAPTIC, fmt } from '../store.jsx';
import { Icon, Sun, TopBar, Sheet, Toggle } from '../ui.jsx';
import { PLANS } from './Plan.jsx';
import { SEED_POSTS, FRIENDS, GroupInfo, PostDetail, Avatar as PAvatar, person, useSave, EmptyArt, useCircleClock, setOpenCircle, getThread, fold, opAdd, opMsg, opThread, opGroup, opQueue, sys, names, newId, familyOf, familyLabel, markPaid } from './Social.jsx';

const EVENTS = {
  Riyadh: [
    { id: 'e1', title: 'Boulevard World at night', when: 'Every evening · 16:00–01:00', where: 'Riyadh Season', tag: 'Family', img: 'img/riyadh.jpg' },
    { id: 'e2', title: 'Desert dinner under the stars', when: 'Thu and Fri · 19:30', where: 'Outside Riyadh, 45 min', tag: 'Friends', img: 'img/alula.jpg' },
    { id: 'e3', title: 'Weekend in AlUla', when: 'Flights from SAR 690', where: '1h 20m away', tag: 'Getaway', img: 'img/alula.jpg' },
  ],
  Istanbul: [
    { id: 'e4', title: 'Bosphorus dinner cruise', when: 'Nightly · 19:30', where: 'From Kabataş pier', tag: 'Family', img: 'img/istanbul.jpg' },
    { id: 'e5', title: 'Kadıköy food walk', when: 'Daily · 11:00', where: 'Asian side, 20 min by ferry', tag: 'Food', img: 'img/istanbul.jpg' },
    { id: 'e6', title: 'Topkapı Palace, skip the line', when: 'Closed Tuesdays', where: 'Sultanahmet', tag: 'Culture', img: 'img/istanbul.jpg' },
  ],
  AlUla: [
    { id: 'e7', title: 'Hegra at golden hour', when: 'Daily · 15:30', where: 'Hegra, 25 min from Old Town', tag: 'Culture', img: 'img/alula.jpg' },
    { id: 'e8', title: 'Stargazing at Gharameel', when: 'Thu–Sat · 20:00', where: 'Gharameel, 40 min', tag: 'Family', img: 'img/alula.jpg' },
  ],
};

/* Cities Discover can show; others are asked for, not faked. */
const CITY_INFO = {
  Riyadh: { country: 'Saudi Arabia', img: 'img/riyadh.jpg' },
  Istanbul: { country: 'Türkiye', img: 'img/istanbul.jpg' },
  AlUla: { country: 'Saudi Arabia', img: 'img/alula.jpg' },
};

function CitySheet({ current, onPick, onClose }) {
  const { s, toast } = useStore();
  const [q, setQ] = useState('');
  const groups = [
    ['Where you are', [['Riyadh', 'Here now']]],
    ...(s.trip ? [['Your trips', [[s.trip.city || 'Istanbul', s.trip.dates || '']]]] : []),
    ['Worth a look', [['AlUla', 'A trip we’ve planned'], ...(s.trip ? [] : [['Istanbul', 'Popular this month']])]],
  ];
  const term = q.trim().toLowerCase();
  const hits = term ? Object.keys(CITY_INFO).filter((c) => c.toLowerCase().includes(term)) : null;
  const Row = ([c, note]) => (
    <button key={c + note} type="button" className={'city-row' + (c === current ? ' on' : '')} aria-pressed={c === current ? 'true' : 'false'} onClick={() => { buzz(HAPTIC.select); onPick(c); }}>
      <img src={CITY_INFO[c].img} alt="" />
      <span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 16 }}>{c}</span><span className="tiny">{note}</span></span>
      {c === current ? <Icon name="check" size={20} color="#1e352d" width={2.4} /> : null}
    </button>
  );
  return (
    <Sheet label="Choose a city" onClose={onClose}>
      <h2 className="h2">What’s on where?</h2>
      <input className="input" placeholder="Search a city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search a city" />
      {hits ? (
        hits.length ? <div className="col" style={{ gap: 8 }}>{hits.map((c) => Row([c, CITY_INFO[c].country]))}</div> : (
          <div className="card well" style={{ gap: 8 }}>
            <span className="h3" style={{ fontSize: 15 }}>We don’t cover {q.trim()} yet.</span>
            <span className="small">Faisal can still plan it with you, and we’ll tell you when Discover reaches it.</span>
            <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => { toast(`We’ll tell you when ${q.trim()} is on Discover.`); onClose(); }}>Tell me when it’s here</button>
          </div>
        )
      ) : groups.map(([title, rows]) => (
        <div key={title} className="col" style={{ gap: 8 }}>
          <span className="eyebrow">{title}</span>
          {rows.map(Row)}
        </div>
      ))}
    </Sheet>
  );
}


/* ---------- what Mada knows about places, for answers in a circle ---------- */

const PLACES = {
  Istanbul: { fly: '4h 15m direct from Riyadh', from: 1745, nightly: 980, plan: 'istanbul3', ideas: ['A Bosphorus dinner cruise from Kabataş, 19:30', 'Topkapı Palace in the morning. Closed Tuesdays', 'The ferry to Kadıköy for the food walk'], spots: ['Bosphorus cruise', 'Topkapı Palace', 'Kadıköy', 'Princes’ Islands'], when: 'April to June is mild, about 18–24°C. Eid in March is cool, so bring jackets.', visa: 'Saudi passports get an e-visa online in about 10 minutes.', stay: 'Galata or Sultanahmet. Both are walkable with kids.' },
  Georgia: { fly: '3h 30m direct to Tbilisi', from: 1290, nightly: 620, ideas: ['Old Tbilisi and the cable car up to Narikala', 'A day in Kazbegi, under the mountains', 'Lake Bazaleti for a quiet afternoon by the water'], spots: ['Tbilisi', 'Kazbegi', 'Batumi', 'Gudauri'], when: 'May to October is green and warm. Gudauri has snow from December to March.', visa: 'Saudi passports need no visa for stays up to a year.', stay: 'Old Tbilisi to walk everywhere, then a mountain lodge in Kazbegi.' },
  Baku: { fly: '3h direct', from: 1150, nightly: 700, ideas: ['The Old City walls at dusk', 'The Flame Towers light show from the Boulevard', 'A day in Gabala: cable cars and lakes'], spots: ['Old City', 'Boulevard', 'Gabala', 'Shahdag'], when: 'April to June, and September to October.', visa: 'Saudi passports get an e-visa in about 3 days.', stay: 'The Old City, or a seafront hotel on the Boulevard.' },
  AlUla: { fly: '1h 20m direct', from: 690, nightly: 1650, plan: 'alula2', ideas: ['Hegra at golden hour', 'Old Town lanes after 16:00', 'Stargazing at Gharameel'], spots: ['Hegra', 'Old Town', 'Elephant Rock', 'Maraya'], when: 'October to March. Warm days, cool nights.', visa: 'No visa needed.', stay: 'A desert resort with family villas.' },
  London: { fly: '6h 50m direct', from: 3150, nightly: 1900, ideas: ['Hyde Park and the Diana playground', 'The Natural History Museum. Free, book a slot', 'A Thames boat down to Greenwich'], spots: ['Hyde Park', 'Natural History Museum', 'Greenwich', 'Harrods'], when: 'June to September. Long days, about 20°C.', visa: 'Saudi passports need an electronic travel authorisation. About 3 days.', stay: 'Kensington or Marylebone, near the parks.' },
  Dubai: { fly: '2h direct', from: 820, nightly: 1100, ideas: ['Dubai Frame and Zabeel Park', 'A day at Aquaventure', 'A desert dinner at sunset'], spots: ['Downtown', 'The Palm', 'Dubai Frame', 'Desert camp'], when: 'November to March.', visa: 'No visa needed.', stay: 'Downtown for the fountains, or the Palm for the beach.' },
  Riyadh: { fly: null, from: 0, nightly: 800, ideas: ['Boulevard World in the evening', 'Sunset at Bujairi Terrace, Diriyah', 'A desert camp in Thumamah'], spots: ['Boulevard World', 'Diriyah', 'Thumamah', 'Kingdom Centre'], when: 'October to March. Evenings are best.', visa: 'No visa needed.', stay: 'Close to the Boulevard if you’re staying over.' },
  Abha: { fly: '1h 35m direct', from: 540, nightly: 650, ideas: ['The Al Soudah cable car', 'Rijal Almaa, the stone village', 'Evenings at 20°C in August'], spots: ['Al Soudah', 'Rijal Almaa', 'Abha Dam', 'Art Street'], when: 'June to September, when Riyadh is hot.', visa: 'No visa needed.', stay: 'Al Soudah, up in the clouds.' },
};
const ALIASES = [['tbilisi', 'Georgia'], ['georgia', 'Georgia'], ['batumi', 'Georgia'], ['istanbul', 'Istanbul'], ['türkiye', 'Istanbul'], ['turkiye', 'Istanbul'], ['turkey', 'Istanbul'], ['baku', 'Baku'], ['azerbaijan', 'Baku'], ['alula', 'AlUla'], ['al ula', 'AlUla'], ['london', 'London'], ['dubai', 'Dubai'], ['riyadh', 'Riyadh'], ['abha', 'Abha']];
const findPlace = (text = '') => {
  const t = ` ${String(text).toLowerCase()} `;
  const hit = ALIASES.find(([k]) => new RegExp(`[^a-z]${k}[^a-z]`).test(t));
  return hit ? hit[1] : null;
};
/* Where a circle is going: what it was told, its trip, or its name. Never a guess. */
export const circleDest = (g) => {
  if (!g) return null;
  if (g.dest) return findPlace(g.dest) || g.dest;
  const t = g.trip && g.trip !== 'Somewhere new' ? g.trip.split(' · ')[0] : '';
  return findPlace(t) || findPlace(g.name) || t || null;
};
const roundTo = (n, step) => Math.round(n / step) * step;

/* Mada's answer to "@Mada …" in a circle: about this circle's place, or a question back. */
function madaReply(g, raw, thread) {
  const n = g.members.length;
  const q = raw.replace(/@mada\b/ig, '').trim();
  const t = q.toLowerCase();
  const prev = [...thread.msgs].reverse().find((m) => m.t !== 'sys');
  let dest = findPlace(q) || circleDest(g);
  if (!dest && prev?.askWhere && q && q.split(/\s+/).length <= 3 && !/[\d@?!.,;:]/.test(q)) dest = q.replace(/\b\w/g, (c) => c.toUpperCase());
  if (!dest) return { askWhere: true, text: `Where are you thinking? Tell us a place and we’ll bring ideas for ${n === 1 ? 'you' : 'all ' + n}.`, actions: ['Georgia', 'Baku', 'AlUla'].map((p) => ({ label: p, say: p })) };
  const P = PLACES[dest];
  const who = n === 1 ? 'you' : `all ${n}`;
  const planIt = { label: 'Plan it', ask: `Plan a trip to ${dest} for ${n}` };
  if (!P) return { dest, text: `We don’t have ready ideas for ${dest} yet. Faisal can plan it with you from scratch, for ${who}.`, actions: [planIt] };
  if (/visa|passport/.test(t)) return { dest, text: `${P.visa} We check every passport in the circle before anything is booked.`, actions: [planIt] };
  if (/flight|fly|plane|ticket/.test(t)) return P.fly
    ? { dest, text: `${dest} is ${P.fly}. Flights from SAR ${fmt(P.from)} a person. Faisal can hold seats for ${who}, together.`, actions: [{ label: 'Find flights', ask: `Flights to ${dest} for ${n}` }] }
    : { dest, text: `${dest} is home. No flights needed.`, actions: [planIt] };
  if (/hotel|stay|room|villa|sleep/.test(t)) return { dest, text: `Where to stay in ${dest}: ${P.stay}`, actions: [{ label: 'See stays', ask: `A place to stay in ${dest} for ${n}` }] };
  if (/when|weather|season|best time|cold|hot|warm/.test(t)) return { dest, text: `Best time for ${dest}: ${P.when}`, actions: [planIt] };
  if (/cost|price|budget|how much|expensive|cheap/.test(t)) {
    const lo = Math.max(500, roundTo(P.from * n + P.nightly * 4 * Math.ceil(n / 4), 500));
    return { dest, text: `For ${n === 1 ? 'one person' : n + ' people'}, 4 nights in ${dest} is usually SAR ${fmt(lo)}–${fmt(roundTo(lo * 1.25, 500))} with flights and a hotel. Faisal prices it exactly.`, actions: [planIt] };
  }
  return { dest, text: `Three ideas for ${dest}, for ${who}:`, list: P.ideas, foot: P.fly ? `${P.fly}, from SAR ${fmt(P.from)} a person.` : null, actions: [planIt, ...(P.plan ? [{ label: 'See our plan', plan: P.plan }] : [])] };
}

/* Friends answer some messages, not all. Questions get answers, hellos get hellos, "ok" gets a read receipt. */
const ACK = /^(ok|okay|k|kk|sure|yes|yeah|yep|no|nope|fine|done|cool|great|good|noted|alright|perfect|👍|🙏)[.! ]*$/i;
const GREET = /^(salam|assalam|as-salam|assalamu|hi|hello|hey|marhaba|السلام)/i;
const THANKS = /thank|shukran|thx|jazak/i;
const QUESTION = /\?\s*$|^(who|what|when|where|why|how|can|could|should|shall|are|is|do|does|did|will|would|which|any|anyone)\b/i;
function answerFor(text, g) {
  const t = text.toLowerCase();
  const dest = circleDest(g);
  if (/who.*\b(in|coming|joining|free)\b|anyone|are you in|you in/.test(t)) return 'I’m in.';
  if (/vote/.test(t)) return 'Yes, start a vote. Easier.';
  if (/how much|cost|price|budget|afford/.test(t)) return 'Under SAR 5,000 a family would be good.';
  if (/flight|fly|plane/.test(t)) return 'Morning flights, please. The kids sleep better.';
  if (/hotel|stay|room|villa/.test(t)) return 'Somewhere we can walk to dinner.';
  if (/food|eat|dinner|lunch|restaurant|breakfast/.test(t)) return 'Anywhere halal with family seating.';
  if (/where/.test(t)) return dest ? `${dest} still sounds good to me.` : 'Somewhere cooler than Riyadh. Georgia?';
  if (/when|date|day|week|month|june|july|eid/.test(t)) return 'After the 10th works for us.';
  return 'Not sure yet. Can we vote on it?';
}
const PREF = ['hessa', 'abdullah', 'noor', 'faris', 'khalid', 'maha', 'yousef', 'reem'];
const rank = (ids) => [...ids].sort((a, b) => (PREF.indexOf(a) + 1 || 99) - (PREF.indexOf(b) + 1 || 99));
function planResponses(g, text, mid, thread) {
  const now = Date.now();
  const evs = [];
  const others = g.members.filter((m) => m !== 'omar');
  const prev = [...thread.msgs].reverse().find((m) => m.t !== 'sys');
  const toMada = /@mada\b/i.test(text) || (prev?.t === 'mada' && prev.askWhere && !circleDest(g));
  if (toMada) {
    const r = madaReply(g, text, thread);
    if (r.dest && !circleDest(g)) evs.push({ at: now + 1500, gid: g.id, type: 'dest', dest: r.dest });
    evs.push({ at: now + 1600, gid: g.id, type: 'msg', who: 'mada', msg: { t: 'mada', text: r.text, list: r.list || null, foot: r.foot || null, actions: r.actions || [], askWhere: !!r.askWhere } });
  }
  if (!others.length) return evs;
  const ranked = rank(others);
  const turn = thread.msgs.filter((m) => m.who === 'omar').length;
  const responder = g.dm ? others[0] : ranked[turn % Math.min(ranked.length, 3)];
  (g.dm ? others : ranked.slice(0, 3)).forEach((w, i) => evs.push({ at: now + 1100 + i * 900, gid: g.id, type: 'seen', mid, who: w }));
  if (toMada) return evs;
  const plain = text.trim();
  let reply = null;
  if (ACK.test(plain) || THANKS.test(plain)) reply = null;
  else if (GREET.test(plain)) reply = 'Wa alaikum assalam.';
  else if (QUESTION.test(plain)) reply = answerFor(plain, g);
  else if (/\b(booked|paid)\b/i.test(plain)) reply = 'Thank you.';
  if (reply) evs.push({ at: now + 3000, gid: g.id, type: 'msg', who: responder, msg: { t: 'text', text: reply } });
  if (reply === 'I’m in.' && !g.dm && ranked.length > 1) evs.push({ at: now + 4800, gid: g.id, type: 'msg', who: ranked.find((r) => r !== responder), msg: { t: 'text', text: 'Me too, if it’s after the 10th.' } });
  return evs;
}

/* Others vote over a few seconds, most for the first choice. */
const planVotes = (g, mid, options) => {
  const now = Date.now();
  return rank(g.members.filter((m) => m !== 'omar')).slice(0, 4).map((who, i) => ({ at: now + 1800 + i * 1400, gid: g.id, type: 'vote', mid, who, opt: options[[0, 0, 1, 0][i] % options.length].id }));
};
const DAYS = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const phrase = (label) => (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(label) ? DAYS[label.slice(0, 3)] : label);

/* Splits: equally, by family, or custom amounts that add up. */
function shareUnits(mode, ids) {
  if (mode === 'family') {
    const fam = {};
    ids.forEach((id) => { const k = familyOf(id); (fam[k] = fam[k] || []).push(id); });
    return Object.entries(fam).map(([key, list]) => ({ key, ids: list, label: familyLabel(key, list) }));
  }
  return ids.map((id) => ({ key: id, ids: [id], label: id === 'omar' ? 'You' : person(id).short }));
}
function equalAmounts(total, k) {
  const base = Math.floor(total / k);
  const rest = Math.round(total - base * k);
  return Array.from({ length: k }, (_, i) => base + (i < rest ? 1 : 0));
}

const STAMPS = [
  { city: 'Istanbul', date: 'MAR 27', color: '#b98f4a', rot: -8, upcoming: true },
  { city: 'Baku', date: 'APR 26', color: '#7d5d27', rot: -4 },
  { city: 'AlUla', date: 'JAN 26', color: '#1e352d', rot: 6 },
  { city: 'Abha', date: 'AUG 25', color: '#1e352d', rot: 9 },
  { city: 'London', date: 'JUL 25', color: '#7d5d27', rot: -10 },
];

/* One line under a circle's name: the last thing that happened in it. */
function lastLine(g, t) {
  const m = t && [...t.msgs].reverse().find((x) => x.kind !== 'welcome');
  if (!m) return (g.invited || []).length ? `${g.invited.length} invited` : 'Nothing yet';
  const who = m.who === 'omar' ? 'You' : m.who === 'mada' ? 'Mada' : person(m.who).short;
  if (m.t === 'sys') return m.text;
  if (m.t === 'vote') return `${m.vote.closed ? 'Vote closed' : 'Vote'}: ${m.vote.q}`;
  if (m.t === 'split') return `${m.split.settled ? 'Settled' : 'Split'}: ${m.split.what}`;
  if (m.t === 'card') return `${who} shared ${m.card.kind === 'plan' ? PLANS[m.card.id]?.title : m.card.post?.place}`;
  if (m.t === 'faisal') return 'Faisal: seats held on the cruise';
  return `${who}: ${m.text || ''}`;
}

export default function Circles() {
  const { s, set, push, toast } = useStore();
  useCircleClock();
  const c = s.circles;
  const [sheet, setSheet] = useState(null);
  const [who, setWho] = useState(c.aroundWho || 'picked');
  const [pressed, setPressed] = useState(null);
  const [reason, setReason] = useState(null);
  const [posts, setPosts] = useState(SEED_POSTS);
  const [openPost, setOpenPost] = useState(null);
  const { isSaved, toggle: toggleSave } = useSave();
  const op = posts.find((p) => p.id === openPost);
  const city = s.trip ? 'Istanbul' : 'Riyadh';
  const setC = (patch) => set((p) => ({ circles: { ...p.circles, ...patch } }));
  const noorHidden = c.hidden.includes('noor');
  const [view, setView] = useState('discover');
  const circles = s.groups.filter((g, i, all) => !g.dm && all.findIndex((x) => x.id === g.id) === i);
  const friends = s.friends || [];
  const known = posts.filter((p) => friends.includes(p.uid) || (s.following || []).includes(p.uid) || p.who === 'You');
  const savedCount = (s.savedPosts || []).length + (s.savedPlans || []).length;
  /* Stamps come from trips taken. A new account has none yet: an empty passport, with the next trip pencilled in. */
  const stamps = (s.stamps || []).length || (s.pastTrips || []).length ? STAMPS : [];

  return (
    <div className="screen">
      <div className="scroll">
        <div className="spread" style={{ paddingTop: 58 }}>
          <div className="tabs-text" role="tablist" aria-label="Circles views">
            {[['discover', 'Discover'], ['circles', 'Circles']].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id ? 'true' : 'false'} onClick={() => { setView(id); buzz(HAPTIC.select); }}>{label}</button>
            ))}
          </div>
          {view === 'discover'
            ? <button type="button" className="icon-btn dark" aria-label="Post a tip" onClick={() => setSheet('post')}><Icon name="plus" color="#f6f2ec" /></button>
            : <span className="row" style={{ gap: 8 }}>
                <button type="button" className="icon-btn" aria-label={`Your people${(s.friendRequests || []).length ? ', ' + s.friendRequests.length + ' request' : ''}`} style={{ position: 'relative' }} onClick={() => push('people')}><Icon name="circles" />{(s.friendRequests || []).length > 0 && <span className="badge-dot" />}</button>
                <button type="button" className="icon-btn dark" aria-label="New circle" onClick={() => push('newCircle')}><Icon name="plus" color="#f6f2ec" /></button>
              </span>}
        </div>
        {view === 'discover' ? <Discover posts={posts} setPosts={setPosts} /> : (<>

        {friends.length > 0 && (
        <div className="card focal rise" style={{ padding: 18, gap: 14 }}>
          {!noorHidden && s.trip && friends.includes('noor') && (
            <>
              <div className="row" style={{ gap: 12 }}>
                <span style={{ position: 'relative' }}><span className="avatar gold" style={{ width: 44, height: 44 }}>N</span><span className="pulse" style={{ position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: 999, background: '#4fbf7a', border: '2px solid #1e352d' }} /></span>
                <div className="grow col" style={{ gap: 2 }}><span className="h3">Noor is in Istanbul when you are.</span><span className="tiny">10–14 Mar · she shared it with you</span></div>
                <button type="button" className="icon-btn" aria-label="More options for Noor" style={{ background: 'rgba(233,226,216,.12)', width: 36, height: 36 }} onClick={() => setSheet('noor')}><Icon name="more" color="#e9e2d8" /></button>
              </div>
              {c.hello ? <span className="small" style={{ color: '#e6c88f', fontWeight: 600 }}>{c.hello === 'sent' ? 'Sent. Noor will see it next time she opens Mada.' : 'Okay. We won’t mention it again for this trip.'}</span> : (
                <div className="row">
                  <button type="button" className="btn gold small" onClick={() => { setC({ hello: 'sent' }); buzz(HAPTIC.knock); }}>Say hello</button>
                  <button type="button" className="btn on-dark small" onClick={() => { setC({ hello: 'no' }); buzz(HAPTIC.tap); }}>Not now</button>
                </div>
              )}
              <div className="divider" style={{ background: 'rgba(233,226,216,.12)' }} />
            </>
          )}
          <div className="row" style={{ gap: 12 }}>
            <div className="grow col" style={{ gap: 2 }}>
              <span className="h3" style={{ fontSize: 15 }}>Tell friends you're in {city}</span>
              <span className="tiny">{c.around ? `On for ${who === 'family' ? 'family only' : who === 'close' ? 'close friends' : 'Abdullah, Noor and family'} · city only · ends when you fly home` : 'Off. Only people you choose, city only, and it ends when you fly home.'}</span>
            </div>
            <Toggle onDark checked={c.around} label={`Tell friends you're in ${city}`} onChange={(v) => { if (v) setSheet('around'); else { setC({ around: false }); toast('Hidden. Nobody can see where you are.'); } }} />
          </div>
        </div>
        )}

        <div className="spread"><h2 className="h2">Your circles</h2>{circles.length > 0 && <span className="tiny">{circles.length}</span>}</div>
        {circles.length === 0 ? (
          <div className="cx-empty cx-empty-hero rise">
            <EmptyArt kind="circles" />
            <span className="display" style={{ fontSize: 30 }}>Your people, in one place.</span>
            <span className="small">Make a circle for the people you travel with. Plan together, vote on dates and split the costs.</span>
            <div className="chips" style={{ justifyContent: 'center' }}>
              {['Family', 'Eid trip', 'Weekend crew', 'Cousins'].map((t) => <button key={t} type="button" className="chip" onClick={() => push('newCircle', { name: t })}>{t}</button>)}
            </div>
            <button type="button" className="btn primary small" onClick={() => push('newCircle')}>Make your first circle</button>
          </div>
        ) : (
        <div className="chips scrollx" style={{ gap: 10 }}>
          {circles.map((g) => {
            const line = lastLine(g, getThread(s, g.id));
            return g.img ? (
              <button key={g.id} type="button" className="photo cx-tile" onClick={() => push('group', { id: g.id })}>
                <img src={g.img} alt="" /><span className="cx-veil" />
                {g.unread > 0 && <span className="pill gold" style={{ position: 'absolute', top: 10, left: 10 }}>{g.unread} new</span>}
                {g.muted && <span className="pill glass" style={{ position: 'absolute', top: 10, right: 10 }}>Muted</span>}
                <span className="over" style={{ textAlign: 'left', gap: 2 }}><span className="display" style={{ fontSize: 22, color: '#fffdf9' }}>{g.name}</span><span className="tiny cx-line" style={{ color: 'rgba(255,253,249,.92)' }}>{line}</span></span>
              </button>
            ) : (
              <button key={g.id} type="button" className="card tap cx-tile plain" onClick={() => push('group', { id: g.id })}>
                <span className="spread" style={{ width: '100%' }}>
                  <span className="stack">{g.members.slice(0, 3).map((m) => <PAvatar key={m} id={m} size={30} ring="#fffdf9" />)}</span>
                  {g.unread > 0 && <span className="pill gold">{g.unread} new</span>}
                </span>
                <span className="col" style={{ gap: 0, minWidth: 0, width: '100%' }}><span className="h3" style={{ fontSize: 15 }}>{g.name}</span><span className="tiny cx-line">{line}</span></span>
              </button>
            );
          })}
          <button type="button" className="new-tile" onClick={() => push('newCircle')}><Icon name="plus" />New circle</button>
        </div>
        )}

        <div className="spread"><h2 className="h2">Friends</h2>{friends.length > 0 && <button type="button" className="link" onClick={() => push('people')}>{(s.friendRequests || []).length ? `${s.friendRequests.length} request · See all` : 'See all'}</button>}</div>
        {friends.length === 0 ? (
          <div className="cx-empty row-empty">
            <EmptyArt kind="friends" />
            <span className="col" style={{ gap: 4, alignItems: 'flex-start', textAlign: 'left' }}>
              <span className="h3">Bring your people.</span>
              <span className="small">Add the friends you travel with. Only they see your trips and tips.</span>
              <span className="row" style={{ gap: 8, marginTop: 6 }}>
                <button type="button" className="btn primary small" onClick={() => push('people', { add: true })}>Add friends</button>
                {(s.friendRequests || []).length > 0 && <button type="button" className="btn secondary small" onClick={() => push('people', { tab: 'requests' })}>{s.friendRequests.length} request</button>}
              </span>
            </span>
          </div>
        ) : (
        <div className="chips scrollx" style={{ gap: 14 }}>
          {friends.map((id) => (
            <button key={id} type="button" className="friend-chip" onClick={() => push('friend', { id })}>
              <span style={{ position: 'relative' }}><PAvatar id={id} size={56} />{FRIENDS[id]?.going && <span className="going-dot" aria-hidden="true" />}</span>
              <span className="tiny" style={{ fontWeight: 600, color: '#1e352d' }}>{person(id).short}</span>
            </button>
          ))}
          <button type="button" className="friend-chip" onClick={() => push('people', { tab: 'invited' })}>
            <span className="avatar" style={{ width: 56, height: 56, background: 'transparent', border: '1.5px dashed #b98f4a', color: '#7d5d27' }}><Icon name="plus" /></span>
            <span className="tiny" style={{ fontWeight: 600, color: '#1e352d' }}>Invited</span>
          </button>
        </div>
        )}

        {(friends.length > 0 || known.length > 0) && (<>
          <div className="spread"><h2 className="h2">From people you know</h2><span className="tiny">Newest first</span></div>
          {known.length === 0 && <div className="card well"><span className="h3">Nothing from friends yet.</span><span className="small">When friends post tips, they show here first.</span></div>}
          {known.map((p) => (
            <button key={p.id} type="button" className="card tap" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }} onClick={() => setOpenPost(p.id)}>
              {p.img ? <img src={p.img} alt="" style={{ width: 64, height: 64, borderRadius: 14, objectFit: 'cover', flexShrink: 0 }} /> : <span className={'avatar' + (p.tone ? ' ' + p.tone : '')} style={{ width: 64, height: 64, borderRadius: 14, fontSize: 24 }}>{p.initial}</span>}
              <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                <span className="tiny"><b style={{ color: '#1e352d' }}>{p.who}</b> · {p.city} · {p.when || 'Just now'}{p.pending ? ' · being checked' : ''}</span>
                <span className="h3" style={{ fontSize: 15 }}>{p.place}</span>
                <span className="small" style={{ color: '#3f4f48', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.text}</span>
              </span>
            </button>
          ))}
        </>)}

        <div className="spread"><h2 className="h2">Saved</h2>{savedCount > 0 && <button type="button" className="link" onClick={() => push('saved')}>See all</button>}</div>
        {savedCount === 0 ? (
          <div className="cx-empty row-empty">
            <EmptyArt kind="saved" />
            <span className="col" style={{ gap: 4, alignItems: 'flex-start', textAlign: 'left' }}>
              <span className="h3">Nothing saved yet.</span>
              <span className="small">Tap the bookmark on any tip or plan in Discover. It lands here, sorted by city.</span>
              <button type="button" className="link" style={{ padding: '6px 0' }} onClick={() => { setView('discover'); buzz(HAPTIC.select); }}>Look around Discover</button>
            </span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 }}>
            {[...new Set((s.savedPosts || []).map((p) => p.city))].map((cty) => {
              const n = s.savedPosts.filter((p) => p.city === cty).length;
              return (
                <button key={cty} type="button" className="photo" style={{ height: 112, border: 0, padding: 0 }} onClick={() => push('saved', { city: cty })}>
                  <img src={cty === 'Riyadh' ? 'img/riyadh.jpg' : cty === 'AlUla' ? 'img/alula.jpg' : 'img/istanbul.jpg'} alt="" /><span className="cx-veil" />
                  <span className="over" style={{ textAlign: 'left', gap: 0, padding: 12 }}><span className="h3" style={{ fontSize: 15, color: '#fffdf9' }}>{cty}</span><span className="tiny" style={{ color: 'rgba(255,253,249,.9)' }}>{n} {n === 1 ? 'place' : 'places'}</span></span>
                </button>
              );
            })}
            {(s.savedPlans || []).filter((id) => PLANS[id]).map((id) => (
              <button key={id} type="button" className="photo" style={{ height: 112, border: 0, padding: 0 }} onClick={() => push('plan', { id })}>
                <img src={PLANS[id].img} alt="" /><span className="cx-veil" />
                <span className="over" style={{ textAlign: 'left', gap: 0, padding: 12 }}><span className="h3" style={{ fontSize: 14, color: '#fffdf9' }}>{PLANS[id].title}</span><span className="tiny" style={{ color: 'rgba(255,253,249,.9)' }}>Plan · {PLANS[id].days} days</span></span>
              </button>
            ))}
          </div>
        )}

        <div className="spread"><h2 className="h2">Your passport</h2><span className="tiny">{stamps.length ? ((s.stamps || []).length ? `${s.stamps.length} countries` : '14 countries · 9 Saudi places') : 'No stamps yet'}</span></div>
        {stamps.length === 0 ? (
          <div className="cx-passport" aria-label="An empty passport page">
            <Sun width={150} color="rgba(185,143,74,.1)" className="cx-watermark" />
            <div className="cx-passport-head"><span className="eyebrow" style={{ color: '#7d5d27' }}>Visas · Stamps</span><Sun width={26} color="#d9b77a" /></div>
            <div className="cx-stamp-row">
              {s.trip ? (
                <span className="cx-stamp soon" style={{ transform: 'rotate(-7deg)' }}><span><b>{s.trip.city || 'Istanbul'}</b><i>SOON</i></span></span>
              ) : <span className="cx-stamp ghost" style={{ transform: 'rotate(-7deg)' }} />}
              <span className="cx-stamp ghost" style={{ transform: 'rotate(5deg)' }} />
              <span className="cx-stamp ghost" style={{ transform: 'rotate(-3deg)' }} />
            </div>
            <span className="h3" style={{ fontSize: 15 }}>{s.trip ? `Your first stamp lands when you’re home from ${s.trip.city || 'Istanbul'}.` : 'Every trip home adds a stamp.'}</span>
            <span className="small">{s.trip ? 'It fills in by itself. Nothing to do.' : 'Book your first trip and this page starts to fill.'}</span>
            {!s.trip && <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => push('ask', {})}>Plan a trip</button>}
          </div>
        ) : (
        <div className="card" style={{ gap: 14 }}>
          <div className="chips scrollx" style={{ gap: 12, padding: '4px 18px', margin: '0 -16px' }}>
            {stamps.map((st) => (
              <button key={st.city} type="button" aria-label={`${st.city} stamp${st.upcoming ? ', after this trip' : ''}`} onClick={() => { setPressed(pressed === st.city ? null : st.city); buzz([0, 10, 40, 10, 40, 10]); }}
                style={{ flexShrink: 0, width: 76, height: 76, borderRadius: 999, border: `2px ${st.upcoming ? 'dashed' : 'solid'} ${st.color}`, background: 'transparent', padding: 0, display: 'grid', placeItems: 'center', color: st.color, opacity: st.upcoming ? 0.55 : 1, transform: `rotate(${pressed === st.city ? 0 : st.rot}deg) scale(${pressed === st.city ? 1.12 : 1})`, transition: 'transform .35s var(--spring)' }}>
                <span style={{ width: 64, height: 64, borderRadius: 999, border: `1px dashed ${st.color}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                  <span style={{ fontFamily: 'var(--f-display)', fontSize: 15 }}>{st.city}</span>
                  <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.08em' }}>{st.upcoming ? 'SOON' : st.date}</span>
                </span>
              </button>
            ))}
          </div>
          {friends.includes('abdullah') && (
            <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <span className="stack"><span className="avatar sm green" style={{ borderColor: '#fffdf9' }}>A</span><span className="avatar sm gold" style={{ borderColor: '#fffdf9' }}>N</span><span className="avatar sm" style={{ borderColor: '#fffdf9' }}>O</span></span>
              <span className="small grow" style={{ color: '#3f4f48' }}>You're 2nd among friends for places explored. Abdullah leads with 19.</span>
            </div>
          )}
        </div>
        )}
        </>)}
      </div>

      {sheet === 'post' && <PostSheet onClose={() => setSheet(null)} onPost={(post) => { setPosts([post, ...posts]); setSheet(null); setView('discover'); buzz(HAPTIC.success); toast('Posted to ' + (post.audience === 'friends' ? 'your friends' : 'everyone on Mada') + '. It shows once it’s checked, usually within a minute.'); }} />}
      {sheet === 'around' && (
        <Sheet label="Who can see you" onClose={() => setSheet(null)}>
          <h2 className="h2">Who can see you're in {city}?</h2>
          <p className="small">City only. Never a map, a hotel or a live location. It turns off by itself when you fly home.</p>
          {[['picked', 'Friends I pick', 'Abdullah and Noor'], ['close', 'Close friends', '4 people'], ['family', 'Family only', 'Hessa, Sara, Ahmed']].map(([id, t, sub]) => (
            <button key={id} type="button" className={'card tap well' + (who === id ? ' selected' : '')} onClick={() => { setWho(id); buzz(HAPTIC.select); }}>
              <span className="h3" style={{ fontSize: 15 }}>{t}</span><span className="tiny">{sub}</span>
            </button>
          ))}
          <button type="button" className="btn primary block" onClick={() => { setC({ around: true, aroundWho: who }); setSheet(null); buzz(HAPTIC.success); }}>Turn on</button>
        </Sheet>
      )}
      {sheet === 'noor' && (
        <Sheet label="Noor" onClose={() => setSheet(null)}>
          <h2 className="h2">Noor</h2>
          <button type="button" className="card tap well" onClick={() => { setC({ hidden: [...c.hidden, 'noor'] }); setSheet(null); toast('Hidden. You won’t see Noor here, and she isn’t told.'); }}><span className="h3" style={{ fontSize: 15 }}>Don't show me Noor here</span><span className="tiny">She isn't told.</span></button>
          <button type="button" className="card tap well" onClick={() => setSheet('report')}><span className="h3" style={{ fontSize: 15, color: '#8a3524' }}>Report</span><span className="tiny">A person reviews every report.</span></button>
          <button type="button" className="btn ghost block" onClick={() => setSheet(null)}>Cancel</button>
        </Sheet>
      )}
      {sheet === 'report' && (
        <Sheet label="Report" onClose={() => setSheet(null)}>
          <h2 className="h2">What's wrong?</h2>
          <div className="chips">{['Unwanted messages', 'Not who they say', 'Something unsafe', 'Something else'].map((r) => <button key={r} type="button" className="chip" aria-pressed={reason === r ? 'true' : 'false'} onClick={() => setReason(r)}>{r}</button>)}</div>
          <button type="button" className="btn primary block" disabled={!reason} onClick={() => { setC({ reported: [...c.reported, 'noor'], hidden: [...c.hidden, 'noor'] }); setSheet(null); buzz(HAPTIC.success); toast('Thanks. A person will look at this within 24 hours.'); }}>Send report</button>
        </Sheet>
      )}
      {op && <PostDetail post={op} saved={isSaved(op.id)} onSave={() => toggleSave(op)} onClose={() => setOpenPost(null)} onDelete={(id) => { setPosts(posts.filter((p) => p.id !== id)); setOpenPost(null); }} />}
    </div>
  );
}

/* ---------- one circle: the chat, with votes, splits, shared plans and Mada ---------- */

export function Group({ params = {} }) {
  const { s, set, pop, push, replace, toast } = useStore();
  useCircleClock();
  const group = s.groups.find((g) => g.id === (params.id || 'eid'));
  const gid = group?.id;
  const thread = getThread(s, gid) || { msgs: [] };
  const [info, setInfo] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [draft, setDraft] = useState('');
  const scroller = useRef(null);
  const input = useRef(null);
  const run = (...ops) => set((st) => fold(st, ops));
  const queue = s.circleQueue || [];
  const soon = queue.filter((e) => e.gid === gid && e.type === 'msg');
  const [, tick] = useState(0);
  const waiting = soon.length > 0;
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 400);
    return () => clearInterval(t);
  }, [waiting]);

  useEffect(() => {
    if (!gid) return undefined;
    setOpenCircle(gid);
    set((st) => fold(st, [opGroup(gid, (g) => (g.unread ? { ...g, unread: 0 } : g)), getThread(st, gid) ? opThread(gid, (t) => ({ ...t, opened: true })) : null]));
    /* A first look at a circle you just joined starts at the top: the trip, then the story so far. */
    const el = scroller.current;
    if (el && !holdTop.current) el.scrollTop = el.scrollHeight;
    return () => setOpenCircle(null);
  }, [gid]);
  const count = thread.msgs.length;
  const firstRender = useRef(true);
  /* Someone who just joined by link sees the trip first, not the bottom of the chat. */
  const holdTop = useRef(!!group && group.via === 'invite' && !(getThread(s, gid) || {}).opened);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (holdTop.current) { holdTop.current = false; scroller.current && (scroller.current.scrollTop = 0); return; }
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [count]);

  /* Back from paying a share: mark it paid. */
  useEffect(() => {
    const cp = s.circlePay;
    if (!cp || cp.gid !== gid || !s.circles?.sharePaid) return;
    run(opMsg(gid, cp.mid, (m) => markPaid(m, cp.key)), opAdd(gid, sys(`You paid your share · SAR ${fmt(cp.amount)}`)), () => ({ circlePay: null }));
  }, [s.circles?.sharePaid, s.circlePay]);

  if (!group) return (
    <div className="screen push"><TopBar onBack={pop} backLabel="Circles" />
      <div className="scroll no-dock">
        {params.id ? (<>
          <h1 className="h1">This circle is gone.</h1>
          <p className="body">You left it, or the admin deleted it. Bookings you made are still in Trips.</p>
        </>) : (
          <div className="cx-empty cx-empty-hero">
            <EmptyArt kind="circles" />
            <span className="display" style={{ fontSize: 30 }}>No trip circle yet.</span>
            <span className="small">Make one for the people going with you. Plan, vote and split costs together.</span>
            <button type="button" className="btn primary small" onClick={() => replace('newCircle', { name: 'Eid trip' })}>Make a circle</button>
          </div>
        )}
      </div>
    </div>
  );

  const invited = group.invited || [];
  const others = group.members.filter((m) => m !== 'omar');
  const dest = circleDest(group);
  const admin = group.admin === 'omar';

  const send = (text) => {
    const v = (text ?? draft).trim();
    if (!v) return;
    const mid = newId();
    const plan = planResponses(group, v, mid, thread);
    run(opAdd(gid, { id: mid, t: 'text', who: 'omar', text: v }), opQueue(plan));
    setDraft('');
    buzz(HAPTIC.tap);
  };
  const askMada = () => { setSheet(null); setDraft('@Mada '); setTimeout(() => input.current && input.current.focus(), 60); };

  const postVote = ({ q, kind, options }) => {
    const mid = newId();
    const opts = options.map((label, i) => ({ id: 'o' + i, label, votes: [] }));
    run(opAdd(gid, { id: mid, t: 'vote', who: 'omar', vote: { q, kind, options: opts, closed: false } }), opQueue(planVotes(group, mid, opts)));
    setSheet(null); buzz(HAPTIC.success);
  };
  const castVote = (m, opt) => {
    if (m.vote.closed) return;
    buzz(HAPTIC.select);
    run(opMsg(gid, m.id, (x) => {
      const mineNow = x.vote.options.find((o) => o.votes.includes('omar'));
      return { ...x, vote: { ...x.vote, options: x.vote.options.map((o) => ({ ...o, votes: o.id === opt && mineNow?.id !== opt ? [...o.votes, 'omar'] : o.votes.filter((v) => v !== 'omar') })) } };
    }));
  };
  const bookPrefill = (v, w) => (v.kind === 'places' ? `Plan a trip to ${w.label} for ${group.members.length}` : `${v.q.replace(/\?$/, '')}: ${w.label}${dest ? ' · ' + dest : ''}`);
  const result = (m, w) => ({ t: 'mada', who: 'mada', kind: 'result', ref: m.id, text: `${phrase(w.label)} it is. Want us to book it?`, actions: [m.id === 'eid-vote' ? { label: 'Book it', hold: true } : { label: 'Book it', ask: bookPrefill(m.vote, w) }, { label: 'Not now', dismiss: true }] });
  const closeVote = (m) => {
    const max = Math.max(...m.vote.options.map((o) => o.votes.length));
    const top = m.vote.options.filter((o) => o.votes.length === max);
    const w = top.length === 1 ? top[0] : null;
    buzz(HAPTIC.success);
    run(opMsg(gid, m.id, (x) => ({ ...x, vote: { ...x.vote, closed: true, winner: w?.id || null } })),
      opAdd(gid, w ? result(m, w) : { t: 'mada', who: 'mada', kind: 'tie', ref: m.id, text: `It’s a tie between ${top.map((o) => o.label).join(' and ')}. Pick one and we’ll take it from there.`, actions: top.map((o) => ({ label: o.label, pick: o.id })) }));
  };
  const pick = (tie, optId) => {
    const vm = thread.msgs.find((x) => x.id === tie.ref);
    const w = vm.vote.options.find((o) => o.id === optId);
    run(opMsg(gid, vm.id, (x) => ({ ...x, vote: { ...x.vote, winner: optId } })), opMsg(gid, tie.id, (x) => ({ ...x, done: true })), opAdd(gid, result(vm, w)));
  };

  const postSplit = (split) => {
    const mid = newId();
    const firstOwing = split.shares.find((sh) => !sh.paid);
    run(opAdd(gid, { id: mid, t: 'split', who: 'omar', split }), split.paidBy === 'omar' && firstOwing ? opQueue({ at: Date.now() + 6000, gid, type: 'paid', mid, key: firstOwing.key }) : null);
    setSheet(null); buzz(HAPTIC.success);
  };
  const bookCruise = () => {
    const hold = thread.msgs.find((x) => x.kind === 'hold');
    if (!hold || hold.booked) return;
    const units = shareUnits('family', group.members);
    const amounts = equalAmounts(1140, units.length);
    const shares = units.map((u, i) => ({ ...u, amount: amounts[i], paid: u.ids.includes('omar') }));
    const mid = newId();
    const owing = shares.find((sh) => !sh.paid);
    buzz(HAPTIC.success);
    run(opMsg(gid, hold.id, (x) => ({ ...x, booked: true })),
      ...thread.msgs.filter((x) => x.kind === 'result' && x.ref === 'eid-vote').map((x) => opMsg(gid, x.id, (y) => ({ ...y, done: true, text: y.text.replace(' Want us to book it?', ' Faisal has booked it.') }))),
      opAdd(gid, { id: mid, t: 'split', who: 'omar', split: { what: 'Bosphorus dinner cruise', total: 1140, paidBy: 'omar', mode: 'family', shares, settled: false } }),
      owing ? opQueue({ at: Date.now() + 6000, gid, type: 'paid', mid, key: owing.key }) : null);
  };
  const payShare = (m, sh) => {
    set((p) => ({ circlePay: { gid, mid: m.id, key: sh.key, amount: sh.amount }, circles: { ...p.circles, sharePaid: false } }));
    push('pay', { kind: 'share', amount: sh.amount, title: m.split.what, circle: group.name, payee: person(m.split.paidBy).short });
  };
  const remind = (m) => {
    const owing = m.split.shares.filter((sh) => !sh.paid && !sh.ids.includes('omar'));
    run(opMsg(gid, m.id, (x) => ({ ...x, split: { ...x.split, reminded: true } })), opAdd(gid, sys(`You reminded ${owing.map((sh) => sh.label).join(' and ')}`)),
      owing[0] ? opQueue({ at: Date.now() + 4000, gid, type: 'paid', mid: m.id, key: owing[0].key }) : null);
    toast(`Reminder sent to ${owing.map((sh) => sh.label).join(' and ')}.`);
  };
  const markShare = (m, sh) => { buzz(HAPTIC.select); run(opMsg(gid, m.id, (x) => markPaid(x, sh.key)), opAdd(gid, sys(sh.ids.includes('omar') ? `You marked your share as paid · SAR ${fmt(sh.amount)}` : `You marked ${sh.label} as paid`))); };

  const shareCard = (card, pin) => {
    run(opAdd(gid, { t: 'card', who: 'omar', card }), pin && card.kind === 'plan' ? opThread(gid, (t) => ({ ...t, pinned: { kind: 'plan', id: card.id, by: 'omar' } })) : null,
      pin && card.kind === 'plan' ? opAdd(gid, sys(`You pinned ${PLANS[card.id].title}`)) : null);
    setSheet(null); buzz(HAPTIC.success);
  };

  const act = (m, a) => {
    buzz(HAPTIC.tap);
    if (a.ask) push('ask', { prefill: a.ask });
    else if (a.plan) push('plan', { id: a.plan });
    else if (a.say) send(a.say);
    else if (a.pick) pick(m, a.pick);
    else if (a.hold) bookCruise();
    else if (a.dismiss) run(opMsg(gid, m.id, (x) => ({ ...x, done: true })));
  };

  /* One pinned line, never a stack: an open vote first, then a pinned plan. */
  const openVote = [...thread.msgs].reverse().find((m) => m.t === 'vote' && !m.vote.closed);
  const pinned = openVote ? { kind: 'vote', m: openVote } : thread.pinned && PLANS[thread.pinned.id] ? { kind: 'plan', id: thread.pinned.id } : null;
  const jump = (id) => { const el = document.getElementById('msg-' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); };

  const typingEv = soon.find((e) => e.at - Date.now() < 1900);
  const lastMine = [...thread.msgs].reverse().find((m) => m.who === 'omar' && m.t === 'text');
  const voters = (m) => m.vote.options.reduce((a, o) => a + o.votes.length, 0);

  const faces = (
    <button type="button" className={'cx-faces' + (group.img ? ' on-photo' : '')} aria-label={`${group.name} settings and people`} onClick={() => setInfo(true)}>
      <span className="stack">{group.members.slice(0, 3).map((m) => <PAvatar key={m} id={m} size={28} ring={group.img ? 'rgba(15,26,22,.6)' : '#e9e2d8'} />)}</span>
      {group.members.length > 3 && <span className="cx-more">+{group.members.length - 3}</span>}
    </button>
  );

  return (
    <div className="screen push">
      {group.dm ? (
        <TopBar onBack={pop} backLabel="Circles" title={group.name} right={faces} />
      ) : (
        <div className={'cx-head' + (group.img ? ' photo-head' : '')}>
          {group.img && <><img src={group.img} alt="" className="cx-head-bg" /><span className="cx-head-veil" /></>}
          <div style={{ position: 'relative', zIndex: 1 }}><TopBar onBack={pop} backLabel="Circles" dark={!!group.img} right={faces} /></div>
          <div className="cx-head-text">
            <h1 className="display">{group.name}</h1>
            <span className="cx-head-sub">{[dest && group.trip ? group.trip.replace('Somewhere new', dest) : dest || null, `${group.members.length} ${group.members.length === 1 ? 'person' : 'people'}`, invited.length ? `${invited.length} invited` : null, group.muted ? 'muted' : null].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
      )}
      {pinned && (
        <button type="button" className="cx-pin" onClick={() => (pinned.kind === 'vote' ? jump(pinned.m.id) : push('plan', { id: pinned.id }))}>
          <span className="cx-pin-ic" aria-hidden="true">{pinned.kind === 'vote' ? <VoteIcon /> : <Icon name="pin" size={16} />}</span>
          <span className="grow col" style={{ gap: 0, minWidth: 0 }}>
            <span className="cx-pin-k">{pinned.kind === 'vote' ? 'Open vote' : 'Pinned plan'}</span>
            <span className="cx-pin-t">{pinned.kind === 'vote' ? `${pinned.m.vote.q} · ${voters(pinned.m)} of ${group.members.length} voted` : PLANS[pinned.id].title}</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}
      <div className="scroll no-dock cx-thread" ref={scroller}>
        {thread.trip && <TripCard trip={thread.trip} group={group} />}
        {thread.msgs.map((m, i) => {
          const prev = thread.msgs[i - 1];
          const cont = prev && prev.who === m.who && prev.t !== 'sys' && m.t === 'text' && prev.t === 'text';
          const key = 'msg-' + m.id;
          if (m.t === 'sys') return <div key={m.id} id={key} className="cx-sys">{m.text}</div>;
          if (m.t === 'vote') return (
            <Bubble key={m.id} id={key} who={m.who} wide label={`${m.who === 'omar' ? 'You' : person(m.who).short} started a vote`}>
              <VoteCard m={m} group={group} canClose={m.who === 'omar' || admin} onVote={(o) => castVote(m, o)} onClose={() => closeVote(m)} />
            </Bubble>
          );
          if (m.t === 'split') return (
            <Bubble key={m.id} id={key} who={m.who} wide label={`${m.who === 'omar' ? 'You' : person(m.who).short} split a cost`}>
              <SplitCard m={m} onPay={(sh) => payShare(m, sh)} onRemind={() => remind(m)} onMark={(sh) => markShare(m, sh)} />
            </Bubble>
          );
          if (m.t === 'card') return (
            <Bubble key={m.id} id={key} who={m.who} wide label={`${m.who === 'omar' ? 'You' : person(m.who).short} shared ${m.card.kind === 'plan' ? 'a plan' : 'a place'}`}>
              <ShareCard card={m.card} group={group} pinned={thread.pinned?.id === m.card.id} onPin={() => run(opThread(gid, (t) => ({ ...t, pinned: { kind: 'plan', id: m.card.id, by: 'omar' } })), opAdd(gid, sys(`You pinned ${PLANS[m.card.id].title}`)))} />
            </Bubble>
          );
          if (m.t === 'faisal') {
            const vm = thread.msgs.find((x) => x.id === 'eid-vote');
            const lead = vm && (vm.vote.options.find((o) => o.id === vm.vote.winner) || [...vm.vote.options].sort((a, b) => b.votes.length - a.votes.length)[0]);
            const day = lead ? phrase(lead.label) : 'Wednesday';
            return (
              <Bubble key={m.id} id={key} who="faisal">
                <span>I’m holding 6 seats on the {day} cruise at 19:30 until Monday. SAR 1,140 for everyone.</span>
                {m.booked ? <span className="row tiny cx-ok"><Icon name="check" size={16} color="#2f7a4b" width={2.4} />Confirmed by Faisal at Mada</span>
                  : <button type="button" className="btn gold small" style={{ alignSelf: 'flex-start' }} onClick={bookCruise}>Book it</button>}
              </Bubble>
            );
          }
          if (m.t === 'mada') {
            if (m.kind === 'welcome') return (
              <Bubble key={m.id} id={key} who="mada">
                <span>{others.length ? `This is ${group.name}. Plan here, vote on choices and split costs. Type @Mada to ask us anything. Faisal confirms anything you book.`
                  : invited.length ? `This is ${group.name}. ${names(invited.map((x) => x.id))} ${invited.length === 1 ? 'is' : 'are'} invited. Start planning while you wait.`
                    : `This is ${group.name}. It’s just you so far. Share the link and people join when they open it.`}</span>
                <span className="cx-actions">
                  {!others.length && !invited.length && <button type="button" className="btn primary small" onClick={() => setInfo(true)}>Invite people</button>}
                  <button type="button" className="btn secondary small" onClick={() => send(`@Mada ideas for ${dest || 'a trip'}`)}>Ideas for {dest || 'a trip'}</button>
                  <button type="button" className="btn secondary small" onClick={() => setSheet('vote')}>Start a vote</button>
                  {others.length > 0 && <button type="button" className="btn secondary small" onClick={() => setSheet('split')}>Split a cost</button>}
                </span>
              </Bubble>
            );
            if (m.kind === 'van') return (
              <Bubble key={m.id} id={key} who="mada">
                <span>{m.text}</span>
                {m.choice ? <span className="row tiny cx-ok"><Icon name="check" size={16} color="#2f7a4b" width={2.4} />{m.choice === 'one' ? 'One van for both families' : 'Two cars, one for each family'}</span> : (
                  <span className="cx-actions"><button type="button" className="btn primary small" onClick={() => { run(opMsg(gid, m.id, (x) => ({ ...x, choice: 'one' }))); buzz(HAPTIC.select); }}>Keep one van</button><button type="button" className="btn secondary small" onClick={() => { run(opMsg(gid, m.id, (x) => ({ ...x, choice: 'two' }))); buzz(HAPTIC.select); }}>Separate cars</button></span>
                )}
              </Bubble>
            );
            return (
              <Bubble key={m.id} id={key} who="mada">
                <span>{m.text}</span>
                {m.list && <ol className="cx-list">{m.list.map((l) => <li key={l}>{l}</li>)}</ol>}
                {m.foot && <span className="tiny">{m.foot}</span>}
                {!m.done && m.actions && m.actions.length > 0 && (
                  <span className="cx-actions">{m.actions.map((a, j) => <button key={a.label} type="button" className={'btn small ' + (j === 0 && !a.say ? 'primary' : 'secondary')} onClick={() => act(m, a)}>{a.label}</button>)}</span>
                )}
              </Bubble>
            );
          }
          /* Read receipts under your last message, until someone answers. */
          const seen = m === lastMine && (m.seen || []).length > 0 && !thread.msgs.slice(i + 1).some((x) => x.t !== 'sys' && x.who !== 'omar' && x.who !== 'mada');
          return (
            <React.Fragment key={m.id}>
              <Bubble id={key} who={m.who} cont={cont}>{m.text}</Bubble>
              {seen && <span className="cx-seen">{group.dm ? 'Seen' : `Seen by ${names(m.seen)}`}</span>}
            </React.Fragment>
          );
        })}
        {typingEv && <span className="cx-typing rise"><span className="dots" aria-hidden="true"><i /><i /><i /></span>{typingEv.who === 'mada' ? 'Mada is looking into it' : `${person(typingEv.who).short} is typing`}</span>}
      </div>
      <form className="cx-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {!group.dm && <button type="button" className="cx-plus" aria-label="Circle tools: vote, split, share, ask Mada" onClick={() => setSheet('tools')}><Icon name="plus" size={20} /></button>}
        <label htmlFor="msg" className="cx-sr">Message the group</label>
        <input id="msg" ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={group.dm ? `Message ${group.name}` : 'Message, or @Mada'} autoComplete="off" />
        <button type="submit" className="icon-btn dark" aria-label="Send" style={{ width: 40, height: 40 }}><Icon name="up" color="#f6f2ec" size={18} /></button>
      </form>
      {sheet === 'tools' && (
        <Sheet label="Add to the circle" onClose={() => setSheet(null)}>
          <h2 className="h2">Add to the circle</h2>
          {[
            ['vote', <VoteIcon key="i" />, 'Start a vote', 'Dates, places, anything. Everyone taps once.'],
            ['split', <Icon key="i" name="card" size={20} />, 'Split a cost', others.length ? 'Who paid, who owes. Pay your share here.' : 'Works once someone joins.'],
            ['share', <Icon key="i" name="pin" size={20} />, 'Share a plan or place', 'From our plans and your saves.'],
            ['ask', <Sun key="i" width={24} color="#b98f4a" />, 'Ask Mada', dest ? `Ideas, flights, stays and visas for ${dest}.` : 'Ideas, flights, stays and visas.'],
          ].map(([id, ic, t, sub]) => (
            <button key={id} type="button" className="cx-tool" disabled={id === 'split' && !others.length} onClick={() => (id === 'ask' ? askMada() : setSheet(id))}>
              <span className="cx-tool-ic">{ic}</span>
              <span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{t}</span><span className="tiny">{sub}</span></span>
              <Icon name="chevron" size={18} />
            </button>
          ))}
        </Sheet>
      )}
      {sheet === 'vote' && <VoteSheet dest={dest} onClose={() => setSheet(null)} onPost={postVote} />}
      {sheet === 'split' && <SplitSheet group={group} onClose={() => setSheet(null)} onPost={postSplit} />}
      {sheet === 'share' && <ShareSheet onClose={() => setSheet(null)} onPick={shareCard} />}
      {info && <GroupInfo group={group} onClose={() => setInfo(false)} />}
    </div>
  );
}

const VoteIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h10M4 12h16M4 18h7" /><path d="M17 4.5l1.5 1.5 3-3" /></svg>
);

function Bubble({ id, who, cont, wide, label, children }) {
  const mine = who === 'omar';
  const p = who === 'mada' ? { short: 'Mada' } : who === 'faisal' ? { short: 'Faisal · your Mada agent', initial: 'F', tone: 'green' } : person(who);
  const face = who === 'mada' ? <span className="avatar sm green"><Sun width={18} /></span> : who === 'faisal' ? <span className="avatar sm green">F</span> : <PAvatar id={who} size={32} />;
  return (
    <div id={id} className={'cx-row rise' + (mine ? ' mine' : '') + (cont ? ' cont' : '') + (wide ? ' wide' : '')}>
      {!mine && <span className="cx-face">{cont ? null : face}</span>}
      <div className={'cx-bubble' + (who === 'mada' ? ' mada' : '') + (wide ? ' bare' : '')}>
        {!cont && !mine && !wide && <span className="cx-name">{p.short}</span>}
        {wide && <span className="cx-name">{label}</span>}
        {children}
      </div>
    </div>
  );
}

function VoteCard({ m, group, canClose, onVote, onClose }) {
  const v = m.vote;
  const total = v.options.reduce((a, o) => a + o.votes.length, 0);
  const mine = v.options.find((o) => o.votes.includes('omar'));
  return (
    <div className={'cx-card cx-vote' + (v.closed ? ' closed' : '')}>
      <span className="h3" style={{ fontSize: 16 }}>{v.q}</span>
      {v.options.map((o) => {
        const pct = total ? Math.round((o.votes.length / total) * 100) : 0;
        const won = v.closed && v.winner === o.id;
        return (
          <button key={o.id} type="button" className={'cx-opt' + (mine?.id === o.id ? ' on' : '') + (won ? ' won' : '')} aria-pressed={mine?.id === o.id ? 'true' : 'false'} disabled={v.closed} onClick={() => onVote(o.id)} aria-label={`${o.label}, ${o.votes.length} ${o.votes.length === 1 ? 'vote' : 'votes'}`}>
            <span className="cx-fill" style={{ width: pct + '%' }} />
            <span className="cx-opt-row">
              <span className="row" style={{ gap: 8, minWidth: 0 }}>{won && <Icon name="check" size={16} width={2.6} />}<span className="cx-opt-l">{o.label}</span></span>
              <span className="row" style={{ gap: 8 }}>
                <span className="stack cx-voters">{o.votes.slice(0, 3).map((id) => <PAvatar key={id} id={id} size={20} ring="#fffdf9" />)}</span>
                <span className="num cx-n">{o.votes.length}</span>
              </span>
            </span>
          </button>
        );
      })}
      <span className="spread">
        <span className="tiny">{v.closed ? (v.winner ? `Closed · ${v.options.find((o) => o.id === v.winner)?.label} won` : 'Closed · a tie') : `${total} of ${group.members.length} voted${mine ? ' · you picked ' + mine.label : ''}`}</span>
        {!v.closed && canClose && <button type="button" className="link" style={{ fontSize: 13 }} disabled={!total} onClick={onClose}>Close vote</button>}
      </span>
    </div>
  );
}

function SplitCard({ m, onPay, onRemind, onMark }) {
  const sp = m.split;
  const iPaid = sp.paidBy === 'omar';
  const owing = sp.shares.filter((sh) => !sh.paid && !sh.ids.includes('omar'));
  return (
    <div className={'cx-card cx-split' + (sp.settled ? ' settled' : '')}>
      <span className="spread" style={{ alignItems: 'flex-start' }}>
        <span className="col" style={{ gap: 2 }}>
          <span className="h3" style={{ fontSize: 16 }}>{sp.what}</span>
          <span className="tiny">Paid by {iPaid ? 'you' : person(sp.paidBy).short} · {sp.mode === 'family' ? 'split by family' : sp.mode === 'custom' ? 'custom amounts' : 'split equally'}</span>
        </span>
        <span className="col" style={{ gap: 2, alignItems: 'flex-end' }}>
          <span className="num cx-amt">SAR {fmt(sp.total)}</span>
          {sp.settled && <span className="pill ok">Settled</span>}
        </span>
      </span>
      <div className="cx-shares">
        {sp.shares.map((sh) => {
          const me = sh.ids.includes('omar');
          return (
            <div key={sh.key} className={'cx-share' + (sh.paid ? ' paid' : '')}>
              <span className="stack">{sh.ids.slice(0, 2).map((id) => <PAvatar key={id} id={id} size={26} ring="#fffdf9" />)}</span>
              <span className="grow col" style={{ gap: 0, minWidth: 0 }}>
                <span className="cx-share-l wrap">{sh.label}</span>
                <span className="tiny">{sh.paid ? (sh.ids.includes(sp.paidBy) ? 'Paid the bill' : 'Paid') : me ? 'Your share' : 'Owes ' + (iPaid ? 'you' : person(sp.paidBy).short)}</span>
              </span>
              <span className="col" style={{ gap: 0, alignItems: 'flex-end' }}>
                <span className="row" style={{ gap: 6 }}><span className="num cx-share-a">SAR {fmt(sh.amount)}</span>{sh.paid && <Icon name="check" size={16} color="#2f7a4b" width={2.6} />}</span>
                {!sh.paid && iPaid && !me && <button type="button" className="link cx-mark" onClick={() => onMark(sh)}>Mark paid</button>}
              </span>
            </div>
          );
        })}
      </div>
      {!sp.settled && (() => {
        const mineSh = sp.shares.find((sh) => sh.ids.includes('omar'));
        if (mineSh && !mineSh.paid) return (
          <span className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn primary small" onClick={() => onPay(mineSh)}>Pay my share · SAR {fmt(mineSh.amount)}</button>
            <button type="button" className="link" style={{ fontSize: 13 }} onClick={() => onMark(mineSh)}>I paid in cash</button>
          </span>
        );
        if (iPaid && owing.length) return <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} disabled={sp.reminded} onClick={onRemind}>{sp.reminded ? 'Reminded today' : `Remind ${owing.map((sh) => sh.label.replace('’s family', '')).join(' and ')}`}</button>;
        return null;
      })()}
      {sp.settled && <span className="tiny">Everyone’s paid. Nothing to chase.</span>}
    </div>
  );
}

function ShareCard({ card, group, pinned, onPin }) {
  const { s, set, push, toast } = useStore();
  const { isSaved, toggle } = useSave();
  if (card.kind === 'plan') {
    const pl = PLANS[card.id];
    if (!pl) return null;
    const saved = (s.savedPlans || []).includes(pl.id);
    return (
      <div className="cx-card cx-share-card">
        <button type="button" className="cx-share-photo" onClick={() => push('plan', { id: pl.id })}>
          <img src={pl.img} alt="" /><span className="cx-veil" />
          <span className="pill glass" style={{ position: 'absolute', top: 10, left: 10 }}>Plan · {pl.days} days</span>
          <span className="cx-share-over"><span className="display" style={{ fontSize: 24 }}>{pl.title}</span><span className="tiny" style={{ color: 'rgba(255,253,249,.9)' }}>{pl.sub}</span></span>
        </button>
        <span className="cx-actions">
          <button type="button" className={'btn small ' + (saved ? 'gold' : 'secondary')} aria-pressed={saved ? 'true' : 'false'} onClick={() => { set((p) => ({ savedPlans: saved ? (p.savedPlans || []).filter((x) => x !== pl.id) : [...(p.savedPlans || []), pl.id] })); buzz(HAPTIC.select); toast(saved ? 'Removed from Saved.' : 'Saved. It’s in Circles → Saved.'); }}>{saved ? 'Saved' : 'Save'}</button>
          <button type="button" className="btn primary small" onClick={() => push('plan', { id: pl.id })}>Plan it</button>
          {!pinned && !group.dm && <button type="button" className="link" style={{ fontSize: 13 }} onClick={onPin}>Pin</button>}
        </span>
      </div>
    );
  }
  const p = card.post;
  const on = isSaved(p.id);
  return (
    <div className="cx-card cx-share-card">
      {p.img ? (
        <div className="cx-share-photo small">
          <img src={p.img} alt="" /><span className="cx-veil" />
          <span className="cx-share-over"><span className="h3" style={{ fontSize: 17, color: '#fffdf9' }}>{p.place}</span><span className="tiny" style={{ color: 'rgba(255,253,249,.9)' }}>{p.city} · {p.who === 'You' ? 'your tip' : `${p.who}’s tip`}</span></span>
        </div>
      ) : (
        <span className="col" style={{ gap: 2 }}><span className="h3" style={{ fontSize: 16 }}>{p.place}</span><span className="tiny">{p.city} · {p.who === 'You' ? 'your tip' : `${p.who}’s tip`}</span></span>
      )}
      <span className="small cx-clamp">{p.text}</span>
      <span className="cx-actions">
        <button type="button" className={'btn small ' + (on ? 'gold' : 'secondary')} aria-pressed={on ? 'true' : 'false'} onClick={() => toggle(p)}>{on ? 'Saved' : 'Save'}</button>
        <button type="button" className="btn primary small" onClick={() => push('ask', { prefill: (p.kind === 'Food' ? 'A table at ' : '') + p.place })}>Plan it</button>
      </span>
    </div>
  );
}

/* The circle's trip, as everyone has it: dates, who's booked on what, and the same flights for you. */
function TripCard({ trip, group }) {
  const { s, push } = useStore();
  const mineBooked = s.trip && s.trip.flight;
  return (
    <div className="cx-trip rise">
      <div className="cx-trip-photo">
        <img src={trip.img} alt="" /><span className="cx-veil" />
        <span className="cx-trip-over">
          <span className="pill glass">The trip</span>
          <span className="display" style={{ fontSize: 30, color: '#fffdf9' }}>{trip.city}</span>
          <span className="small" style={{ color: 'rgba(255,253,249,.92)' }}>{trip.dates}</span>
        </span>
      </div>
      <div className="cx-trip-rows">
        {trip.flights.filter((f) => group.members.includes(f.who)).map((f) => (
          <div key={f.who} className="row" style={{ gap: 10 }}><PAvatar id={f.who} size={28} /><span className="small grow" style={{ color: '#1e352d' }}>{f.text}</span><Icon name="flight" size={16} color="#7d5d27" /></div>
        ))}
        <div className="row" style={{ gap: 10 }}><PAvatar id="omar" size={28} /><span className="small grow" style={{ color: '#1e352d' }}>{mineBooked ? `You’re on ${s.trip.flight.code}, ${s.trip.flight.date || 'Tue 9 Mar'}` : 'You haven’t booked yet'}</span>{mineBooked && <Icon name="check" size={16} color="#2f7a4b" width={2.4} />}</div>
        {!mineBooked && <button type="button" className="btn gold small" style={{ alignSelf: 'flex-start' }} onClick={() => push('ask', { prefill: trip.same || group.name })}>Book the same flights</button>}
      </div>
    </div>
  );
}

/* ---------- tools ---------- */

const VOTE_KINDS = [['dates', 'Dates'], ['places', 'Places'], ['any', 'Anything']];
function VoteSheet({ dest, onClose, onPost }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('dates');
  const [opts, setOpts] = useState(['', '']);
  const [tried, setTried] = useState(false);
  const ideas = kind === 'dates' ? ['Wed 10 Mar', 'Thu 11 Mar', 'Fri 12 Mar', 'Sat 13 Mar'] : kind === 'places' ? (PLACES[dest]?.spots || ['Georgia', 'Baku', 'AlUla', 'Istanbul']) : ['Yes', 'No', 'Maybe'];
  const clean = opts.map((o) => o.trim()).filter(Boolean);
  const dup = new Set(clean.map((o) => o.toLowerCase())).size !== clean.length;
  const ok = q.trim().length >= 3 && clean.length >= 2 && !dup;
  const fill = (v) => {
    if (opts.some((o) => o.trim().toLowerCase() === v.toLowerCase())) return;
    const i = opts.findIndex((o) => !o.trim());
    if (i >= 0) setOpts(opts.map((o, j) => (j === i ? v : o)));
    else if (opts.length < 4) setOpts([...opts, v]);
    buzz(HAPTIC.select);
  };
  return (
    <Sheet label="Start a vote" onClose={onClose}>
      <h2 className="h2">Start a vote</h2>
      <div className="field">
        <label htmlFor="vote-q">Question</label>
        <input id="vote-q" className="input" maxLength={60} value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === 'places' ? 'Where should we go?' : kind === 'dates' ? 'Which evening for dinner?' : 'Shall we book the van?'} />
      </div>
      <div className="chips" role="radiogroup" aria-label="Kind of vote">
        {VOTE_KINDS.map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={kind === id ? 'true' : 'false'} className={'chip' + (kind === id ? ' on' : '')} onClick={() => { setKind(id); buzz(HAPTIC.select); }}>{label}</button>)}
      </div>
      <div className="col" style={{ gap: 8 }}>
        {opts.map((o, i) => (
          <div key={i} className="row" style={{ gap: 8 }}>
            <input id={`vote-o${i + 1}`} className="input" aria-label={`Choice ${i + 1}`} maxLength={30} value={o} placeholder={`Choice ${i + 1}`} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} />
            {opts.length > 2 && <button type="button" className="icon-btn" aria-label={`Remove choice ${i + 1}`} style={{ background: 'var(--mist)' }} onClick={() => setOpts(opts.filter((_, j) => j !== i))}><Icon name="close" size={18} /></button>}
          </div>
        ))}
        {opts.length < 4 && <button type="button" className="link" style={{ alignSelf: 'flex-start', padding: '4px 0' }} onClick={() => setOpts([...opts, ''])}>Add a choice</button>}
      </div>
      <div className="chips" aria-label="Quick choices">{ideas.map((v) => <button key={v} type="button" className="chip cx-chip-ghost" onClick={() => fill(v)}>{v}</button>)}</div>
      {tried && !ok && <span className="err" role="alert" style={{ color: '#8a3524', fontSize: 13 }}>{q.trim().length < 3 ? 'Add a question.' : dup ? 'Two choices are the same.' : 'Add at least 2 choices.'}</span>}
      <button type="button" className="btn primary block" aria-disabled={!ok ? 'true' : 'false'} style={{ opacity: ok ? 1 : 0.45 }} onClick={() => { if (!ok) { setTried(true); return; } onPost({ q: q.trim().replace(/([^?])$/, '$1?'), kind, options: clean }); }}>Post the vote</button>
    </Sheet>
  );
}

function SplitSheet({ group, onClose, onPost }) {
  const [what, setWhat] = useState('');
  const [total, setTotal] = useState('');
  const [paidByPick, setPaidBy] = useState('omar');
  const [mode, setMode] = useState('equal');
  const [who, setWho] = useState(group.members);
  const [custom, setCustom] = useState({});
  const sum = Number(String(total).replace(/[^\d.]/g, '')) || 0;
  const paidBy = who.includes(paidByPick) ? paidByPick : who[0];
  const units = shareUnits(mode === 'custom' ? 'equal' : mode, who);
  const amounts = mode === 'custom' ? units.map((u) => Number(custom[u.key]) || 0) : equalAmounts(sum, units.length || 1);
  const assigned = amounts.reduce((a, b) => a + b, 0);
  const diff = Math.round(sum - assigned);
  const ok = what.trim().length >= 2 && sum > 0 && who.length >= 2 && who.includes(paidBy) && (mode !== 'custom' || diff === 0);
  const label = (id) => (id === 'omar' ? 'You' : person(id).short);
  return (
    <Sheet label="Split a cost" onClose={onClose}>
      <h2 className="h2">Split a cost</h2>
      <div className="field">
        <label htmlFor="split-what">What for</label>
        <input id="split-what" className="input" maxLength={40} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Dinner on the Bosphorus" />
        <div className="chips">{['Dinner', 'Hotel', 'Airport van', 'Tickets'].map((t) => <button key={t} type="button" className="chip cx-chip-ghost" onClick={() => setWhat(t)}>{t}</button>)}</div>
      </div>
      <div className="field">
        <label htmlFor="split-total">Total</label>
        <div className="row" style={{ gap: 8 }}><span className="input cx-sar">SAR</span><input id="split-total" className="input num" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value.replace(/[^\d]/g, '').slice(0, 7))} placeholder="1,200" /></div>
      </div>
      <div className="col" style={{ gap: 8 }}>
        <span className="eyebrow">Paid by</span>
        <div className="chips" role="radiogroup" aria-label="Paid by">{who.map((id) => <button key={id} type="button" role="radio" aria-checked={paidBy === id ? 'true' : 'false'} className={'chip' + (paidBy === id ? ' on' : '')} onClick={() => setPaidBy(id)}>{label(id)}</button>)}</div>
      </div>
      <div className="col" style={{ gap: 8 }}>
        <span className="eyebrow">Between</span>
        <div className="chips" aria-label="Between">{group.members.map((id) => <button key={id} type="button" aria-pressed={who.includes(id) ? 'true' : 'false'} className="chip" onClick={() => { setWho(who.includes(id) ? who.filter((x) => x !== id) : group.members.filter((x) => x === id || who.includes(x))); buzz(HAPTIC.select); }}>{label(id)}</button>)}</div>
      </div>
      <div className="cx-seg" role="radiogroup" aria-label="How to split">
        {[['equal', 'Equally'], ['family', 'By family'], ['custom', 'Custom']].map(([id, l]) => <button key={id} type="button" role="radio" aria-checked={mode === id ? 'true' : 'false'} onClick={() => { setMode(id); buzz(HAPTIC.select); }}>{l}</button>)}
      </div>
      <div className="cx-shares well">
        {units.map((u, i) => (
          <div key={u.key} className="cx-share">
            <span className="stack">{u.ids.slice(0, 3).map((id) => <PAvatar key={id} id={id} size={26} ring="#f6f2ec" />)}</span>
            <span className="grow cx-share-l">{u.label}</span>
            {mode === 'custom'
              ? <input className="input num cx-amt-in" inputMode="numeric" aria-label={u.ids.includes('omar') ? 'Your share' : `${u.label}’s share`} value={custom[u.key] || ''} placeholder="0" onChange={(e) => setCustom({ ...custom, [u.key]: e.target.value.replace(/[^\d]/g, '').slice(0, 7) })} />
              : <span className="num cx-share-a">SAR {fmt(amounts[i] || 0)}</span>}
          </div>
        ))}
      </div>
      {mode === 'custom' && sum > 0 && (diff === 0
        ? <span className="tiny cx-ok">Adds up to SAR {fmt(sum)}.</span>
        : <span className="err" role="alert" style={{ color: '#8a3524', fontSize: 13 }}>{diff > 0 ? `SAR ${fmt(diff)} still to share out.` : `SAR ${fmt(-diff)} more than the total.`}</span>)}
      {who.length < 2 && <span className="tiny">Pick at least 2 people.</span>}
      <button type="button" className="btn primary block" disabled={!ok} onClick={() => {
        const shares = units.map((u, i) => ({ ...u, amount: amounts[i], paid: u.ids.includes(paidBy) }));
        onPost({ what: what.trim(), total: sum, paidBy, mode, shares, settled: shares.every((x) => x.paid) });
      }}>{ok ? `Split SAR ${fmt(sum)}` : 'Split it'}</button>
    </Sheet>
  );
}

function ShareSheet({ onClose, onPick }) {
  const { s } = useStore();
  const [pin, setPin] = useState(false);
  const saved = s.savedPosts || [];
  return (
    <Sheet label="Share a plan or place" onClose={onClose}>
      <h2 className="h2">Share a plan or place</h2>
      <span className="eyebrow">Plans we’ve made</span>
      {Object.values(PLANS).map((pl) => (
        <button key={pl.id} type="button" className="city-row" onClick={() => onPick({ kind: 'plan', id: pl.id }, pin)}>
          <img src={pl.img} alt="" />
          <span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{pl.title}</span><span className="tiny">{pl.days} days · {pl.city}</span></span>
          <Icon name="up" size={18} />
        </button>
      ))}
      <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} />Pin the plan to the top of the circle</label>
      <span className="eyebrow">Your saved places</span>
      {saved.length === 0 ? <span className="small">Nothing saved yet. Bookmark a tip in Discover and you can share it here.</span> : saved.map((p) => (
        <button key={p.id} type="button" className="city-row" onClick={() => onPick({ kind: 'place', post: { id: p.id, who: p.who, uid: p.uid, initial: p.initial, tone: p.tone, city: p.city, place: p.place, text: p.text, img: p.img, kind: p.kind, saves: p.saves, rel: p.rel } })}>
          {p.img ? <img src={p.img} alt="" /> : <span className="avatar" style={{ width: 48, height: 48, borderRadius: 12 }}>{p.initial}</span>}
          <span className="grow col" style={{ gap: 0, minWidth: 0 }}><span className="h3" style={{ fontSize: 15 }}>{p.place}</span><span className="tiny">{p.city} · from {p.who}</span></span>
          <Icon name="up" size={18} />
        </button>
      ))}
    </Sheet>
  );
}

function Discover({ posts, setPosts }) {
  const { s, push, toast } = useStore();
  const cities = s.trip ? ['Istanbul', 'Riyadh'] : ['Riyadh', 'Istanbul'];
  const [city, setCity] = useState(cities[0]);
  const [filter, setFilter] = useState('All');
  const { isSaved, toggle: toggleSave } = useSave();
  const feed = posts.filter((p) => p.city === city && (filter === 'All' || p.kind === filter))
    .sort((a, b) => (a.rel === 'Friend' ? -1 : 0) - (b.rel === 'Friend' ? -1 : 0));
  const [picking, setPicking] = useState(false);
  return (
    <>
      <h2 className="h2" style={{ fontSize: 22 }}>
        On this week in{' '}
        <button type="button" className="city-switch" onClick={() => { setPicking(true); buzz(HAPTIC.tap); }} aria-haspopup="dialog" aria-label={`${city}. Choose a city`}>
          {city}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7d5d27" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </h2>
      {picking && <CitySheet current={city} onPick={(c) => { setCity(c); setPicking(false); }} onClose={() => setPicking(false)} />}
      {s.trip && city === 'Istanbul' && <span className="tiny" style={{ marginTop: -8 }}>While you're there, {s.trip.dates}</span>}
      <div className="chips scrollx" style={{ gap: 12 }}>
        {EVENTS[city].map((e, i) => (
          <button key={e.id} type="button" className="story" style={{ width: 236, minHeight: 300, flexShrink: 0, border: 0, padding: 0, textAlign: 'left' }} onClick={() => push('ask', { prefill: `${e.title} in ${city}` })}>
            <img className="bg" src={e.img} alt="" style={{ objectPosition: ['50% 40%', '30% 70%', '70% 30%'][i] }} />
            <span className="veil" />
            <span className="top"><span className="pill glass">{e.tag}</span></span>
            <span className="body">
              <span className="quote" style={{ fontSize: 26 }}>{e.title}</span>
              <span className="small" style={{ color: 'rgba(255,253,249,.88)' }}>{e.when}<br />{e.where}</span>
              <span className="glass-btn" style={{ alignSelf: 'flex-start' }}>Book with Mada<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
            </span>
          </button>
        ))}
      </div>

      <h2 className="h2" style={{ fontSize: 22, marginTop: 6 }}>Trips we've planned</h2>
      <div className="chips scrollx" style={{ gap: 12 }}>
        {Object.values(PLANS).map((pl) => (
          <button key={pl.id} type="button" className="story" style={{ width: 280, minHeight: 220, flexShrink: 0, border: 0, padding: 0, textAlign: 'left' }} onClick={() => push('plan', { id: pl.id })}>
            <img className="bg" src={pl.img} alt="" />
            <span className="veil" />
            <span className="top"><span className="pill glass">{pl.days} days · planned by Mada</span></span>
            <span className="body" style={{ gap: 4 }}>
              <span className="quote" style={{ fontSize: 26 }}>{pl.title}</span>
              <span className="small" style={{ color: 'rgba(255,253,249,.88)' }}>{pl.sub}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="spread" style={{ marginTop: 6 }}>
        <h2 className="h2" style={{ fontSize: 22 }}>From people who went</h2>
        <div className="row" style={{ gap: 12 }} role="group" aria-label="Filter tips">
          {[['All', 'All'], ['Food', 'Food'], ['Things to do', 'To do']].map(([f, label]) => (
            <button key={f} type="button" aria-pressed={filter === f ? 'true' : 'false'} onClick={() => { setFilter(f); buzz(HAPTIC.select); }}
              style={{ border: 0, background: 'none', padding: '6px 0', fontSize: 14, fontWeight: 600, color: filter === f ? '#1e352d' : '#7a857f', borderBottom: filter === f ? '2px solid #d9b77a' : '2px solid transparent' }}>{label}</button>
          ))}
        </div>
      </div>
      {feed.length === 0 && <div className="card well"><span className="h3">No tips here yet.</span><span className="small">Be the first. Tap + to post one.</span></div>}
      {feed.map((p, i) => {
        const on = isSaved(p.id);
        return (
          <article key={p.id} className={'story rise' + (p.img ? '' : ' plain')} style={{ animationDelay: `${i * 0.05}s` }}>
            {p.img && <img className="bg" src={p.img} alt="" style={{ objectPosition: '50% 55%' }} />}
            <span className="veil" />
            <div className="top">
              <button type="button" disabled={!FRIENDS[p.uid]} aria-label={`${p.who}'s profile`} onClick={() => push('friend', { id: p.uid })} className="row" style={{ gap: 8, padding: '4px 12px 4px 4px', borderRadius: 999, border: 0, color: '#fffdf9', textAlign: 'left', background: 'rgba(15,26,22,.45)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
                <span className={'avatar sm' + (p.tone ? ' ' + p.tone : '')} style={{ width: 28, height: 28 }}>{p.initial}</span>
                <span className="col" style={{ gap: 0 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{p.who}</span><span style={{ fontSize: 11, color: 'rgba(255,253,249,.8)' }}>{p.rel}{p.pending ? ' · being checked' : ''}</span></span>
              </button>
              <span className="pill glass">{p.kind === 'Things to do' ? 'To do' : p.kind}</span>
            </div>
            <div className="body">
              {!p.img && <span aria-hidden="true" style={{ fontFamily: 'var(--f-display)', fontSize: 64, lineHeight: 0.6, color: '#d9b77a', marginTop: 30 }}>“</span>}
              <p className="quote">{p.text}</p>
              <span className="row" style={{ gap: 6, fontSize: 14, fontWeight: 600, color: 'rgba(255,253,249,.92)' }}><Icon name="pin" size={16} color="#d9b77a" />{p.place}</span>
              <div className="row" style={{ marginTop: 4 }}>
                <button type="button" className={'glass-btn' + (on ? ' on' : '')} aria-pressed={on ? 'true' : 'false'} onClick={() => toggleSave(p)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={on ? '#1e352d' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg>{p.saves + (on ? 1 : 0)}
                </button>
                <button type="button" className="glass-btn" onClick={() => push('ask', { prefill: (p.kind === 'Food' ? 'A table at ' : '') + p.place })}>{p.kind === 'Food' ? 'Book a table' : 'Plan it'}</button>
              </div>
            </div>
          </article>
        );
      })}
    </>
  );
}

function PostSheet({ onClose, onPost }) {
  const [place, setPlace] = useState('');
  const [text, setText] = useState('');
  const [kind, setKind] = useState('Food');
  const [city, setCity] = useState('Istanbul');
  const [audience, setAudience] = useState('friends');
  const [photo, setPhoto] = useState(null);
  const [consent, setConsent] = useState(false);
  const ok = place.trim().length > 2 && text.trim().length > 10 && (!photo || consent);
  return (
    <Sheet label="Post a tip" onClose={onClose}>
      <h2 className="h2">Post a tip</h2>
      <div className="chips">{['Istanbul', 'Riyadh'].map((c) => <button key={c} type="button" className={'chip' + (city === c ? ' on' : '')} onClick={() => setCity(c)}>{c}</button>)}</div>
      <div className="field"><label htmlFor="tip-place">Place</label><input id="tip-place" className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Künefe near Galata Tower" /></div>
      <div className="field"><label htmlFor="tip-text">Your tip</label><textarea id="tip-text" className="input" style={{ height: 96, padding: 14, resize: 'none', lineHeight: 1.4 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="What should people know? When to go, what to order, who it suits." /></div>
      <div className="chips">{['Food', 'Things to do'].map((k) => <button key={k} type="button" className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{k}</button>)}</div>
      <div className="field">
        <label htmlFor="tip-photo">Photo (optional)</label>
        <input id="tip-photo" type="file" accept="image/*" onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) { const r = new FileReader(); r.onload = () => setPhoto(r.result); r.readAsDataURL(f); } }} />
        {photo && (
          <label className="row small" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
            Everyone in this photo agreed to it being shared.
          </label>
        )}
      </div>
      <div className="chips" role="radiogroup" aria-label="Who sees it">
        {[['friends', 'Friends'], ['everyone', 'Everyone on Mada']].map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={audience === id ? 'true' : 'false'} className={'chip' + (audience === id ? ' on' : '')} onClick={() => setAudience(id)}>{label}</button>)}
      </div>
      <span className="tiny">Tips are checked before they show. No faces of strangers, no addresses of people.</span>
      <button type="button" className="btn primary block" disabled={!ok} onClick={() => onPost({ id: 'u' + Date.now(), who: 'You', initial: 'O', tone: 'green', rel: 'Friend', city, place: place.trim(), text: text.trim(), img: photo, saves: 0, kind, audience, pending: true })}>Post</button>
    </Sheet>
  );
}

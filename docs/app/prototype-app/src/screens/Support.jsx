import React, { useEffect, useRef, useState } from 'react';
import { useStore, buzz, HAPTIC, PEOPLE, fmt } from '../store.jsx';
import { Icon, Sun, TopBar, QuietRadar, EmptyState, ArtChat } from '../ui.jsx';

/* One conversation with Faisal and the 24/7 desk. Every message gets a real answer for what it is about,
   and urgent things get a phone call. "Did that sort it?" only follows something that was actually done.
   State this file owns: support (the thread). */

export const DESK = '+966 11 520 0000';
export const DESK_TEL = 'tel:+966115200000';
const DESK_WA = 'https://wa.me/966115200000';

const TOPICS = [
  ['change', 'Change my booking'],
  ['refund', 'A refund'],
  ['bag', 'A missing bag'],
  ['docs', 'Documents or a visa'],
  ['airport', 'Help at the airport'],
  ['other', 'Something else'],
];
const TOPIC_ICON = { change: 'flight', refund: 'refund', bag: 'bag', docs: 'visa', airport: 'pin', other: 'more' };

/* What a message is about. Order matters: someone hurt beats a lost bag. */
export function supportIntent(text) {
  const t = (text || '').toLowerCase();
  if (/\b(emergency|urgent|ambulance|hospital|medical|doctor|injured|injury|hurt|bleeding|collapsed|police|stolen|robbed|unwell|chest pain)\b|^\s*help\b|help me|lost (my |our |her |his )?passport/.test(t)) return 'urgent';
  if (/\b(bag|bags|luggage|suitcase|baggage)\b/.test(t)) return 'bag';
  if (/missed|cancell?ed|cancel my flight|flight (was |is |got )?(cancel|delay)|delayed|rebook|stuck at|didn'?t (let|board)/.test(t)) return 'missed';
  if (/refund|charged|charge|payment|paid twice|money back|double|deducted/.test(t)) return 'refund';
  if (/window|aisle|\bseats?\b|sit (by|next|together)/.test(t)) return 'seat';
  if (/change|move (my|the|our)|different (date|day|flight)|reschedul/.test(t)) return 'change';
  if (/visa|passport|document|iqama/.test(t)) return 'docs';
  if (/airport|gate|check[- ]?in|counter/.test(t)) return 'airport';
  return 'free';
}

const time = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const REFUND_STAGE = { '-1': 'Faisal is checking it with the airline', 0: 'Asked the airline. They usually answer within 3 days', 1: 'Approved. It’s being sent to your card', 2: 'Sent. Banks take up to 5 working days to show it' };

export function Support({ params = {} }) {
  const { s, set, pop, push } = useStore();
  const thread = s.support || [];
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const end = useRef(null);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  const tripName = s.trip ? `${s.trip.city || 'Istanbul'} trip` : null;
  const about = params.about || (s.trip ? `${tripName} · ${s.trip.dates || ''}`.replace(/ \u00b7 $/, '') : 'Your account');
  const add = (m) => set((p) => ({ support: [...(p.support || []), { id: 'm' + Date.now() + Math.random(), at: Date.now(), ...m }] }));
  const say = (m, ms = 1500) => {
    setTyping(true);
    later(() => { setTyping(false); add({ from: 'faisal', ...m }); buzz(m.urgent ? HAPTIC.warn : HAPTIC.knock); }, ms);
  };

  /* Each answer is written for what was asked. Nothing claims to be done unless it was. */
  const answer = (key, text = '') => {
    const t = text.toLowerCase();
    const trip = s.trip;
    if (key === 'urgent') { say({ text: `Call the desk now: ${DESK}. Someone answers any hour, usually within a minute. If anyone is hurt, call 997 for an ambulance in Saudi Arabia, or 112 abroad.`, urgent: true }, 400); return; }
    if (key === 'airport') { say({ text: 'Calling is quickest at the airport. Tap call and you reach the desk straight away, any hour.', urgent: true }, 600); return; }
    if (key === 'bag') { say({ text: 'Sorry about the bag. Let’s find it. Send me the bag tag number from the sticker on your boarding pass, or the reference the baggage desk gave you.', form: 'bag' }); return; }
    if (key === 'missed') {
      if (trip?.flight) say({ text: `I’m rebooking you now. I’m holding seats on two flights today. Which one?`, choices: [[`Saudia SV265 · leaves 13:30`, 'sv265'], ['flynas XY125 · leaves 10:25', 'xy125'], ['A refund instead', 'refund']] });
      else say({ text: 'I’m on it. Send me the flight number or a photo of the booking, and I’ll rebook you on the next flight with seats.' });
      return;
    }
    if (key === 'refund') {
      if (/twice|double|charged|deducted/.test(t)) {
        say({ text: `I can see one payment${trip?.pnr ? ` for booking ${trip.pnr}` : ''}. A second charge is usually a hold from the bank that drops off within 3 days. Send me a screenshot of the statement and I’ll check it today.` });
        return;
      }
      const latest = [...(s.refunds || [])].reverse()[0];
      if (latest) say({ text: `Here’s where your refund is.`, refund: { amount: latest.amount, title: latest.title, stage: latest.stage, card: latest.card || 'your card' }, action: ['Start another refund', 'refund'] });
      else say({ text: 'No refunds in progress. Pick what you want refunded and you’ll see exactly what comes back before anything happens.', action: ['Start a refund', 'refund'] });
      return;
    }
    if (key === 'seat') {
      if (!trip?.flight) { say({ text: 'Once you’ve booked, I’ll seat you together. There’s nothing to change yet.' }); return; }
      const people = (trip.travellers || []).map((id) => PEOPLE[id]).filter(Boolean);
      const who = people.find((p) => new RegExp(`\\b${p.name.toLowerCase()}\\b`).test(t)) || people[0];
      const next = people.find((p) => p !== who);
      const window = /window/.test(t);
      say({ text: `Done. ${!who || who.role === 'You' ? 'You’re' : `${who.name} is`} in 23${window ? 'A by the window' : 'C on the aisle'}${next ? `, next to ${next.name}` : ''}, on both flights. The new seat is on the boarding pass in your Wallet.`, resolved: true });
      return;
    }
    if (key === 'change') { say({ text: 'What would you like to change: the flight, the hotel, or who’s travelling? You can also do it yourself and I’ll confirm it.', action: trip ? ['Change the flight', 'changeFlight'] : null }); return; }
    if (key === 'docs') { say({ text: 'Send me a photo of the document, or tell me which country. I’ll check what each of you needs.' }); return; }
    if (key === 'other') { say({ text: 'Go ahead. I’m here.' }, 900); return; }
    if (key === 'photo') { say({ text: 'Got it. I’ll look at it and reply here within 5 minutes.' }); return; }
    say({ text: 'Let me look and I’ll reply here within 5 minutes.' });
  };

  const send = (text, key) => {
    if (!text.trim()) return;
    const k = key || supportIntent(text);
    /* A message that didn't reach Mada stays in the thread, marked, with Send again on it. */
    const failed = !s.demo.offline && (s.demo.sendFails || s.demo.serverDown);
    add({ from: 'me', text: text.trim(), queued: !!s.demo.offline, failed, about, intent: k });
    buzz(failed ? HAPTIC.soft : HAPTIC.tap);
    if (!s.demo.offline && !failed) answer(k, text);
  };
  const sendAgain = (m) => {
    if (s.demo.serverDown) { buzz(HAPTIC.soft); return; }
    set((p) => ({ support: p.support.map((x) => (x.id === m.id ? { ...x, failed: false, sending: true } : x)) }));
    later(() => { set((p) => ({ support: p.support.map((x) => (x.id === m.id ? { ...x, sending: false } : x)) })); answer(m.intent || supportIntent(m.text), m.text || ''); }, 900);
  };

  const pick = (m, [label, k]) => {
    set((p) => ({ support: p.support.map((x) => (x.id === m.id ? { ...x, picked: k } : x)) }));
    add({ from: 'me', text: label });
    if (k === 'refund') { say({ text: 'Your seats are released and the full fare comes back. Pick what to refund and you’ll see the amount first.', action: ['Start a refund', 'refund'] }); return; }
    const patch = k === 'sv265' ? { code: 'SV265', dep: '13:30', arr: '17:45' } : { code: 'XY125', dep: '10:25', arr: '15:05', to: 'SAW', airline: 'flynas', iata: 'XY' };
    set((p) => (p.trip ? { trip: { ...p.trip, rebooked: true, flight: { ...p.trip.flight, ...patch } } } : {}));
    const n = s.trip?.travellers?.length || 1;
    say({ text: `Done. ${n === 1 ? 'You’re' : `All ${n} of you are`} on ${patch.code}, leaving ${patch.dep}${n > 1 ? ', seated together' : ''}. New boarding passes are in your Wallet${k === 'xy125' ? ', and your pickup moves to Sabiha Gökçen' : ''}.`, resolved: true }, 1800);
  };

  const fileBag = (m, form) => {
    set((p) => ({ support: p.support.map((x) => (x.id === m.id ? { ...x, filed: true } : x)) }));
    const ref = form.ref.trim().toUpperCase() || 'SV 482913';
    add({ from: 'me', text: `${ref} · ${form.kind.toLowerCase()} · deliver to ${form.to.toLowerCase()}` });
    say({ text: `Thanks. I’ve filed it with the airline under ${ref}. Here’s what happens next.`, steps: [
      'They trace it now. Most bags turn up within 24 hours.',
      `When it’s found, it’s delivered to ${form.to === 'Our hotel' ? 'your hotel' : 'your home'} at no cost. I’ll tell you here.`,
      'Until then, buy what you need. The airline pays back reasonable costs: keep the receipts and send photos here.',
      'If it isn’t found in 21 days, I’ll claim its full value for you.',
    ], resolved: true }, 1800);
  };

  useEffect(() => { if (params.topic && !thread.length) send(TOPICS.find(([k]) => k === params.topic)?.[1] || 'Hi', params.topic); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [thread.length, typing]);
  /* Back online: everything queued goes, and the newest one gets its answer. */
  useEffect(() => {
    if (s.demo.offline) return;
    const queued = thread.filter((m) => m.queued);
    if (!queued.length) return;
    set((p) => ({ support: p.support.map((m) => ({ ...m, queued: false })) }));
    const last = queued[queued.length - 1];
    answer(last.intent || supportIntent(last.text), last.text || '');
  }, [s.demo.offline]);

  const lastResolved = thread.map((m) => !!m.resolved).lastIndexOf(true);
  const lastRated = thread.map((m) => !!m.rated).lastIndexOf(true);
  const askRating = lastResolved > -1 && lastResolved > lastRated && !typing;
  const queued = thread.filter((m) => m.queued);
  const smsBody = encodeURIComponent(queued.map((m) => m.text).filter(Boolean).join('\n') || 'Hi Faisal, I need help with my trip.');
  const openForm = [...thread].reverse().find((m) => m.form === 'bag' && !m.filed);

  return (
    <div className={'screen push support' + (s.demo.offline ? ' is-offline' : '')}>
      <TopBar onBack={pop} right={
        <span className="row" style={{ gap: 8 }}>
          <a className="icon-btn" aria-label="WhatsApp Mada" href={DESK_WA} target="_blank" rel="noreferrer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z" /><path d="M9 9.5c.3 1.8 1.7 3.2 3.5 3.5l1-1 2 .8c-.2 1.3-1.3 2-2.5 1.7A6 6 0 0 1 8.3 9.8C8 8.6 8.7 7.5 10 7.3l.8 2z" /></svg></a>
          <a className="icon-btn dark" aria-label={`Call Mada on ${DESK}`} href={DESK_TEL}><PhoneIcon /></a>
        </span>
      } />
      <div className="support-head">
        <span style={{ position: 'relative' }}><span className="avatar green" style={{ width: 52, height: 52 }}><Sun width={30} /></span></span>
        <span className="col" style={{ gap: 2 }}>
          <span className="h2" style={{ fontSize: 22 }}>Mada</span>
          {(() => {
            /* Mada vs Faisal: Mada is who you talk to; the person on duty shows as presence. */
            const h = new Date().getHours();
            const night = h >= 22 || h < 8;
            return <span className="tiny row" style={{ gap: 6 }}><i className="presence-dot" aria-hidden="true" />{night ? 'Noura is covering for Faisal tonight · replies in about 5 min' : 'Faisal is online · usually replies in 2 min'}</span>;
          })()}
        </span>
      </div>
      <div className="support-about"><Icon name="trips" size={16} />About: {about}</div>

      <div className="scroll no-dock support-scroll">
        <p className="tiny" style={{ textAlign: 'center', margin: '0 12px' }}>Instant answers from Mada. Faisal and the team confirm anything you book.</p>
        {thread.length === 0 && (
          <div className="col" style={{ gap: 12 }}>
            <div className="es-chat-hero rise" aria-hidden="true"><div className="es-stage"><ArtChat /></div></div>
            <div className="support-msg them rise"><span>{s.user?.name ? `Hi ${s.user.name}.` : 'Hi.'} I have your {tripName || 'account'} open. What can I do?</span></div>
            <div className="sp-topics rise d1" role="group" aria-label="Topics">
              {TOPICS.map(([k, label]) => <button key={k} type="button" onClick={() => send(label, k)}><Icon name={TOPIC_ICON[k] || 'chevron'} size={18} />{label}</button>)}
            </div>
          </div>
        )}
        {thread.map((m) => (
          <div key={m.id} className={'support-msg ' + (m.from === 'me' ? 'me' : 'them') + ' rise'}>
            {m.img && <img src={m.img} alt="Photo you sent" style={{ width: 180, borderRadius: 14, display: 'block' }} />}
            {m.text && <span>{m.text}</span>}
            {m.refund && (
              <div className="sp-refund">
                <span className="spread"><span className="h3" style={{ fontSize: 15 }}>SAR {fmt(m.refund.amount)}</span><span className="pill">{m.refund.stage === 2 ? 'Sent' : m.refund.stage === -1 ? 'With Faisal' : 'On its way'}</span></span>
                <span className="small">{m.refund.title}</span>
                <span className="small" style={{ color: '#1e352d' }}>{REFUND_STAGE[m.refund.stage] || REFUND_STAGE[0]}. To {m.refund.card}.</span>
              </div>
            )}
            {m.steps && <ol className="sp-steps">{m.steps.map((x) => <li key={x}>{x}</li>)}</ol>}
            {m.choices && !m.picked && <div className="col" style={{ gap: 6 }}>{m.choices.map((c) => <button key={c[1]} type="button" className="btn secondary small" style={{ justifyContent: 'flex-start' }} onClick={() => pick(m, c)}>{c[0]}</button>)}</div>}
            {m.form === 'bag' && !m.filed && <BagForm onSend={(f) => fileBag(m, f)} onNone={() => { set((p) => ({ support: p.support.map((x) => (x.id === m.id ? { ...x, filed: true } : x)) })); add({ from: 'me', text: 'I don’t have a reference yet.' }); say({ text: 'That’s fine. Before you leave the airport, go to the baggage desk in arrivals and report it. They’ll give you a reference on a form. Send me a photo of it and I’ll take it from there.' }); }} />}
            {m.action && <button type="button" className="btn gold small" style={{ alignSelf: 'flex-start' }} onClick={() => push(m.action[1], m.action[2] || { from: 'support' })}>{m.action[0]}</button>}
            {m.urgent && <a className="btn primary small" style={{ alignSelf: 'flex-start' }} href={DESK_TEL}>Call the desk now</a>}
            {m.failed ? (
              <span className="support-time msg-failed" role="status">{time(m.at)} · Didn’t send<button type="button" className="msg-again" onClick={() => { buzz(HAPTIC.tap); sendAgain(m); }}>Send again</button></span>
            ) : <span className="support-time">{time(m.at)}{m.from === 'me' ? (m.sending ? ' · sending…' : m.queued ? ' · sends when you’re online' : ' · read') : ''}</span>}
          </div>
        ))}
        {typing && <div className="support-msg them"><span className="dots" style={{ color: '#7a857f' }} aria-label="Faisal is typing"><i /><i /><i /></span></div>}
        {s.demo.offline && (
          <div className="card well rise sp-offline" role="status">
            <span className="row h3" style={{ fontSize: 15, gap: 8 }}><Icon name="wifiOff" size={18} />You're offline.</span>
            <span className="small">{queued.length ? `${queued.length === 1 ? 'Your message sends' : `Your ${queued.length} messages send`} the moment you're back.` : 'Messages you write now send the moment you’re back.'} Need us now? The desk answers any hour.</span>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <a className="btn primary small" href={DESK_TEL}>Call the desk</a>
              <a className="btn secondary small" href={`sms:+966115200000?&body=${smsBody}`}>Send an SMS</a>
            </div>
          </div>
        )}
        {askRating && (
          <div className="card well rise" style={{ gap: 8 }}>
            <span className="h3" style={{ fontSize: 15 }}>Did that sort it?</span>
            <div className="row">
              <button type="button" className="btn secondary small" onClick={() => add({ from: 'me', text: 'Yes, thanks.', rated: true })}>Yes, thanks</button>
              <button type="button" className="btn secondary small" onClick={() => { add({ from: 'me', text: 'Not yet.', rated: true }); answer('other'); }}>Not yet</button>
            </div>
          </div>
        )}
        <span ref={end} />
      </div>

      <form className="act support-act" onSubmit={(e) => { e.preventDefault(); send(draft); setDraft(''); }}>
        <div className="row support-composer">
          <label className="icon-btn" aria-label="Send a photo" style={{ width: 40, height: 40, cursor: 'pointer' }}>
            <Icon name="plus" size={20} />
            <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => {
              const f = e.target.files && e.target.files[0]; if (!f) return;
              if (f.size > 10 * 1024 * 1024) { add({ from: 'faisal', text: 'That file is over 10 MB. Send a smaller photo, or a screenshot of the page.' }); return; }
              const reply = () => { if (s.demo.offline) return; if (openForm) fileBag(openForm, { ref: 'SV 482913', kind: 'Suitcase', to: s.trip ? 'Our hotel' : 'Home' }); else answer('photo'); };
              if (f.type === 'application/pdf') { add({ from: 'me', text: `PDF · ${f.name}`, queued: !!s.demo.offline }); reply(); return; }
              const r = new FileReader(); r.onload = () => { add({ from: 'me', img: r.result, queued: !!s.demo.offline }); reply(); }; r.readAsDataURL(f);
            }} />
          </label>
          <label htmlFor="support-msg" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Message Mada</label>
          <input id="support-msg" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message Mada" autoComplete="off" />
          <button type="submit" className="icon-btn dark" aria-label="Send" style={{ width: 40, height: 40 }} disabled={!draft.trim()}><Icon name="up" color="#f6f2ec" size={18} /></button>
        </div>
      </form>
    </div>
  );
}

export function PhoneIcon({ color = '#f6f2ec', size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg>;
}

function BagForm({ onSend, onNone }) {
  const { s } = useStore();
  const [ref, setRef] = useState('');
  const [kind, setKind] = useState('Black suitcase');
  const [to, setTo] = useState(s.trip ? 'Our hotel' : 'Home');
  return (
    <form className="sp-form" onSubmit={(e) => { e.preventDefault(); if (ref.trim().length >= 5) onSend({ ref, kind, to }); }}>
      <div className="field">
        <label htmlFor="bag-ref">Bag tag or baggage desk reference</label>
        <input id="bag-ref" className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="SV 482913 or RUHSV12345" autoComplete="off" autoCapitalize="characters" />
      </div>
      <span className="tiny">What does it look like?</span>
      <div className="chips">{['Black suitcase', 'Coloured suitcase', 'A bag or box'].map((k) => <button key={k} type="button" className="chip" aria-pressed={kind === k ? 'true' : 'false'} onClick={() => setKind(k)}>{k}</button>)}</div>
      <span className="tiny">Deliver it to</span>
      <div className="chips">{['Our hotel', 'Home'].map((k) => <button key={k} type="button" className="chip" aria-pressed={to === k ? 'true' : 'false'} onClick={() => setTo(k)}>{k}</button>)}</div>
      <button type="submit" className="btn primary small" disabled={ref.trim().length < 5}>Send to Mada</button>
      <button type="button" className="link" style={{ alignSelf: 'flex-start', fontSize: 13, padding: 0 }} onClick={onNone}>I don’t have a reference yet</button>
    </form>
  );
}

/* Everything that happened, so a missed banner is never lost. */
const KIND_ICON = { trip: 'flight', reply: 'doc', money: 'refund', booking: 'check', circle: 'circles' };

export function Inbox() {
  const { s, set, pop, push, openBanner } = useStore();
  const [filter, setFilter] = useState('all');
  const items = (s.inbox || []).filter((n) => filter === 'all' || (filter === 'trips' ? ['trip', 'booking', 'reply'].includes(n.kind) : n.kind === filter));
  const unread = (s.inbox || []).filter((n) => !n.read).length;
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'Just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };
  return (
    <div className="screen push">
      <TopBar onBack={pop} right={unread ? <button type="button" className="link" onClick={() => set((p) => ({ inbox: p.inbox.map((n) => ({ ...n, read: true })) }))}>Mark all read</button> : null} />
      <div className="scroll no-dock" style={{ gap: 12 }}>
        <h1 className="h1">Updates</h1>
        <div className="row" style={{ gap: 16 }} role="group" aria-label="Filter updates">
          {[['all', 'All'], ['trips', 'Trips'], ['money', 'Money'], ['circle', 'Circles']].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id ? 'true' : 'false'} onClick={() => { setFilter(id); buzz(HAPTIC.select); }}
              style={{ border: 0, background: 'none', padding: '6px 0', fontSize: 15, fontWeight: 600, color: filter === id ? '#1e352d' : '#7a857f', borderBottom: filter === id ? '2px solid #d9b77a' : '2px solid transparent' }}>{label}</button>
          ))}
        </div>
        {items.length === 0 && (
          <EmptyState center tall art={<QuietRadar />} title="All quiet."
            body={filter === 'money' ? 'Payments, refunds and Mada credit land here the moment they move.'
              : filter === 'circle' ? 'Votes, splits and new people in your circles land here.'
                : s.trip || (s.trackedFlights || []).length ? 'We’re watching your flights. The moment a gate, a time or a reply changes, it lands here.'
                  : 'Gate changes, replies from Faisal, refunds and circle news land here, so nothing gets lost.'}
            action={!s.trip && filter !== 'circle' && filter !== 'money' ? <button type="button" className="btn primary" onClick={() => { pop(); push('ask', {}); }}>Plan a trip</button> : null} />
        )}
        {items.map((n) => (
          <button key={n.id} type="button" className={'inbox-row' + (n.read ? '' : ' unread')} onClick={() => { set((p) => ({ inbox: p.inbox.map((x) => (x.id === n.id ? { ...x, read: true } : x)) })); if (n.to) openBanner({ id: n.at, to: n.to }); }}>
            <span className="inbox-icon"><Icon name={KIND_ICON[n.kind] || 'bell'} size={20} color={n.read ? '#7a857f' : '#1e352d'} /></span>
            <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
              <span className="spread"><span className="h3" style={{ fontSize: 15 }}>{n.title}</span><span className="tiny" style={{ flexShrink: 0 }}>{ago(n.at)}</span></span>
              <span className="small" style={{ color: '#3f4f48' }}>{n.body}</span>
            </span>
            {!n.read && <i className="inbox-dot" aria-label="Unread" />}
          </button>
        ))}
      </div>
    </div>
  );
}

export const SCREENS = { support: Support, inbox: Inbox };

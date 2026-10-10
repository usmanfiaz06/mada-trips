import React, { useEffect, useRef, useState } from 'react';
import { useStore, buzz, HAPTIC } from '../store.jsx';
import { Icon, Sun, TopBar } from '../ui.jsx';

/* One conversation with Faisal and the 24/7 desk. Every message gets an answer, and urgent things get a phone call. */

const TOPICS = [
  ['change', 'Change my booking'],
  ['refund', 'A refund'],
  ['docs', 'Documents or a visa'],
  ['airport', 'Help at the airport'],
  ['other', 'Something else'],
];

const ANSWERS = {
  change: { text: 'Happy to. What would you like to change: the flight, the hotel, or who’s travelling? You can also do it yourself and I’ll confirm it.', action: ['Change the flight', 'changeFlight'] },
  refund: { text: 'I can help with that. Pick what you want refunded and you’ll see exactly what comes back before anything happens.', action: ['Start a refund', 'refund'] },
  docs: { text: 'Send me a photo of the document, or tell me which country. I’ll check what each of you needs.', action: null },
  airport: { text: 'Calling is quickest at the airport. Tap call and you reach the desk straight away, any hour.', action: null, urgent: true },
  other: { text: 'Go ahead. I’m here.', action: null },
  free: { text: 'Got it. Give me a minute to look at your booking.', follow: 'Done. I’ve noted it on your trip, and I’ll message here if anything needs you.' },
};

const time = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export function Support({ params = {} }) {
  const { s, set, pop, push } = useStore();
  const thread = s.support || [];
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const end = useRef(null);
  const about = params.about || (s.trip ? 'Istanbul trip · 9–15 Mar' : 'Your account');
  const add = (m) => set((p) => ({ support: [...(p.support || []), { id: 'm' + Date.now() + Math.random(), at: Date.now(), ...m }] }));
  const reply = (key) => {
    const a = ANSWERS[key] || ANSWERS.free;
    if (s.demo.offline) return;
    setTimeout(() => setTyping(true), 500);
    setTimeout(() => { setTyping(false); add({ from: 'faisal', text: a.text, action: a.action, urgent: a.urgent }); buzz(HAPTIC.knock); }, 1900);
    if (a.follow) setTimeout(() => add({ from: 'faisal', text: a.follow, resolved: true }), 4200);
  };
  const send = (text, key) => {
    if (!text.trim()) return;
    add({ from: 'me', text: text.trim(), queued: !!s.demo.offline, about });
    buzz(HAPTIC.tap);
    reply(key);
  };
  useEffect(() => { if (params.topic && !thread.length) send(TOPICS.find(([k]) => k === params.topic)?.[1] || 'Hi', params.topic); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [thread.length, typing]);
  useEffect(() => {
    if (!s.demo.offline && thread.some((m) => m.queued)) {
      set((p) => ({ support: p.support.map((m) => ({ ...m, queued: false })) }));
      reply('free');
    }
  }, [s.demo.offline]);

  return (
    <div className="screen push">
      <TopBar onBack={pop} right={
        <span className="row" style={{ gap: 8 }}>
          <a className="icon-btn" aria-label="WhatsApp Mada" href="https://wa.me/966920000000" target="_blank" rel="noreferrer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z" /><path d="M9 9.5c.3 1.8 1.7 3.2 3.5 3.5l1-1 2 .8c-.2 1.3-1.3 2-2.5 1.7A6 6 0 0 1 8.3 9.8C8 8.6 8.7 7.5 10 7.3l.8 2z" /></svg></a>
          <a className="icon-btn dark" aria-label="Call Mada" href="tel:+966920000000"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f6f2ec" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" /></svg></a>
        </span>
      } />
      <div className="support-head">
        <span style={{ position: 'relative' }}><span className="avatar green" style={{ width: 52, height: 52, fontSize: 20 }}>F</span><i className="wait-dot" style={{ borderColor: '#e9e2d8' }} /></span>
        <span className="col" style={{ gap: 1 }}>
          <span className="h2" style={{ fontSize: 22 }}>Faisal at Mada</span>
          <span className="tiny">Replies in about 2 minutes · the 24/7 desk covers him at night</span>
        </span>
      </div>
      <div className="support-about"><Icon name="trips" size={16} />About: {about}</div>

      <div className="scroll no-dock" style={{ gap: 10, paddingBottom: 110 }}>
        {thread.length === 0 && (
          <div className="col" style={{ gap: 10 }}>
            <div className="support-msg them rise"><span>Hi {s.user?.name || 'Omar'}. I have your {s.trip ? 'Istanbul trip' : 'account'} open. What can I do?</span></div>
            <div className="chips" style={{ paddingLeft: 4 }}>
              {TOPICS.map(([k, label]) => <button key={k} type="button" className="chip" onClick={() => send(label, k)}>{label}</button>)}
            </div>
          </div>
        )}
        {thread.map((m) => (
          <div key={m.id} className={'support-msg ' + (m.from === 'me' ? 'me' : 'them') + ' rise'}>
            {m.img && <img src={m.img} alt="Photo you sent" style={{ width: 180, borderRadius: 14, display: 'block' }} />}
            {m.text && <span>{m.text}</span>}
            {m.action && <button type="button" className="btn gold small" style={{ alignSelf: 'flex-start' }} onClick={() => push(m.action[1], { from: 'support' })}>{m.action[0]}</button>}
            {m.urgent && <a className="btn primary small" style={{ alignSelf: 'flex-start' }} href="tel:+966920000000">Call the desk now</a>}
            <span className="support-time">{time(m.at)}{m.from === 'me' ? (m.queued ? ' · sends when you’re online' : ' · read') : ''}</span>
          </div>
        ))}
        {typing && <div className="support-msg them"><span className="dots" style={{ color: '#7a857f' }} aria-label="Faisal is typing"><i /><i /><i /></span></div>}
        {thread.some((m) => m.resolved) && !thread.some((m) => m.rated) && (
          <div className="card well rise" style={{ gap: 8 }}>
            <span className="h3" style={{ fontSize: 15 }}>Did that sort it?</span>
            <div className="row">
              <button type="button" className="btn secondary small" onClick={() => add({ from: 'me', text: 'Yes, thanks.', rated: true })}>Yes, thanks</button>
              <button type="button" className="btn secondary small" onClick={() => { add({ from: 'me', text: 'Not yet.', rated: true }); reply('other'); }}>Not yet</button>
            </div>
          </div>
        )}
        <span ref={end} />
      </div>

      <form className="act" style={{ bottom: 24 }} onSubmit={(e) => { e.preventDefault(); send(draft); setDraft(''); }}>
        <div className="row" style={{ height: 52, borderRadius: 999, background: '#fffdf9', border: '1px solid var(--line)', padding: '0 6px 0 8px' }}>
          <label className="icon-btn" aria-label="Send a photo" style={{ width: 40, height: 40, cursor: 'pointer' }}>
            <Icon name="plus" size={20} />
            <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => {
              const f = e.target.files && e.target.files[0]; if (!f) return;
              if (f.size > 10 * 1024 * 1024) { add({ from: 'faisal', text: 'That file is over 10 MB. Send a smaller photo, or a screenshot of the page.' }); return; }
              if (f.type === 'application/pdf') { add({ from: 'me', text: `📄 ${f.name}` }); reply('free'); return; }
              const r = new FileReader(); r.onload = () => { add({ from: 'me', img: r.result }); reply('free'); }; r.readAsDataURL(f);
            }} />
          </label>
          <label htmlFor="support-msg" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Message Faisal</label>
          <input id="support-msg" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message Faisal" style={{ flex: '1 1 auto', minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontSize: 16 }} />
          <button type="submit" className="icon-btn dark" aria-label="Send" style={{ width: 40, height: 40 }} disabled={!draft.trim()}><Icon name="up" color="#f6f2ec" size={18} /></button>
        </div>
      </form>
    </div>
  );
}

/* Everything that happened, so a missed banner is never lost. */
const KIND_ICON = { trip: 'flight', reply: 'doc', money: 'refund', booking: 'check', circle: 'circles' };

export function Inbox() {
  const { s, set, pop, openBanner } = useStore();
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
          <div className="card well" style={{ alignItems: 'flex-start' }}>
            <Sun width={36} color="#b98f4a" />
            <span className="h3">Nothing here yet.</span>
            <span className="small">Gate changes, replies from Faisal, refunds and circle news land here, so nothing gets lost.</span>
          </div>
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

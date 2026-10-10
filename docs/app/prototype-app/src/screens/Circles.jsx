import React, { useState } from 'react';
import { useStore, buzz, HAPTIC, fmt } from '../store.jsx';
import { Icon, Sun, TopBar, Sheet, Toggle } from '../ui.jsx';
import { PLANS } from './Plan.jsx';

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
};

const SEED_POSTS = [
  { id: 'p1', who: 'Noor', initial: 'N', tone: 'gold', rel: 'Friend', city: 'Istanbul', place: 'Künefe near Galata Tower', text: 'Go before 8pm, it sells out. Ask for it with kaymak. Halal, family seating upstairs.', img: 'img/istanbul.jpg', saves: 24, kind: 'Food' },
  { id: 'p2', who: 'Abdullah', initial: 'A', tone: 'green', rel: 'Friend', city: 'Riyadh', place: 'Desert camp, Thumamah', text: 'Took the kids last Friday. Book the 5pm slot, you catch sunset and it’s not cold yet.', img: 'img/alula.jpg', saves: 11, kind: 'Things to do' },
  { id: 'p3', who: 'Reem', initial: 'R', tone: '', rel: 'Mada traveller · 14 trips', city: 'Istanbul', place: 'Breakfast in Cihangir', text: 'Turkish breakfast for 6 for about SAR 300. Window table if you go before 10.', img: null, saves: 52, kind: 'Food' },
  { id: 'p4', who: 'Faris', initial: 'F', tone: '', rel: 'Mada traveller · 6 trips', city: 'Riyadh', place: 'Bujairi Terrace, Diriyah', text: 'Go at sunset and walk At-Turaif after. Parking fills up after 7.', img: 'img/riyadh.jpg', saves: 38, kind: 'Food' },
];

const STAMPS = [
  { city: 'Istanbul', date: 'MAR 27', color: '#b98f4a', rot: -8, upcoming: true },
  { city: 'Baku', date: 'APR 26', color: '#7d5d27', rot: -4 },
  { city: 'AlUla', date: 'JAN 26', color: '#1e352d', rot: 6 },
  { city: 'Abha', date: 'AUG 25', color: '#1e352d', rot: 9 },
  { city: 'London', date: 'JUL 25', color: '#7d5d27', rot: -10 },
];

export default function Circles() {
  const { s, set, push, toast } = useStore();
  const c = s.circles;
  const [sheet, setSheet] = useState(null);
  const [who, setWho] = useState(c.aroundWho || 'picked');
  const [pressed, setPressed] = useState(null);
  const [reason, setReason] = useState(null);
  const [posts, setPosts] = useState(SEED_POSTS);
  const city = s.trip ? 'Istanbul' : 'Riyadh';
  const setC = (patch) => set((p) => ({ circles: { ...p.circles, ...patch } }));
  const noorHidden = c.hidden.includes('noor');
  const [view, setView] = useState('discover');

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
            : <button type="button" className="btn primary small" onClick={() => setSheet('invite')}>Invite</button>}
        </div>
        {view === 'discover' ? <Discover posts={posts} setPosts={setPosts} /> : (<>

        <div className="card focal rise" style={{ padding: 18, gap: 14 }}>
          {!noorHidden && s.trip && (
            <>
              <div className="row" style={{ gap: 12 }}>
                <span style={{ position: 'relative' }}><span className="avatar gold" style={{ width: 44, height: 44 }}>N</span><span className="pulse" style={{ position: 'absolute', right: -1, bottom: -1, width: 12, height: 12, borderRadius: 999, background: '#d9b77a', border: '2px solid #1e352d' }} /></span>
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

        <div className="spread"><h2 className="h2">Your groups</h2><span className="tiny">3</span></div>
        <div className="chips scrollx" style={{ gap: 10 }}>
          <button type="button" className="photo" style={{ width: 210, height: 128, border: 0, padding: 0, flexShrink: 0 }} onClick={() => push('group')}>
            <img src="img/istanbul.jpg" alt="" /><span className="shade" />
            <span className="pill gold" style={{ position: 'absolute', top: 10, left: 10 }}>2 new</span>
            <span className="over" style={{ textAlign: 'left', gap: 2 }}><span className="display" style={{ fontSize: 22, color: '#fffdf9' }}>Istanbul for Eid</span><span className="tiny" style={{ color: 'rgba(255,253,249,.9)' }}>6 people · vote on the cruise</span></span>
          </button>
          {[['Family', '4 people · documents', ['O', 'H', 'S']], ['Riyadh Season', '8 friends · 2 events', ['A', 'F', '+5']]].map(([t, sub, av]) => (
            <button key={t} type="button" className="card tap" style={{ width: 150, height: 128, flexShrink: 0, justifyContent: 'space-between', boxSizing: 'border-box' }} onClick={() => push('group')}>
              <span className="stack">{av.map((a, i) => <span key={a} className={'avatar sm' + (i === 0 ? ' green' : i === 1 ? ' gold' : '')} style={{ borderColor: '#fffdf9' }}>{a}</span>)}</span>
              <span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{t}</span><span className="tiny">{sub}</span></span>
            </button>
          ))}
        </div>

        <div className="spread"><h2 className="h2">Saved</h2><span className="tiny">From you and your friends</span></div>
        {(s.savedPlans || []).map((id) => (
          <button key={id} type="button" className="card tap" style={{ flexDirection: 'row', alignItems: 'center' }} onClick={() => push('plan', { id })}>
            <img src={PLANS[id].img} alt="" style={{ width: 48, height: 48, borderRadius: 14, objectFit: 'cover' }} />
            <span className="grow col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{PLANS[id].title}</span><span className="tiny">Saved plan · {PLANS[id].days} days</span></span><Icon name="chevron" />
          </button>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 10 }}>
          {[['img/istanbul.jpg', 'Istanbul with the kids', '8 places', 'A hotel in Istanbul'], ['img/alula.jpg', 'AlUla weekend', '5 places · 3 from Abdullah', 'A weekend in AlUla']].map(([img, t, sub, pre]) => (
            <button key={t} type="button" className="photo" style={{ height: 112, border: 0, padding: 0 }} onClick={() => push('ask', { prefill: pre })}>
              <img src={img} alt="" /><span className="shade" />
              <span className="over" style={{ textAlign: 'left', gap: 0, padding: 12 }}><span className="h3" style={{ fontSize: 14, color: '#fffdf9' }}>{t}</span><span className="tiny" style={{ color: 'rgba(255,253,249,.9)' }}>{sub}</span></span>
            </button>
          ))}
        </div>

        <div className="spread"><h2 className="h2">Your passport</h2><span className="tiny">14 countries · 9 Saudi places</span></div>
        <div className="card" style={{ gap: 14 }}>
          <div className="chips scrollx" style={{ gap: 12, padding: '4px 18px', margin: '0 -16px' }}>
            {STAMPS.map((st) => (
              <button key={st.city} type="button" aria-label={`${st.city} stamp${st.upcoming ? ', after this trip' : ''}`} onClick={() => { setPressed(pressed === st.city ? null : st.city); buzz([0, 10, 40, 10, 40, 10]); }}
                style={{ flexShrink: 0, width: 76, height: 76, borderRadius: 999, border: `2px ${st.upcoming ? 'dashed' : 'solid'} ${st.color}`, background: 'transparent', padding: 0, display: 'grid', placeItems: 'center', color: st.color, opacity: st.upcoming ? 0.55 : 1, transform: `rotate(${pressed === st.city ? 0 : st.rot}deg) scale(${pressed === st.city ? 1.12 : 1})`, transition: 'transform .35s var(--spring)' }}>
                <span style={{ width: 64, height: 64, borderRadius: 999, border: `1px dashed ${st.color}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                  <span style={{ fontFamily: 'var(--f-display)', fontSize: 15 }}>{st.city}</span>
                  <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.08em' }}>{st.upcoming ? 'SOON' : st.date}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <span className="stack"><span className="avatar sm green" style={{ borderColor: '#fffdf9' }}>A</span><span className="avatar sm gold" style={{ borderColor: '#fffdf9' }}>N</span><span className="avatar sm" style={{ borderColor: '#fffdf9' }}>O</span></span>
            <span className="small grow" style={{ color: '#3f4f48' }}>You're 2nd among friends for places explored. Abdullah leads with 19.</span>
          </div>
        </div>
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
      {sheet === 'invite' && (
        <Sheet label="Invite" onClose={() => setSheet(null)}>
          <h2 className="h2">Invite someone you travel with</h2>
          <p className="small">They join your circle when they open the link. Nothing is shared until they accept.</p>
          <input className="input" readOnly value="madatrips.sa/join/omar-8k2" onFocus={(e) => e.target.select()} aria-label="Invite link" />
          <button type="button" className="btn primary block" onClick={async () => { try { await navigator.clipboard.writeText('https://madatrips.sa/join/omar-8k2'); toast('Link copied. Paste it in WhatsApp.'); } catch (e) { toast('Select the link above to copy it.'); } }}>Copy link</button>
        </Sheet>
      )}
    </div>
  );
}

export function Group() {
  const { s, set, pop, push, toast } = useStore();
  const c = s.circles;
  const [van, setVan] = useState(null);
  const [vote, setVote] = useState(null);
  const [cruise, setCruise] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [draft, setDraft] = useState('');
  const counts = { wed: 3 + (vote === 'wed' ? 1 : 0), thu: 1 + (vote === 'thu' ? 1 : 0) };
  const total = counts.wed + counts.thu;
  const day = counts.thu > counts.wed ? 'Thursday' : 'Wednesday';
  return (
    <div className="screen push">
      <TopBar onBack={pop} backLabel="Circles" right={<span className="stack"><span className="avatar sm">O</span><span className="avatar sm gold">H</span><span className="avatar sm green">A</span><span className="avatar sm" style={{ fontSize: 10 }}>+3</span></span>} />
      <div style={{ padding: '0 24px 8px' }}>
        <h1 className="display" style={{ fontSize: 34 }}>Istanbul for Eid</h1>
        <span className="tiny">9–15 Mar · 2 families · 6 people · Instant answers from Mada. A Mada agent confirms anything you book.</span>
      </div>
      <div className="scroll no-dock" style={{ paddingBottom: 100 }}>
        <Bubble who="mada">
          <span>Abdullah and Noor land 40 minutes after you. We've put everyone in one van, so it waits for both families.</span>
          {van ? <span className="row tiny" style={{ color: '#2f7a4b', fontWeight: 600 }}><Icon name="check" size={16} color="#2f7a4b" width={2.4} />{van === 'one' ? 'One van for both families' : 'Two cars, one for each family'}</span> : (
            <span className="row"><button type="button" className="btn primary small" onClick={() => { setVan('one'); buzz(HAPTIC.select); }}>Keep one van</button><button type="button" className="btn secondary small" style={{ background: '#f6f2ec' }} onClick={() => { setVan('two'); buzz(HAPTIC.select); }}>Separate cars</button></span>
          )}
        </Bubble>
        <Bubble who="H" name="Hessa" tone="gold" soft>Can we all do a Bosphorus dinner cruise one evening?</Bubble>
        <div className="card" style={{ marginLeft: 42, gap: 10 }}>
          <span className="h3" style={{ fontSize: 15 }}>Which evening?</span>
          {[['wed', 'Wed 10 Mar'], ['thu', 'Thu 11 Mar']].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={vote === id ? 'true' : 'false'} onClick={() => { setVote(vote === id ? null : id); buzz(HAPTIC.select); }}
              style={{ position: 'relative', height: 44, borderRadius: 14, border: vote === id ? '2px solid #1e352d' : '1px solid var(--line)', background: '#f6f2ec', overflow: 'hidden', padding: 0, textAlign: 'left' }}>
              <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round((counts[id] / total) * 100)}%`, background: vote === id ? '#ecd9b0' : '#efe9e0', transition: 'width .5s var(--ease)' }} />
              <span className="spread" style={{ position: 'relative', height: 44, padding: '0 14px', fontSize: 14, fontWeight: 600 }}><span>{label}</span><span className="num">{counts[id]}</span></span>
            </button>
          ))}
          <span className="tiny">{vote ? `You voted. ${total - 1} others have too.` : 'Hessa asked · 4 of 6 voted'}</span>
        </div>
        <Bubble who="F" name="Faisal · your Mada agent" tone="green">
          <span>I'm holding 6 seats on the {day} cruise at 19:30 until Monday. SAR 1,140 for everyone.</span>
          {cruise ? <span className="row tiny" style={{ color: '#2f7a4b', fontWeight: 600 }}><Icon name="check" size={16} color="#2f7a4b" width={2.4} />Confirmed by Faisal at Mada</span>
            : <button type="button" className="btn gold small" style={{ alignSelf: 'flex-start' }} onClick={() => { setCruise(true); buzz(HAPTIC.success); }}>Book it</button>}
        </Bubble>
        {cruise && (
          <div className="card rise" style={{ marginLeft: 42 }}>
            <span className="h3" style={{ fontSize: 15 }}>Split between the families</span>
            <span className="small">Your share SAR 570 · Abdullah's share SAR 570</span>
            {c.sharePaid ? <span className="pill ok" style={{ alignSelf: 'flex-start' }}>Abdullah paid his share</span>
              : <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start', background: '#f6f2ec' }} onClick={() => push('pay', { kind: 'share', amount: 570 })}>Pay Abdullah's share (demo)</button>}
          </div>
        )}
        {msgs.map((m, i) => <Bubble key={i} who="O" name="You" mine>{m}</Bubble>)}
      </div>
      <form className="act" style={{ bottom: 24 }} onSubmit={(e) => { e.preventDefault(); if (!draft.trim()) return; setMsgs([...msgs, draft.trim()]); setDraft(''); buzz(HAPTIC.tap); }}>
        <div className="row" style={{ height: 52, borderRadius: 999, background: '#fffdf9', border: '1px solid var(--line)', padding: '0 6px 0 20px' }}>
          <label htmlFor="msg" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Message the group</label>
          <input id="msg" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message the group" style={{ flex: '1 1 auto', minWidth: 0, border: 0, outline: 'none', background: 'transparent', fontSize: 16 }} />
          <button type="submit" className="icon-btn dark" aria-label="Send" style={{ width: 40, height: 40 }}><Icon name="up" color="#f6f2ec" size={18} /></button>
        </div>
      </form>
    </div>
  );
}

function Bubble({ who, name, tone, soft, mine, children }) {
  return (
    <div className="row rise" style={{ alignItems: 'flex-start', gap: 10, flexDirection: mine ? 'row-reverse' : 'row' }}>
      {who === 'mada'
        ? <span className="avatar sm green"><Sun width={18} /></span>
        : <span className={'avatar sm' + (tone ? ' ' + tone : '')}>{who}</span>}
      <div className="col" style={{ gap: 8, padding: '10px 14px', borderRadius: mine ? '22px 6px 22px 22px' : '6px 22px 22px 22px', background: mine ? '#1e352d' : soft ? '#f6f2ec' : '#fffdf9', color: mine ? '#f6f2ec' : '#1e352d', fontSize: 15, lineHeight: 1.45, maxWidth: '82%' }}>
        <span className="tiny" style={{ fontWeight: 600, color: mine ? '#c9c1b4' : undefined }}>{who === 'mada' ? 'Mada' : name}</span>
        {children}
      </div>
    </div>
  );
}

function Discover({ posts, setPosts }) {
  const { s, push, toast } = useStore();
  const cities = s.trip ? ['Istanbul', 'Riyadh'] : ['Riyadh', 'Istanbul'];
  const [city, setCity] = useState(cities[0]);
  const [filter, setFilter] = useState('All');
  const [saved, setSaved] = useState([]);
  const feed = posts.filter((p) => p.city === city && (filter === 'All' || p.kind === filter))
    .sort((a, b) => (a.rel === 'Friend' ? -1 : 0) - (b.rel === 'Friend' ? -1 : 0));
  const otherCity = cities.find((c) => c !== city);
  return (
    <>
      <h2 className="h2" style={{ fontSize: 22 }}>
        On this week in{' '}
        <button type="button" className="city-switch" onClick={() => { setCity(otherCity); buzz(HAPTIC.select); }} aria-label={`${city}. Switch to ${otherCity}`}>
          {city}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7d5d27" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
      </h2>
      {s.trip && city === 'Istanbul' && <span className="tiny" style={{ marginTop: -8 }}>While you're there, 9–15 Mar</span>}
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
        const on = saved.includes(p.id);
        return (
          <article key={p.id} className={'story rise' + (p.img ? '' : ' plain')} style={{ animationDelay: `${i * 0.05}s` }}>
            {p.img && <img className="bg" src={p.img} alt="" style={{ objectPosition: '50% 55%' }} />}
            <span className="veil" />
            <div className="top">
              <span className="row" style={{ gap: 8, padding: '4px 12px 4px 4px', borderRadius: 999, background: 'rgba(15,26,22,.45)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
                <span className={'avatar sm' + (p.tone ? ' ' + p.tone : '')} style={{ width: 28, height: 28 }}>{p.initial}</span>
                <span className="col" style={{ gap: 0 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{p.who}</span><span style={{ fontSize: 11, color: 'rgba(255,253,249,.8)' }}>{p.rel}{p.pending ? ' · being checked' : ''}</span></span>
              </span>
              <span className="pill glass">{p.kind === 'Things to do' ? 'To do' : p.kind}</span>
            </div>
            <div className="body">
              {!p.img && <span aria-hidden="true" style={{ fontFamily: 'var(--f-display)', fontSize: 64, lineHeight: 0.6, color: '#d9b77a', marginTop: 30 }}>“</span>}
              <p className="quote">{p.text}</p>
              <span className="row" style={{ gap: 6, fontSize: 14, fontWeight: 600, color: 'rgba(255,253,249,.92)' }}><Icon name="pin" size={16} color="#d9b77a" />{p.place}</span>
              <div className="row" style={{ marginTop: 4 }}>
                <button type="button" className={'glass-btn' + (on ? ' on' : '')} aria-pressed={on ? 'true' : 'false'} onClick={() => { setSaved(on ? saved.filter((x) => x !== p.id) : [...saved, p.id]); buzz(HAPTIC.select); if (!on) toast('Saved to your ' + city + ' collection.'); }}>
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

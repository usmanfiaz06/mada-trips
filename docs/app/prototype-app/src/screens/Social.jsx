import React, { useEffect, useState } from 'react';
import { UserAvatar } from './Account.jsx';
import { useStore, buzz, HAPTIC, PEOPLE } from '../store.jsx';
import { Icon, TopBar, Sheet, Toggle, InviteSheet } from '../ui.jsx';

/* People on Mada who aren't in the household. */
export const FRIENDS = {
  abdullah: { name: 'Abdullah Alqahtani', short: 'Abdullah', initial: 'A', tone: 'green', since: '2024', places: 19, going: 'Istanbul · 10–14 Mar', mutual: 3 },
  noor: { name: 'Noor Alsaud', short: 'Noor', initial: 'N', tone: 'gold', since: '2025', places: 11, going: 'Istanbul · 10–14 Mar', mutual: 2 },
  khalid: { name: 'Khalid Alotaibi', short: 'Khalid', initial: 'K', tone: '', since: '2025', places: 7, going: null, mutual: 1 },
  faris: { name: 'Faris Almutairi', short: 'Faris', initial: 'F', tone: '', since: '2026', places: 6, going: 'London · June', mutual: 2 },
  maha: { name: 'Maha Alharbi', short: 'Maha', initial: 'M', tone: 'gold', since: null, places: 0, going: null, mutual: 1 },
  yousef: { name: 'Yousef Alshehri', short: 'Yousef', initial: 'Y', tone: 'green', since: '2026', places: 4, going: null, mutual: 2 },
  reem: { name: 'Reem Aldosari', short: 'Reem', initial: 'R', tone: '', since: null, places: 14, going: null, mutual: 2 },
};
/* Contacts on this phone who are already on Mada (demo). */
const CONTACTS = ['maha', 'yousef', 'reem'];

export const person = (id) => {
  if (id === 'omar') return { short: 'You', name: 'You', initial: 'O', tone: 'green' };
  if (FRIENDS[id]) return FRIENDS[id];
  const p = PEOPLE[id];
  return p ? { short: p.name, name: p.full || p.name, initial: p.initial || p.name.charAt(0), tone: '', household: true } : { short: 'Someone', name: 'Someone', initial: '?', tone: '' };
};

export const SEED_POSTS = [
  { id: 'p1', who: 'Noor', uid: 'noor', initial: 'N', tone: 'gold', rel: 'Friend', city: 'Istanbul', place: 'Künefe near Galata Tower', text: 'Go before 8pm, it sells out. Ask for it with kaymak. Halal, family seating upstairs.', img: 'img/istanbul.jpg', saves: 24, kind: 'Food', when: '2 days ago' },
  { id: 'p2', who: 'Abdullah', uid: 'abdullah', initial: 'A', tone: 'green', rel: 'Friend', city: 'Riyadh', place: 'Desert camp, Thumamah', text: 'Took the kids last Friday. Book the 5pm slot, you catch sunset and it’s not cold yet.', img: 'img/alula.jpg', saves: 11, kind: 'Things to do', when: 'Last week' },
  { id: 'p3', who: 'Reem', uid: 'reem', initial: 'R', tone: '', rel: 'Mada traveller · 14 trips', city: 'Istanbul', place: 'Breakfast in Cihangir', text: 'Turkish breakfast for 6 for about SAR 300. Window table if you go before 10.', img: null, saves: 52, kind: 'Food', when: '3 weeks ago' },
  { id: 'p4', who: 'Faris', uid: 'faris', initial: 'F', tone: '', rel: 'Friend', city: 'Riyadh', place: 'Bujairi Terrace, Diriyah', text: 'Go at sunset and walk At-Turaif after. Parking fills up after 7.', img: 'img/riyadh.jpg', saves: 38, kind: 'Food', when: 'Yesterday' },
  { id: 'p5', who: 'Abdullah', uid: 'abdullah', initial: 'A', tone: 'green', rel: 'Friend', city: 'AlUla', place: 'Maraya at night', text: 'The concert hall is mirrors outside. Go for the light show, book the 9pm dinner in advance.', img: 'img/alula.jpg', saves: 19, kind: 'Things to do', when: 'Last month' },
];

const COVERS = [null, 'img/istanbul.jpg', 'img/alula.jpg', 'img/riyadh.jpg'];

export function Avatar({ id, size = 40, ring }) {
  if (id === 'omar') return <UserAvatar size={size} ring={ring} />;
  const p = person(id);
  return <span className={'avatar' + (p.tone ? ' ' + p.tone : '')} style={{ width: size, height: size, fontSize: size * 0.4, flexShrink: 0, ...(ring ? { borderColor: ring } : null) }}>{p.initial}</span>;
}

function PersonRow({ id, sub, right, onClick, on }) {
  const p = person(id);
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag {...(onClick ? { type: 'button', onClick, 'aria-pressed': on === undefined ? undefined : on ? 'true' : 'false' } : {})} className={'person-row' + (on ? ' on' : '')}>
      <Avatar id={id} />
      <span className="grow col" style={{ gap: 0, minWidth: 0 }}><span className="h3" style={{ fontSize: 15 }}>{p.name}</span>{sub && <span className="tiny">{sub}</span>}</span>
      {right}
    </Tag>
  );
}

const Tick = ({ on }) => <span className={'tickbox' + (on ? ' on' : '')} aria-hidden="true">{on && <Icon name="check" size={14} color="#f6f2ec" width={2.6} />}</span>;

/* ---------- new circle ---------- */

export function NewCircle({ params = {} }) {
  const { s, set, pop, replace, toast } = useStore();
  const [name, setName] = useState('');
  const [cover, setCover] = useState(s.trip ? 'img/istanbul.jpg' : null);
  const [picked, setPicked] = useState(params.with ? [params.with] : []);
  const [q, setQ] = useState('');
  const [trip, setTrip] = useState(params.with ? 'new' : 'none');
  const [invite, setInvite] = useState(false);
  const pool = [...s.household.filter((id) => id !== 'omar'), ...s.friends];
  const term = q.trim().toLowerCase();
  const shown = pool.filter((id) => !term || person(id).name.toLowerCase().includes(term));
  const dupe = s.groups.some((g) => g.name.trim().toLowerCase() === name.trim().toLowerCase());
  const ok = name.trim().length >= 2 && !dupe;
  const toggle = (id) => { setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]); buzz(HAPTIC.select); };
  const create = () => {
    const id = 'g' + Date.now();
    const g = { id, name: name.trim(), img: cover, members: ['omar', ...picked], admin: 'omar', unread: 0, sub: picked.length ? 'just started' : 'only you so far', trip: trip === 'trip' ? 'Istanbul · 9–15 Mar' : trip === 'new' ? 'Somewhere new' : null, muted: false, fresh: true };
    set((p) => ({ groups: [g, ...p.groups] }));
    buzz(HAPTIC.success);
    toast(picked.length ? `Circle made. We’ve told ${picked.length === 1 ? person(picked[0]).short : picked.length + ' people'}.` : 'Circle made. Share the link to bring people in.');
    replace('group', { id });
  };
  return (
    <div className="screen push">
      <TopBar onBack={pop} backLabel="Cancel" />
      <div className="scroll no-dock" style={{ gap: 18, paddingBottom: 120 }}>
        <h1 className="h1">A new circle</h1>
        <div className="field">
          <label htmlFor="nc-name">Name it</label>
          <input id="nc-name" className={'input' + (dupe ? ' bad' : '')} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="Summer in Baku" />
          {dupe ? <span className="err" role="alert">You already have a circle called {name.trim()}.</span>
            : <div className="chips">{['Eid trip', 'Weekend crew', 'Work trip', 'Cousins'].map((t) => <button key={t} type="button" className="chip" onClick={() => setName(t)}>{t}</button>)}</div>}
        </div>

        <div className="col" style={{ gap: 8 }}>
          <span className="eyebrow">Cover</span>
          <div className="row" style={{ gap: 10 }} role="radiogroup" aria-label="Cover">
            {COVERS.map((c) => (
              <button key={c || 'plain'} type="button" role="radio" aria-checked={cover === c ? 'true' : 'false'} aria-label={c ? c.split('/')[1].split('.')[0] : 'Plain green'} onClick={() => { setCover(c); buzz(HAPTIC.select); }}
                className={'cover-pick' + (cover === c ? ' on' : '')} style={c ? { backgroundImage: `url(${c})` } : { background: '#1e352d' }} />
            ))}
          </div>
        </div>

        <div className="col" style={{ gap: 8 }}>
          <div className="spread"><span className="eyebrow">Who’s in</span><span className="tiny">{picked.length ? `${picked.length} picked` : 'Optional'}</span></div>
          {pool.length > 5 && <input className="input" placeholder="Search friends and family" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search friends and family" />}
          {shown.map((id) => (
            <PersonRow key={id} id={id} sub={person(id).household ? 'Family' : 'Friend'} on={picked.includes(id)} onClick={() => toggle(id)} right={<Tick on={picked.includes(id)} />} />
          ))}
          {shown.length === 0 && <span className="small">Nobody called “{q.trim()}” yet. Invite them with a link.</span>}
          <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => setInvite(true)}><Icon name="link" size={18} />Invite someone not on Mada</button>
        </div>

        <div className="col" style={{ gap: 8 }}>
          <span className="eyebrow">Planning a trip together?</span>
          <div className="chips" role="radiogroup" aria-label="Trip">
            {[['none', 'Not yet'], ...(s.trip ? [['trip', 'Our Istanbul trip']] : []), ['new', 'Somewhere new']].map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={trip === id ? 'true' : 'false'} className={'chip' + (trip === id ? ' on' : '')} onClick={() => setTrip(id)}>{label}</button>
            ))}
          </div>
          {trip !== 'none' && <span className="tiny">Mada joins the circle to answer questions. A Mada agent confirms anything you book.</span>}
        </div>
      </div>
      <div className="act"><button type="button" className="btn primary block" disabled={!ok} onClick={create}>{ok ? `Make ${name.trim()}` : 'Make the circle'}</button></div>
      {invite && <InviteSheet what={name.trim() || 'your circle'} onClose={() => setInvite(false)} />}
    </div>
  );
}

/* ---------- circle settings ---------- */

export function GroupInfo({ group, onClose }) {
  const { s, set, pop, toast } = useStore();
  const [sheet, setSheet] = useState(null);
  const [rename, setRename] = useState(group.name);
  const [target, setTarget] = useState(null);
  const admin = group.admin === 'omar';
  const patch = (p) => set((st) => ({ groups: st.groups.map((g) => (g.id === group.id ? { ...g, ...p } : g)) }));
  const others = group.members.filter((m) => m !== 'omar');
  const addable = [...s.household.filter((id) => id !== 'omar'), ...s.friends].filter((id) => !group.members.includes(id));
  const [adding, setAdding] = useState([]);
  const leave = () => {
    set((st) => ({ groups: others.length ? st.groups.map((g) => (g.id === group.id ? { ...g, members: others, admin: admin ? others[0] : g.admin, left: true } : g)).filter((g) => g.id !== group.id) : st.groups.filter((g) => g.id !== group.id) }));
    buzz(HAPTIC.success); toast(others.length ? `You left ${group.name}.` : `${group.name} is deleted.`); onClose(); pop();
  };

  if (sheet === 'rename') return (
    <Sheet label="Rename" onClose={() => setSheet(null)}>
      <h2 className="h2">Rename the circle</h2>
      <input className="input" maxLength={40} value={rename} onChange={(e) => setRename(e.target.value)} aria-label="Circle name" />
      <span className="tiny">Everyone in the circle sees the new name.</span>
      <button type="button" className="btn primary block" disabled={rename.trim().length < 2} onClick={() => { patch({ name: rename.trim() }); setSheet(null); toast('Renamed.'); }}>Save</button>
    </Sheet>
  );
  if (sheet === 'add') return (
    <Sheet label="Add people" onClose={() => setSheet(null)}>
      <h2 className="h2">Add people</h2>
      {addable.length === 0 && <span className="small">Everyone you know on Mada is already here. Invite others with a link.</span>}
      {addable.map((id) => <PersonRow key={id} id={id} on={adding.includes(id)} onClick={() => setAdding(adding.includes(id) ? adding.filter((x) => x !== id) : [...adding, id])} right={<Tick on={adding.includes(id)} />} />)}
      <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => setSheet('invite')}><Icon name="link" size={18} />Invite with a link</button>
      <button type="button" className="btn primary block" disabled={!adding.length} onClick={() => { patch({ members: [...group.members, ...adding] }); buzz(HAPTIC.success); toast(`Added ${adding.map((id) => person(id).short).join(', ')}.`); setAdding([]); setSheet(null); }}>Add {adding.length || ''}</button>
    </Sheet>
  );
  if (sheet === 'invite') return <InviteSheet what={group.name} onClose={() => setSheet(null)} />;
  if (sheet === 'member') {
    const p = person(target);
    return (
      <Sheet label={p.name} onClose={() => setSheet(null)}>
        <div className="row"><Avatar id={target} size={48} /><div className="col" style={{ gap: 0 }}><span className="h2">{p.name}</span><span className="tiny">{group.admin === target ? 'Admin' : 'Member'}</span></div></div>
        {admin && <button type="button" className="card tap well" onClick={() => { patch({ admin: target }); setSheet(null); toast(`${p.short} is the admin now.`); }}><span className="h3" style={{ fontSize: 15 }}>Make {p.short} the admin</span><span className="tiny">You stay in the circle.</span></button>}
        {admin && <button type="button" className="card tap well" onClick={() => { patch({ members: group.members.filter((m) => m !== target) }); setSheet(null); toast(`${p.short} is out of the circle. They aren’t told why.`); }}><span className="h3" style={{ fontSize: 15, color: '#8a3524' }}>Remove from the circle</span><span className="tiny">Their messages stay. They lose access to shared plans.</span></button>}
        {!admin && <span className="small">Only the admin, {person(group.admin).short}, can add or remove people.</span>}
      </Sheet>
    );
  }
  if (sheet === 'leave') return (
    <Sheet label="Leave" onClose={() => setSheet(null)}>
      <h2 className="h2">{others.length ? `Leave ${group.name}?` : `Delete ${group.name}?`}</h2>
      <p className="body">{!others.length ? 'You’re the only one here, so the circle is deleted.' : admin ? `${person(others[0]).short} becomes the admin. Bookings you made stay yours.` : 'You won’t see new messages. Bookings you made stay yours.'}</p>
      <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={leave}>{others.length ? 'Leave' : 'Delete'}</button>
      <button type="button" className="btn ghost block" onClick={() => setSheet(null)}>Stay</button>
    </Sheet>
  );
  if (sheet === 'delete') return (
    <Sheet label="Delete for everyone" onClose={() => setSheet(null)}>
      <h2 className="h2">Delete it for everyone?</h2>
      <p className="body">Messages, votes and shared plans go for all {group.members.length}. Bookings stay with whoever made them.</p>
      <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={() => { set((st) => ({ groups: st.groups.filter((g) => g.id !== group.id) })); toast(`${group.name} is deleted.`); onClose(); pop(); }}>Delete for everyone</button>
      <button type="button" className="btn ghost block" onClick={() => setSheet(null)}>Keep it</button>
    </Sheet>
  );

  return (
    <Sheet label="Circle settings" onClose={onClose}>
      <div className="spread">
        <h2 className="h2">{group.name}</h2>
        {admin && <button type="button" className="link" onClick={() => setSheet('rename')}>Rename</button>}
      </div>
      <span className="tiny">{group.members.length} {group.members.length === 1 ? 'person' : 'people'}{group.trip ? ' · ' + group.trip : ''} · {admin ? 'you’re the admin' : person(group.admin).short + ' is the admin'}</span>
      <div className="col" style={{ gap: 6 }}>
        {group.members.map((id) => (
          <PersonRow key={id} id={id} sub={id === group.admin ? 'Admin' : person(id).household ? 'Family' : null}
            onClick={id === 'omar' ? undefined : () => { setTarget(id); setSheet('member'); }} right={id === 'omar' ? null : <Icon name="chevron" />} />
        ))}
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {admin && <button type="button" className="btn secondary small" onClick={() => setSheet('add')}><Icon name="plus" size={18} />Add people</button>}
        <button type="button" className="btn secondary small" onClick={() => setSheet('invite')}><Icon name="link" size={18} />Invite with a link</button>
      </div>
      <div className="spread" style={{ padding: '6px 0' }}>
        <span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>Mute</span><span className="tiny">Bookings and votes still reach you.</span></span>
        <Toggle checked={!!group.muted} label="Mute this circle" onChange={(v) => { patch({ muted: v }); toast(v ? 'Muted.' : 'Unmuted.'); }} />
      </div>
      <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={() => setSheet('leave')}>{others.length ? 'Leave the circle' : 'Delete the circle'}</button>
      {admin && others.length > 0 && <button type="button" className="btn ghost block" style={{ color: '#8a3524' }} onClick={() => setSheet('delete')}>Delete for everyone</button>}
    </Sheet>
  );
}

/* ---------- people: friends, invited, requests ---------- */

export function People({ params = {} }) {
  const { s, set, pop, push, toast } = useStore();
  const [tab, setTab] = useState(params.tab || 'friends');
  const [sheet, setSheet] = useState(null);
  const [contacts, setContacts] = useState(null);
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState([]);
  const invites = s.invites || [];
  const requests = s.friendRequests || [];
  const patchInvite = (id, p) => set((st) => ({ invites: st.invites.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
  const digits = phone.replace(/\D/g, '');
  const phoneOk = /^5\d{8}$/.test(digits);
  const found = phoneOk ? (digits.endsWith('7') ? 'khalid' : null) : null;
  return (
    <div className="screen push">
      <TopBar onBack={pop} backLabel="Circles" right={<button type="button" className="btn primary small" onClick={() => setSheet('add')}>Add friends</button>} />
      <div className="scroll no-dock" style={{ gap: 14 }}>
        <h1 className="h1">Your people</h1>
        <div className="tabs-text small-tabs" role="tablist" aria-label="People">
          {[['friends', 'Friends', s.friends.length], ['following', 'Following', (s.following || []).length], ['invited', 'Invited', invites.filter((i) => i.status === 'pending').length], ['requests', 'Requests', requests.length]].map(([id, label, n]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id ? 'true' : 'false'} onClick={() => { setTab(id); buzz(HAPTIC.select); }}>{label}{n ? <sup>{n}</sup> : null}</button>
          ))}
        </div>

        {tab === 'friends' && (s.friends.length ? s.friends.map((id) => (
          <PersonRow key={id} id={id} sub={FRIENDS[id].going ? `Going to ${FRIENDS[id].going}` : `${FRIENDS[id].places} places explored`} onClick={() => push('friend', { id })} right={<Icon name="chevron" />} />
        )) : <div className="card well"><span className="h3">No friends here yet.</span><span className="small">Add people you travel with. Only they see your tips and plans.</span></div>)}

        {tab === 'following' && ((s.following || []).length ? s.following.map((id) => (
          <PersonRow key={id} id={id} sub={`${FRIENDS[id].places} trips · public tips`} onClick={() => push('friend', { id })} right={<Icon name="chevron" />} />
        )) : <div className="card well"><span className="h3">You don’t follow anyone yet.</span><span className="small">Tap a name on any tip in Discover to see their profile and follow them.</span></div>)}

        {tab === 'invited' && (invites.length ? invites.map((iv) => (
          <div key={iv.id} className="person-row" style={{ alignItems: 'flex-start' }}>
            <span className="avatar" style={{ width: 40, height: 40 }}>{iv.name.charAt(0)}</span>
            <span className="grow col" style={{ gap: 4 }}>
              <span className="spread"><span className="h3" style={{ fontSize: 15 }}>{iv.name}</span><span className={'pill' + (iv.status === 'joined' ? ' ok' : '')}>{iv.status === 'joined' ? 'Joined' : iv.status === 'expired' ? 'Link expired' : 'Not yet'}</span></span>
              <span className="tiny">Sent by {iv.via} · {iv.when}{iv.reminded ? ' · reminded today' : ''}</span>
              {iv.status === 'pending' && (
                <span className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn secondary small" disabled={iv.reminded} onClick={() => { patchInvite(iv.id, { reminded: true }); toast(`Reminder sent to ${iv.name} on WhatsApp.`); }}>{iv.reminded ? 'Reminded' : 'Remind'}</button>
                  <button type="button" className="btn ghost small" onClick={() => { set((st) => ({ invites: st.invites.filter((x) => x.id !== iv.id) })); toast('Invite cancelled. The link no longer works.'); }}>Cancel invite</button>
                </span>
              )}
              {iv.status === 'joined' && <button type="button" className="link" style={{ alignSelf: 'flex-start', fontSize: 13 }} onClick={() => push('friend', { id: 'yousef' })}>See {iv.name}</button>}
            </span>
          </div>
        )) : <div className="card well"><span className="h3">Nobody invited yet.</span><span className="small">Invite links last 14 days. You’ll see here when someone joins.</span></div>)}

        {tab === 'requests' && (requests.length ? requests.map((id) => (
          <div key={id} className="person-row" style={{ alignItems: 'flex-start' }}>
            <Avatar id={id} />
            <span className="grow col" style={{ gap: 6 }}>
              <span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{FRIENDS[id].name}</span><span className="tiny">{FRIENDS[id].places} trips · {FRIENDS[id].mutual} friends in common</span></span>
              <span className="row" style={{ gap: 8 }}>
                <button type="button" className="btn primary small" onClick={() => { set((st) => ({ friendRequests: st.friendRequests.filter((x) => x !== id), friends: [...st.friends, id] })); buzz(HAPTIC.success); toast(`You and ${FRIENDS[id].short} are friends.`); }}>Accept</button>
                <button type="button" className="btn secondary small" onClick={() => { set((st) => ({ friendRequests: st.friendRequests.filter((x) => x !== id) })); toast(`Declined. ${FRIENDS[id].short} isn’t told.`); }}>Decline</button>
                <button type="button" className="btn ghost small" style={{ color: '#8a3524' }} onClick={() => { set((st) => ({ friendRequests: st.friendRequests.filter((x) => x !== id), circles: { ...st.circles, blocked: [...(st.circles.blocked || []), id] } })); toast(`Blocked. ${FRIENDS[id].short} can’t find or message you.`); }}>Block</button>
              </span>
            </span>
          </div>
        )) : <div className="card well"><span className="h3">No requests.</span><span className="small">When someone asks to be your friend, it shows here.</span></div>)}
      </div>

      {sheet === 'add' && (
        <Sheet label="Add friends" onClose={() => setSheet(null)}>
          <h2 className="h2">Add friends</h2>
          <button type="button" className="card tap well" onClick={() => setSheet('contacts')}><span className="row"><Icon name="circles" /><span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>From your contacts</span><span className="tiny">See who’s already on Mada. Your contacts aren’t uploaded.</span></span></span></button>
          <div className="field">
            <label htmlFor="add-phone">By phone number</label>
            <div className="row"><span className="input" style={{ width: 72, display: 'grid', placeItems: 'center', flexShrink: 0 }}>+966</span><input id="add-phone" className="input grow" inputMode="tel" placeholder="5X XXX XXXX" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            {digits.length >= 9 && !phoneOk && <span className="err">Saudi mobile numbers start with 5 and have 9 digits.</span>}
          </div>
          {phoneOk && (found ? (
            s.friends.includes(found) ? <span className="small">{FRIENDS[found].short} is already your friend.</span> : (
              <PersonRow id={found} sub="On Mada" right={<button type="button" className="btn primary small" disabled={sent.includes(found)} onClick={() => { setSent([...sent, found]); toast('Request sent.'); }}>{sent.includes(found) ? 'Sent' : 'Add'}</button>} />
            )
          ) : (
            <div className="card well" style={{ gap: 8 }}>
              <span className="h3" style={{ fontSize: 15 }}>Not on Mada yet.</span>
              <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => { set((st) => ({ invites: [{ id: 'i' + Date.now(), name: '+966 ' + digits, via: 'SMS', when: 'Just now', status: 'pending' }, ...st.invites] })); setPhone(''); setSheet(null); setTab('invited'); toast('Invite sent by SMS.'); }}>Invite them by SMS</button>
            </div>
          ))}
          <button type="button" className="btn secondary block" onClick={() => setSheet('link')}><Icon name="link" size={18} />Share your invite link</button>
        </Sheet>
      )}
      {sheet === 'contacts' && contacts === null && (
        <Sheet label="Contacts access" onClose={() => setSheet(null)}>
          <h2 className="h2">“Mada” would like to access your contacts</h2>
          <p className="body">To show who’s already on Mada. Numbers are matched on this phone and never stored.</p>
          <button type="button" className="btn primary block" onClick={() => setContacts(true)}>Allow</button>
          <button type="button" className="btn ghost block" onClick={() => setContacts(false)}>Don’t allow</button>
        </Sheet>
      )}
      {sheet === 'contacts' && contacts === false && (
        <Sheet label="No contacts" onClose={() => { setSheet(null); setContacts(null); }}>
          <h2 className="h2">That’s fine.</h2>
          <p className="body">Add friends by phone number or send your link instead. You can allow contacts later in Settings.</p>
          <button type="button" className="btn primary block" onClick={() => { setContacts(null); setSheet('link'); }}>Share your invite link</button>
        </Sheet>
      )}
      {sheet === 'contacts' && contacts === true && (
        <Sheet label="Contacts on Mada" onClose={() => setSheet(null)}>
          <h2 className="h2">On Mada from your contacts</h2>
          {CONTACTS.filter((id) => !s.friends.includes(id)).map((id) => (
            <PersonRow key={id} id={id} sub={`${FRIENDS[id].mutual} friends in common`} right={
              requests.includes(id) ? <button type="button" className="btn primary small" onClick={() => { set((st) => ({ friendRequests: st.friendRequests.filter((x) => x !== id), friends: [...st.friends, id] })); toast(`You and ${FRIENDS[id].short} are friends.`); }}>Accept</button>
                : <button type="button" className="btn primary small" disabled={sent.includes(id)} onClick={() => { setSent([...sent, id]); buzz(HAPTIC.tap); toast('Request sent.'); }}>{sent.includes(id) ? 'Sent' : 'Add'}</button>
            } />
          ))}
          {CONTACTS.every((id) => s.friends.includes(id)) && <span className="small">Everyone in your contacts on Mada is already your friend.</span>}
        </Sheet>
      )}
      {sheet === 'link' && <InviteSheet what="Mada" onClose={() => setSheet(null)} />}
    </div>
  );
}

/* ---------- a friend ---------- */

export function Friend({ params }) {
  const { s, set, pop, push, toast } = useStore();
  const [sheet, setSheet] = useState(null);
  const [reason, setReason] = useState(null);
  const id = params.id;
  const f = FRIENDS[id];
  const isFriend = s.friends.includes(id);
  const following = (s.following || []).includes(id);
  const [asked, setAsked] = useState(false);
  const posts = SEED_POSTS.filter((p) => p.uid === id);
  const shared = s.groups.filter((g) => g.members.includes(id));
  if (!f) return <div className="screen push"><TopBar onBack={pop} /><div className="scroll no-dock"><h1 className="h1">This person isn’t on Mada any more.</h1></div></div>;
  const dm = () => {
    const gid = 'dm-' + id;
    if (!s.groups.some((g) => g.id === gid)) set((st) => ({ groups: [...st.groups, { id: gid, name: f.short, img: null, members: ['omar', id], admin: 'omar', unread: 0, sub: 'just you two', trip: null, muted: false, dm: true, fresh: true }] }));
    push('group', { id: gid });
  };
  return (
    <div className="screen push">
      <TopBar onBack={pop} right={<button type="button" className="icon-btn" aria-label={`More options for ${f.short}`} onClick={() => setSheet('more')}><Icon name="more" /></button>} />
      <div className="scroll no-dock" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 14 }}>
          <Avatar id={id} size={68} />
          <div className="col" style={{ gap: 2 }}>
            <h1 className="h1" style={{ fontSize: 26 }}>{f.name}</h1>
            <span className="small">{isFriend ? `Friends since ${f.since || 'today'}` : following ? 'You follow them' : `${f.places} trips with Mada`} · {f.places} places · {120 + f.places * 7} followers</span>
          </div>
        </div>
        {f.going && s.trip && f.going.startsWith('Istanbul') && (
          <div className="card focal" style={{ gap: 6 }}><span className="h3">In Istanbul when you are</span><span className="small">{f.going.split(' · ')[1]} · {f.short} shared it with you</span></div>
        )}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {isFriend ? <button type="button" className="btn primary small" onClick={dm}>Message</button> : (<>
            <button type="button" className={'btn small ' + (following ? 'secondary' : 'primary')} aria-pressed={following ? 'true' : 'false'} onClick={() => { set((st) => ({ following: following ? st.following.filter((x) => x !== id) : [...(st.following || []), id] })); buzz(HAPTIC.select); toast(following ? `Unfollowed ${f.short}.` : `Following ${f.short}. Their public tips show in your feed.`); }}>{following ? 'Following' : 'Follow'}</button>
            {(s.friendRequests || []).includes(id)
              ? <button type="button" className="btn secondary small" onClick={() => { set((st) => ({ friends: [...st.friends, id], friendRequests: st.friendRequests.filter((x) => x !== id) })); toast(`You and ${f.short} are friends.`); }}>Accept friend request</button>
              : <button type="button" className="btn secondary small" disabled={asked} onClick={() => { setAsked(true); toast(`Asked ${f.short}. Friends see each other’s trips and private tips.`); }}>{asked ? 'Asked' : 'Add friend'}</button>}
          </>)}
          {isFriend && <button type="button" className="btn secondary small" onClick={() => push('newCircle', { with: id })}>Plan a trip together</button>}
        </div>
        {!isFriend && <span className="tiny">Following shows you {f.short}’s public tips. Only friends see each other’s trips and where they are.</span>}
        {shared.length > 0 && (<>
          <span className="eyebrow">Circles together</span>
          {shared.map((g) => <button key={g.id} type="button" className="card tap" style={{ flexDirection: 'row', alignItems: 'center' }} onClick={() => push('group', { id: g.id })}><span className="grow h3" style={{ fontSize: 15 }}>{g.name}</span><span className="tiny">{g.members.length} people</span><Icon name="chevron" /></button>)}
        </>)}
        <span className="eyebrow">{f.short}’s tips</span>
        {posts.length ? posts.map((p) => (
          <div key={p.id} className="card" style={{ gap: 6 }}>
            <span className="tiny">{p.city} · {p.kind} · {p.when}</span>
            <span className="h3" style={{ fontSize: 15 }}>{p.place}</span>
            <span className="small" style={{ color: '#3f4f48' }}>{p.text}</span>
          </div>
        )) : <span className="small">{f.short} hasn’t posted a tip yet.</span>}
      </div>
      {sheet === 'more' && (
        <Sheet label={f.short} onClose={() => setSheet(null)}>
          <h2 className="h2">{f.short}</h2>
          <button type="button" className="card tap well" onClick={() => { set((st) => ({ circles: { ...st.circles, hidden: [...st.circles.hidden, id] } })); setSheet(null); toast(`You won’t see ${f.short} in Who’s around. They aren’t told.`); }}><span className="h3" style={{ fontSize: 15 }}>Hide from Who’s around</span><span className="tiny">They aren’t told.</span></button>
          {isFriend && <button type="button" className="card tap well" onClick={() => setSheet('remove')}><span className="h3" style={{ fontSize: 15 }}>Remove friend</span><span className="tiny">You stay in circles you share.</span></button>}
          <button type="button" className="card tap well" onClick={() => setSheet('report')}><span className="h3" style={{ fontSize: 15, color: '#8a3524' }}>Report or block</span><span className="tiny">A person reviews every report within 24 hours.</span></button>
        </Sheet>
      )}
      {sheet === 'remove' && (
        <Sheet label="Remove friend" onClose={() => setSheet(null)}>
          <h2 className="h2">Remove {f.short}?</h2>
          <p className="body">They won’t see your tips or where you are. They aren’t told.</p>
          <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={() => { set((st) => ({ friends: st.friends.filter((x) => x !== id) })); toast(`Removed ${f.short}.`); pop(); }}>Remove</button>
          <button type="button" className="btn ghost block" onClick={() => setSheet(null)}>Keep</button>
        </Sheet>
      )}
      {sheet === 'report' && (
        <Sheet label="Report" onClose={() => setSheet(null)}>
          <h2 className="h2">What’s wrong?</h2>
          <div className="chips">{['Unwanted messages', 'Not who they say', 'Something unsafe', 'Something else'].map((r) => <button key={r} type="button" className="chip" aria-pressed={reason === r ? 'true' : 'false'} onClick={() => setReason(r)}>{r}</button>)}</div>
          <button type="button" className="btn primary block" disabled={!reason} onClick={() => { set((st) => ({ friends: st.friends.filter((x) => x !== id), circles: { ...st.circles, reported: [...st.circles.reported, id], blocked: [...(st.circles.blocked || []), id] } })); toast('Reported and blocked. A person will look at it within 24 hours.'); pop(); }}>Report and block</button>
        </Sheet>
      )}
    </div>
  );
}

/* ---------- one tip, opened ---------- */

export function PostDetail({ post, saved, onSave, onClose, onDelete }) {
  const { push, toast } = useStore();
  const [thanked, setThanked] = useState(false);
  const [sheet, setSheet] = useState(null);
  const mine = post.who === 'You';
  if (sheet === 'delete') return (
    <Sheet label="Delete tip" onClose={() => setSheet(null)}>
      <h2 className="h2">Delete this tip?</h2>
      <p className="body">It goes for everyone, including people who saved it.</p>
      <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={() => { onDelete(post.id); toast('Tip deleted.'); }}>Delete</button>
      <button type="button" className="btn ghost block" onClick={() => setSheet(null)}>Keep it</button>
    </Sheet>
  );
  return (
    <Sheet label={post.place} onClose={onClose}>
      {post.img && <img src={post.img} alt="" style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 20 }} />}
      <button type="button" className="row" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} disabled={mine || !FRIENDS[post.uid]} onClick={() => { onClose(); push('friend', { id: post.uid }); }}>
        <span className={'avatar sm' + (post.tone ? ' ' + post.tone : '')}>{post.initial}</span>
        <span className="col" style={{ gap: 0 }}><span className="h3" style={{ fontSize: 15 }}>{post.who}</span><span className="tiny">{post.rel} · {post.when || 'Just now'}{post.pending ? ' · being checked' : ''}</span></span>
      </button>
      <h2 className="h2">{post.place}</h2>
      <p className="body">{post.text}</p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className={'btn small ' + (saved ? 'gold' : 'secondary')} aria-pressed={saved ? 'true' : 'false'} onClick={onSave}>{saved ? 'Saved' : 'Save'}</button>
        <button type="button" className="btn primary small" onClick={() => { onClose(); push('ask', { prefill: (post.kind === 'Food' ? 'A table at ' : '') + post.place }); }}>{post.kind === 'Food' ? 'Book a table' : 'Plan it with Mada'}</button>
        {!mine && <button type="button" className="btn secondary small" disabled={thanked} onClick={() => { setThanked(true); buzz(HAPTIC.tap); }}>{thanked ? `${post.who} will see your thanks` : `Thank ${post.who}`}</button>}
      </div>
      {mine ? <button type="button" className="btn ghost block" style={{ color: '#8a3524' }} onClick={() => setSheet('delete')}>Delete tip</button>
        : <button type="button" className="btn ghost block" style={{ color: '#8a3524' }} onClick={() => { toast('Thanks. A person will look at this tip within 24 hours.'); onClose(); }}>Report this tip</button>}
    </Sheet>
  );
}

/* Typing, then a reply: so a message never goes into silence. */
export function useReply(group, msgs) {
  const [reply, setReply] = useState([]);
  const [typing, setTyping] = useState(null);
  useEffect(() => {
    if (!msgs.length || !group) return undefined;
    const others = group.members.filter((m) => m !== 'omar');
    if (!others.length) return undefined;
    const who = others[(msgs.length - 1) % others.length];
    const t1 = setTimeout(() => setTyping(who), 700);
    const t2 = setTimeout(() => { setTyping(null); setReply((r) => [...r, { at: msgs.length, who, text: ['Sounds good to me.', 'Yes! Which dates work for you?', 'I’m in. Can Mada check flights?', 'Let me ask Hessa and come back to you.'][(msgs.length - 1) % 4] }]); }, 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [msgs.length]);
  return { reply, typing };
}

/* Saving a tip keeps a copy, so it stays even if the post goes. */
export function useSave() {
  const { s, set, toast } = useStore();
  const isSaved = (id) => (s.savedPosts || []).some((x) => x.id === id);
  const toggle = (post) => {
    const on = isSaved(post.id);
    set((st) => ({ savedPosts: on ? st.savedPosts.filter((x) => x.id !== post.id) : [{ ...post, savedAt: Date.now() }, ...(st.savedPosts || [])] }));
    buzz(HAPTIC.select);
    toast(on ? 'Removed from Saved.' : `Saved to ${post.city}. Find it in Circles → Saved.`);
  };
  return { isSaved, toggle };
}

const CITY_IMG = { Istanbul: 'img/istanbul.jpg', Riyadh: 'img/riyadh.jpg', AlUla: 'img/alula.jpg' };

/* Everything you saved, by city. */
export function Saved({ params = {} }) {
  const { s, set, pop, push, toast } = useStore();
  const { toggle } = useSave();
  const [share, setShare] = useState(null);
  const posts = s.savedPosts || [];
  const cities = [...new Set(posts.map((p) => p.city))];
  const list = params.city ? [params.city] : cities;
  return (
    <div className="screen push">
      <TopBar onBack={pop} backLabel="Circles" />
      <div className="scroll no-dock" style={{ gap: 16 }}>
        <h1 className="h1">{params.city ? `Saved in ${params.city}` : 'Saved'}</h1>
        {posts.length === 0 && (s.savedPlans || []).length === 0 && (
          <div className="card well"><span className="h3">Nothing saved yet.</span><span className="small">Tap the bookmark on any tip or plan. It lands here, sorted by city, ready to plan or share.</span></div>
        )}
        {list.map((city) => {
          const items = posts.filter((p) => p.city === city);
          if (!items.length) return null;
          return (
            <div key={city} className="col" style={{ gap: 10 }}>
              <div className="photo" style={{ height: 120 }}>
                <img src={CITY_IMG[city] || 'img/istanbul.jpg'} alt="" /><span className="shade" />
                <span className="over" style={{ textAlign: 'left', gap: 0 }}><span className="display" style={{ fontSize: 28, color: '#fffdf9' }}>{city}</span><span className="tiny" style={{ color: 'rgba(255,253,249,.9)' }}>{items.length} {items.length === 1 ? 'place' : 'places'}</span></span>
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn primary small" onClick={() => push('ask', { prefill: `Plan a day in ${city} around ${items.map((i) => i.place).join(', ')}` })}>Plan a day from these</button>
                <button type="button" className="btn secondary small" onClick={() => setShare(city)}><Icon name="link" size={18} />Share</button>
              </div>
              {items.map((p) => (
                <div key={p.id} className="card" style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                  {p.img ? <img src={p.img} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover', flexShrink: 0 }} /> : <span className="avatar" style={{ width: 56, height: 56, borderRadius: 14 }}>{p.initial}</span>}
                  <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                    <span className="h3" style={{ fontSize: 15 }}>{p.place}</span>
                    <span className="tiny">From {p.who} · {p.kind}</span>
                    <span className="row" style={{ gap: 14, marginTop: 4 }}>
                      <a className="link" style={{ fontSize: 13 }} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.place + ', ' + p.city)}`} target="_blank" rel="noreferrer">Map</a>
                      <button type="button" className="link" style={{ fontSize: 13 }} onClick={() => push('ask', { prefill: (p.kind === 'Food' ? 'A table at ' : '') + p.place })}>{p.kind === 'Food' ? 'Book a table' : 'Plan it'}</button>
                      <button type="button" className="link" style={{ fontSize: 13, color: '#8a3524' }} onClick={() => toggle(p)}>Remove</button>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          );
        })}
        {!params.city && (s.savedPlans || []).length > 0 && (<>
          <span className="eyebrow">Saved plans</span>
          {s.savedPlans.map((id) => <button key={id} type="button" className="card tap" style={{ flexDirection: 'row', alignItems: 'center' }} onClick={() => push('plan', { id })}><span className="grow h3" style={{ fontSize: 15 }}>{id === 'alula2' ? 'Two days in AlUla' : 'Three easy days in Istanbul'}</span><Icon name="chevron" /></button>)}
        </>)}
      </div>
      {share && <InviteSheet what={`your ${share} list`} onClose={() => setShare(null)} />}
    </div>
  );
}

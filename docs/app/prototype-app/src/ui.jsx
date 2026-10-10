import { createPortal } from 'react-dom';
import React, { useEffect, useRef, useState } from 'react';
import { buzz, HAPTIC, useStore, registerPerson, outboxItems, discardOutbox } from './store.jsx';

const PATHS = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  trips: <><rect x="3" y="7" width="18" height="13" rx="3" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></>,
  circles: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.5 3.5 5.2" /></>,
  wallet: <><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M3 10h18M16 15h2M6 6V5a2 2 0 0 1 2-2h9" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  flight: <path d="M10.5 13.5 3 11l1.5-1.5 8 1 4-4.5c1-1 2.6-1.3 3.4-.4.8.8.6 2.4-.4 3.4l-4.5 4 1 8L14.5 22.5 12 15z" />,
  stay: <><path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" /><circle cx="7" cy="11" r="1.6" /></>,
  visa: <><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="10" r="3" /><path d="M9 17h6" /></>,
  umrah: <path d="M4 21V10l8-5 8 5v11M9 21v-6h6v6M4 21h16" />,
  car: <path d="M5 16V11l2-5h10l2 5v5M4 16h16v3H4zM5 11h14" />,
  star: <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7z" />,
  food: <path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 0-3 2.5-3 5.5S14 13 16 13v8" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />,
  pin: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  more: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  card: <><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18M7 15h4" /></>,
  doc: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>,
  scan: <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" />,
  wifiOff: <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.7M14.6 10.5A10 10 0 0 1 19 13M2 9.5a15 15 0 0 1 4.3-2.8M12 20h.01" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  rain: <path d="M7 15a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.5 1.5A3.5 3.5 0 0 1 17.5 15M9 18l-1 2M13 18l-1 2M17 18l-1 2" />,
  bag: <><rect x="5" y="7" width="14" height="13" rx="2" /><path d="M9 7V5h6v2M9 11v5M15 11v5" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  refund: <path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13.5" r="3.5" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z" />,
  chat: <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />,
  outbox: <><path d="M4 13v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6M4 13l2.5-6h11l2.5 6M4 13h5l1 2h4l1-2h5" /><path d="M12 4v6M9.5 6.5 12 4l2.5 2.5" /></>,
};

export function Icon({ name, size = 22, color = 'currentColor', width = 1.8, style }) {
  return (
    <svg className={'ic ic-' + name} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {PATHS[name]}
    </svg>
  );
}

export function Plane({ size = 16, color = '#1e352d' }) {
  return (
    <svg className="route-plane" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ margin: '0 6px', flexShrink: 0 }}>
      <path d="M22 12c0-.8-.7-1.5-1.5-1.5H15L10 3H8l2.5 7.5H6L4.5 8.5H3l1 3.5-1 3.5h1.5L6 13.5h4.5L8 21h2l5-7.5h5.5c.8 0 1.5-.7 1.5-1.5z" fill={color} />
    </svg>
  );
}

export function Sun({ width = 32, color = '#d9b77a', className, style }) {
  return (
    <svg width={width} height={width * 0.67} viewBox="0 0 132.31 88.61" aria-hidden="true" className={className} style={style}>
      <g fill={color}>
        <path d="M47.95,59.75c0,.14,0,.28,0,.42L0,69.45l4.77-11.37,43.22.48c-.03.39-.04.79-.04,1.19Z" />
        <path d="M84.36,59.75c0,.14,0,.28,0,.42l47.96,9.28-4.77-11.37-43.22.48c.03.39.04.79.04,1.19Z" />
        <path d="M73.28,0l-4.89,41.68c-.73-.09-1.48-.14-2.23-.14s-1.5.05-2.23.14L59.03,0h14.25Z" />
        <path d="M58.2,43.37c-1.53.74-2.95,1.7-4.2,2.83l-25.36-23.54,10.22-8.47,19.34,29.19Z" />
        <path d="M18.07,35.39l32.47,15.02c-.64,1.07-1.17,2.21-1.59,3.4l-37.72-6.41,6.84-12.01Z" />
        <path d="M74.11,43.37c1.53.74,2.95,1.7,4.2,2.83l25.36-23.54-10.22-8.47-19.34,29.19Z" />
        <path d="M114.25,35.39l-32.47,15.02c.64,1.07,1.17,2.21,1.59,3.4l37.72-6.41-6.84-12.01Z" />
        <path d="M63.33,61.18h-2.23c-.71,0-1.39.32-1.84.88l-21.48,26.55h18.76l6.79-27.43Z" />
        <path d="M68.98,61.18h2.23c.71,0,1.39.32,1.84.88l21.48,26.55h-18.76s-6.79-27.43-6.79-27.43Z" />
      </g>
    </svg>
  );
}

export function TopBar({ title, onBack, backLabel = 'Back', right, dark }) {
  return (
    <div className="topbar">
      {onBack ? (
        <button type="button" className="back" onClick={() => { buzz(HAPTIC.tap); onBack(); }} style={dark ? { color: '#f6f2ec' } : null}>
          <Icon name="back" />{backLabel}
        </button>
      ) : <span />}
      {title ? <span className="title">{title}</span> : null}
      {right || <span style={{ width: 44 }} />}
    </div>
  );
}

export function Sheet({ onClose, children, label }) {
  useEffect(() => { buzz(HAPTIC.tap); }, []);
  const node = (
    <>
      <div className="backdrop" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label}>
        <div className="grab" />
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
  /* Pinned to the phone, so a sheet opened from deep in a scrolled page never scrolls away. */
  const host = typeof document !== 'undefined' && document.querySelector('.phone');
  return host ? createPortal(node, host) : node;
}

export function Toggle({ checked, onChange, label, onDark }) {
  return (
    <button type="button" role="switch" aria-checked={checked ? 'true' : 'false'} aria-label={label} className={'toggle' + (onDark ? ' on-dark' : '')} onClick={() => { buzz(HAPTIC.select); onChange(!checked); }} />
  );
}

/* Slide to confirm: drag the sun across. Enter or Space also confirms, for keyboards and screen readers. */
/** Where the pointer is along the track, from its start: the left in English, the right in Arabic. */
const along = (e, r) => (document.documentElement.dir === 'rtl' ? (r.right - e.clientX) / r.width : (e.clientX - r.left) / r.width);

export function SlideToConfirm({ label, onConfirm, busyLabel, busy, disabled }) {
  const [p, setP] = useState(0);
  const [drag, setDrag] = useState(false);
  const ref = useRef({});
  const TRACK_PAD = 4;
  useEffect(() => { if (!busy) setP(0); }, [busy]);
  const knobFrac = (el) => 56 / el.getBoundingClientRect().width;
  const down = (e) => {
    if (disabled || busy) return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = along(e, r);
    const kf = knobFrac(el);
    const centre = (TRACK_PAD / r.width) + kf / 2 + p * (1 - kf - 2 * TRACK_PAD / r.width);
    if (Math.abs(x - centre) > 0.16) return;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    ref.current = { r, offset: x - centre, tick: 0, kf };
    setDrag(true);
    buzz(6);
  };
  const move = (e) => {
    if (!drag) return;
    const { r, offset, kf } = ref.current;
    const x = along(e, r) - offset;
    const pad = TRACK_PAD / r.width;
    let np = (x - pad - kf / 2) / (1 - kf - 2 * pad);
    np = Math.max(0, Math.min(1, np));
    const ticks = [0.25, 0.5, 0.75];
    while (ref.current.tick < 3 && np >= ticks[ref.current.tick]) { buzz(6 + ref.current.tick * 6); ref.current.tick += 1; }
    setP(np);
  };
  const up = () => {
    if (!drag) return;
    setDrag(false);
    if (p > 0.9) { setP(1); buzz(HAPTIC.thunk); onConfirm(); } else setP(0);
  };
  const key = (e) => {
    if (disabled || busy) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setP(1); buzz(HAPTIC.thunk); onConfirm(); }
  };
  const trans = drag ? 'none' : 'inset-inline-start .45s cubic-bezier(.2,.9,.25,1.15), width .45s cubic-bezier(.2,.9,.25,1.15)';
  const pct = busy ? 1 : p;
  return (
    <button type="button" className={'slider' + (busy ? ' busy' : '')} aria-label={label + '. Press Enter to confirm.'} disabled={disabled}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
      style={{ opacity: disabled ? 0.45 : 1, cursor: drag ? 'grabbing' : 'grab' }}>
      <span className="fill" style={{ width: `calc(${pct * 100}% - ${pct * 64}px + 64px)`, transition: trans }} />
      <span className="label" style={{ opacity: busy ? 1 : Math.max(0, 1 - p * 1.7), color: busy ? '#1e352d' : undefined }}>
        {busy ? <><span className="spinner" style={{ marginInlineEnd: 10 }} />{busyLabel}</> : label}
      </span>
      {!busy && (
        <span className="knob" style={{ insetInlineStart: `calc(4px + ${p} * (100% - 64px))`, transition: trans }}>
          <Sun width={30} color="#1e352d" />
        </span>
      )}
    </button>
  );
}

export function Dock() {
  const { s, go, push } = useStore();
  const tabs = [
    { id: 'today', label: 'Today', icon: 'home' },
    { id: 'trips', label: 'Trips', icon: 'trips' },
    { id: 'ask' },
    { id: 'circles', label: 'Circles', icon: 'circles' },
    { id: 'wallet', label: 'Wallet', icon: 'wallet' },
  ];
  return (
    <nav className="dock" aria-label="Main">
      {tabs.map((t) => t.id === 'ask' ? (
        <button key="ask" type="button" className="orb" aria-label="Ask Mada" onClick={() => { buzz(HAPTIC.tap); push('ask', {}); }}>
          <Sun width={32} />
        </button>
      ) : (
        <button key={t.id} type="button" className={s.tab === t.id ? 'on' : ''} aria-label={t.label} aria-current={s.tab === t.id ? 'page' : undefined} onClick={() => {
          buzz(HAPTIC.tap);
          /* Tapping the tab you're on takes you back to its top, like iOS. */
          if (s.tab === t.id) document.querySelectorAll('.phone .scroll').forEach((el) => el.scrollTo({ top: 0, behavior: 'smooth' }));
          go(t.id);
        }}>
          <Icon name={t.icon} />{s.tab === t.id ? t.label : null}
        </button>
      ))}
    </nav>
  );
}

export function Route({ dep, arr, from, to, dur, big }) {
  return (
    <div className="route">
      <div className="end"><span className="t" style={big ? { fontSize: 26 } : null}>{dep}</span><span className="c">{from}</span></div>
      <div className="mid">
        <div className="line"><span /><Plane /><span /></div>
        <span className="tiny">{dur} · direct</span>
      </div>
      <div className="end r"><span className="t" style={big ? { fontSize: 26 } : null}>{arr}</span><span className="c">{to}</span></div>
    </div>
  );
}

export function Avatar({ person, tone, size }) {
  return <span className={'avatar' + (size === 'sm' ? ' sm' : '') + (tone ? ' ' + tone : '')} aria-hidden="true">{person?.initial || '?'}</span>;
}

export function Steps({ items }) {
  return (
    <div className="steps">
      {items.map((it) => (
        <div key={it.text} className={'step' + (it.state === 'todo' ? ' todo' : '')}>
          <span className="mark">
            {it.state === 'done' && <Icon name="check" color="#2f7a4b" width={2.4} size={20} />}
            {it.state === 'now' && <span className="spinner" />}
            {it.state === 'todo' && <span className="dot" style={{ background: '#d6cec2' }} />}
          </span>
          {it.text}
        </div>
      ))}
    </div>
  );
}

export function Tracker({ items }) {
  return (
    <div className="tracker">
      {items.map((it, i) => (
        <div key={it.title} className="t-item">
          <div className="rail">
            <span className={'node ' + (it.state || '')} />
            {i < items.length - 1 && <span className="bar" />}
          </div>
          <div className="t-text">
            <span className="h3" style={{ fontSize: 15, color: it.state ? undefined : '#5f6b65' }}>{it.title}</span>
            {it.sub && <span className="tiny">{it.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function useTimer(ms, deps = []) {
  const [done, setDone] = useState(false);
  useEffect(() => { setDone(false); const t = setTimeout(() => setDone(true), ms); return () => clearTimeout(t); }, deps);
  return done;
}

export function useTicker(ms = 1000) {
  const [, setN] = useState(0);
  useEffect(() => { const t = setInterval(() => setN((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
}

/* Airline logo: the airline's official mark (from the content provider's logo library), with its code as a fallback. */
export function AirlineMark({ flight, size = 36 }) {
  const [failed, setFailed] = useState(false);
  if (!flight) return null;
  if (failed) {
    return (
      <span aria-label={flight.airline} role="img" style={{ width: size, height: size, borderRadius: 12, background: flight.brand || '#1e352d', color: '#fff', display: 'grid', placeItems: 'center', fontSize: size * 0.36, fontWeight: 700, flexShrink: 0 }}>{flight.iata}</span>
    );
  }
  return (
    <span style={{ width: size, height: size, borderRadius: 12, background: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0, boxShadow: 'inset 0 0 0 1px rgba(30,53,45,.08)' }}>
      <img src={`img/airlines/${flight.iata}.svg`} alt={flight.airline} onError={() => setFailed(true)} style={{ width: size * 0.68, height: size * 0.68, objectFit: 'contain' }} />
    </span>
  );
}

/* Add a traveller to the household: name exactly as on the passport, and how they relate. */
export function AddPersonSheet({ onClose, onAdded }) {
  const { set, toast } = useStore();
  const [given, setGiven] = useState('');
  const [surname, setSurname] = useState('');
  const [rel, setRel] = useState('Family');
  const ok = given.trim().length > 1 && surname.trim().length > 1;
  return (
    <Sheet label="Add someone" onClose={onClose}>
      <h2 className="h2">Add someone</h2>
      <p className="small">Names exactly as on their passport. You can scan it later from the Wallet.</p>
      <div className="row" style={{ gap: 10 }}>
        <div className="field grow"><label htmlFor="ap-given">Given names</label><input id="ap-given" className="input" value={given} onChange={(e) => setGiven(e.target.value)} autoCapitalize="words" /></div>
        <div className="field grow"><label htmlFor="ap-sur">Surname</label><input id="ap-sur" className="input" value={surname} onChange={(e) => setSurname(e.target.value)} autoCapitalize="words" /></div>
      </div>
      <div className="chips">{['Family', 'Friend', 'Helper', 'Colleague'].map((r) => <button key={r} type="button" className={'chip' + (rel === r ? ' on' : '')} onClick={() => setRel(r)}>{r}</button>)}</div>
      {rel === 'Helper' && <span className="small">We'll ask for their iqama and exit and re-entry visa before any trip abroad.</span>}
      <button type="button" className="btn primary block" disabled={!ok} onClick={() => {
        const first = given.trim().split(/\s+/)[0];
        const name = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
        const p = { id: 'p' + Date.now(), name, full: `${given.trim()} ${surname.trim()}`.replace(/\b\w/g, (c) => c.toUpperCase()), initial: name.charAt(0), role: rel, born: '—', number: 'Not scanned', expires: 'Not scanned', helper: rel === 'Helper', added: true };
        registerPerson(p);
        set((prev) => ({ extraPeople: [...(prev.extraPeople || []), p], household: [...(prev.household.length ? prev.household : ['omar']), p.id] }));
        buzz(HAPTIC.success); toast(`${name} added. Scan their passport from the Wallet when you can.`);
        onAdded && onAdded(p);
      }}>Add {given.trim().split(/\s+/)[0] || 'them'}</button>
    </Sheet>
  );
}

/* Invite someone with a link: they join, add their own passport and can pay their share. */
export function InviteSheet({ onClose, what = 'this trip' }) {
  const { toast } = useStore();
  const link = 'madatrips.sa/join/ist-8k2';
  return (
    <Sheet label="Invite with a link" onClose={onClose}>
      <h2 className="h2">Invite to {what}</h2>
      <p className="small">They open the link, add their own passport and can pay their own share. Nothing is shared until they join.</p>
      <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
      <button type="button" className="btn primary block" onClick={async () => { try { await navigator.clipboard.writeText('https://' + link); toast('Link copied. Paste it in WhatsApp.'); } catch (e) { toast('Select the link above to copy it.'); } }}><Icon name="link" color="#f6f2ec" />Copy invite link</button>
    </Sheet>
  );
}

/* Payment marks, drawn as small cards so every method reads at a glance. */
export function PayMark({ brand, size = 28 }) {
  const w = Math.round(size * 1.5);
  const b = String(brand || '').toLowerCase();
  const box = (bg, children, border) => (
    <svg width={w} height={size} viewBox="0 0 48 32" aria-hidden="true" style={{ flexShrink: 0, borderRadius: 6, boxShadow: border ? 'inset 0 0 0 1px rgba(30,53,45,.14)' : 'none' }}>
      <rect width="48" height="32" rx="6" fill={bg} />{children}
    </svg>
  );
  if (b === 'visa') return box('#fffdf9', <text x="24" y="21" textAnchor="middle" fontFamily="Inter Tight, Arial, sans-serif" fontWeight="800" fontStyle="italic" fontSize="15" fill="#1a1f71" letterSpacing="-.5">VISA</text>, true);
  if (b === 'mastercard') return box('#1e1e1e', <><circle cx="19.5" cy="16" r="8.5" fill="#eb001b" /><circle cx="28.5" cy="16" r="8.5" fill="#f79e1b" /><path d="M24 8.8a8.5 8.5 0 0 1 0 14.4 8.5 8.5 0 0 1 0-14.4z" fill="#ff5f00" /></>);
  if (b === 'mada') return box('#fffdf9', <><rect x="7" y="10" width="13" height="5" rx="1" fill="#84b740" /><rect x="7" y="17" width="13" height="5" rx="1" fill="#259bd6" /><text x="33" y="20.5" textAnchor="middle" fontFamily="Inter Tight, Arial, sans-serif" fontWeight="700" fontSize="11" fill="#1e1e1e">mada</text></>, true);
  if (b === 'applepay') return box('#000', <><path d="M14.6 11.3c.5-.6.8-1.4.7-2.2-.7 0-1.6.5-2.1 1.1-.5.5-.9 1.4-.8 2.2.8.1 1.6-.4 2.2-1.1zm.7 1.2c-1.2-.1-2.2.7-2.8.7s-1.4-.6-2.4-.6c-1.2 0-2.3.7-2.9 1.8-1.3 2.2-.3 5.4.9 7.2.6.9 1.3 1.8 2.2 1.8.9 0 1.2-.6 2.3-.6s1.4.6 2.3.6c1 0 1.6-.9 2.2-1.8.7-1 1-2 1-2-.1 0-1.9-.7-1.9-2.8 0-1.7 1.4-2.6 1.5-2.6-.8-1.2-2.1-1.4-2.4-1.4z" fill="#fff" /><text x="31" y="21" textAnchor="middle" fontFamily="Inter Tight, Arial, sans-serif" fontWeight="600" fontSize="12" fill="#fff">Pay</text></>);
  if (b === 'tabby') return box('#3effc2', <text x="24" y="20.5" textAnchor="middle" fontFamily="Inter Tight, Arial, sans-serif" fontWeight="800" fontSize="12.5" fill="#1e1e1e">tabby</text>);
  if (b === 'tamara') return box('#fdebd7', <text x="24" y="20.5" textAnchor="middle" fontFamily="Inter Tight, Arial, sans-serif" fontWeight="800" fontSize="11.5" fill="#1e1e1e">tamara</text>);
  if (b === 'credit') return box('#1e352d', <g transform="translate(24 16)" stroke="#d9b77a" strokeWidth="2.2" strokeLinecap="round">{Array.from({ length: 8 }, (_, i) => { const a = (i * Math.PI) / 4; return <line key={i} x1={Math.cos(a) * 3.5} y1={Math.sin(a) * 3.5} x2={Math.cos(a) * 8} y2={Math.sin(a) * 8} />; })}</g>);
  return box('#f6f2ec', <rect x="8" y="12" width="32" height="4" rx="1" fill="#1e352d" />, true);
}

/* Card helpers: brand from the number, and the Luhn check every card number must pass. */
const MADA_BINS = ['440647', '440795', '446404', '457865', '588845', '588846', '588848', '588850', '604906', '968201', '968202', '968203', '968204', '968205', '968206', '968207', '968208', '968209', '968210', '968211'];
export function cardBrand(digits) {
  if (MADA_BINS.some((b) => digits.startsWith(b))) return 'mada';
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
  return null;
}
export function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return digits.length >= 13 && sum % 10 === 0;
}
export const BRAND_NAME = { visa: 'Visa', mastercard: 'Mastercard', mada: 'mada', applepay: 'Apple Pay', tabby: 'Tabby', tamara: 'Tamara', credit: 'Mada credit' };

/* Hands the viewer a file. On claude.ai the page must ask through the downloads capability (the viewer confirms);
   anywhere else, a plain download link. Resolves 'saved', 'declined' or 'unavailable'. */
export async function saveFile(filename, data) {
  try {
    const dl = window.claude?.use ? await window.claude.use('downloads') : null;
    if (dl) {
      try { await dl.save({ filename, data }); return 'saved'; } catch (e) { return e?.code === 'declined' ? 'declined' : 'unavailable'; }
    }
    if (window.self !== window.top) return 'unavailable';
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'saved';
  } catch (e) { return 'unavailable'; }
}

/* Google Calendar link for one event: works everywhere, no file needed. Times are 'YYYYMMDDTHHMMSSZ'. */
export const calendarLink = ({ title, start, end, details = '', location = '' }) =>
  `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${start}/${end}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;

/* ---------- empty states with a little life in them ---------- */

const BOARD = [
  ['ISTANBUL', 'IST', '4H 15M'], ['ALULA', 'ULH', '1H 20M'], ['BAKU', 'GYD', '3H 05M'], ['DUBAI', 'DXB', '1H 55M'],
  ['LONDON', 'LHR', '6H 50M'], ['TBILISI', 'TBS', '3H 30M'], ['ABHA', 'AHB', '1H 35M'], ['CAIRO', 'CAI', '2H 25M'],
];

/* A split-flap departures board that keeps flipping through places: the empty Upcoming tab. */
export function DepartureBoard({ from = 'Riyadh', onPick }) {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((n) => n + 1), 2200); return () => clearInterval(t); }, []);
  const rows = [0, 1, 2].map((k) => BOARD[(i + k * 3) % BOARD.length]);
  return (
    <div className="board" role="img" aria-label={`Departures from ${from}`}>
      <div className="board-head"><span>Departures · {from}</span><span className="board-dot" /></div>
      {rows.map(([city, code, dur], k) => (
        <button type="button" key={k} className="board-row" onClick={() => onPick && onPick(city)} aria-label={`Plan ${city.toLowerCase()}`}>
          <span className="board-flaps" key={city}>{city.padEnd(9, ' ').split('').map((ch, j) => <i key={j} style={{ animationDelay: `${j * 45 + k * 120}ms` }}>{ch === ' ' ? ' ' : ch}</i>)}</span>
          <span className="board-code">{code}</span>
          <span className="board-dur">{dur}</span>
        </button>
      ))}
      <div className="board-row board-you"><span className="board-flaps">{'YOUR TRIP'.split('').map((ch, j) => <i key={j} className="blink" style={{ animationDelay: `${j * 60}ms` }}>{ch === ' ' ? ' ' : ch}</i>)}</span><span className="board-code">???</span><span className="board-dur">SOON</span></div>
    </div>
  );
}

/* An empty passport page, stamps waiting: the empty Past tab. */
export function EmptyPassport() {
  const [hit, setHit] = useState(null);
  const spots = [[18, 22, -12], [62, 16, 8], [28, 60, 6], [70, 58, -6]];
  return (
    <div className="pp-empty" role="img" aria-label="An empty passport page">
      <span className="pp-empty-title">VISAS · STAMPS</span>
      {spots.map(([x, y, r], k) => (
        <button type="button" key={k} className={'pp-slot' + (k === 0 ? ' first' : '') + (hit === k ? ' hit' : '')} style={{ left: `${x}%`, top: `${y}%`, transform: `rotate(${r}deg)` }}
          onClick={() => { setHit(k); buzz([0, 10, 40, 10]); setTimeout(() => setHit(null), 500); }} aria-label={k === 0 ? 'Your first stamp goes here' : 'Empty stamp'}>
          {k === 0 ? <span>YOUR<br />FIRST</span> : null}
        </button>
      ))}
      <span className="pp-empty-no">P · 01</span>
    </div>
  );
}

/* A paper plane looping on a dotted line: nothing waiting on Faisal. */
export function PaperPlane() {
  return (
    <svg className="plane-loop" viewBox="0 0 300 120" width="100%" height="120" aria-hidden="true">
      <path id="loop" d="M10 90 C 70 90, 90 20, 150 30 S 250 110, 290 40" fill="none" stroke="#c9b48a" strokeWidth="2" strokeDasharray="2 8" strokeLinecap="round" />
      <g>
        <path d="M-12 -7 L12 0 L-12 7 L-6 0 Z" fill="#1e352d" />
        <path d="M-6 0 L12 0 L-9 4 Z" fill="#d9b77a" />
        <animateMotion dur="5.5s" repeatCount="indefinite" rotate="auto"><mpath href="#loop" /></animateMotion>
      </g>
    </svg>
  );
}

/* A calm radar: all quiet, still watching. */
export function QuietRadar() {
  return (
    <div className="radar" aria-hidden="true">
      <span className="radar-ring r1" /><span className="radar-ring r2" /><span className="radar-ring r3" />
      <span className="radar-sweep" />
      <span className="radar-blip" />
      <Sun width={30} color="#b98f4a" />
    </div>
  );
}

/* ---------- the empty-state family ----------
   One wrapper and a set of small drawings that share a hand: 2-unit strokes on a 160×120 board, paper fills,
   green ink, gold for the one thing that is alive. Each drawing moves for a reason (a route draws, a tag swings,
   a page turns) and settles into a still picture when Reduce Motion is on. */

const useArtId = () => 'a' + String(React.useId()).replace(/[^a-zA-Z0-9]/g, '');

function Art({ children, className = '', label }) {
  return (
    <svg className={'es-svg ' + className} viewBox="0 0 160 120" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'} focusable="false">
      {children}
    </svg>
  );
}

/* A folded map: a dotted route draws itself to a pin that bobs. Nothing planned, somewhere to go. */
export function ArtMap() {
  const id = useArtId();
  return (
    <Art className="es-map">
      <defs><mask id={id}><path className="es-draw" d="M44 84 C 56 64, 70 82, 82 62 S 106 40, 118 46" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" pathLength="100" /></mask></defs>
      <path d="M30 32 L64 24 L64 94 L30 102 Z" fill="#fffdf9" stroke="#e3d6bf" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M64 24 L98 32 L98 102 L64 94 Z" fill="#f4ecdd" stroke="#e3d6bf" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M98 32 L132 24 L132 94 L98 102 Z" fill="#fffdf9" stroke="#e3d6bf" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M36 50 h14 M36 58 h20 M104 74 h18 M104 82 h12" stroke="#e9dcc4" strokeWidth="2" strokeLinecap="round" />
      <path d="M44 84 C 56 64, 70 82, 82 62 S 106 40, 118 46" fill="none" stroke="#b98f4a" strokeWidth="2.2" strokeDasharray="0.1 6" strokeLinecap="round" mask={`url(#${id})`} />
      <circle cx="44" cy="84" r="4" fill="#1e352d" />
      <g className="es-bob"><path d="M118 47 c-6-7-9-11-9-15 a9 9 0 0 1 18 0 c0 4-3 8-9 15z" fill="#d9b77a" stroke="#7d5d27" strokeWidth="1.5" strokeLinejoin="round" /><circle cx="118" cy="32" r="3" fill="#fffdf9" /></g>
      <ellipse className="es-shadow" cx="118" cy="50" rx="5" ry="1.6" fill="#1e352d" opacity=".15" />
    </Art>
  );
}

/* A packed case with a luggage tag that swings: requests, stays, loyalty. */
export function ArtSuitcase({ tag = '' }) {
  return (
    <Art className="es-case">
      <path d="M68 40 v-8 a5 5 0 0 1 5-5 h14 a5 5 0 0 1 5 5 v8" fill="none" stroke="#1e352d" strokeWidth="2.4" strokeLinejoin="round" />
      <rect x="46" y="40" width="68" height="56" rx="11" fill="#fffdf9" stroke="#1e352d" strokeWidth="2.4" />
      <path d="M62 40 v56 M98 40 v56" stroke="#d9b77a" strokeWidth="5" />
      <path d="M46 62 h68" stroke="#e3d6bf" strokeWidth="1.5" />
      <circle cx="58" cy="100" r="3.2" fill="#1e352d" /><circle cx="102" cy="100" r="3.2" fill="#1e352d" />
      <g className="es-swing">
        <path d="M88 34 C 96 40, 104 44, 110 50" fill="none" stroke="#7d5d27" strokeWidth="1.5" />
        <g transform="rotate(14 116 60)"><rect x="106" y="50" width="20" height="30" rx="4" fill="#d9b77a" stroke="#7d5d27" strokeWidth="1.5" /><circle cx="116" cy="56" r="2" fill="#fffdf9" /><path d="M110 66 h12 M110 72 h8" stroke="#7d5d27" strokeWidth="1.5" strokeLinecap="round" /></g>
        {tag ? <text x="116" y="90" textAnchor="middle" fontSize="7" fill="#7d5d27">{tag}</text> : null}
      </g>
    </Art>
  );
}

/* A wallet pocket with a card that rises and catches the light: documents, cards, refunds. */
export function ArtCardSlot({ kind = 'card' }) {
  const id = useArtId();
  return (
    <Art className="es-slot">
      <defs><clipPath id={id}><rect x="44" y="18" width="72" height="70" rx="0" /></clipPath><linearGradient id={id + 'g'} x1="0" x2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".75" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
      <g clipPath={`url(#${id})`}>
        <g className="es-rise-card">
          {kind === 'doc' ? (<>
            <path d="M56 26 h34 l14 14 v52 h-48 z" fill="#fffdf9" stroke="#1e352d" strokeWidth="2" strokeLinejoin="round" />
            <path d="M90 26 v14 h14" fill="none" stroke="#1e352d" strokeWidth="2" strokeLinejoin="round" />
            <path d="M64 50 h22 M64 58 h30 M64 66 h26" stroke="#d9b77a" strokeWidth="2.4" strokeLinecap="round" />
          </>) : (<>
            <rect x="50" y="30" width="60" height="40" rx="7" fill="#d9b77a" stroke="#7d5d27" strokeWidth="1.5" />
            <rect x="58" y="40" width="12" height="9" rx="2" fill="#f4e2bd" stroke="#7d5d27" strokeWidth="1" />
            <path d="M58 60 h26" stroke="#7d5d27" strokeWidth="2" strokeLinecap="round" opacity=".6" />
          </>)}
          <rect className="es-shine" x="20" y="20" width="22" height="80" fill={`url(#${id}g)`} transform="skewX(-18)" />
        </g>
      </g>
      <path d="M36 66 h88 v26 a10 10 0 0 1 -10 10 h-68 a10 10 0 0 1 -10 -10 z" fill="#1e352d" />
      <path d="M42 72 h76" stroke="#d9b77a" strokeWidth="1.2" strokeDasharray="3 4" opacity=".7" />
      <circle cx="80" cy="88" r="4" fill="none" stroke="#d9b77a" strokeWidth="1.5" />
    </Art>
  );
}

/* A boarding pass with its stub, a small plane crossing the fold: passes and tracked flights. */
export function ArtPass() {
  return (
    <Art className="es-pass">
      <path d="M26 36 h82 a6 6 0 0 0 12 0 h14 a6 6 0 0 1 6 6 v36 a6 6 0 0 1 -6 6 h-14 a6 6 0 0 0 -12 0 h-82 a6 6 0 0 1 -6 -6 v-36 a6 6 0 0 1 6 -6 z" fill="#fffdf9" stroke="#1e352d" strokeWidth="2" strokeLinejoin="round" />
      <path d="M114 44 v32" stroke="#e3d6bf" strokeWidth="1.5" strokeDasharray="3 4" />
      <path d="M32 50 h16 M32 70 h30 M124 52 h10 M124 60 h6" stroke="#e3d6bf" strokeWidth="2.4" strokeLinecap="round" />
      <text x="32" y="64" fontSize="10" fontWeight="700" fill="#1e352d" fontFamily="Inter Tight, sans-serif">RUH</text>
      <text x="80" y="64" fontSize="10" fontWeight="700" fill="#b98f4a" fontFamily="Inter Tight, sans-serif">???</text>
      <path d="M58 60 h18" stroke="#b98f4a" strokeWidth="1.5" strokeDasharray="1 3" strokeLinecap="round" />
      <g className="es-glide"><path d="M-5 -3 L5 0 L-5 3 L-2.5 0 Z" fill="#1e352d" transform="translate(64 60)" /></g>
    </Art>
  );
}

/* Dots that find each other: people, friends, circles, household. The gold one is you. */
export function ArtFriends() {
  const pts = [[80, 62], [34, 34], [124, 28], [132, 88], [32, 92]];
  return (
    <Art className="es-friends">
      {pts.slice(1).map(([x, y], i) => (
        <line key={i} className="es-draw" style={{ animationDelay: `${0.25 + i * 0.22}s` }} x1="80" y1="62" x2={x} y2={y} stroke={i === 3 ? '#b98f4a' : '#c9b48a'} strokeWidth="2" strokeLinecap="round" strokeDasharray={i === 3 ? '2 5' : undefined} pathLength="100" />
      ))}
      <path className="es-draw" style={{ animationDelay: '1.1s' }} d="M34 34 Q 80 12 124 28" fill="none" stroke="#e0d1b4" strokeWidth="1.6" strokeLinecap="round" pathLength="100" />
      <path className="es-draw" style={{ animationDelay: '1.3s' }} d="M124 28 Q 142 58 132 88" fill="none" stroke="#e0d1b4" strokeWidth="1.6" strokeLinecap="round" pathLength="100" />
      {pts.slice(1, 4).map(([x, y], i) => <circle key={i} className="es-pop" style={{ animationDelay: `${0.5 + i * 0.22}s` }} cx={x} cy={y} r={i === 1 ? 10 : 9} fill={i === 1 ? '#1e352d' : '#fffdf9'} stroke="#1e352d" strokeWidth="2.2" />)}
      <circle className="es-ring" cx="32" cy="92" r="11" fill="#fffdf9" stroke="#b98f4a" strokeWidth="1.8" strokeDasharray="3.5 3.5" />
      <path d="M32 87 v10 M27 92 h10" stroke="#b98f4a" strokeWidth="2" strokeLinecap="round" />
      <circle className="es-pulse" cx="80" cy="62" r="20" fill="#d9b77a" opacity=".25" />
      <circle cx="80" cy="62" r="13" fill="#d9b77a" stroke="#7d5d27" strokeWidth="2.2" />
    </Art>
  );
}

/* An open book with a ribbon that falls into the fold: saved places. */
export function ArtBookmark() {
  return (
    <Art className="es-book">
      <path d="M80 44 C 66 36, 46 34, 30 38 v52 c16-4 36-2 50 6 z" fill="#fffdf9" stroke="#1e352d" strokeWidth="2" strokeLinejoin="round" />
      <path d="M80 44 C 94 36, 114 34, 130 38 v52 c-16-4-36-2-50 6 z" fill="#f7f0e4" stroke="#1e352d" strokeWidth="2" strokeLinejoin="round" />
      <path d="M40 52 c10-2 22-1 32 3 M40 62 c10-2 22-1 32 3 M40 72 c8-1 16 0 22 2" fill="none" stroke="#e3d6bf" strokeWidth="2" strokeLinecap="round" />
      <path d="M90 55 c10-4 22-5 30-3 M90 65 c10-4 22-5 30-3" fill="none" stroke="#e3d6bf" strokeWidth="2" strokeLinecap="round" />
      <g className="es-drop"><path d="M98 14 h14 v46 l-7 -6 l-7 6 z" fill="#d9b77a" stroke="#7d5d27" strokeWidth="1.5" strokeLinejoin="round" /></g>
    </Art>
  );
}

/* A day-to-a-page calendar whose top page lifts away: dates, days, the itinerary. */
export function ArtCalendar({ day = '9' }) {
  return (
    <Art className="es-cal">
      <rect x="48" y="30" width="64" height="66" rx="10" fill="#fffdf9" stroke="#1e352d" strokeWidth="2" />
      <path d="M48 48 h64" stroke="#1e352d" strokeWidth="2" />
      <text x="80" y="82" textAnchor="middle" fontSize="28" fill="#1e352d" fontFamily="Instrument Serif, Georgia, serif">{Number(day) + 1}</text>
      <g className="es-page">
        <rect x="49" y="49" width="62" height="46" rx="0" fill="#fffdf9" />
        <path d="M49 49 h62 v37 a9 9 0 0 1 -9 9 h-44 a9 9 0 0 1 -9 -9 z" fill="#fffdf9" stroke="#e3d6bf" strokeWidth="1" />
        <circle cx="80" cy="72" r="15" fill="#f4e9d3" />
        <text x="80" y="82" textAnchor="middle" fontSize="28" fill="#7d5d27" fontFamily="Instrument Serif, Georgia, serif">{day}</text>
      </g>
      <rect x="48" y="30" width="64" height="18" rx="10" fill="#1e352d" />
      <rect x="48" y="40" width="64" height="8" fill="#1e352d" />
      <path d="M62 24 v12 M98 24 v12" stroke="#d9b77a" strokeWidth="3" strokeLinecap="round" />
    </Art>
  );
}

/* A receipt that prints out of a slot: payments and invoices. With `stamp`, the trip is settled. */
export function ArtReceipt({ stamp }) {
  const id = useArtId();
  return (
    <Art className="es-receipt">
      <defs><clipPath id={id}><rect x="40" y="34" width="80" height="80" /></clipPath></defs>
      <g clipPath={`url(#${id})`}>
        <g className={stamp ? '' : 'es-print'}>
          <path d="M54 30 h52 v66 l-6.5 5 l-6.5 -5 l-6.5 5 l-6.5 -5 l-6.5 5 l-6.5 -5 l-6.5 5 l-6.5 -5 z" fill="#fffdf9" stroke="#1e352d" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M62 48 h26 M62 56 h36 M62 64 h20" stroke="#e3d6bf" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M62 80 h18" stroke="#1e352d" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M90 80 h8" stroke="#b98f4a" strokeWidth="2.4" strokeLinecap="round" />
          {stamp && <g className="es-stamp" transform="rotate(-12 96 64)"><circle cx="96" cy="64" r="14" fill="none" stroke="#b98f4a" strokeWidth="2" /><circle cx="96" cy="64" r="10.5" fill="none" stroke="#b98f4a" strokeWidth="1" strokeDasharray="2 2" /><path d="M90 64 l4 4 l8 -8" fill="none" stroke="#b98f4a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></g>}
        </g>
      </g>
      <rect x="34" y="24" width="92" height="14" rx="7" fill="#1e352d" />
      <path d="M44 31 h72" stroke="#0f1a16" strokeWidth="3" strokeLinecap="round" />
      <circle cx="116" cy="31" r="2" fill="#d9b77a" className="es-blink" />
    </Art>
  );
}

/* Two bubbles, one breathing: a chat that hasn't started. */
export function ArtChat() {
  return (
    <Art className="es-chat">
      <g className="es-breathe">
        <path d="M30 34 h64 a12 12 0 0 1 12 12 v18 a12 12 0 0 1 -12 12 h-46 l-12 10 v-10 h-6 a12 12 0 0 1 -12 -12 v-18 a12 12 0 0 1 12 -12 z" fill="#fffdf9" stroke="#1e352d" strokeWidth="2" strokeLinejoin="round" transform="translate(12 0)" />
        <circle className="es-dot d1" cx="62" cy="55" r="3.6" fill="#1e352d" /><circle className="es-dot d2" cx="74" cy="55" r="3.6" fill="#1e352d" /><circle className="es-dot d3" cx="86" cy="55" r="3.6" fill="#1e352d" />
      </g>
      <g className="es-float">
        <path d="M100 74 h28 a10 10 0 0 1 10 10 v4 a10 10 0 0 1 -10 10 h-2 v8 l-10 -8 h-16 a10 10 0 0 1 -10 -10 v-4 a10 10 0 0 1 10 -10 z" fill="#d9b77a" stroke="#7d5d27" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M100 86 h18" stroke="#7d5d27" strokeWidth="2" strokeLinecap="round" opacity=".55" />
      </g>
    </Art>
  );
}

/* A compass whose needle swings and settles: no match yet, we'll find the way. */
export function ArtCompass() {
  return (
    <Art className="es-compass">
      <circle cx="80" cy="60" r="38" fill="#fffdf9" stroke="#1e352d" strokeWidth="2" />
      <circle cx="80" cy="60" r="30" fill="none" stroke="#e3d6bf" strokeWidth="1.2" />
      {Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; const r1 = i % 3 ? 33 : 30; return <line key={i} x1={80 + Math.sin(a) * r1} y1={60 - Math.cos(a) * r1} x2={80 + Math.sin(a) * 36} y2={60 - Math.cos(a) * 36} stroke={i % 3 ? '#d6c9b1' : '#1e352d'} strokeWidth={i % 3 ? 1.2 : 2} strokeLinecap="round" />; })}
      <text x="80" y="20" textAnchor="middle" fontSize="9" fontWeight="700" fill="#7d5d27" fontFamily="Inter Tight, sans-serif" transform="translate(0 -3)">N</text>
      <g className="es-needle"><path d="M80 34 L86 60 L80 86 L74 60 Z" fill="#fffdf9" stroke="#1e352d" strokeWidth="1.6" strokeLinejoin="round" /><path d="M80 34 L86 60 L74 60 Z" fill="#d9b77a" stroke="#7d5d27" strokeWidth="1.4" strokeLinejoin="round" /></g>
      <circle cx="80" cy="60" r="3.4" fill="#1e352d" />
    </Art>
  );
}

/* A lantern left on, swaying a little: quiet, but someone is watching for you. */
export function ArtLantern() {
  const id = useArtId();
  return (
    <Art className="es-lantern">
      <defs><radialGradient id={id}><stop offset="0" stopColor="#f3d79c" stopOpacity=".95" /><stop offset="1" stopColor="#f3d79c" stopOpacity="0" /></radialGradient></defs>
      <path d="M40 16 h80" stroke="#d6c9b1" strokeWidth="1.5" strokeLinecap="round" />
      <g className="es-swing-l">
        <path d="M80 16 v14" stroke="#7d5d27" strokeWidth="1.5" />
        <circle className="es-glow" cx="80" cy="66" r="34" fill={`url(#${id})`} />
        <path d="M70 34 h20 l4 8 h-28 z" fill="#1e352d" />
        <path d="M66 42 h28 c2 14 2 30 0 44 h-28 c-2-14-2-30 0-44 z" fill="#fff7e6" stroke="#1e352d" strokeWidth="2" strokeLinejoin="round" />
        <path d="M74 42 c-1 14-1 30 0 44 M86 42 c1 14 1 30 0 44" stroke="#e3c58d" strokeWidth="1.2" fill="none" />
        <path className="es-flame" d="M80 54 c5 6 6 11 0 16 c-6-5-5-10 0-16z" fill="#d9b77a" stroke="#b98f4a" strokeWidth="1" />
        <path d="M68 86 h24 l-3 6 h-18 z" fill="#1e352d" />
      </g>
    </Art>
  );
}

/* An envelope with a letter that lifts out: invites and email. */
export function ArtEnvelope() {
  return (
    <Art className="es-env">
      <g className="es-lift">
        <rect x="56" y="32" width="48" height="44" rx="4" fill="#fffdf9" stroke="#1e352d" strokeWidth="1.8" />
        <path d="M64 44 h24 M64 52 h32 M64 60 h18" stroke="#d9b77a" strokeWidth="2.2" strokeLinecap="round" />
      </g>
      <path d="M40 58 l40 28 l40 -28 v38 a6 6 0 0 1 -6 6 h-68 a6 6 0 0 1 -6 -6 z" fill="#f4ecdd" stroke="#1e352d" strokeWidth="2" strokeLinejoin="round" />
      <path d="M40 102 l30 -24 M120 102 l-30 -24" stroke="#1e352d" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
      <circle cx="80" cy="84" r="5.5" fill="#d9b77a" stroke="#7d5d27" strokeWidth="1.2" />
    </Art>
  );
}

/* One phone, one quiet check: signed in only here. */
export function ArtPhone() {
  return (
    <Art className="es-phone">
      <circle className="es-pulse" cx="80" cy="60" r="34" fill="#d9b77a" opacity=".18" />
      <rect x="62" y="22" width="36" height="76" rx="9" fill="#fffdf9" stroke="#1e352d" strokeWidth="2.2" />
      <path d="M74 28 h12" stroke="#1e352d" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="80" cy="60" r="11" fill="#1e352d" />
      <path d="M75 60 l3.5 3.5 l6.5 -7" fill="none" stroke="#d9b77a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M40 46 h10 M38 60 h12 M40 74 h10 M110 46 h10 M110 60 h12 M110 74 h10" stroke="#e3d6bf" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 4" />
    </Art>
  );
}

/* The wrapper every empty state uses: a drawing on a soft stage, one line of what lands here and why,
   one next step, and at most a few quiet ideas in a single row. `compact` is the inline version for lists. */
export function EmptyState({ art, title, body, action, ideas, compact, center, tall, middle, onClick, label, className = '', children, plain }) {
  if (compact) {
    const inner = (<>
      <span className="es-tile" aria-hidden="true">{art}</span>
      <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
        <span className="h3" style={{ fontSize: 15 }}>{title}</span>
        {body && <span className="tiny es-row-body">{body}</span>}
        {action && <span className="es-row-act">{action}</span>}
      </span>
      {onClick && <Icon name="chevron" size={18} />}
    </>);
    return onClick
      ? <button type="button" className={'es-row tap ' + (plain ? 'plain ' : '') + className} onClick={onClick} aria-label={label}>{inner}</button>
      : <div className={'es-row ' + (plain ? 'plain ' : '') + className}>{inner}</div>;
  }
  return (
    <section className={'es rise ' + (center ? 'center ' : '') + (tall ? 'tall ' : '') + (middle ? 'middle ' : '') + (plain ? 'plain ' : '') + className} aria-label={label || (typeof title === 'string' ? title : undefined)}>
      {art && <div className="es-stage" aria-hidden="true">{art}</div>}
      <h2 className="display es-title">{title}</h2>
      {body && <p className="small es-body">{body}</p>}
      {children}
      {action}
      {ideas && ideas.length > 0 && (
        <div className="es-ideas" role="group" aria-label="Ideas">
          {ideas.map(([t, fn]) => <button key={t} type="button" className="chip" onClick={() => { buzz(HAPTIC.tap); fn(); }}>{t}</button>)}
        </div>
      )}
    </section>
  );
}

/* Three rings that drift until they overlap: a circle of people, planning together. */
export function ArtCircles() {
  return (
    <Art className="es-rings">
      <g className="es-ring-a"><circle cx="58" cy="66" r="28" fill="rgba(30,53,45,.05)" stroke="#1e352d" strokeWidth="2" /><circle cx="58" cy="66" r="5" fill="#1e352d" /></g>
      <g className="es-ring-b"><circle cx="102" cy="66" r="28" fill="rgba(217,183,122,.12)" stroke="#b98f4a" strokeWidth="2" /><circle cx="102" cy="66" r="5" fill="#b98f4a" /></g>
      <g className="es-ring-c"><circle cx="80" cy="42" r="22" fill="none" stroke="#d9b77a" strokeWidth="2" strokeDasharray="4 5" /><circle cx="80" cy="42" r="5" fill="#d9b77a" /></g>
    </Art>
  );
}

/* ======================================================================================================
   When things go wrong: the failure-state family.
   Same hand as the empty states (2-unit strokes on a 160×120 board, paper fills, green ink, gold for the one
   thing that's alive), same stage, same motion rules. Every state says three things, in this order:
   what happened, what still works, and one next step. Nothing is red, nothing shakes, nobody is blamed.
   ====================================================================================================== */

const DESK_LINE = '+966 11 520 0000';
const DESK_CALL = 'tel:+966115200000';

/* The connection and server state the whole app reads. `stale` means we're showing what's saved. */
export function useNet() {
  const { s } = useStore();
  const d = s.demo || {};
  return { offline: !!d.offline, weak: !!d.weak && !d.offline, down: !!d.serverDown && !d.offline, stale: !!d.offline || !!d.serverDown };
}

/* A phone with its signal arcs. Offline: the arcs rest, dashed, and a letter waits above the phone.
   Weak: the arcs light one at a time, slowly. */
export function ArtSignal({ weak }) {
  return (
    <Art className={'es-signal' + (weak ? ' weak' : '')}>
      {[14, 26, 38].map((r, i) => (
        <path key={r} className={weak ? 'fs-arc a' + i : ''} d={`M${80 - r} ${66 - r * 0.15} A ${r} ${r} 0 0 1 ${80 + r} ${66 - r * 0.15}`} fill="none" stroke={weak ? '#b98f4a' : '#d6c9b1'} strokeWidth="2.4" strokeLinecap="round" strokeDasharray={weak ? undefined : '3 6'} transform="translate(0 -14)" />
      ))}
      <rect x="66" y="56" width="28" height="48" rx="7" fill="#fffdf9" stroke="#1e352d" strokeWidth="2.2" />
      <path d="M75 61 h10" stroke="#1e352d" strokeWidth="2" strokeLinecap="round" />
      <circle cx="80" cy="52" r="3.4" fill={weak ? '#d9b77a' : '#1e352d'} />
      {!weak && (
        <g className="es-float">
          <rect x="102" y="24" width="26" height="18" rx="3" fill="#d9b77a" stroke="#7d5d27" strokeWidth="1.5" />
          <path d="M102 26 l13 9 l13 -9" fill="none" stroke="#7d5d27" strokeWidth="1.5" strokeLinejoin="round" />
        </g>
      )}
    </Art>
  );
}

/* A desk bell with its ring fading out: we rang, nobody at Mada's end answered yet. */
export function ArtDesk() {
  return (
    <Art className="es-desk">
      <path className="fs-wave w1" d="M50 50 a34 34 0 0 1 60 0" fill="none" stroke="#d9b77a" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 6" />
      <path className="fs-wave w2" d="M40 46 a46 46 0 0 1 80 0" fill="none" stroke="#e3d6bf" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 6" />
      <g className="fs-ding">
        <path d="M80 54 v-6" stroke="#1e352d" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="80" cy="46" r="3.6" fill="#1e352d" />
        <path d="M52 86 a28 28 0 0 1 56 0 z" fill="#d9b77a" stroke="#7d5d27" strokeWidth="2" strokeLinejoin="round" />
        <path d="M62 78 a18 18 0 0 1 12 -12" fill="none" stroke="#fffdf9" strokeWidth="2.4" strokeLinecap="round" opacity=".7" />
      </g>
      <rect x="42" y="86" width="76" height="9" rx="4.5" fill="#1e352d" />
      <path d="M36 102 h88" stroke="#e3d6bf" strokeWidth="2" strokeLinecap="round" />
    </Art>
  );
}

/* A door sign on a nail that swings a little: closed for a planned hour, back at a set time. */
export function ArtSign({ until = '03:00' }) {
  return (
    <Art className="es-sign">
      <circle cx="80" cy="18" r="3" fill="#1e352d" />
      <g className="es-swing-l">
        <path d="M80 18 L56 44 M80 18 L104 44" stroke="#7d5d27" strokeWidth="1.5" fill="none" />
        <rect x="40" y="42" width="80" height="54" rx="9" fill="#fffdf9" stroke="#1e352d" strokeWidth="2.2" />
        <rect x="46" y="48" width="68" height="42" rx="5" fill="none" stroke="#e3d6bf" strokeWidth="1.2" />
        <text x="80" y="64" textAnchor="middle" fontSize="8.5" fontWeight="700" letterSpacing="1.4" fill="#7d5d27" fontFamily="Inter Tight, Arial, sans-serif">BACK AT</text>
        <text x="80" y="83" textAnchor="middle" fontSize="17" fill="#1e352d" fontFamily="JetBrains Mono, Menlo, monospace" fontWeight="600">{until}</text>
      </g>
    </Art>
  );
}

/* A phone with a gold arrow lifting out of it: a new version is ready. */
export function ArtUpdate() {
  return (
    <Art className="es-update">
      <circle className="es-pulse" cx="80" cy="62" r="34" fill="#d9b77a" opacity=".18" />
      <rect x="60" y="20" width="40" height="84" rx="10" fill="#fffdf9" stroke="#1e352d" strokeWidth="2.2" />
      <path d="M73 26 h14" stroke="#1e352d" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M68 88 h24" stroke="#e3d6bf" strokeWidth="2.4" strokeLinecap="round" />
      <g className="fs-up">
        <circle cx="80" cy="58" r="13" fill="#d9b77a" stroke="#7d5d27" strokeWidth="1.6" />
        <path d="M80 65 v-14 M74 57 l6 -6 l6 6" fill="none" stroke="#1e352d" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <path d="M40 40 h8 M36 52 h10 M112 40 h8 M114 52 h10" stroke="#e3d6bf" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 4" />
    </Art>
  );
}

/* A key that turns in its lock and back: sign in again, nothing else changes. */
export function ArtKey() {
  return (
    <Art className="es-key">
      <rect x="34" y="34" width="44" height="56" rx="10" fill="#fffdf9" stroke="#1e352d" strokeWidth="2.2" />
      <circle cx="56" cy="56" r="6" fill="#1e352d" />
      <path d="M56 60 l-3 14 h6 z" fill="#1e352d" />
      <g className="fs-turn">
        <circle cx="104" cy="62" r="14" fill="#d9b77a" stroke="#7d5d27" strokeWidth="2" />
        <circle cx="104" cy="62" r="5" fill="#fffdf9" stroke="#7d5d27" strokeWidth="1.5" />
        <path d="M90 62 h-24 M74 62 v7 M68 62 v5" stroke="#7d5d27" strokeWidth="3" strokeLinecap="round" />
      </g>
    </Art>
  );
}

/* An hourglass that drains, then turns over: wait a moment, then go again. */
export function ArtHourglass() {
  return (
    <Art className="es-hour">
      <g className="fs-flip">
        <path d="M60 22 h40 M60 98 h40" stroke="#1e352d" strokeWidth="3" strokeLinecap="round" />
        <path d="M64 24 c0 18 12 24 14 36 c-2 12 -14 18 -14 36 h32 c0 -18 -12 -24 -14 -36 c2 -12 14 -18 14 -36 z" fill="#fffdf9" stroke="#1e352d" strokeWidth="2.2" strokeLinejoin="round" />
        <path className="fs-sand-top" d="M70 34 h20 c-2 8 -7 12 -10 18 c-3 -6 -8 -10 -10 -18 z" fill="#d9b77a" />
        <path className="fs-sand-bot" d="M68 94 c2 -8 8 -12 12 -14 c4 2 10 6 12 14 z" fill="#d9b77a" />
        <path className="fs-stream" d="M80 60 v20" stroke="#d9b77a" strokeWidth="1.6" strokeDasharray="2 3" />
      </g>
    </Art>
  );
}

/* Two gears, the gold one turning back into step: something broke on our side, and it's being put right. */
/* A crash, told as a holding pattern: the plane circles the fix while we sort it, the trail following it round,
   clouds drifting past. Calm, never stuck. Reduced motion parks the plane on the top leg. */
const HOLD = 'M44 36 H116 A24 24 0 0 1 116 84 H44 A24 24 0 0 1 44 36 Z';
const HOLD_LEN = 144 + 2 * Math.PI * 24;
export const PLANE_TOP = 'M9.5 0 C9.5 -1.3 8 -1.6 6.5 -1.6 L2.6 -1.6 L-1.4 -8.6 L-3.8 -8.6 L-1.9 -1.6 L-5.8 -1.6 L-7.6 -4.2 L-9.3 -4.2 L-8.3 -0.8 L-8.3 0.8 L-9.3 4.2 L-7.6 4.2 L-5.8 1.6 L-1.9 1.6 L-3.8 8.6 L-1.4 8.6 L2.6 1.6 L6.5 1.6 C8 1.6 9.5 1.3 9.5 0 Z';
export function ArtHolding() {
  const still = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dur = '9s';
  return (
    <Art className="es-holding">
      <g className="hp-cloud hp-cloud-a" fill="#fffdf9" opacity="0.9"><path d="M8 18 a7 7 0 0 1 12 -5 a9 9 0 0 1 16 4 a6 6 0 0 1 0 12 h-26 a6 6 0 0 1 -2 -11 z" /></g>
      <g className="hp-cloud hp-cloud-b" fill="#fffdf9" opacity="0.75"><path d="M120 98 a6 6 0 0 1 10 -4 a8 8 0 0 1 14 3 a5 5 0 0 1 0 10 h-22 a5 5 0 0 1 -2 -9 z" /></g>
      <path d={HOLD} fill="none" stroke="#e3d6bf" strokeWidth="1.6" strokeDasharray="2 5" strokeLinecap="round" />
      <circle className="hp-ping" cx="80" cy="60" r="5" fill="none" stroke="#d9b77a" strokeWidth="1.5" />
      <circle cx="80" cy="60" r="3.5" fill="#d9b77a" stroke="#7d5d27" strokeWidth="1.4" />
      {still ? (
        <g transform="translate(98 36) scale(1.4)"><path d={PLANE_TOP} fill="#1e352d" stroke="#fffdf9" strokeWidth="0.8" strokeLinejoin="round" /></g>
      ) : (
        <>
          <path d={HOLD} fill="none" stroke="#d9b77a" strokeWidth="2.4" strokeLinecap="round" strokeDasharray={`44 ${HOLD_LEN}`} opacity="0.75">
            <animate attributeName="stroke-dashoffset" from="44" to={44 - HOLD_LEN} dur={dur} repeatCount="indefinite" />
          </path>
          <g>
            <path d={PLANE_TOP} transform="scale(1.4)" fill="#1e352d" stroke="#fffdf9" strokeWidth="0.8" strokeLinejoin="round" />
            <animateMotion dur={dur} repeatCount="indefinite" rotate="auto" path={HOLD} />
          </g>
        </>
      )}
    </Art>
  );
}

/* A ticket torn in two, the halves drifting a little apart: the thing this link pointed to is gone. */
export function ArtTorn() {
  return (
    <Art className="es-torn">
      <g className="fs-half-l">
        <path d="M24 38 h52 l-4 6 l5 6 l-5 6 l5 6 l-5 6 l5 6 l-5 6 l4 6 h-52 a6 6 0 0 1 -6 -6 v-36 a6 6 0 0 1 6 -6 z" fill="#fffdf9" stroke="#1e352d" strokeWidth="2" strokeLinejoin="round" />
        <path d="M30 52 h22 M30 70 h30" stroke="#e3d6bf" strokeWidth="2.4" strokeLinecap="round" />
        <text x="30" y="65" fontSize="9" fontWeight="700" fill="#1e352d" fontFamily="Inter Tight, sans-serif">RUH</text>
      </g>
      <g className="fs-half-r">
        <path d="M86 38 h50 a6 6 0 0 1 6 6 v36 a6 6 0 0 1 -6 6 h-50 l4 -6 l-5 -6 l5 -6 l-5 -6 l5 -6 l-5 -6 l5 -6 l-5 -6 z" fill="#fffdf9" stroke="#1e352d" strokeWidth="2" strokeLinejoin="round" />
        <text x="100" y="65" fontSize="9" fontWeight="700" fill="#b98f4a" fontFamily="Inter Tight, sans-serif">???</text>
        <path d="M100 52 h24 M100 72 h16" stroke="#e3d6bf" strokeWidth="2.4" strokeLinecap="round" />
      </g>
    </Art>
  );
}

/* A settings switch that slides on, rests, and slides back: it's off on this phone, and it's one switch away. */
export function ArtSwitch({ icon = 'camera' }) {
  return (
    <Art className="es-switch">
      <circle cx="80" cy="36" r="17" fill="#fffdf9" stroke="#1e352d" strokeWidth="2" />
      <g transform="translate(68 24)"><g transform="scale(1)" fill="none" stroke="#1e352d" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{PATHS[icon]}</g></g>
      <rect x="52" y="70" width="56" height="30" rx="15" fill="#e9e2d8" stroke="#1e352d" strokeWidth="2" />
      <rect className="fs-track" x="52" y="70" width="56" height="30" rx="15" fill="#d9b77a" />
      <circle className="fs-knob" cx="67" cy="85" r="11" fill="#fffdf9" stroke="#1e352d" strokeWidth="2" />
    </Art>
  );
}

/* A price tag with a ring that runs down slowly: nothing was charged, the price is still held. */
export function ArtPriceHold() {
  return (
    <Art className="es-hold">
      <path d="M40 46 l26 -16 h44 a6 6 0 0 1 6 6 v48 a6 6 0 0 1 -6 6 h-44 z" fill="#fffdf9" stroke="#1e352d" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="58" cy="60" r="4" fill="none" stroke="#1e352d" strokeWidth="2" />
      <path d="M74 52 h26 M74 62 h18" stroke="#e3d6bf" strokeWidth="2.4" strokeLinecap="round" />
      <text x="74" y="80" fontSize="10" fontWeight="700" fill="#1e352d" fontFamily="Inter Tight, sans-serif">SAR</text>
      <circle cx="120" cy="86" r="16" fill="#1e352d" />
      <circle cx="120" cy="86" r="11" fill="none" stroke="rgba(233,226,216,.25)" strokeWidth="3" />
      <path className="fs-ring" d="M120 75 a11 11 0 1 1 -0.01 0" fill="none" stroke="#d9b77a" strokeWidth="3" strokeLinecap="round" pathLength="100" strokeDasharray="100" />
      <path d="M120 80 v6 l4 2" stroke="#fffdf9" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </Art>
  );
}

/* A page going up a line of dots that pauses partway: the part that went is kept. */
export function ArtUploadStop() {
  return (
    <Art className="es-upstop">
      <path d="M58 30 h30 l14 14 v48 h-44 z" fill="#fffdf9" stroke="#1e352d" strokeWidth="2" strokeLinejoin="round" />
      <path d="M88 30 v14 h14" fill="none" stroke="#1e352d" strokeWidth="2" strokeLinejoin="round" />
      <path d="M66 54 h22 M66 62 h28 M66 70 h18" stroke="#e3d6bf" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="40" y="100" width="80" height="6" rx="3" fill="#e9e2d8" />
      <rect className="fs-bar" x="40" y="100" width="50" height="6" rx="3" fill="#d9b77a" />
      <circle className="es-blink" cx="90" cy="103" r="5" fill="#fffdf9" stroke="#b98f4a" strokeWidth="2" />
      <path d="M118 52 v-14 M112 44 l6 -6 l6 6" stroke="#b98f4a" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Art>
  );
}

/* ---------- loading: skeletons and the slow-connection veil ---------- */

/* Grey shapes where the content will be, with one slow sheen across them. */
export function Skeleton({ rows = 3, hero = true, className = '' }) {
  return (
    <div className={'sk-wrap ' + className} aria-hidden="true">
      {hero && <div className="sk sk-hero" />}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="sk-row">
          <span className="sk sk-tile" />
          <span className="col grow" style={{ gap: 8 }}><span className="sk sk-line" style={{ width: `${72 - i * 9}%` }} /><span className="sk sk-line short" style={{ width: `${44 + i * 7}%` }} /></span>
        </div>
      ))}
    </div>
  );
}

/* A weak connection: the screen loads under a skeleton. After 4 seconds we say so, with a way out. */
export function LoadingVeil({ onCancel, onDone, ms = 7600, stacked }) {
  const [slow, setSlow] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => { setSlow(true); buzz(HAPTIC.tap); }, 4000);
    const b = setTimeout(() => { setGone(true); onDone && onDone(); }, ms);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  if (gone) return null;
  return (
    <div className={'veil-load' + (stacked ? ' stacked' : '')} role="status" aria-live="polite" aria-label="Loading">
      <Skeleton rows={4} />
      {slow && (
        <div className="slow-note">
          <span className="slow-dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="col grow" style={{ gap: 1 }}><span className="h3" style={{ fontSize: 15 }}>Still working… slower than usual</span><span className="tiny">Your connection is weak. Nothing you did is lost.</span></span>
          <button type="button" className="btn secondary small" onClick={() => { buzz(HAPTIC.tap); setGone(true); onCancel && onCancel(); }}>Cancel</button>
        </div>
      )}
    </div>
  );
}

/* ---------- small honest markers ---------- */

/* Shown on anything that came from this phone's copy instead of live. */
export function StaleBadge({ mins = 14, offline }) {
  return (
    <span className="stale" role="status"><i aria-hidden="true" />{offline ? `Saved on this phone · updated ${mins} min ago` : `Last updated ${mins} min ago`}</span>
  );
}
/* The badge, only when what's on screen is the saved copy. Drop it under any header that shows cached data. */
export function NetStale() {
  const net = useNet();
  if (!net.stale) return null;
  return <div className="stale-row rise"><StaleBadge offline={net.offline} /></div>;
}

/* One step that couldn't finish, said in place: what happened, then Try again. Everything around it still works. */
export function InlineError({ art, icon = 'refund', title, body, onRetry, retryLabel = 'Try again', secondary, tone, className = '' }) {
  const [busy, setBusy] = useState(false);
  const retry = () => { if (busy) return; buzz(HAPTIC.tap); setBusy(true); setTimeout(() => { setBusy(false); onRetry && onRetry(); }, 900); };
  return (
    <div className={'ie rise' + (tone === 'partial' ? ' partial' : '') + ' ' + className} role="status">
      {art ? <span className="es-tile ie-art" aria-hidden="true">{art}</span> : <span className="ie-ic" aria-hidden="true"><Icon name={icon} size={20} color="#7d5d27" /></span>}
      <span className="col grow" style={{ gap: 4, minWidth: 0 }}>
        <span className="h3" style={{ fontSize: 15 }}>{title}</span>
        {body && <span className="small">{body}</span>}
        {(onRetry || secondary) && (
          <span className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {onRetry && <button type="button" className="btn primary small" onClick={retry} disabled={busy}>{busy ? <><span className="spinner light" />Trying</> : retryLabel}</button>}
            {secondary}
          </span>
        )}
      </span>
    </div>
  );
}

/* What still works, as quiet chips with a tick. */
function Works({ items }) {
  if (!items || !items.length) return null;
  return (
    <div className="fs-works" role="list" aria-label="Still works">
      <span className="fs-works-label" aria-hidden="true">Still works</span>
      {items.map((t) => <span key={t} className="fs-work" role="listitem"><Icon name="check" size={14} width={2.4} color="#2f7a4b" />{t}</span>)}
    </div>
  );
}

/* A whole area that has nothing saved to show: the empty-state stage, plus what still works and one next step. */
export function ErrorState({ art, title, body, works, action, secondary, className = '', tall }) {
  return (
    <EmptyState className={'fs-err ' + className} tall={tall} art={art} title={title} body={body}
      action={<>{works && <Works items={works} />}{action}{secondary}</>} />
  );
}

/* The full-screen version, for when the whole app has to wait: maintenance, an update, a crash. */
export function FullScreenState({ art, eyebrow, title, body, works, list, primary, secondary, note, label, dark }) {
  return (
    <div className={'fs-screen' + (dark ? ' dark' : '')} role="alertdialog" aria-modal="true" aria-label={label || (typeof title === 'string' ? title : 'Mada')}>
      <div className="fs-inner">
        <div className="es-stage fs-stage" aria-hidden="true">{art}</div>
        {eyebrow && <span className="eyebrow fs-eyebrow">{eyebrow}</span>}
        <h1 className="display fs-title">{title}</h1>
        {body && <p className="body fs-body">{body}</p>}
        {list && <ul className="fs-list">{list.map(([ic, t]) => <li key={t}><span className="fs-list-ic"><Icon name={ic} size={16} color="#7d5d27" /></span>{t}</li>)}</ul>}
        <Works items={works} />
      </div>
      <div className="fs-act">
        {primary}
        {secondary}
        {note && <span className="act-note">{note}</span>}
      </div>
    </div>
  );
}

/* ---------- the connection pill and the Outbox ---------- */

/* A small pill in the status-bar strip: never over the back button, never over a banner. Tap for the Outbox. */
export function NetPill({ mode, count, onClick, label }) {
  const text = label || (mode === 'held' ? `${count} didn’t send · open the Outbox` : mode === 'offline' ? (count ? `Offline · ${count} waiting to send` : 'Offline · your trips are on this phone')
    : mode === 'down' ? (count ? `Can’t reach Mada · ${count} waiting` : 'Can’t reach Mada right now')
    : mode === 'weak' ? 'Weak connection · loading slowly'
    : mode === 'sending' ? `Sending ${count} ${count === 1 ? 'thing' : 'things'}…` : '');
  return (
    <button type="button" className={'net-pill ' + mode} onClick={() => { buzz(HAPTIC.tap); onClick && onClick(); }} aria-live="polite" aria-label={text + '. Open the Outbox.'}>
      {mode === 'sending' ? <span className="spinner light" style={{ width: 12, height: 12 }} /> : <i className="net-dot" aria-hidden="true" />}
      <span>{text}</span>
      {mode !== 'weak' && mode !== 'sending' && <Icon name="chevron" size={14} color="currentColor" />}
    </button>
  );
}

const OUTBOX_STATE = { queued: 'Queued', sending: 'Sending', failed: 'Didn’t send' };
const OUTBOX_ICON = { message: 'chat', request: 'doc', choice: 'flight', upload: 'up' };

/* Everything waiting to reach Mada, one row each: Queued, Sending, or Didn't send with Send again and Discard. */
export function OutboxSheet({ onClose }) {
  const { s, set, toast } = useStore();
  const net = useNet();
  const items = outboxItems(s);
  const [busy, setBusy] = useState({});
  const again = (it) => {
    buzz(HAPTIC.tap);
    setBusy((b) => ({ ...b, [it.id]: true }));
    setTimeout(() => {
      setBusy((b) => ({ ...b, [it.id]: false }));
      if (net.offline || s.demo.serverDown) { set((p) => (it.ref.type === 'outbox' ? { outbox: (p.outbox || []).map((o) => (o.id === it.ref.id ? { ...o, state: 'failed', why: net.offline ? 'You’re still offline. It stays here.' : 'Mada isn’t answering yet. It stays here.' } : o)) } : {})); toast(net.offline ? 'Still offline. It stays in the Outbox.' : 'Mada isn’t answering yet. It stays in the Outbox.'); return; }
      if (it.ref.type === 'support') set((p) => ({ support: (p.support || []).map((m) => (m.id === it.ref.id ? { ...m, failed: false, queued: false } : m)) }));
      else set((p) => discardOutbox(p, it.ref));
      buzz(HAPTIC.success); toast('Sent.');
    }, 1300);
  };
  const discard = (it) => { set((p) => discardOutbox(p, it.ref)); buzz(HAPTIC.tap); toast('Discarded. Nothing was sent.'); };
  return (
    <Sheet label="Outbox" onClose={onClose}>
      <div className="row" style={{ gap: 12 }}>
        <span className="es-tile ob-art" aria-hidden="true"><ArtSignal weak={!net.offline} /></span>
        <span className="col" style={{ gap: 2 }}>
          <h2 className="h2">{items.length ? 'Waiting to send' : 'Nothing waiting to send'}</h2>
          <span className="small">{net.offline ? 'You’re offline. These go the moment you’re back.' : net.down ? 'Mada isn’t answering right now. These go as soon as it does.' : 'Everything you did has reached Mada.'}</span>
        </span>
      </div>
      {items.length > 0 && (
        <div className="ob-list" role="list">
          {items.map((it) => {
            const st = busy[it.id] ? 'sending' : it.state;
            return (
              <div key={it.id} className={'ob-row ' + st} role="listitem">
                <span className="ob-ic" aria-hidden="true"><Icon name={OUTBOX_ICON[it.kind] || 'doc'} size={18} /></span>
                <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
                  <span className="ob-title">{it.title}</span>
                  <span className="tiny">{it.sub}{it.size ? ` · ${it.size}` : ''}</span>
                  {st === 'sending' && it.progress != null && <span className="ob-bar" aria-hidden="true"><i style={{ width: `${it.progress}%` }} /></span>}
                  {st === 'failed' && <span className="tiny ob-why">{it.why || 'It didn’t reach Mada. Nothing is lost.'}</span>}
                  {st === 'failed' && (
                    <span className="row" style={{ gap: 8, marginTop: 4 }}>
                      <button type="button" className="btn primary small" onClick={() => again(it)}>Send again</button>
                      <button type="button" className="btn secondary small" onClick={() => discard(it)}>Discard</button>
                    </span>
                  )}
                </span>
                <span className={'ob-state ' + st}>{st === 'sending' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <i />}{OUTBOX_STATE[st]}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="ob-works">
        <span className="eyebrow">Works without a connection</span>
        <span className="small">Trips, Wallet, boarding passes, your itinerary and the hotel address in the local language.</span>
      </div>
      <a className="btn secondary block" href={DESK_CALL}><Icon name="phone" size={18} />Call Mada · {DESK_LINE}</a>
    </Sheet>
  );
}

/* ---------- permissions: one design for camera, contacts, location and alerts ---------- */

const PERMS = {
  camera: { icon: 'camera', title: 'The camera is off for Mada.', why: 'We use it to read passports and documents. Nothing is saved until you check it.', manual: 'Upload a photo instead' },
  contacts: { icon: 'user', title: 'Contacts are off for Mada.', why: 'We match numbers on this phone to show who’s already on Mada. They’re never uploaded.', manual: 'Share your invite link' },
  location: { icon: 'pin', title: 'Location is off for Mada.', why: 'We use your city, never your street, so friends you chose can see you’re nearby.', manual: 'Choose your city instead' },
  notifications: { icon: 'bell', title: 'Alerts are off for Mada.', why: 'Gate changes, delays and your driver arriving. Never offers.', manual: 'Get them by SMS instead' },
};

/* It was turned off in the phone's Settings, so we can't ask again. Say why it helps, how to turn it on, and the way
   to carry on without it. `inline` drops it into a sheet that's already open. */
export function PermissionDenied({ kind = 'camera', onManual, manualLabel, onClose, inline }) {
  const { toast } = useStore();
  const p = PERMS[kind] || PERMS.camera;
  const body = (
    <div className={'perm' + (inline ? ' inline' : '')}>
      <div className="es-stage perm-stage" aria-hidden="true"><ArtSwitch icon={p.icon} /></div>
      <h2 className="h2">{p.title}</h2>
      <p className="small" style={{ margin: 0 }}>{p.why} Turn it on in Settings › Mada, or carry on without it.</p>
      <button type="button" className="btn primary block" onClick={() => { buzz(HAPTIC.tap); toast('Opens the phone’s Settings for Mada.'); }}><Icon name="gear" size={18} color="#f6f2ec" />Open Settings</button>
      <button type="button" className="btn secondary block" onClick={() => { buzz(HAPTIC.tap); onManual && onManual(); }}>{manualLabel || p.manual}</button>
    </div>
  );
  if (inline) return body;
  return <Sheet label={p.title} onClose={onClose}>{body}</Sheet>;
}

/* ---------- images that don't arrive ---------- */

const TONES = [['#1e352d', '#2a4a40'], ['#7d5d27', '#b98f4a'], ['#2a4a40', '#4d5c55'], ['#b98f4a', '#d9b77a'], ['#142720', '#2a4a40']];
const initialsOf = (label) => String(label || 'Mada').replace(/[^A-Za-zÀ-ž\s-]/g, ' ').trim().split(/[\s_-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'M';
/* A tasteful stand-in: a tone picked from the name, the initials in the display serif, the sun's rays faintly. */
export function placeholderSrc(label, small) {
  const k = [...String(label || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length;
  const [a, b] = TONES[k];
  const ini = initialsOf(label);
  /* Large photos usually carry their own words on top, so the initials sit in a small medallion up top and the
     sun's rays rise from the bottom edge. Thumbnails get the initials large and centred. */
  const rays = Array.from({ length: 9 }, (_, i) => { const t = Math.PI + (i * Math.PI) / 8; return `<line x1="${200 + Math.cos(t) * 120}" y1="${330 + Math.sin(t) * 120}" x2="${200 + Math.cos(t) * 210}" y2="${330 + Math.sin(t) * 210}"/>`; }).join('');
  const mark = small
    ? `<text x="200" y="182" text-anchor="middle" font-family="Instrument Serif, Georgia, serif" font-size="120" fill="#fffdf9" fill-opacity=".9">${ini}</text>`
    : `<circle cx="200" cy="92" r="34" fill="none" stroke="#fffdf9" stroke-opacity=".5" stroke-width="2"/><text x="200" y="105" text-anchor="middle" font-family="Instrument Serif, Georgia, serif" font-size="36" fill="#fffdf9" fill-opacity=".85">${ini}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><g stroke="#fffdf9" stroke-opacity=".08" stroke-width="12" stroke-linecap="round">${small ? '' : rays}</g>${mark}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
const labelFor = (img) => {
  if (img.alt) return img.alt;
  const src = img.dataset.orig || img.getAttribute('src') || '';
  const file = (src.split('/').pop() || '').replace(/\.[a-z]+$/i, '');
  return file.replace(/[-_]/g, ' ') || 'Mada';
};

/* An <img> that falls back to the placeholder by itself. */
export function SafeImg({ src, alt = '', label, small, ...rest }) {
  const [bad, setBad] = useState(false);
  return <img {...rest} src={bad ? placeholderSrc(label || alt, small) : src} alt={alt} data-fallback={bad ? '1' : undefined} onError={() => setBad(true)} />;
}

/* Every photo in the phone gets the same fallback when it can't load. With `off`, photos are made to miss
   (the "Photos don't load" switch), so the fallback can be seen everywhere at once. */
export function useImageFallback(off) {
  useEffect(() => {
    const root = document.querySelector('.phone');
    if (!root) return undefined;
    const onErr = (e) => {
      const img = e.target;
      if (!img || img.tagName !== 'IMG' || img.dataset.fallback || /^data:/.test(img.getAttribute('src') || '')) return;
      if (/airlines\//.test(img.dataset.orig || img.getAttribute('src') || '')) return; /* the airline mark has its own fallback */
      img.dataset.fallback = '1';
      img.src = placeholderSrc(labelFor(img), (img.clientWidth || img.parentElement?.clientWidth || 0) < 140);
      img.classList.add('img-fallback');
    };
    root.addEventListener('error', onErr, true);
    let mo = null;
    if (off) {
      const miss = (img) => { const src = img.getAttribute('src') || ''; if (img.dataset.orig || /^(data|blob):/.test(src)) return; img.dataset.orig = src; img.setAttribute('src', 'img/__missing__/' + src.split('/').pop()); };
      root.querySelectorAll('img').forEach(miss);
      mo = new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType !== 1) return; if (n.tagName === 'IMG') miss(n); else n.querySelectorAll && n.querySelectorAll('img').forEach(miss); })));
      mo.observe(root, { childList: true, subtree: true });
    }
    return () => {
      root.removeEventListener('error', onErr, true);
      if (mo) mo.disconnect();
      if (off) root.querySelectorAll('img[data-orig]').forEach((img) => { img.setAttribute('src', img.dataset.orig); delete img.dataset.orig; delete img.dataset.fallback; img.classList.remove('img-fallback'); });
    };
  }, [off]);
}

/* ---------- an upload that keeps what it already sent ---------- */

/* Goes up in steps. With `stopAt`, the connection drops there once; Carry on picks up from the same byte. */
export function UploadProgress({ name = 'scan.jpg', size = 2.4, stopAt, onDone }) {
  const [pct, setPct] = useState(0);
  const [stopped, setStopped] = useState(false);
  const stoppedOnce = useRef(false);
  useEffect(() => {
    if (stopped || pct >= 100) return undefined;
    const t = setTimeout(() => {
      const next = Math.min(100, pct + 8);
      if (stopAt && !stoppedOnce.current && next >= stopAt) { stoppedOnce.current = true; setPct(stopAt); setStopped(true); buzz(HAPTIC.soft); return; }
      setPct(next);
      if (next >= 100) setTimeout(() => onDone && onDone(), 350);
    }, 160);
    return () => clearTimeout(t);
  }, [pct, stopped]);
  const sent = ((size * pct) / 100).toFixed(1);
  return (
    <div className={'up' + (stopped ? ' stopped' : '')} aria-live="polite">
      {stopped && <div className="es-stage up-stage" aria-hidden="true"><ArtUploadStop /></div>}
      <div className="spread"><span className="h3" style={{ fontSize: 15 }}>{stopped ? `Stopped at ${pct}%. The connection dropped.` : `Uploading ${name}`}</span><span className="tiny num">{sent} of {size} MB</span></div>
      <div className="up-track" role="progressbar" aria-label="Upload" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} />{stopped && <b style={{ left: `${pct}%` }} />}</div>
      {stopped && (<>
        <span className="small">The {sent} MB that went is kept. Carry on and it starts from there, not from the beginning.</span>
        <button type="button" className="btn primary block" onClick={() => { buzz(HAPTIC.tap); setStopped(false); }}>Carry on from {pct}%</button>
      </>)}
    </div>
  );
}

/* ---------- app-level screens ---------- */

/* A link to something that isn't there any more: say so, and a way back. */
export function NotFound({ params = {} }) {
  const { pop, reset } = useStore();
  const what = params.what || 'trip';
  return (
    <div className="screen push">
      <TopBar onBack={pop} />
      <div className="scroll no-dock" style={{ paddingTop: 8 }}>
        <ErrorState className="middle" tall art={<ArtTorn />}
          title="This link doesn’t go anywhere now."
          body={`The ${what === 'post' ? 'tip' : what} it pointed to was removed, or it was shared with someone else. Nothing of yours has changed.`}
          works={['Your trips', 'Your Wallet', 'Your circles']}
          action={<button type="button" className="btn primary block" onClick={() => { buzz(HAPTIC.tap); reset(what === 'post' ? 'circles' : 'trips'); }}>{what === 'post' ? 'Go to Circles' : 'See your trips'}</button>}
          secondary={<button type="button" className="btn ghost block" onClick={() => reset('today')}>Go to Today</button>} />
      </div>
    </div>
  );
}

/* Planned downtime: when it ends, what still works, and a person on the phone. */
export function MaintenanceScreen({ until = '03:00', onOpenTrips }) {
  return (
    <FullScreenState label="Planned maintenance" art={<ArtSign until={until} />} eyebrow="Planned maintenance"
      title={<>Mada is being updated until {until}.</>}
      body={`Booking, changes and payments pause until ${until} Riyadh time. It’s planned, and nothing you’ve booked is affected.`}
      works={['Your trips and Wallet still work offline', 'Boarding passes', 'Hotel address']}
      primary={<button type="button" className="btn primary block" onClick={() => { buzz(HAPTIC.tap); onOpenTrips && onOpenTrips(); }}>Open my trips</button>}
      secondary={<a className="btn secondary block" href={DESK_CALL}><Icon name="phone" size={18} />Talk to Mada by phone</a>}
      note={`The desk answers any hour on ${DESK_LINE}.`} />
  );
}

/* This version can't book any more. What's new, and one button. */
export function UpdateScreen({ onUpdate }) {
  return (
    <FullScreenState label="Update Mada" art={<ArtUpdate />} eyebrow="Mada 1.1 is ready"
      title="Update Mada to keep booking."
      body="This version can’t reach bookings any more. Your trips and documents are safe, and they’re all here after the update."
      list={[['trips', 'Boarding passes for the whole family in one swipe'], ['bell', 'Gate changes and delays on the lock screen'], ['circles', 'Pay your share in a circle with mada or Apple Pay']]}
      primary={<button type="button" className="btn primary block" onClick={() => { buzz(HAPTIC.success); onUpdate && onUpdate(); }}>Update Mada</button>}
      note="38 MB from the App Store. Usually under a minute on Wi-Fi." />
  );
}

/* The session ran out: sign back in over the screen you were on, so nothing you typed is lost. */
export function SessionSheet({ onDone }) {
  const { s } = useStore();
  const [code, setCode] = useState('');
  const [bad, setBad] = useState(false);
  const tail = (s.account?.phone?.digits || '501234127').slice(-4);
  const check = (v) => { if (v === '123456') { buzz(HAPTIC.success); onDone && onDone(); } else { setBad(true); setCode(''); buzz(HAPTIC.soft); } };
  return (
    <Sheet label="Sign back in" onClose={() => {}}>
      <div className="row" style={{ gap: 12 }}>
        <span className="es-tile" aria-hidden="true"><ArtKey /></span>
        <span className="col" style={{ gap: 2 }}><h2 className="h2">Sign back in to carry on.</h2><span className="small">You’ve been signed out to keep your account safe. What you typed is still here.</span></span>
      </div>
      <div className="field">
        <label htmlFor="session-code">Code sent to +966 5• ••• {tail}</label>
        <input id="session-code" className={'input otp' + (bad ? ' bad' : '')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); setBad(false); if (v.length === 6) check(v); }} />
        {bad && <span className="err" role="alert">That code doesn’t match. Check the latest text from Mada.</span>}
      </div>
      <span className="tiny">Demo code: 123456. Your trips and Wallet stayed on this phone the whole time.</span>
    </Sheet>
  );
}

/* Too many tries in a row: a short, friendly pause with a countdown, never a lock-out with no end. */
export function RateLimitSheet({ seconds = 45, onDone, onClose }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => { if (left <= 0) return undefined; const t = setTimeout(() => setLeft(left - 1), 1000); return () => clearTimeout(t); }, [left]);
  const r = 26; const c = 2 * Math.PI * r;
  return (
    <Sheet label="A short pause" onClose={onClose}>
      <div className="es-stage rl-stage" aria-hidden="true"><ArtHourglass /></div>
      <h2 className="h2">Let’s take a short pause.</h2>
      <p className="small" style={{ margin: 0 }}>There were a lot of tries in a row, so we’ve paused codes for this number for a moment. It keeps your account safe. Nothing is locked.</p>
      <div className="rl-count" role="timer" aria-live="polite">
        <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r={r} fill="none" stroke="#efe9e0" strokeWidth="5" /><circle cx="32" cy="32" r={r} fill="none" stroke="#d9b77a" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - left / seconds)} transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset 1s linear' }} /></svg>
        <span className="col" style={{ gap: 0 }}><span className="tiny">{left > 0 ? 'You can try again in' : 'Ready when you are'}</span><span className="num rl-time">{left > 0 ? `0:${String(left).padStart(2, '0')}` : '0:00'}</span></span>
      </div>
      <button type="button" className="btn primary block" disabled={left > 0} onClick={() => { buzz(HAPTIC.tap); onDone && onDone(); }}>Try again</button>
      <a className="btn ghost block" href={DESK_CALL}>Talk to Mada instead</a>
    </Sheet>
  );
}

/* Catches a crash anywhere in the app and shows a calm screen instead of a blank one. */
export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { crashed: false }; }
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch() { /* production sends a report here: screen, version, no personal details */ }
  render() {
    if (this.state.crashed) return this.props.fallback(() => this.setState({ crashed: false }));
    return this.props.children;
  }
}
/* Throws while the "App crashed" switch is on, so the boundary above is the real one, not a mock. */
export function Crasher() {
  const { s } = useStore();
  if (s.demo?.crashed) throw new Error('Demo crash');
  return null;
}
export function CrashScreen({ onRestart, onTalk }) {
  return (
    <FullScreenState label="Mada restarted" art={<ArtHolding />} eyebrow="Holding pattern"
      title="We’re circling for a moment. Your trips are safe."
      body="Something on our side stopped. Your bookings, payments and documents are untouched. Restart and you’ll land back on Today."
      primary={<button type="button" className="btn primary block" onClick={() => { buzz(HAPTIC.tap); onRestart && onRestart(); }}>Restart Mada</button>}
      secondary={<button type="button" className="btn secondary block" onClick={() => { buzz(HAPTIC.tap); onTalk && onTalk(); }}>Talk to Mada</button>}
      note="Our team already knows. No personal details were sent." />
  );
}

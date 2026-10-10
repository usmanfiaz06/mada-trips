import { createPortal } from 'react-dom';
import React, { useEffect, useRef, useState } from 'react';
import { buzz, HAPTIC, useStore, registerPerson } from './store.jsx';

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
};

export function Icon({ name, size = 22, color = 'currentColor', width = 1.8, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      {PATHS[name]}
    </svg>
  );
}

export function Plane({ size = 16, color = '#1e352d' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ margin: '0 6px', flexShrink: 0 }}>
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
    const x = (e.clientX - r.left) / r.width;
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
    const x = (e.clientX - r.left) / r.width - offset;
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
  const trans = drag ? 'none' : 'left .45s cubic-bezier(.2,.9,.25,1.15), width .45s cubic-bezier(.2,.9,.25,1.15)';
  const pct = busy ? 1 : p;
  return (
    <button type="button" className={'slider' + (busy ? ' busy' : '')} aria-label={label + '. Press Enter to confirm.'} disabled={disabled}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
      style={{ opacity: disabled ? 0.45 : 1, cursor: drag ? 'grabbing' : 'grab' }}>
      <span className="fill" style={{ width: `calc(${pct * 100}% - ${pct * 64}px + 64px)`, transition: trans }} />
      <span className="label" style={{ opacity: busy ? 1 : Math.max(0, 1 - p * 1.7), color: busy ? '#1e352d' : undefined }}>
        {busy ? <><span className="spinner" style={{ marginRight: 10 }} />{busyLabel}</> : label}
      </span>
      {!busy && (
        <span className="knob" style={{ left: `calc(4px + ${p} * (100% - 64px))`, transition: trans }}>
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

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

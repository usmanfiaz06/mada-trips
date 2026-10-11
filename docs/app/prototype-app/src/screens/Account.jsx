/* Account management: your details and where each one came from, sign-in methods, travel preferences,
   household, security and devices, privacy and data, help and legal. Registered in main.jsx's STACK by name. */
import React, { useEffect, useRef, useState } from 'react';
import { ReturnHero } from './Welcome.jsx';
import { useStore, buzz, HAPTIC, PEOPLE, MRZ, passportIssue } from '../store.jsx';
import { Icon, TopBar, Sheet, Toggle, AddPersonSheet, Sun, EmptyState, ArtEnvelope, ArtSuitcase, ArtFriends, ArtPhone } from '../ui.jsx';
import * as Support from './Support.jsx';
import { CodeInput, PasswordInput, PasswordRules, passwordMeetsRules } from './AuthHelp.jsx';
import { setLang, useLang } from '../lang.jsx';

export const DEMO_CODE = '123456';
const DAY = 86400000;
const MAX_PHOTO = 10 * 1024 * 1024;
const hidden = { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' };

/* ---------- account state: s.account, always read through defaults ---------- */

const DEFAULTS = {
  photo: null,
  photoAt: null,
  preferred: null,
  preferredAt: null,
  email: null,
  phone: { digits: '', source: null, at: null },
  home: 'RUH',
  homeAt: null,
  language: 'en',
  arabicNotify: false,
  currency: 'SAR',
  methods: { apple: false, google: false, phone: false },
  prefs: { seat: 'any', together: true, meal: 'halal', assist: [], loyalty: [], notes: '' },
  people: {},
  faceId: true,
  devices: [
    { id: 'this', name: 'This iPhone', sub: 'Now', current: true },
  ],
  exportAt: null,
  consents: { marketing: false, analytics: true },
  deleteAt: null,
  signedOut: false,
};

export function useAccount() {
  const { s, set } = useStore();
  const raw = s.account || {};
  const a = { ...DEFAULTS, ...raw, prefs: { ...DEFAULTS.prefs, ...(raw.prefs || {}) }, consents: { ...DEFAULTS.consents, ...(raw.consents || {}) }, methods: { ...DEFAULTS.methods, ...(raw.methods || {}) } };
  const save = (patch) => set((p) => {
    const cur = p.account || {};
    const full = { ...DEFAULTS, ...cur, prefs: { ...DEFAULTS.prefs, ...(cur.prefs || {}) }, consents: { ...DEFAULTS.consents, ...(cur.consents || {}) }, methods: { ...DEFAULTS.methods, ...(cur.methods || {}) } };
    return { account: { ...cur, ...(typeof patch === 'function' ? patch(full) : patch) } };
  });
  return [a, save];
}

/* ---------- small helpers ---------- */

export function fmtDate(ts, withYear) {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear || !sameYear ? { year: 'numeric' } : {}) });
}
export const prettyPhone = (d) => (d ? `+966 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}` : 'Not added');
/* Names come only from the passport or what the person typed. With neither, we say "you". */
const firstName = (s) => s.user?.name || (s.user?.full ? s.user.full.split(' ')[0] : '');
export function passportName(s) {
  return s.user?.full || '';
}
export function displayName(s) {
  return (s.account && s.account.preferred) || firstName(s) || '';
}

/* Date of birth from the passport's second MRZ line (YYMMDD at 13–19). */
export function dobOf(id) {
  const line = MRZ[id] && MRZ[id][1];
  const m = line && line.slice(13, 19).match(/^(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const yy = Number(m[1]);
  const year = yy > new Date().getFullYear() % 100 ? 1900 + yy : 2000 + yy;
  return new Date(year, Number(m[2]) - 1, Number(m[3]));
}
const ageOf = (d) => { const n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a -= 1; return a; };
export function ageBand(id) {
  const d = dobOf(id);
  if (!d) return null;
  const age = ageOf(d);
  if (age < 2) return { age, short: 'Infant', label: 'Infant · under 2', note: 'Flies on a lap or in a bassinet. Needs their own passport.' };
  if (age < 12) return { age, short: 'Child', label: `Child · ${age}`, note: 'Child fare on most airlines, from 2 to 11.' };
  if (age < 18) return { age, short: 'Teen', label: `Teen · ${age}`, note: 'Adult fare from 12. Still a minor for visas and consent letters.' };
  return { age, short: 'Adult', label: `Adult · ${age}`, note: null };
}

export function passportStatus(s, id) {
  const p = PEOPLE[id];
  if (!p) return { key: 'none', label: 'Not scanned', tone: 'muted' };
  if (id === 'omar' && !s.passportSaved) return { key: 'none', label: 'Not scanned', tone: 'muted' };
  if (p.added || /not scanned/i.test(p.number || '')) return { key: 'none', label: 'Not scanned', tone: 'muted' };
  const issue = passportIssue(s, id);
  if (issue?.blocking) return { key: 'problem', label: 'Needs renewing', tone: 'warn', text: issue.text };
  if (p.expiresISO) {
    const left = (new Date(p.expiresISO) - Date.now()) / DAY;
    if (left < 0) return { key: 'expired', label: 'Expired', tone: 'warn', text: `Expired on ${fmtDate(p.expiresISO, true)}. It can't be used to travel.` };
    if (left < 365) return { key: 'soon', label: 'Expires soon', tone: 'gold', text: `Expires ${fmtDate(p.expiresISO, true)}. Many countries want 6 months left when you land.` };
  }
  return { key: 'ok', label: 'Scanned', tone: 'ok' };
}
function StatusPill({ st }) {
  return <span className={'pill acc-pill ' + st.tone}>{st.label}</span>;
}

const SRC = {
  passport: ['scan', 'From your passport scan'],
  typed: ['user', 'You typed it'],
  apple: ['lock', 'From Apple sign-in'],
  google: ['lock', 'From Google sign-in'],
  signup: ['check', 'Verified by text when you signed up'],
  verified: ['check', 'Verified'],
  default: ['gear', 'Mada default'],
  none: ['scan', 'Not scanned yet'],
  added: ['user', 'Set when you added them'],
};
export function Source({ kind, at }) {
  const [icon, text] = SRC[kind] || SRC.default;
  const when = at ? (kind === 'verified' ? ' on ' : ' · ') + fmtDate(at) : '';
  return <span className={'acc-src' + (kind === 'verified' || kind === 'signup' ? ' ok' : '')}><Icon name={icon} size={12} width={2.2} />{text}{when}</span>;
}

/* ---------- shared list pieces ---------- */

export function Group({ children, label }) {
  return (
    <section className="col" style={{ gap: 8 }}>
      {label && <span className="eyebrow" style={{ padding: '0 4px' }}>{label}</span>}
      <div className="acc-group">{children}</div>
    </section>
  );
}
export function Row({ icon, lead, label, value, sub, src, onClick, right, danger, locked, ariaLabel }) {
  const inner = (
    <>
      {lead || (icon && <span className="acc-ic"><Icon name={icon} size={20} color={danger ? '#8a3524' : '#1e352d'} /></span>)}
      <span className="grow col" style={{ gap: 2 }}>
        {label && <span className="acc-k">{label}</span>}
        <span className="acc-v" style={danger ? { color: '#8a3524' } : null}>{value}</span>
        {sub && <span className="tiny">{sub}</span>}
        {src}
      </span>
      {right !== undefined ? right : locked ? <Icon name="lock" size={16} color="#8a9590" /> : onClick ? <Icon name="chevron" size={18} color="#8a9590" /> : null}
    </>
  );
  return onClick
    ? <button type="button" className="acc-row" aria-label={ariaLabel} onClick={() => { buzz(HAPTIC.tap); onClick(); }}>{inner}</button>
    : <div className="acc-row">{inner}</div>;
}

/* The person's own photo, or their initial. Use anywhere Omar's avatar appears. */
export function UserAvatar({ size = 40, ring, className = '' }) {
  const { s } = useStore();
  const photo = s.account?.photo;
  const initial = displayName(s).charAt(0).toUpperCase();
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4), flexShrink: 0, ...(ring ? { boxShadow: `0 0 0 2px ${ring}` } : null) };
  return photo
    ? <img className={'avatar acc-photo ' + className} src={photo} alt="" aria-hidden="true" style={style} />
    : <span className={'avatar green ' + className} aria-hidden="true" style={style}>{initial || <Icon name="user" size={Math.round(size * 0.45)} color="#f6f2ec" />}</span>;
}

/* ---------- 6-digit code entry (email, phone, linking) ---------- */

function CodeStep({ to, onDone, onBack, backLabel = 'Change' }) {
  const email = to.includes('@');
  return (
    <>
      <h2 className="h2">Enter the code</h2>
      <p className="body">Sent to {to}. {onBack && <button type="button" className="link" onClick={onBack}>{backLabel}</button>}</p>
      <CodeInput id="acc-code" about={email ? 'email' : 'phone'} contact={to} shownAs={to} flow="add" onDone={onDone} onChange={onBack || (() => {})} />
    </>
  );
}

/* ---------- photo: take, choose, crop, remove ---------- */

const FRAME = 240;
export function PhotoSheet({ onClose }) {
  const { toast } = useStore();
  const [a, save] = useAccount();
  const [stage, setStage] = useState('menu');
  const [err, setErr] = useState(null);
  const [img, setImg] = useState(null); // { src, w, h, via }
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef(null);

  const pick = (file, via) => {
    setErr(null);
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { setErr('That file isn’t a photo. Choose a JPEG or PNG.'); buzz(HAPTIC.soft); return; }
    if (file.size > MAX_PHOTO) { setErr(`That photo is ${Math.round(file.size / 1024 / 1024)} MB. Choose one under 10 MB.`); buzz(HAPTIC.soft); return; }
    const r = new FileReader();
    r.onerror = () => setErr('We couldn’t open that photo. Try a JPEG or PNG.');
    r.onload = () => {
      const im = new Image();
      im.onload = () => { setImg({ src: r.result, w: im.naturalWidth, h: im.naturalHeight, via, el: im }); setZoom(1); setOff({ x: 0, y: 0 }); setStage('crop'); buzz(HAPTIC.tap); };
      im.onerror = () => { setErr('We couldn’t open that photo. Try a JPEG or PNG.'); buzz(HAPTIC.soft); };
      im.src = r.result;
    };
    r.readAsDataURL(file);
  };

  const scale = img ? (FRAME / Math.min(img.w, img.h)) * zoom : 1;
  const clamp = (o, z = zoom) => {
    if (!img) return o;
    const sc = (FRAME / Math.min(img.w, img.h)) * z;
    const mx = (img.w * sc - FRAME) / 2; const my = (img.h * sc - FRAME) / 2;
    return { x: Math.max(-mx, Math.min(mx, o.x)), y: Math.max(-my, Math.min(my, o.y)) };
  };
  const useIt = () => {
    const OUT = 320; const r = OUT / FRAME;
    const c = document.createElement('canvas'); c.width = OUT; c.height = OUT;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e9e2d8'; ctx.fillRect(0, 0, OUT, OUT);
    const dw = img.w * scale; const dh = img.h * scale;
    ctx.drawImage(img.el, (FRAME / 2 - dw / 2 + off.x) * r, (FRAME / 2 - dh / 2 + off.y) * r, dw * r, dh * r);
    let data;
    try { data = c.toDataURL('image/jpeg', 0.86); } catch (e) { data = img.src; }
    save({ photo: data, photoAt: Date.now(), photoVia: img.via });
    buzz(HAPTIC.success); toast('Photo updated.'); onClose();
  };

  if (stage === 'crop' && img) {
    const dw = img.w * scale; const dh = img.h * scale;
    return (
      <Sheet label="Position your photo" onClose={onClose}>
        <h2 className="h2">Move and zoom</h2>
        <div className="acc-crop" style={{ width: FRAME, height: FRAME }}
          onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } drag.current = { x: e.clientX, y: e.clientY, o: off }; }}
          onPointerMove={(e) => { if (!drag.current) return; const d = drag.current; setOff(clamp({ x: d.o.x + e.clientX - d.x, y: d.o.y + e.clientY - d.y })); }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
          <img src={img.src} alt="Your new photo" draggable={false} style={{ width: dw, height: dh, left: FRAME / 2 - dw / 2 + off.x, top: FRAME / 2 - dh / 2 + off.y }} />
          <span className="acc-crop-ring" aria-hidden="true" />
        </div>
        <div className="row" style={{ gap: 12 }}>
          <span className="tiny" aria-hidden="true">−</span>
          <input type="range" className="acc-range grow" min="1" max="3" step="0.01" value={zoom} aria-label="Zoom"
            onChange={(e) => { const z = Number(e.target.value); setZoom(z); setOff((o) => clamp(o, z)); }} />
          <span className="tiny" aria-hidden="true">+</span>
        </div>
        <span className="small" style={{ textAlign: 'center' }}>Drag to move. Faisal and your circles see this.</span>
        <button type="button" className="btn primary block" onClick={useIt}>Use this photo</button>
        <button type="button" className="btn ghost block" onClick={() => { setStage('menu'); setImg(null); }}>Choose another</button>
      </Sheet>
    );
  }
  return (
    <Sheet label="Profile photo" onClose={onClose}>
      <div className="row" style={{ gap: 14 }}>
        <UserAvatar size={64} />
        <div className="col" style={{ gap: 2 }}>
          <h2 className="h2">Your photo</h2>
          <span className="small">{a.photo ? `Added ${fmtDate(a.photoAt || Date.now())}. Faisal and your circles see it.` : 'Faisal and your circles see it. It’s never on a booking.'}</span>
        </div>
      </div>
      <label className="btn primary block acc-file">
        <Icon name="scan" color="#d9b77a" />Take a photo
        <input type="file" accept="image/*" capture="user" style={hidden} data-test="photo-camera" onChange={(e) => { pick(e.target.files && e.target.files[0], 'camera'); e.target.value = ''; }} />
      </label>
      <label className="btn secondary block acc-file">
        Choose a photo
        <input type="file" accept="image/*" style={hidden} data-test="photo-library" onChange={(e) => { pick(e.target.files && e.target.files[0], 'library'); e.target.value = ''; }} />
      </label>
      {err && <span className="err acc-err" role="alert">{err}</span>}
      {a.photo && <button type="button" className="btn ghost block" style={{ color: '#8a3524' }} onClick={() => { save({ photo: null, photoAt: null }); buzz(HAPTIC.tap); toast('Photo removed.'); onClose(); }}>Remove photo</button>}
      <span className="tiny" style={{ textAlign: 'center' }}>JPEG or PNG, up to 10 MB.</span>
    </Sheet>
  );
}

/* ---------- Your details ---------- */

const AIRPORTS = [
  ['RUH', 'Riyadh', 'King Khalid'], ['JED', 'Jeddah', 'King Abdulaziz'], ['DMM', 'Dammam', 'King Fahd'],
  ['MED', 'Madinah', 'Prince Mohammad bin Abdulaziz'], ['AHB', 'Abha', 'Abha'], ['TIF', 'Taif', 'Taif'],
  ['TUU', 'Tabuk', 'Prince Sultan'], ['ELQ', 'Buraidah', 'Prince Naif'], ['GIZ', 'Jazan', 'King Abdullah'],
  ['HOF', 'Al-Ahsa', 'Al-Ahsa'], ['YNB', 'Yanbu', 'Prince Abdulmohsin'], ['ULH', 'AlUla', 'AlUla'],
  ['HAS', 'Hail', 'Hail'], ['AJF', 'Al-Jouf', 'Al-Jouf'], ['RSI', 'Red Sea', 'Red Sea International'],
];
const CURRENCIES = [['SAR', 'Saudi riyal'], ['AED', 'UAE dirham'], ['USD', 'US dollar'], ['EUR', 'Euro'], ['GBP', 'Pound sterling']];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TAKEN_PHONE = '555555555';

function phoneCheck(raw, current) {
  const d = raw.replace(/\D/g, '').replace(/^966/, '').replace(/^0/, '');
  let err = null;
  if (d.length && !d.startsWith('5')) err = 'Saudi mobile numbers start with 5 after +966.';
  else if (d.length && d.length < 9) err = `That number looks short. It needs 9 digits after +966 (you have ${d.length}).`;
  else if (d.length > 9) err = 'That number looks long. It needs 9 digits after +966.';
  else if (d === current) err = 'That’s the number you already use.';
  else if (d === TAKEN_PHONE) err = 'That number is on another Mada account. Sign in with it there, or ask Mada to move it to this one.';
  return { d, err, ok: d.length === 9 && !err };
}

function Account() {
  const { s, pop, go, toast } = useStore();
  const [a, save] = useAccount();
  const [sheet, setSheet] = useState(null);
  const home = AIRPORTS.find((x) => x[0] === a.home) || AIRPORTS[0];
  const scanned = !!s.passportSaved;
  const dob = dobOf('omar');
  return (
    <div className="screen push">
      <TopBar onBack={pop} title="Your details" />
      <div className="scroll no-dock">
        <button type="button" className="acc-hero" onClick={() => setSheet('photo')} aria-label="Change photo">
          <span className={'acc-avatar-wrap' + (a.photo ? '' : ' empty')}><UserAvatar size={84} /><span className="acc-cam"><Icon name="plus" size={16} color="#1e352d" width={2.4} /></span></span>
          <span className="small" style={{ fontWeight: 600, color: '#1e352d' }}>{a.photo ? 'Change photo' : 'Add a photo'}</span>
        </button>

        <p className="small acc-intro">Each detail shows where it came from. Mada uses these on every booking.</p>

        <Group label="Name">
          <Row label="Name on your passport" value={passportName(s) || 'Not scanned yet'} locked onClick={() => setSheet('name')} src={<Source kind={scanned && passportName(s) ? 'passport' : 'none'} />} />
          <Row label="What Mada calls you" value={displayName(s) || 'Add a name'} onClick={() => setSheet('preferred')} src={a.preferred ? <Source kind="typed" at={a.preferredAt} /> : scanned && displayName(s) ? <Source kind="passport" /> : <span className="acc-src warn">We’ll use your first name once your passport is in</span>} />
        </Group>

        <Group label="Contact">
          <Row label="Email" value={<span className="acc-break">{a.email ? a.email.address : 'Not added'}</span>} onClick={() => setSheet('email')}
            src={a.email ? (a.email.relay ? <Source kind="apple" /> : <Source kind="verified" at={a.email.at} />) : <span className="acc-src warn">Add one to get tickets and receipts</span>} />
          <Row label="Mobile" value={<span className="num">{prettyPhone(a.phone.digits)}</span>} onClick={() => setSheet('phone')} src={a.phone.digits ? <Source kind={a.phone.source === 'signup' ? 'signup' : a.phone.at ? 'verified' : 'signup'} at={a.phone.source === 'signup' ? null : a.phone.at} /> : <span className="acc-src warn">Add one for gate changes and Faisal’s messages</span>} />
        </Group>

        <Group label="From your passport">
          <Row label="Date of birth" value={scanned && dob ? fmtDate(dob, true) : 'Not scanned yet'} locked onClick={() => setSheet('passportField')} src={<Source kind={scanned ? 'passport' : 'none'} />} />
          <Row label="Nationality" value={scanned ? (s.user?.passport?.nationality || 'Saudi Arabia') : 'Not scanned yet'} locked onClick={() => setSheet('passportField')} src={<Source kind={scanned ? 'passport' : 'none'} />} />
        </Group>

        <Group label="For bookings">
          <Row label="Home airport" value={`${home[1]} · ${home[0]}`} onClick={() => setSheet('home')} src={<Source kind={a.homeAt ? 'typed' : 'default'} at={a.homeAt} />} />
          <Row label="Language" value={<LangName />} onClick={() => setSheet('language')} src={<Source kind="default" />} />
          <Row label="Prices shown in" value={a.currency === 'SAR' ? 'SAR · Saudi riyal' : `${a.currency} · ${(CURRENCIES.find((c) => c[0] === a.currency) || [])[1]}`} onClick={() => setSheet('currency')} src={<Source kind={a.currency === 'SAR' ? 'default' : 'typed'} />} />
        </Group>
      </div>

      {sheet === 'photo' && <PhotoSheet onClose={() => setSheet(null)} />}
      {(sheet === 'name' || sheet === 'passportField') && (
        <Sheet label="From your passport" onClose={() => setSheet(null)}>
          <span className="acc-ic big"><Icon name="lock" color="#7d5d27" /></span>
          <h2 className="h2">{sheet === 'name' ? 'Comes from your passport.' : 'Read from your passport.'}</h2>
          <p className="body">{sheet === 'name' ? 'Airlines need it letter for letter. To change it, scan a new passport.' : 'It always matches your passport. To change it, scan a new passport.'}{scanned ? '' : ' You haven’t scanned yours yet.'}</p>
          <button type="button" className="btn primary block" onClick={() => { setSheet(null); go('wallet'); toast(scanned ? 'Tap + to scan your new passport.' : 'Tap Scan it now to add your passport.'); }}><Icon name="scan" color="#d9b77a" />{scanned ? 'Scan a new passport' : 'Scan my passport'}</button>
          <button type="button" className="btn ghost block" onClick={() => setSheet(null)}>Not now</button>
        </Sheet>
      )}
      {sheet === 'preferred' && <PreferredSheet onClose={() => setSheet(null)} />}
      {sheet === 'email' && <EmailSheet onClose={() => setSheet(null)} />}
      {sheet === 'phone' && <PhoneSheet onClose={() => setSheet(null)} />}
      {sheet === 'home' && <HomeSheet onClose={() => setSheet(null)} />}
      {sheet === 'language' && <LanguageSheet onClose={() => setSheet(null)} />}
      {sheet === 'currency' && (
        <Sheet label="Currency" onClose={() => setSheet(null)}>
          <h2 className="h2">Show prices in</h2>
          <div className="acc-group well">
            {CURRENCIES.map(([c, n]) => <Row key={c} value={`${c} · ${n}`} onClick={() => { save({ currency: c }); setSheet(null); toast(c === 'SAR' ? 'Prices in SAR.' : `Prices shown in ${c} too. You’re still charged in SAR.`); }} right={a.currency === c ? <Icon name="check" color="#2f7a4b" width={2.4} /> : <span />} />)}
          </div>
          <span className="small">You’re always charged in SAR. Other currencies are a guide, at today’s rate.</span>
        </Sheet>
      )}
    </div>
  );
}

function PreferredSheet({ onClose }) {
  const { s, toast } = useStore();
  const [a, save] = useAccount();
  const [v, setV] = useState(displayName(s));
  const t = v.trim();
  const err = !t ? 'Add the name you’d like us to use.' : t.length > 30 ? 'Keep it under 30 letters.' : /[0-9@#$%^*_=+<>{}[\]\\|]/.test(t) ? 'Use letters only.' : null;
  return (
    <Sheet label="What Mada calls you" onClose={onClose}>
      <h2 className="h2">What should we call you?</h2>
      <p className="small">Used in messages from Mada and Faisal. Tickets always use your passport name.</p>
      <form className="col" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); if (err) return; save({ preferred: t, preferredAt: Date.now() }); buzz(HAPTIC.success); toast(`We’ll call you ${t}.`); onClose(); }}>
        <div className="field">
          <label htmlFor="acc-pref">Name</label>
          <input id="acc-pref" className={'input' + (err && v ? ' bad' : '')} value={v} onChange={(e) => setV(e.target.value)} autoCapitalize="words" maxLength={40} />
          {err && <span className="err" role="alert">{err}</span>}
        </div>
        <button type="submit" className="btn primary block" disabled={!!err}>Save name</button>
        {a.preferred && <button type="button" className="btn ghost block" onClick={() => { save({ preferred: null, preferredAt: null }); toast('We’ll use the name on your passport.'); onClose(); }}>Use my passport name</button>}
      </form>
    </Sheet>
  );
}

function EmailSheet({ onClose }) {
  const { s, toast } = useStore();
  const [a, save] = useAccount();
  const [step, setStep] = useState('view');
  const [v, setV] = useState('');
  const [touched, setTouched] = useState(false);
  const t = v.trim().toLowerCase();
  const err = !t ? null : !EMAIL_RE.test(t) ? 'That doesn’t look like an email address. Check for an @ and a dot.' : a.email && t === a.email.address ? 'That’s already your email.' : null;
  if (step === 'code') {
    return (
      <Sheet label="Verify email" onClose={onClose}>
        <CodeStep to={t} onBack={() => setStep('enter')} onDone={() => { save({ email: { address: t, relay: false, source: 'typed', at: Date.now() } }); toast('Email verified. Tickets and receipts go there now.'); onClose(); }} />
      </Sheet>
    );
  }
  if (step === 'enter' || !a.email) {
    return (
      <Sheet label="Email" onClose={onClose}>
        <h2 className="h2">{a.email ? 'New email' : 'Add your email'}</h2>
        <p className="small">Tickets, receipts and visa letters go here. We send a code to check it’s yours.</p>
        <form className="col" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); setTouched(true); if (err || !t || s.demo.offline) return; buzz(HAPTIC.tap); setStep('code'); }}>
          <div className="field">
            <label htmlFor="acc-email">Email</label>
            <input id="acc-email" className={'input' + (touched && err ? ' bad' : '')} type="email" inputMode="email" autoComplete="email" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => setTouched(true)} />
            {touched && err && <span className="err" role="alert">{err}</span>}
            {s.demo.offline && <span className="err" role="alert">You’re offline. We’ll be able to send the code once you’re connected.</span>}
          </div>
          <button type="submit" className="btn primary block" disabled={!t || (touched && !!err) || s.demo.offline}>Send me a code</button>
        </form>
      </Sheet>
    );
  }
  return (
    <Sheet label="Email" onClose={onClose}>
      <h2 className="h2">Your email</h2>
      <div className="card well" style={{ gap: 6 }}>
        <span className="h3 acc-break" style={{ fontSize: 15 }}>{a.email.address}</span>
        {a.email.relay ? <Source kind="apple" /> : <Source kind="verified" at={a.email.at} />}
      </div>
      {a.email.relay && (
        <div className="notice" style={{ background: '#f6f2ec' }}>
          <Icon name="lock" size={18} style={{ flexShrink: 0, marginTop: 2 }} />
          <div className="grow"><span className="h3" style={{ fontSize: 15 }}>A private address from Apple</span><span className="small">You chose Hide My Email when you signed in. Mail we send here is forwarded to your Apple ID inbox. You can keep it, or use your own address.</span></div>
        </div>
      )}
      <button type="button" className="btn primary block" onClick={() => setStep('enter')}>{a.email.relay ? 'Use my own email' : 'Change email'}</button>
      <button type="button" className="btn ghost block" onClick={onClose}>Keep this one</button>
    </Sheet>
  );
}

function PhoneSheet({ onClose }) {
  const { s, toast } = useStore();
  const [a, save] = useAccount();
  const [step, setStep] = useState('enter');
  const [v, setV] = useState('');
  const [touched, setTouched] = useState(false);
  const chk = phoneCheck(v, a.phone.digits);
  const showErr = chk.err && (touched || chk.d === a.phone.digits || chk.d === TAKEN_PHONE || chk.d.length > 9);
  if (step === 'code') {
    return (
      <Sheet label="Verify new number" onClose={onClose}>
        <CodeStep to={prettyPhone(chk.d)} onBack={() => setStep('enter')} onDone={() => setStep('confirm')} />
      </Sheet>
    );
  }
  if (step === 'confirm') {
    return (
      <Sheet label="Confirm new number" onClose={onClose}>
        <h2 className="h2">{a.phone.digits ? 'Switch to' : 'Use'} {prettyPhone(chk.d)}?</h2>
        {a.phone.digits && <div className="acc-swap">
          <span className="col" style={{ gap: 2 }}><span className="tiny">Stops working</span><span className="h3 num" style={{ fontSize: 15, textDecoration: 'line-through', color: '#5f6b65' }}>{prettyPhone(a.phone.digits)}</span></span>
          <Icon name="arrow" size={18} />
          <span className="col" style={{ gap: 2 }}><span className="tiny">From now on</span><span className="h3 num" style={{ fontSize: 15 }}>{prettyPhone(chk.d)}</span></span>
        </div>}
        <p className="body">Your old number stops working for sign-in straight away. Trip texts and calls from Faisal go to the new one. Airlines on booked trips get it too.</p>
        <button type="button" className="btn primary block" onClick={() => { save((f) => ({ phone: { digits: chk.d, source: 'typed', at: Date.now() }, ...(f.phone?.digits ? {} : { methods: { ...f.methods, phone: true } }) })); buzz(HAPTIC.success); toast(a.phone.digits ? 'Number changed. Use it next time you sign in.' : 'Added. You can sign in with it too.'); onClose(); }}>Use the new number</button>
        <button type="button" className="btn ghost block" onClick={onClose}>Keep my old number</button>
      </Sheet>
    );
  }
  return (
    <Sheet label="Change mobile number" onClose={onClose}>
      <h2 className="h2">{a.phone.digits ? 'Change your number' : 'Add your number'}</h2>
      <p className="small">{a.phone.digits ? `Now ${prettyPhone(a.phone.digits)}. ` : ''}We’ll text a code to the new number to check it’s yours.</p>
      <form className="col" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!chk.ok || s.demo.offline) return; buzz(HAPTIC.tap); setStep('code'); }}>
        <div className="field">
          <label htmlFor="acc-phone">New mobile number</label>
          <div className="row">
            <span className="input" style={{ width: 84, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>+966</span>
            <input id="acc-phone" className={'input' + (showErr ? ' bad' : '')} inputMode="tel" autoComplete="tel-national" placeholder="5X XXX XXXX" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => setTouched(true)} />
          </div>
          {showErr && <span className="err" role="alert">{chk.err}</span>}
          {s.demo.offline && <span className="err" role="alert">You’re offline. We’ll be able to send the code once you’re connected.</span>}
        </div>
        <button type="submit" className="btn primary block" disabled={!chk.ok || s.demo.offline}>Text me a code</button>
      </form>
    </Sheet>
  );
}

function HomeSheet({ onClose }) {
  const { toast } = useStore();
  const [a, save] = useAccount();
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  const list = t ? AIRPORTS.filter((x) => x.join(' ').toLowerCase().includes(t)) : AIRPORTS.slice(3);
  const choose = (code) => { save({ home: code, homeAt: Date.now() }); buzz(HAPTIC.select); toast(`Flights start from ${code} unless you say otherwise.`); onClose(); };
  return (
    <Sheet label="Home airport" onClose={onClose}>
      <h2 className="h2">Where do you usually fly from?</h2>
      <div className="chips" role="radiogroup" aria-label="Main airports">
        {AIRPORTS.slice(0, 3).map(([c, city]) => <button key={c} type="button" role="radio" aria-checked={a.home === c ? 'true' : 'false'} className={'chip' + (a.home === c ? ' on' : '')} onClick={() => choose(c)}>{city} · {c}</button>)}
      </div>
      <div className="field">
        <label htmlFor="acc-air">Another airport</label>
        <input id="acc-air" className="input" placeholder="City or 3-letter code" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="acc-group well" style={{ maxHeight: 240, overflowY: 'auto' }}>
        {list.length ? list.map(([c, city, name]) => <Row key={c} value={`${city} · ${c}`} sub={name} onClick={() => choose(c)} right={a.home === c ? <Icon name="check" color="#2f7a4b" width={2.4} /> : <span />} />)
          : <div className="acc-row"><span className="small">No Saudi airport matches “{q}”. Try the city or the 3-letter code. For airports abroad, ask Mada.</span></div>}
      </div>
    </Sheet>
  );
}

/** The language in use, in its own script. */
export function LangName() { return useLang() === 'ar' ? <span lang="ar">العربية</span> : 'English'; }

export function LanguageSheet({ onClose }) {
  const lang = useLang();
  const pick = (l) => { buzz(HAPTIC.select); setLang(l); };
  return (
    <Sheet label="Language" onClose={onClose}>
      <h2 className="h2">Language</h2>
      <div className="acc-group well" data-no-translate="">
        <Row value="English" onClick={() => pick('en')} right={lang === 'en' ? <Icon name="check" color="#2f7a4b" width={2.4} /> : <span />} />
        <Row value={<span lang="ar" dir="rtl">العربية</span>} onClick={() => pick('ar')} right={lang === 'ar' ? <Icon name="check" color="#2f7a4b" width={2.4} /> : <span />} />
      </div>
      <p className="tiny">In the app, switching restarts Mada so the whole layout can turn. Here it turns at once.</p>
      <button type="button" className="btn primary block" onClick={onClose}>Done</button>
    </Sheet>
  );
}

/* ---------- Sign-in methods ---------- */

const METHODS = [
  { id: 'apple', name: 'Apple', sub: 'Face ID or your Apple password' },
  { id: 'google', name: 'Google', sub: 'Your Google account' },
  { id: 'phone', name: 'Phone number', sub: 'A code by text' },
];
function SignIn() {
  const { s, pop, toast } = useStore();
  const [a, save] = useAccount();
  const [sheet, setSheet] = useState(null);
  const count = METHODS.filter((m) => a.methods[m.id]).length;
  const m = sheet && METHODS.find((x) => x.id === sheet.id);
  /* Password: what they chose, a code to the email to check it's them, then the new one against the rules. */
  const [pw, setPw] = useState(null);
  const savePw = () => { save({ password: { set: true, value: pw.value, at: Date.now() } }); buzz(HAPTIC.success); toast('Password saved. You can sign in with it or with a code.'); setPw(null); };
  const removePw = () => { save({ password: null }); buzz(HAPTIC.tap); toast('Password removed. Codes work as before.'); setPw(null); };
  const link = (id) => { save((f) => ({ methods: { ...f.methods, [id]: true } })); buzz(HAPTIC.success); toast(`${METHODS.find((x) => x.id === id).name} added. You can sign in with it now.`); setSheet(null); };
  return (
    <div className="screen push">
      <TopBar onBack={pop} title="Sign-in methods" />
      <div className="scroll no-dock">
        <p className="body">Ways into your account. Keep at least two, so losing one never locks you out.</p>
        <Group>
          {METHODS.map((x) => (
            <Row key={x.id} lead={<span className={'acc-ic' + (a.methods[x.id] ? ' on' : '')}><Icon name={x.id === 'phone' ? 'bell' : 'lock'} size={18} color={a.methods[x.id] ? '#f6f2ec' : '#1e352d'} /></span>}
              value={x.name} sub={a.methods[x.id] ? (x.id === 'phone' ? prettyPhone(a.phone.digits) : x.id === 'apple' && a.email?.relay ? 'Hide My Email is on' : x.sub) : 'Not linked'}
              right={<span className={'pill' + (a.methods[x.id] ? ' ok' : '')}>{a.methods[x.id] ? 'Linked' : 'Add'}</span>}
              onClick={() => setSheet({ id: x.id, mode: a.methods[x.id] ? 'manage' : 'link' })} />
          ))}
        </Group>
        <Group>
          <Row lead={<span className={'acc-ic' + (a.password?.set ? ' on' : '')}><Icon name="lock" size={18} color={a.password?.set ? '#f6f2ec' : '#1e352d'} /></span>}
            value="Password" sub="Optional, with your email" right={<span className={'pill' + (a.password?.set ? ' ok' : '')}>{a.password?.set ? 'Set' : 'Add'}</span>}
            onClick={() => { setPw({ step: 'menu', action: 'set', value: '' }); }} />
        </Group>
        {count === 1 && <div className="notice warn"><Icon name="lock" color="#7d5d27" style={{ flexShrink: 0 }} /><div className="grow"><span className="h3" style={{ fontSize: 15 }}>Only one way in.</span><span className="small">Add another method so you can still sign in if you lose this one.</span></div></div>}
        {a.methods.apple && (
          <div className="card well" style={{ gap: 6 }}>
            <span className="h3" style={{ fontSize: 15 }}>About Hide My Email</span>
            <span className="small">When you sign in with Apple you can hide your real address. Apple gives us a private one that forwards to you. You can turn it off any time in your iPhone’s Settings, under Apple ID, Sign in with Apple.</span>
          </div>
        )}
      </div>
      {sheet && sheet.mode === 'link' && sheet.id !== 'phone' && (
        <Sheet label={`Add ${m.name}`} onClose={() => setSheet(null)}>
          <h2 className="h2">Add {m.name} as a way in?</h2>
          <p className="body">{m.id === 'apple' ? 'Apple shares your name and an email. You can hide your real address.' : 'Google shares your name and email address. Nothing else.'}</p>
          <button type="button" className="btn primary block" disabled={s.demo.offline} onClick={() => link(m.id)}>Continue with {m.name}</button>
          {s.demo.offline && <span className="err" role="alert">You’re offline. Connect to add a sign-in method.</span>}
          <button type="button" className="btn ghost block" onClick={() => setSheet(null)}>Cancel</button>
        </Sheet>
      )}
      {sheet && sheet.mode === 'link' && sheet.id === 'phone' && (
        <Sheet label="Add phone sign-in" onClose={() => setSheet(null)}>
          <CodeStep to={prettyPhone(a.phone.digits)} onDone={() => link('phone')} />
        </Sheet>
      )}
      {pw && (
        <Sheet label="Password" onClose={() => setPw(null)}>
          {!a.email?.address ? (<>
            <h2 className="h2">Password</h2>
            <p className="body">Add your email first. A password goes with it.</p>
          </>) : pw.step === 'menu' ? (<>
            <h2 className="h2">Password</h2>
            <p className="body">Codes always work. A password is an extra way in with your email.</p>
            {a.password?.set ? (<>
              <button type="button" className="btn primary block" onClick={() => setPw({ ...pw, action: 'set', step: 'code' })}>Change password</button>
              <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={() => setPw({ ...pw, action: 'remove', step: 'code' })}>Remove password</button>
            </>) : <button type="button" className="btn primary block" onClick={() => setPw({ ...pw, action: 'set', step: 'code' })}>Set a password</button>}
          </>) : pw.step === 'code' ? (<>
            <p className="small" style={{ margin: 0 }}>First, a code to check it’s you.</p>
            <CodeStep to={a.email.address} onDone={() => setPw({ ...pw, step: pw.action === 'remove' ? 'confirm' : 'new' })} />
          </>) : pw.step === 'confirm' ? (<>
            <h2 className="h2">Remove password</h2>
            <p className="body">You’ll sign in with a code, Apple or Google, as before.</p>
            <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={removePw}>Remove password</button>
          </>) : (<>
            <h2 className="h2">{a.password?.set ? 'Change password' : 'Set a password'}</h2>
            <input type="email" autoComplete="username" value={a.email.address} readOnly hidden />
            <PasswordInput id="acc-new-password" label="New password" fresh value={pw.value} onChange={(v) => setPw({ ...pw, value: v })} />
            <PasswordRules value={pw.value} />
            <button type="button" className="btn primary block" disabled={!passwordMeetsRules(pw.value)} onClick={savePw}>Save password</button>
          </>)}
          <button type="button" className="btn ghost block" onClick={() => setPw(null)}>Cancel</button>
        </Sheet>
      )}
      {sheet && sheet.mode === 'manage' && (
        <Sheet label={m.name} onClose={() => setSheet(null)}>
          <h2 className="h2">{m.name}</h2>
          <p className="body">{m.id === 'phone' ? `You sign in with a code sent to ${prettyPhone(a.phone.digits)}. To use a different number, change it in Your details.` : `You can sign in with ${m.name}.`}</p>
          {count <= 1 ? (
            <div className="notice warn" role="alert"><Icon name="lock" color="#7d5d27" style={{ flexShrink: 0 }} /><div className="grow"><span className="h3" style={{ fontSize: 15 }}>This is your only way in.</span><span className="small">Add another method before you remove this one.</span></div></div>
          ) : (
            <>
              {m.id === 'apple' && a.email?.relay && <span className="small" style={{ color: '#7d5d27' }}>Your email is Apple’s private address. Mail to it still reaches you, but we’d suggest adding your own email in Your details.</span>}
              <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={() => { save((f) => ({ methods: { ...f.methods, [m.id]: false } })); buzz(HAPTIC.tap); toast(`${m.name} removed. You can’t sign in with it now.`); setSheet(null); }}>Remove {m.name}</button>
            </>
          )}
          <button type="button" className="btn primary block" onClick={() => setSheet(null)}>Keep it</button>
        </Sheet>
      )}
    </div>
  );
}

/* ---------- Travel preferences ---------- */

export const MEALS = [['halal', 'Halal'], ['veg', 'Vegetarian'], ['vegan', 'Vegan'], ['child', 'Child meal'], ['diabetic', 'Diabetic'], ['gluten', 'Gluten-free'], ['lowsalt', 'Low salt']];
const ASSIST = [
  ['wchr', 'Wheelchair to the gate', 'You can walk short distances and climb steps.'],
  ['wchc', 'Wheelchair to the seat', 'Help all the way to your seat on board.'],
  ['infant', 'Travelling with an infant', 'Under 2, on a lap. Airlines need to know when we book.'],
  ['bassinet', 'Bassinet', 'A cot fixed to the wall in front. Limited, so we ask early.'],
];
export const PROGRAMS = [
  { id: 'alfursan', name: 'Saudia Alfursan', kind: 'Airline', re: /^\d{8,10}$/, hint: '8 to 10 digits, on your Alfursan card' },
  { id: 'nasmiles', name: 'flynas nasmiles', kind: 'Airline', re: /^\d{10}$/, hint: '10 digits' },
  { id: 'mands', name: 'Turkish Miles&Smiles', kind: 'Airline', re: /^(TK)?\d{9}$/, hint: '9 digits, sometimes with TK in front' },
  { id: 'skywards', name: 'Emirates Skywards', kind: 'Airline', re: /^(EK)?\d{9}$/, hint: '9 digits, sometimes with EK in front' },
  { id: 'bonvoy', name: 'Marriott Bonvoy', kind: 'Hotel', re: /^\d{9}$/, hint: '9 digits' },
  { id: 'hilton', name: 'Hilton Honors', kind: 'Hotel', re: /^\d{9,10}$/, hint: '9 or 10 digits' },
  { id: 'ihg', name: 'IHG One Rewards', kind: 'Hotel', re: /^\d{9}$/, hint: '9 digits' },
  { id: 'accor', name: 'Accor ALL', kind: 'Hotel', re: /^3081\d{12}$/, hint: '16 digits, starting 3081' },
];
const normNum = (v) => v.toUpperCase().replace(/[\s-]/g, '');

function Prefs() {
  const { s, pop, toast } = useStore();
  const [a, save] = useAccount();
  const [sheet, setSheet] = useState(null);
  const [notes, setNotes] = useState(a.prefs.notes);
  const p = a.prefs;
  const setP = (patch) => save((f) => ({ prefs: { ...f.prefs, ...patch } }));
  const toggleAssist = (id, on) => {
    let next = on ? [...p.assist, id] : p.assist.filter((x) => x !== id);
    if (id === 'wchr' && on) next = next.filter((x) => x !== 'wchc');
    if (id === 'wchc' && on) next = next.filter((x) => x !== 'wchr');
    if (id === 'infant' && !on) next = next.filter((x) => x !== 'bassinet');
    setP({ assist: next });
  };
  const hasInfant = p.assist.includes('infant');
  return (
    <div className="screen push">
      <TopBar onBack={pop} title="Travel preferences" />
      <div className="scroll no-dock">
        <p className="body">Faisal uses these on every booking for you. Change them any time. Trips already booked keep what was asked for.</p>

        <Group label="Seats">
          <div className="acc-row col" style={{ alignItems: 'stretch', gap: 12 }}>
            <div className="chips" role="radiogroup" aria-label="Seat">
              {[['window', 'Window'], ['aisle', 'Aisle'], ['any', 'No preference']].map(([id, l]) => <button key={id} type="button" role="radio" aria-checked={p.seat === id ? 'true' : 'false'} className={'chip' + (p.seat === id ? ' on' : '')} onClick={() => { buzz(HAPTIC.select); setP({ seat: id }); }}>{l}</button>)}
            </div>
          </div>
          <Row value="Seat us together with family" sub="We pay for seat selection when an airline charges for it, and tell you first." right={<Toggle label="Seat us together with family" checked={p.together} onChange={(v) => setP({ together: v })} />} />
        </Group>

        <Group label="Meal">
          <div className="acc-row col" style={{ alignItems: 'stretch', gap: 10 }}>
            <div className="chips" role="radiogroup" aria-label="Meal">
              {MEALS.map(([id, l]) => <button key={id} type="button" role="radio" aria-checked={p.meal === id ? 'true' : 'false'} className={'chip' + (p.meal === id ? ' on' : '')} onClick={() => { buzz(HAPTIC.select); setP({ meal: id }); }}>{l}</button>)}
            </div>
            <span className="tiny">{p.meal === 'halal' ? 'Every meal on Saudi airlines is halal. On other airlines we ask for it.' : p.meal === 'child' ? 'Child meals are for ages 2 to 11. For adults we’ll ask for a light meal.' : 'Asked for at booking. Airlines need it 24 hours before the flight.'}</span>
          </div>
        </Group>

        <Group label="Help at the airport">
          {ASSIST.map(([id, l, sub]) => {
            const disabled = id === 'bassinet' && !hasInfant;
            return <Row key={id} value={l} sub={disabled ? 'Turn on “Travelling with an infant” first.' : sub} right={<span style={disabled ? { opacity: 0.4, pointerEvents: 'none' } : null}><Toggle label={l} checked={p.assist.includes(id)} onChange={(v) => toggleAssist(id, v)} /></span>} />;
          })}
        </Group>

        <Group label="Loyalty numbers">
          {p.loyalty.map((l) => {
            const prog = PROGRAMS.find((x) => x.id === l.program);
            return <Row key={l.id} lead={<span className="acc-ic"><Icon name={prog?.kind === 'Hotel' ? 'stay' : 'flight'} size={18} /></span>} value={prog?.name || l.program} sub={<span className="num">{l.number}</span>} onClick={() => setSheet({ edit: l })} ariaLabel={`Edit ${prog?.name}`} />;
          })}
          {!p.loyalty.length && <EmptyState compact plain art={<ArtSuitcase />} title="No loyalty numbers yet" body="Add Alfursan, or a hotel programme, and every booking we make earns you points." />}
          <Row lead={<span className="acc-ic"><Icon name="plus" size={18} /></span>} value="Add a loyalty number" onClick={() => setSheet({ edit: null })} />
        </Group>

        <Group label="Notes for Faisal">
          <div className="acc-row col" style={{ alignItems: 'stretch', gap: 8 }}>
            <label htmlFor="acc-notes" className="tiny">Anything that helps, like “Hessa prefers early flights” or “Ahmed gets travel sick.”</label>
            <textarea id="acc-notes" className="input acc-notes" maxLength={280} value={notes} onChange={(e) => setNotes(e.target.value)}
              onBlur={() => { if (notes !== p.notes) { setP({ notes: notes.trim() }); toast('Saved for Faisal.'); } }} />
            <span className="tiny num" style={{ alignSelf: 'flex-end' }}>{notes.length}/280</span>
          </div>
        </Group>
      </div>
      {sheet && <LoyaltySheet edit={sheet.edit} onClose={() => setSheet(null)} />}
    </div>
  );
}

function LoyaltySheet({ edit, onClose }) {
  const { toast } = useStore();
  const [a, save] = useAccount();
  const [prog, setProg] = useState(edit ? edit.program : null);
  const [num, setNum] = useState(edit ? edit.number : '');
  const [touched, setTouched] = useState(false);
  const P = PROGRAMS.find((x) => x.id === prog);
  const n = normNum(num);
  const dup = !edit && prog && a.prefs.loyalty.some((l) => l.program === prog);
  const err = !P ? null : dup ? `You already have a ${P.name} number. Edit that one instead.` : !n ? null : !P.re.test(n) ? `That doesn’t look like a ${P.name} number. It’s ${P.hint}.` : null;
  const setL = (list) => save((f) => ({ prefs: { ...f.prefs, loyalty: list } }));
  return (
    <Sheet label="Loyalty number" onClose={onClose}>
      <h2 className="h2">{edit ? P?.name : 'Add a loyalty number'}</h2>
      {!edit && (
        <div className="col" style={{ gap: 8 }}>
          {['Airline', 'Hotel'].map((k) => (
            <div key={k} className="col" style={{ gap: 6 }}>
              <span className="eyebrow">{k}s</span>
              <div className="chips">{PROGRAMS.filter((x) => x.kind === k).map((x) => <button key={x.id} type="button" className={'chip' + (prog === x.id ? ' on' : '')} aria-pressed={prog === x.id ? 'true' : 'false'} onClick={() => { setProg(x.id); buzz(HAPTIC.select); }}>{x.name}</button>)}</div>
            </div>
          ))}
        </div>
      )}
      {P && (
        <form className="col" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); setTouched(true); if (err || !n) return;
          if (edit) setL(a.prefs.loyalty.map((l) => (l.id === edit.id ? { ...l, number: n } : l)));
          else setL([...a.prefs.loyalty, { id: 'l' + Date.now(), program: prog, number: n }]);
          buzz(HAPTIC.success); toast(`${P.name} saved. We add it to every booking that earns.`); onClose(); }}>
          <div className="field">
            <label htmlFor="acc-loy">Membership number</label>
            <input id="acc-loy" className={'input num' + (touched && err ? ' bad' : '')} value={num} onChange={(e) => setNum(e.target.value)} onBlur={() => setTouched(true)} autoCapitalize="characters" placeholder={P.hint} disabled={dup} />
            {(touched || dup) && err && <span className="err" role="alert">{err}</span>}
          </div>
          <button type="submit" className="btn primary block" disabled={!n || !!err}>Save number</button>
          {edit && <button type="button" className="btn ghost block" style={{ color: '#8a3524' }} onClick={() => { setL(a.prefs.loyalty.filter((l) => l.id !== edit.id)); toast(`${P.name} removed. Points already earned stay with ${P.kind === 'Hotel' ? 'the hotel' : 'the airline'}.`); onClose(); }}>Remove</button>}
        </form>
      )}
    </Sheet>
  );
}

/* ---------- Household ---------- */

const RELATIONS = ['Spouse', 'Son', 'Daughter', 'Parent', 'Sibling', 'Relative', 'Friend', 'Helper', 'Colleague'];
export function relationOf(s, id) {
  if (id === 'omar') return 'You';
  const o = s.account?.people?.[id]?.relation;
  if (o) return o;
  const r = (PEOPLE[id]?.role || '').split(',')[0];
  return r || 'Family';
}
export const householdIds = (s) => {
  const ids = s.household.length ? s.household : ['omar'];
  return ids.includes('omar') ? ids.filter((id) => PEOPLE[id]) : ['omar', ...ids.filter((id) => PEOPLE[id])];
};
function PersonAvatar({ id, size = 44 }) {
  if (id === 'omar') return <UserAvatar size={size} />;
  const p = PEOPLE[id];
  return <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: p?.helper ? '#efe3c9' : '#f6f2ec' }} aria-hidden="true">{p?.initial || '?'}</span>;
}

function Household() {
  const { s, pop, push } = useStore();
  const [adding, setAdding] = useState(false);
  const ids = householdIds(s);
  return (
    <div className="screen push">
      <TopBar onBack={pop} title="Household" />
      <div className="scroll no-dock" style={{ paddingBottom: 140 }}>
        <p className="body">Everyone you book for. Their passports and preferences fill in every trip.</p>
        <Group>
          {ids.map((id) => {
            const st = passportStatus(s, id);
            const band = ageBand(id);
            return <Row key={id} lead={<PersonAvatar id={id} />} value={id === 'omar' ? (displayName(s) ? `${displayName(s)} (you)` : 'You') : PEOPLE[id].name}
              sub={[relationOf(s, id) !== 'You' ? relationOf(s, id) : null, st.key !== 'none' && band ? band.label : null].filter(Boolean).join(' · ') || 'Account holder'}
              onClick={() => push('householdPerson', { id })} right={<span className="row" style={{ gap: 6 }}><StatusPill st={st} /><Icon name="chevron" size={18} color="#8a9590" /></span>} />;
          })}
        </Group>
        {ids.length <= 1 && <EmptyState plain center className="es-under" art={<ArtFriends />} title="Just you so far." body="Add the people you book for. Their names and passports fill in every trip, so nobody types them twice." />}
        <span className="tiny" style={{ padding: '0 4px' }}>Passports are scanned in the Wallet and stay encrypted on this phone.</span>
      </div>
      <div className="act"><button type="button" className="btn primary block" onClick={() => setAdding(true)}><Icon name="plus" color="#f6f2ec" />Add someone</button></div>
      {adding && <AddPersonSheet onClose={() => setAdding(false)} onAdded={() => setAdding(false)} />}
    </div>
  );
}

function HouseholdPerson({ params }) {
  const { s, set, pop, go, toast, push } = useStore();
  const [a, save] = useAccount();
  const [sheet, setSheet] = useState(null);
  const id = params?.id;
  const p = PEOPLE[id];
  const mine = (a.people && a.people[id]) || {};
  const [iqama, setIqama] = useState(mine.iqama || '');
  const [iqTouched, setIqTouched] = useState(false);
  if (!p || (!s.household.includes(id) && id !== 'omar')) {
    return (
      <div className="screen push"><TopBar onBack={pop} /><div className="scroll no-dock"><h1 className="h1">No longer in your household.</h1><button type="button" className="btn secondary" onClick={pop}>Back</button></div></div>
    );
  }
  const me = id === 'omar';
  const st = passportStatus(s, id);
  const band = st.key !== 'none' ? ageBand(id) : null;
  const dob = st.key !== 'none' ? dobOf(id) : null;
  const savePerson = (patch) => save((f) => ({ people: { ...(f.people || {}), [id]: { ...((f.people || {})[id] || {}), ...patch } } }));
  const meal = mine.meal || (band && band.short === 'Child' ? 'child' : 'halal');
  const inTrip = s.trip?.travellers?.includes(id);
  const iqD = iqama.replace(/\D/g, '');
  const iqErr = !iqD ? null : iqD.length !== 10 ? `An iqama number has 10 digits (this has ${iqD.length}).` : !iqD.startsWith('2') ? 'Iqama numbers start with 2. Saudi ID numbers start with 1.' : null;
  const exit = mine.exit || { kind: 'none', until: '' };
  const exitLeft = exit.until ? Math.round((new Date(exit.until) - Date.now()) / DAY) : null;
  const exitLine = exit.kind === 'none' ? `Needed before ${p.name} travels abroad. You issue it on Absher as the sponsor.`
    : !exit.until ? 'Add the date it must be used by.'
    : exitLeft < 0 ? `Expired on ${fmtDate(exit.until, true)}. Issue a new one on Absher before any trip.`
    : `Valid until ${fmtDate(exit.until, true)} · ${exitLeft} days left.`;
  const scan = () => { go('wallet'); toast(me ? (s.passportSaved ? 'Tap + to scan your new passport.' : 'Tap Scan it now to add your passport.') : `Pick ${p.name} at the top, then tap + to scan.`); };
  return (
    <div className="screen push">
      <TopBar onBack={pop} backLabel="Household" />
      <div className="scroll no-dock">
        <div className="row" style={{ gap: 14 }}>
          <PersonAvatar id={id} size={64} />
          <div className="col" style={{ gap: 2 }}>
            <h1 className="h1" style={{ fontSize: 26 }}>{me ? displayName(s) || 'You' : p.name}</h1>
            <span className="small">{me ? 'You · account holder' : relationOf(s, id)}{band ? ' · ' + band.label : ''}</span>
          </div>
        </div>

        <div className={'card acc-pp ' + st.tone}>
          <div className="spread"><span className="eyebrow">Passport</span><StatusPill st={st} /></div>
          {st.key === 'none'
            ? <span className="h3">{me ? 'Your passport isn’t scanned yet.' : `${p.name}’s passport isn’t scanned yet.`}</span>
            : <span className="h3">{p.full}</span>}
          {st.key !== 'none' && <span className="small num">{p.number} · expires {p.expiresISO ? fmtDate(p.expiresISO, true) : p.expires}</span>}
          {st.text && <span className="small" style={{ color: st.tone === 'warn' ? '#8a3524' : '#7d5d27' }}>{st.text}</span>}
          {st.key !== 'ok' && <button type="button" className="btn primary block" onClick={scan}><Icon name="scan" color="#d9b77a" />{st.key === 'none' ? (me ? 'Scan my passport' : 'Scan their passport') : 'Scan the new passport'}</button>}
        </div>

        <Group label="Details">
          {!me && <Row label="Relation" value={relationOf(s, id)} onClick={() => setSheet('relation')} src={<Source kind={mine.relation ? 'typed' : 'added'} />} />}
          <Row label="Date of birth" value={dob ? fmtDate(dob, true) : 'Not scanned yet'} locked src={<Source kind={dob ? 'passport' : 'none'} />} />
          {band && band.note && <div className="acc-row"><span className="tiny">{band.note}</span></div>}
          {!me && (
            <div className="acc-row col" style={{ alignItems: 'stretch', gap: 8 }}>
              <span className="acc-k">Meal</span>
              <div className="chips">{MEALS.map(([mid, l]) => <button key={mid} type="button" className={'chip' + (meal === mid ? ' on' : '')} aria-pressed={meal === mid ? 'true' : 'false'} onClick={() => { savePerson({ meal: mid }); buzz(HAPTIC.select); }}>{l}</button>)}</div>
            </div>
          )}
          {me && <Row label="Your details and preferences" value="Name, contact, seats, meals" onClick={() => push('account')} />}
        </Group>

        {p.helper && (
          <Group label="Residency">
            <div className="acc-row col" style={{ alignItems: 'stretch', gap: 8 }}>
              <div className="field">
                <label htmlFor="acc-iqama">Iqama number</label>
                <input id="acc-iqama" className={'input num' + (iqTouched && iqErr ? ' bad' : '')} inputMode="numeric" maxLength={12} placeholder="2XXXXXXXXX" value={iqama}
                  onChange={(e) => setIqama(e.target.value)} onBlur={() => { setIqTouched(true); if (!iqErr && iqD !== (mine.iqama || '')) { savePerson({ iqama: iqD, iqamaAt: Date.now() }); if (iqD) toast('Iqama number saved.'); } }} />
                {iqTouched && iqErr && <span className="err" role="alert">{iqErr}</span>}
                {mine.iqama && !iqErr && <Source kind="typed" at={mine.iqamaAt} />}
              </div>
            </div>
            <div className="acc-row col" style={{ alignItems: 'stretch', gap: 10 }}>
              <span className="acc-k">Exit and re-entry visa</span>
              <div className="chips" role="radiogroup" aria-label="Exit and re-entry visa">
                {[['none', 'None yet'], ['single', 'Single'], ['multiple', 'Multiple']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={exit.kind === k ? 'true' : 'false'} className={'chip' + (exit.kind === k ? ' on' : '')} onClick={() => { savePerson({ exit: { ...exit, kind: k } }); buzz(HAPTIC.select); }}>{l}</button>)}
              </div>
              {exit.kind !== 'none' && (
                <div className="field"><label htmlFor="acc-exit">Use by</label><input id="acc-exit" type="date" className="input" value={exit.until} onChange={(e) => savePerson({ exit: { ...exit, until: e.target.value } })} /></div>
              )}
              <span className={'small' + (exit.kind === 'none' || exitLeft < 0 ? ' acc-warn' : '')}>{exitLine}</span>
            </div>
          </Group>
        )}

        {!me && <button type="button" className="btn ghost block" style={{ color: '#8a3524' }} onClick={() => setSheet('remove')}>Remove {p.name} from household</button>}
      </div>

      {sheet === 'relation' && (
        <Sheet label="Relation" onClose={() => setSheet(null)}>
          <h2 className="h2">{p.name} is your…</h2>
          <div className="chips">{RELATIONS.map((r) => <button key={r} type="button" className={'chip' + (relationOf(s, id) === r ? ' on' : '')} onClick={() => { savePerson({ relation: r }); buzz(HAPTIC.select); toast('Saved.'); setSheet(null); }}>{r}</button>)}</div>
          <span className="small">Some visas and consent letters ask how you’re related.</span>
        </Sheet>
      )}
      {sheet === 'remove' && (
        <Sheet label="Remove from household" onClose={() => setSheet(null)}>
          <h2 className="h2">Remove {p.name}?</h2>
          <p className="body">{p.name}’s passport and preferences are deleted from this phone. Bookings already made stay as they are{inTrip ? `, including ${s.trip.city}` : ''}. You can add {p.sex === 'M' ? 'him' : 'her'} again any time.</p>
          <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={() => {
            set((x) => ({ household: x.household.filter((h) => h !== id) }));
            save((f) => { const ppl = { ...(f.people || {}) }; delete ppl[id]; return { people: ppl }; });
            buzz(HAPTIC.tap); toast(`${p.name} removed from your household.`); pop();
          }}>Remove {p.name}</button>
          <button type="button" className="btn primary block" onClick={() => setSheet(null)}>Keep {p.name}</button>
        </Sheet>
      )}
    </div>
  );
}

/* ---------- Security & devices ---------- */

function Security() {
  const { s, pop, toast } = useStore();
  const [a, save] = useAccount();
  const [sheet, setSheet] = useState(null);
  const [checking, setChecking] = useState(false);
  const [faceErr, setFaceErr] = useState(null);
  const signOut = useSignOut();
  const others = a.devices.filter((d) => !d.current);
  const turnOn = () => {
    setChecking(true); setFaceErr(null);
    setTimeout(() => {
      setChecking(false);
      if (s.demo.faceIdFails) { setFaceErr('Face ID didn’t match. Try again, or set it up in your iPhone’s Settings.'); buzz(HAPTIC.soft); return; }
      save({ faceId: true }); buzz(HAPTIC.success); toast('Wallet locks with Face ID.');
    }, 900);
  };
  const d = sheet && sheet.device;
  return (
    <div className="screen push">
      <TopBar onBack={pop} title="Security" />
      <div className="scroll no-dock">
        <Group label="Wallet">
          <Row icon="lock" value="Face ID for the Wallet" sub={checking ? 'Checking Face ID…' : a.faceId ? 'Passports open only after Face ID or your passcode.' : 'Off. Anyone with your unlocked phone can open passports.'}
            right={checking ? <span className="spinner" /> : <Toggle label="Face ID for the Wallet" checked={a.faceId} onChange={(v) => (v ? turnOn() : setSheet('faceoff'))} />} />
          {faceErr && <div className="acc-row"><span className="err" role="alert">{faceErr}</span></div>}
        </Group>

        <Group label="Signed in on">
          {a.devices.map((x) => (
            <Row key={x.id} icon={x.id === 'web' ? 'globe' : 'user'} value={x.name} sub={x.sub}
              right={x.current ? <span className="pill ok">This phone</span> : <button type="button" className="btn secondary small acc-mini" onClick={() => setSheet({ device: x })}>Sign out</button>} />
          ))}
          {!others.length && <EmptyState compact plain className="acc-es" art={<ArtPhone />} title="Only this phone is signed in." body="If you sign in on an iPad or the web, it shows here, and you can sign it out from this phone." />}
        </Group>
        <span className="tiny" style={{ padding: '0 4px' }}>Don’t recognise a device? Sign it out, then tell Mada.</span>

        <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={() => setSheet('everywhere')}>Sign out everywhere</button>
      </div>

      {sheet === 'faceoff' && (
        <Sheet label="Turn off Face ID" onClose={() => setSheet(null)}>
          <h2 className="h2">Turn off Face ID for the Wallet?</h2>
          <p className="body">Passports and visas will open without a check. Anyone holding your unlocked phone could see them.</p>
          <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} onClick={() => { save({ faceId: false }); toast('Face ID off for the Wallet.'); setSheet(null); }}>Turn it off</button>
          <button type="button" className="btn primary block" onClick={() => setSheet(null)}>Keep Face ID</button>
        </Sheet>
      )}
      {d && (
        <Sheet label="Sign out a device" onClose={() => setSheet(null)}>
          <h2 className="h2">Sign out of {d.name}?</h2>
          <p className="body">It will need Apple, Google or a code to get back in. Anything saved only on that device is removed from it.</p>
          <button type="button" className="btn primary block" disabled={s.demo.offline} onClick={() => { save((f) => ({ devices: f.devices.filter((x) => x.id !== d.id) })); buzz(HAPTIC.tap); toast(`Signed out of ${d.name}.`); setSheet(null); }}>Sign out of {d.name}</button>
          {s.demo.offline && <span className="err" role="alert">You’re offline. Connect to sign out another device.</span>}
          <button type="button" className="btn ghost block" onClick={() => setSheet(null)}>Cancel</button>
        </Sheet>
      )}
      {sheet === 'everywhere' && <SignOutSheet everywhere onClose={() => setSheet(null)} />}
    </div>
  );
}

/* Sign out, two ways. Keep: trips stay on this phone, documents stay locked until sign-in, and Onboarding offers
   "Welcome back". Remove: nothing of this account is left on the phone. */
export function useSignOut() {
  const { set, hardReset } = useStore();
  return (mode = 'keep') => {
    buzz(HAPTIC.tap);
    if (mode === 'remove') { hardReset(); return; }
    set((p) => ({ onboarded: false, guest: false, walletUnlocked: false, stack: [], tab: 'today', account: { ...(p.account || {}), signedOut: true, signedOutAt: Date.now() } }));
  };
}

export function SignOutSheet({ onClose, everywhere }) {
  const { s } = useStore();
  const signOut = useSignOut();
  const [a, save] = useAccount();
  const others = s.household.filter((id) => id !== 'omar').length;
  const go = (mode) => { if (everywhere) save((f) => ({ devices: f.devices.filter((x) => x.current) })); onClose(); signOut(mode); };
  return (
    <Sheet label={everywhere ? 'Sign out everywhere' : 'Sign out'} onClose={onClose}>
      <h2 className="h2">{everywhere ? 'Sign out everywhere?' : 'Sign out?'}</h2>
      <p className="body" style={{ marginTop: -8 }}>{everywhere ? 'Every device, this phone included. ' : ''}Your trips stay in your account either way. What should stay on this phone?</p>
      <button type="button" className="card tap well acc-choice" onClick={() => go('keep')}>
        <span className="row" style={{ gap: 10 }}><span className="acc-ic"><Icon name="lock" size={18} /></span><span className="h3" style={{ fontSize: 15 }}>Keep my trips on this phone</span></span>
        <span className="small">Faster to sign back in. {others ? `Passports for you and ${others} ${others === 1 ? 'other' : 'others'} stay encrypted and locked` : 'Your passport stays encrypted and locked'} until you sign in.</span>
      </button>
      <button type="button" className="card tap well acc-choice" onClick={() => go('remove')}>
        <span className="row" style={{ gap: 10 }}><span className="acc-ic"><Icon name="close" size={18} color="#8a3524" /></span><span className="h3" style={{ fontSize: 15, color: '#8a3524' }}>Remove everything from this phone</span></span>
        <span className="small">For a shared or borrowed phone. Trips, passports, cards and photos are wiped from it. Sign in again to get them back.</span>
      </button>
      <button type="button" className="btn ghost block" onClick={onClose}>Cancel</button>
    </Sheet>
  );
}

/* "Welcome back, Omar": a fast way back in after signing out. Render from Onboarding's welcome step when s.account?.signedOut. */
export function WelcomeBack({ onSomeoneElse }) {
  const { s, set, hardReset } = useStore();
  const [a] = useAccount();
  const [sheet, setSheet] = useState(null);
  const via = a.methods.apple ? 'Apple' : a.methods.google ? 'Google' : null;
  const back = () => { set((p) => ({ onboarded: true, guest: false, stack: [], tab: 'today', account: { ...(p.account || {}), signedOut: false } })); buzz(HAPTIC.success); };
  return (
    <div className="screen" style={{ overflow: 'hidden' }}>
      <ReturnHero name={displayName(s)}
        people={s.household.slice(0, 5).map((id, i) => [(id === 'omar' ? (displayName(s) || 'Y') : (PEOPLE[id]?.name || '?')).charAt(0).toUpperCase(), ['green', 'gold', '', 'green', 'gold'][i]])}
        stamp={(s.pastTrips || [])[0] ? [String(s.pastTrips[0].city || '').toUpperCase().slice(0, 8), 'BEEN'] : ['MADA', 'HOME']}
        line={`${s.household.length > 1 ? 'Your trips and family are still on this phone.' : 'Your trips are still on this phone.'} Documents stay locked until you’re in.`} />
      <div className="act" style={{ gap: 10 }}>
        {via
          ? <button type="button" className="btn primary block" onClick={back}>Continue with {via}</button>
          : <button type="button" className="btn primary block" onClick={() => setSheet('code')}>Text me a code</button>}
        {via && a.methods.phone && <button type="button" className="btn secondary block" onClick={() => setSheet('code')}>Use my phone number</button>}
        <button type="button" className="btn ghost block" onClick={() => (onSomeoneElse ? onSomeoneElse() : hardReset())}>Not {displayName(s) || 'you'}? Start fresh</button>
      </div>
      {sheet === 'code' && <Sheet label="Sign in" onClose={() => setSheet(null)}><CodeStep to={prettyPhone(a.phone.digits)} onDone={back} /></Sheet>}
    </div>
  );
}

/* ---------- Privacy & data ---------- */

const STORED = [
  ['visa', 'Passports and IDs', 'To book flights, hotels and visas. Encrypted on this phone. Sent only to the airline, hotel or embassy when we book.'],
  ['user', 'Name, phone and email', 'To sign you in and reach you about your trips.'],
  ['trips', 'Trips and payments', 'So you can see and change them. Card numbers are held by our payment provider, not by Mada.'],
  ['star', 'Preferences', 'Seats, meals and loyalty numbers, to fill in bookings.'],
  ['pin', 'Location', 'Only on travel days, to time your drive. And for Who’s around, when it’s on.'],
  ['gear', 'App usage', 'If you allow it. To find what’s slow. Never sold, never used for ads.'],
];
function Privacy() {
  const { s, set, pop, toast } = useStore();
  const [a, save] = useAccount();
  const [sheet, setSheet] = useState(null);
  const [typed, setTyped] = useState('');
  const pending = a.exportAt && Date.now() - a.exportAt < DAY;
  const requestExport = () => {
    if (s.demo.offline) { toast('You’re offline. Ask again once you’re connected.'); return; }
    save({ exportAt: Date.now() }); buzz(HAPTIC.success); setSheet(null);
    toast('Requested. We’ll email a link within 24 hours.');
  };
  return (
    <div className="screen push">
      <TopBar onBack={pop} title="Privacy and data" />
      <div className="scroll no-dock">
        {a.deleteAt && <DeletionBanner />}

        <Group label="Your data">
          <Row icon="doc" value={pending ? 'Copy on its way' : 'Download my data'}
            sub={pending ? `Asked for ${fmtDate(a.exportAt)} at ${new Date(a.exportAt).toTimeString().slice(0, 5)}. A link goes to ${a.email ? a.email.address : 'your email'} within 24 hours.` : 'Trips, documents, payments and messages, as one file.'}
            right={pending ? <span className="pill gold">Pending</span> : undefined}
            onClick={pending ? undefined : () => setSheet('export')} />
        </Group>

        <Group label="What we keep, and why">
          {STORED.map(([icon, t, why]) => <Row key={t} icon={icon} value={t} sub={why} />)}
        </Group>

        <Group label="You choose">
          <Row value="Who’s around" sub="Friends in Circles see when you’re in the same city. Off unless you turn it on." right={<Toggle label="Who’s around" checked={!!s.circles?.around} onChange={(v) => set((p) => ({ circles: { ...p.circles, around: v } }))} />} />
          <Row value="Offers by email" sub="Never on unless you ask. At most one email a month." right={<Toggle label="Offers by email" checked={a.consents.marketing} onChange={(v) => save((f) => ({ consents: { ...f.consents, marketing: v } }))} />} />
          <Row value="Help us improve the app" sub="Anonymous usage, like which screens are slow." right={<Toggle label="Help us improve the app" checked={a.consents.analytics} onChange={(v) => save((f) => ({ consents: { ...f.consents, analytics: v } }))} />} />
        </Group>

        {!a.deleteAt && <button type="button" className="btn ghost block" style={{ color: '#8a3524' }} onClick={() => { setTyped(''); setSheet('delete'); }}>Delete my account</button>}
        <span className="tiny" style={{ padding: '0 4px' }}>We never sell your data. Questions go to privacy@madatrips.sa.</span>
      </div>

      {sheet === 'export' && (
        <Sheet label="Download my data" onClose={() => setSheet(null)}>
          <h2 className="h2">Get a copy of everything?</h2>
          <p className="body">We’ll email a download link {a.email ? `to ${a.email.address} ` : ''}within 24 hours. The link works for 7 days.</p>
          {!a.email
            ? <span className="err" role="alert">Add an email in Your details first, so we have somewhere to send it.</span>
            : <button type="button" className="btn primary block" onClick={requestExport}>Email me my data</button>}
          <button type="button" className="btn ghost block" onClick={() => setSheet(null)}>Not now</button>
        </Sheet>
      )}
      {sheet === 'delete' && (
        <Sheet label="Delete account" onClose={() => setSheet(null)}>
          <h2 className="h2">Delete your account?</h2>
          <p className="body">In 30 days we delete your trips, documents, household and preferences. Until then you can change your mind.</p>
          <ul className="small acc-list">
            <li>Bookings already made stay with the airline and hotel{s.trip ? `, including ${s.trip.city} on ${s.trip.flight?.date || s.trip.dates}` : ''}.</li>
            <li>Refunds still in progress still reach your card.</li>
            <li>We keep receipts for 5 years, because the law asks us to.</li>
          </ul>
          <div className="field">
            <label htmlFor="acc-del">Type DELETE to confirm</label>
            <input id="acc-del" className="input" autoCapitalize="characters" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
            {typed && typed.trim().toUpperCase() !== 'DELETE' && 'DELETE'.startsWith(typed.trim().toUpperCase()) === false && <span className="err">Type the word DELETE.</span>}
          </div>
          <button type="button" className="btn secondary block" style={{ color: '#8a3524' }} disabled={typed.trim().toUpperCase() !== 'DELETE'}
            onClick={() => { save({ deleteAt: Date.now() + 30 * DAY }); buzz(HAPTIC.warn); toast(`Scheduled for ${fmtDate(Date.now() + 30 * DAY, true)}.`); setSheet(null); }}>Delete in 30 days</button>
          <button type="button" className="btn primary block" onClick={() => setSheet(null)}>Keep my account</button>
        </Sheet>
      )}
    </div>
  );
}

export function DeletionBanner() {
  const { toast } = useStore();
  const [a, save] = useAccount();
  if (!a.deleteAt) return null;
  return (
    <div className="notice warn" role="status">
      <Icon name="bell" color="#7d5d27" style={{ flexShrink: 0 }} />
      <div className="grow">
        <span className="h3" style={{ fontSize: 15 }}>Scheduled for deletion on {fmtDate(a.deleteAt, true)}.</span>
        <span className="small">Everything stays until then. Bookings stay with the airlines.</span>
        <button type="button" className="btn secondary small" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => { save({ deleteAt: null }); buzz(HAPTIC.success); toast('Deletion cancelled. Your account stays.'); }}>Cancel deletion</button>
      </div>
    </div>
  );
}

/* ---------- Help & legal ---------- */

const FAQ = [
  ['Who books my trip?', 'A person at Mada, usually Faisal. Every booking is checked and confirmed by hand, and you see the name of whoever confirmed it.'],
  ['Can I change or cancel a booking?', 'Yes. Open the trip and tap Change. We show the airline’s fee before anything happens, and nothing changes until you say so.'],
  ['When does a refund reach my card?', 'We send it the day the airline or hotel releases it. Banks then take 5 to 14 days to show it. You can follow each step in Trips.'],
  ['Is my passport safe in the app?', 'It’s encrypted on this phone and locked with Face ID. We open it only to book for you, and we never sell your data.'],
  ['Can I book for my family and our helper?', 'Yes. Add them to your household once. Their passports fill in every booking, and for a helper we check the iqama and exit and re-entry visa first.'],
  ['What happens if my flight is delayed or cancelled?', 'We watch every flight. If it changes, we hold seats on other flights and tell you the options. Faisal and the team are there day and night.'],
];
function Help() {
  const { s, pop, push, toast } = useStore();
  const [open, setOpen] = useState(null);
  const [call, setCall] = useState(false);
  const chat = () => {
    const ok = Support.SCREENS && Support.SCREENS.support;
    if (ok) push('support', { about: 'Your account' }); else toast('Messages open here soon. For now, call or WhatsApp us.');
  };
  return (
    <div className="screen push">
      <TopBar onBack={pop} title="Help" />
      <div className="scroll no-dock">
        <div className="card focal" style={{ gap: 12 }}>
          <div className="row"><span className="avatar gold" style={{ width: 44, height: 44 }}><Sun width={28} color="#1e352d" /></span><span className="col" style={{ gap: 0 }}><span className="h3" style={{ color: '#f6f2ec' }}>Talk to Mada</span><span className="small">A person answers, day and night. Usually within 5 minutes.</span></span></div>
          <button type="button" className="btn gold block" onClick={chat}>Message Mada</button>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn on-dark small grow" onClick={() => { toast('Opening WhatsApp: +966 11 520 0000'); }}>WhatsApp</button>
            <button type="button" className="btn on-dark small grow" onClick={() => setCall(true)}>Call</button>
          </div>
        </div>

        <Group label="Questions people ask">
          {FAQ.map(([q, ans], i) => (
            <div key={q} className="acc-faq">
              <button type="button" className="acc-row" aria-expanded={open === i ? 'true' : 'false'} onClick={() => { buzz(HAPTIC.tap); setOpen(open === i ? null : i); }}>
                <span className="grow acc-v">{q}</span>
                <Icon name="chevron" size={18} color="#8a9590" style={{ transform: open === i ? 'rotate(90deg)' : 'none', transition: 'transform .25s var(--ease)' }} />
              </button>
              {open === i && <p className="small acc-answer">{ans}</p>}
            </div>
          ))}
        </Group>

        <Group label="Legal">
          <Row value="Terms of use" onClick={() => push('accountLegal', { doc: 'terms' })} />
          <Row value="Privacy policy" onClick={() => push('accountLegal', { doc: 'privacy' })} />
        </Group>
        <span className="tiny" style={{ textAlign: 'center' }}>Mada Trips 1.0 (build 1){s.demo.offline ? ' · offline' : ''}</span>
      </div>
      {call && (
        <Sheet label="Call Mada" onClose={() => setCall(false)}>
          <h2 className="h2">Call Mada</h2>
          <p className="body">+966 11 520 0000. Day and night, in Arabic or English. Have your booking code ready if it’s about a trip{s.trip?.pnr ? `: ${s.trip.pnr}` : ''}.</p>
          <a className="btn primary block" href="tel:+966115200000" onClick={() => setCall(false)}>Call now</a>
          <button type="button" className="btn ghost block" onClick={() => setCall(false)}>Cancel</button>
        </Sheet>
      )}
    </div>
  );
}

const LEGAL = {
  terms: ['Terms of use', 'Updated 1 Oct 2026', [
    ['Who we are', 'Mada Trips is run by Mada Travel and Tourism, a licensed travel agency in Riyadh. People at Mada book every trip.'],
    ['Bookings', 'When you confirm, we book with the airline, hotel or supplier in your name. Their fare rules apply, and we show them before you pay.'],
    ['Payment', 'Prices are in SAR and include every fee we know of. If a price changes before we book, we ask you first.'],
    ['Changes and refunds', 'We pass on the supplier’s fees and add none of our own for changes you make in the app.'],
    ['Your account', 'Keep your sign-in to yourself. You’re responsible for bookings made from your account.'],
  ]],
  privacy: ['Privacy policy', 'Updated 1 Oct 2026', [
    ['What we collect', 'Your details, your household’s passports, your trips and payments, and, if you allow it, location on travel days.'],
    ['Why', 'To book and look after your trips. Nothing else.'],
    ['Who sees it', 'People at Mada who work on your trips, and the airlines, hotels and embassies we book with. We never sell it.'],
    ['Where it’s kept', 'Passports are encrypted on your phone. Everything else is stored in Saudi Arabia, under the Personal Data Protection Law.'],
    ['Your rights', 'Download it, correct it or delete it, any time, from Privacy and data in the app.'],
  ]],
};
function Legal({ params }) {
  const { pop } = useStore();
  const [title, updated, parts] = LEGAL[params?.doc] || LEGAL.terms;
  return (
    <div className="screen push">
      <TopBar onBack={pop} />
      <div className="scroll no-dock">
        <h1 className="h1">{title}</h1>
        <span className="tiny">{updated}</span>
        {parts.map(([h, b]) => <div key={h} className="col" style={{ gap: 6 }}><span className="h3">{h}</span><p className="body" style={{ fontSize: 15 }}>{b}</p></div>)}
      </div>
    </div>
  );
}

export const SCREENS = {
  account: Account,
  accountSignin: SignIn,
  accountPrefs: Prefs,
  household: Household,
  householdPerson: HouseholdPerson,
  accountSecurity: Security,
  accountPrivacy: Privacy,
  accountHelp: Help,
  accountLegal: Legal,
};

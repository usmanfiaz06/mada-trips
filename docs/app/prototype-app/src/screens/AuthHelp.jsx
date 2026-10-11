import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore, buzz, HAPTIC } from '../store.jsx';
import { Icon, Sheet, TopBar, Sun, ArtHourglass } from '../ui.jsx';
import { passwordChecks, passwordMeetsRules } from '../../../../../packages/shared/src/password.ts';

/*
 * Sign-in help, shared by the onboarding code screens and Profile (the app's CodeEntry, CodeHelp, PauseSheet,
 * PasswordField and recover screen). Every line is the catalogue's English (packages/shared/src/copy/auth.ts), so the
 * prototype's Arabic comes from the same place as the app's.
 */

export const DEMO_CODE = '123456';
export const CODE_SENDER = 'no-reply@madatrips.sa';
const RESEND_SECONDS = 60;
const MAX_TRIES = 3;
const PAUSE_SECONDS = 45;
const DESK_CALL = 'tel:+966115200000';

export const mmss = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
export const prettyDigits = (d) => (d && d.length === 9 ? `+966 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}` : d ? `+966 ${d}` : '');
/** "o•••@gmail.com" / "+966 5• ••• 4567". */
export const maskContact = (via, v) => (via === 'email' ? `${(v || '').slice(0, 1)}•••@${(v || '').split('@')[1] || ''}` : `+966 ${(v || '').slice(0, 1)}• ••• ${(v || '').slice(5)}`);

/** The six digits out of whatever was typed or pasted (a whole pasted message gives its code). */
export function codeFrom(raw, previous = '') {
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 6) return digits;
  const runs = [...raw.matchAll(/(^|\D)(\d{6})(?!\d)/g)].map((m) => m[2]);
  if (runs.length) return runs[runs.length - 1];
  return raw.length - previous.length > 1 ? digits.slice(-6) : digits.slice(0, 6);
}

/** Too many tries in a row: the prototype's short, friendly pause, in the catalogue's words. */
export function AuthPause({ until, seconds = PAUSE_SECONDS, doneLabel = 'Send a new code', onDone, onClose }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const left = Math.min(seconds, Math.max(0, Math.ceil((until - now) / 1000)));
  const r = 26; const c = 2 * Math.PI * r;
  return (
    <Sheet label="Let’s take a short pause." onClose={onClose}>
      <div className="es-stage rl-stage" aria-hidden="true"><ArtHourglass /></div>
      <h2 className="h2">Let’s take a short pause.</h2>
      <p className="small" style={{ margin: 0 }}>There were a lot of tries in a row, so we’ve paused codes for a moment. It keeps your account safe. Nothing is locked.</p>
      <div className="rl-count" role="timer" aria-live="polite">
        <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r={r} fill="none" stroke="#efe9e0" strokeWidth="5" /><circle cx="32" cy="32" r={r} fill="none" stroke="#d9b77a" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - left / seconds)} transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset .5s linear' }} /></svg>
        <span className="col" style={{ gap: 0 }}><span className="tiny">{left > 0 ? 'You can try again in' : 'Ready when you are'}</span><span className="num rl-time">{mmss(left)}</span></span>
      </div>
      <button type="button" className="btn primary block" disabled={left > 0} onClick={() => { buzz(HAPTIC.tap); onDone(); }}>{doneLabel}</button>
      <a className="btn ghost block" href={DESK_CALL}>Call Mada</a>
    </Sheet>
  );
}

function HelpRow({ icon, title, sub, onClick, disabled }) {
  const body = (<>
    <span className="auth-help-ic" aria-hidden="true">{icon}</span>
    <span className="col grow" style={{ gap: 2, textAlign: 'start' }}><span className="h3" style={{ fontSize: 15, color: disabled ? '#5f6b65' : undefined }}>{title}</span>{sub && <span className="tiny">{sub}</span>}</span>
    {onClick && <Icon name="chevron" size={16} color="#5f6b65" />}
  </>);
  return onClick
    ? <button type="button" className="auth-help-row" disabled={disabled} aria-disabled={disabled ? 'true' : 'false'} onClick={() => { buzz(HAPTIC.tap); onClick(); }}>{body}</button>
    : <div className="auth-help-row">{body}</div>;
}

const APPLE = <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#1e352d" d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.72-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.75.73 1.05 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.32-3.52zM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.68-.92 2.67.97.08 1.96-.49 2.56-1.22z" /></svg>;
const GOOGLE = <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.5z" /></svg>;

/**
 * "Didn't get the code?": a new code (after the countdown), the spam folder for email, the wrong number or address,
 * another way in (sign-in only), and "I can't use this number or email any more".
 */
export function CodeHelpSheet({ about, resendIn, onResend, onChange, flow, onOther, onApple, onGoogle, onLost, onClose }) {
  const go = (fn) => () => { onClose(); fn(); };
  return (
    <Sheet label="Didn’t get the code?" onClose={onClose}>
      <h2 className="h2">Didn’t get the code?</h2>
      <p className="body">Codes can take a minute to arrive. Here’s what else you can do.</p>
      <HelpRow icon={<Icon name="refund" size={18} />} title={resendIn > 0 ? `Send a new code in ${mmss(resendIn)}` : 'Send a new code'} disabled={resendIn > 0} onClick={go(onResend)} />
      {about === 'email' && <HelpRow icon={<Icon name="doc" size={18} />} title="Check your spam or junk folder" sub={`It comes from Mada Trips, ${CODE_SENDER}.`} />}
      <HelpRow icon={<Icon name={about === 'phone' ? 'bell' : 'doc'} size={18} />} title={about === 'phone' ? 'Wrong number? Change it' : 'Wrong email? Change it'} onClick={go(onChange)} />
      {flow === 'signin' && (<>
        <span className="small" style={{ fontWeight: 600, marginTop: 4 }}>Try another way</span>
        <HelpRow icon={<Icon name={about === 'phone' ? 'doc' : 'bell'} size={18} />} title={about === 'phone' ? 'Get a code by email' : 'Get a code by text'} onClick={go(onOther)} />
        <HelpRow icon={APPLE} title="Continue with Apple" onClick={go(onApple)} />
        <HelpRow icon={GOOGLE} title="Continue with Google" onClick={go(onGoogle)} />
      </>)}
      <HelpRow icon={<Icon name="user" size={18} />} title="I can’t use this number or email any more" sub="We’ll check it’s you and move your account." onClick={go(onLost)} />
    </Sheet>
  );
}

/**
 * The code field and everything under it: tries left with a gentle shake, the pause after the third, the countdown
 * that turns into "Send a new code", Open Mail for email, and the help sheet.
 */
export function CodeInput({ id = 'otp', about, contact, shownAs, onDone, onChange, flow = 'signin', onOther, onApple, onGoogle, onLost }) {
  const { s, toast } = useStore();
  const [code, setCode] = useState('');
  const [tries, setTries] = useState(0);
  const [resendIn, setResendIn] = useState(RESEND_SECONDS);
  const [pause, setPause] = useState(null);
  const [help, setHelp] = useState(false);
  const [shake, setShake] = useState(0);
  const input = useRef(null);
  useEffect(() => { const t = setInterval(() => setResendIn((n) => (n > 0 ? n - 1 : 0)), 1000); return () => clearInterval(t); }, []);
  const paused = pause && pause.until > Date.now();
  const shown = shownAs || (about === 'phone' ? prettyDigits(contact) : contact);
  const [lost, setLost] = useState(false);

  const check = (v) => {
    if (v === DEMO_CODE) { buzz(HAPTIC.success); onDone(); return; }
    buzz(HAPTIC.soft); setShake((n) => n + 1); setCode('');
    const used = tries + 1;
    setTries(used);
    if (used >= MAX_TRIES) setPause({ until: Date.now() + Math.max(PAUSE_SECONDS, resendIn) * 1000, seconds: Math.max(PAUSE_SECONDS, resendIn), open: true });
  };
  const resend = () => {
    if (s.demo.offline) { toast('You’re offline. We’ll send it once you’re connected.'); return; }
    setTries(0); setCode(''); setPause(null); setResendIn(RESEND_SECONDS); buzz(HAPTIC.tap);
    toast(`New code sent to ${shown}.`);
    setTimeout(() => input.current?.focus(), 50);
  };
  const left = MAX_TRIES - tries;

  return (
    <>
      <div className="field">
        <label htmlFor={id}>6-digit code</label>
        <input id={id} ref={input} key={shake} className={'input otp' + (tries && !paused ? ' bad' : '') + (shake ? ' shake' : '')} inputMode="numeric" autoComplete="one-time-code" value={code} disabled={!!paused}
          onChange={(e) => { const v = codeFrom(e.target.value, code); setCode(v); if (v.length === 6) check(v); }} autoFocus={shake > 0} />
        {tries > 0 && !paused && left > 0 && <span className="err" role="alert">{left === 1 ? 'That code doesn\'t match. 1 try left.' : `That code doesn't match. ${left} tries left.`}</span>}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
        {paused && !pause.open
          ? <button type="button" className="link" onClick={() => setPause({ ...pause, open: true })}>Let’s take a short pause.</button>
          : resendIn > 0
            ? <span className="small num">New code in {mmss(resendIn)}</span>
            : <button type="button" className="btn secondary small" onClick={resend}>Send a new code</button>}
        {about === 'email' && <a className="btn secondary small" href="mailto:">Open Mail</a>}
      </div>
      <div className="row"><button type="button" className="link" onClick={() => setHelp(true)}>Didn’t get the code?</button></div>
      <p className="tiny">Demo code: 123456</p>
      {help && <CodeHelpSheet about={about} resendIn={resendIn} flow={flow} onClose={() => setHelp(false)} onResend={resend} onChange={onChange}
        onOther={onOther} onApple={onApple} onGoogle={onGoogle} onLost={onLost || (() => setLost(true))} />}
      {lost && <Overlay><RecoverScreen prefill={{}} onBack={() => setLost(false)} onDone={() => setLost(false)} /></Overlay>}
      {pause?.open && <AuthPause until={pause.until} seconds={pause.seconds} onClose={() => setPause({ ...pause, open: false })} onDone={resend} />}
    </>
  );
}

/** The password field: hidden until Show; marked for password managers. */
export function PasswordInput({ id, label = 'Password', value, onChange, fresh, error }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className={'input' + (error ? ' bad' : '')} type={shown ? 'text' : 'password'} autoComplete={fresh ? 'new-password' : 'current-password'} autoCapitalize="none" spellCheck={false}
        value={value} onChange={(e) => onChange(e.target.value)} />
      {error && <span className="err" role="alert">{error}</span>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="link" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</button></div>
    </div>
  );
}

/** Supabase's rules, ticking as they're met (PASSWORD_RULES in packages/shared). */
const RULE_WORDS = { length: 'At least 8 characters', lower: 'A lowercase letter', upper: 'An uppercase letter', digit: 'A number', symbol: 'A symbol, like # or @' };
export function PasswordRules({ value }) {
  return (
    <div className="col" style={{ gap: 6 }} aria-label="Your password needs">
      <span className="small">Your password needs</span>
      {passwordChecks(value).map((c) => (
        <span key={c.id} className={'auth-rule' + (c.ok ? ' ok' : '')} data-rule={c.id} data-ok={c.ok ? 'yes' : 'no'}>
          <span className="auth-rule-dot" aria-hidden="true">{c.ok && <Icon name="check" size={13} color="#f6f2ec" width={2.4} />}</span>
          <span className="small">{RULE_WORDS[c.id]}</span>
        </span>
      ))}
    </div>
  );
}
export { passwordMeetsRules };

/**
 * "I can't use this number or email any more": who they are, the old contact, a new way to reach them, a note.
 * The confirmation is the same whether or not an account uses the old contact.
 */
export function RecoverScreen({ prefill = {}, onBack, onDone }) {
  const [name, setName] = useState('');
  const [oldKind, setOldKind] = useState(prefill.kind === 'email' ? 'email' : 'phone');
  const [oldValue, setOldValue] = useState(prefill.value || '');
  const [newKind, setNewKind] = useState(prefill.kind === 'phone' ? 'email' : 'phone');
  const [newValue, setNewValue] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [sent, setSent] = useState(null);
  const okOf = (k, v) => (k === 'email' ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) : /^5\d{8}$/.test(v.replace(/\D/g, '').replace(/^966/, '').replace(/^0/, '')));
  const norm = (k, v) => (k === 'email' ? v.trim().toLowerCase() : v.replace(/\D/g, '').replace(/^966/, '').replace(/^0/, ''));
  const same = okOf(oldKind, oldValue) && okOf(newKind, newValue) && norm(oldKind, oldValue) === norm(newKind, newValue);
  const ready = name.trim() && okOf(oldKind, oldValue) && okOf(newKind, newValue) && !same;
  const send = (e) => {
    e.preventDefault(); setTried(true);
    if (!ready) { buzz(HAPTIC.soft); return; }
    buzz(HAPTIC.success);
    setSent(newKind === 'phone' ? prettyDigits(norm('phone', newValue)) : norm('email', newValue));
  };
  const contact = (kind, setKind, value, setValue, label, err) => (
    <>
      <div className="row" style={{ gap: 8 }} role="radiogroup">
        {[['phone', 'Phone number'], ['email', 'Email']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={kind === k ? 'true' : 'false'} className={'chip' + (kind === k ? ' on' : '')} onClick={() => { setKind(k); setValue(''); buzz(HAPTIC.select); }}>{l}</button>)}
      </div>
      <div className="field">
        <label htmlFor={`rec-${label}`}>{label}</label>
        {kind === 'phone'
          ? <div className="row"><span className="input" dir="ltr" style={{ width: 92, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>+966</span><input id={`rec-${label}`} className={'input' + (err ? ' bad' : '')} inputMode="tel" placeholder="5X XXX XXXX" value={value} onChange={(e) => setValue(e.target.value)} /></div>
          : <input id={`rec-${label}`} className={'input' + (err ? ' bad' : '')} inputMode="email" autoCapitalize="none" placeholder="you@example.com" value={value} onChange={(e) => setValue(e.target.value)} />}
        {err && <span className="err" role="alert">{err}</span>}
      </div>
    </>
  );

  if (sent) {
    return (
      <div className="screen">
        <TopBar onBack={onBack} />
        <div className="scroll no-dock" style={{ padding: '24px 24px 0', gap: 16 }}>
          <Sun width={56} />
          <h1 className="h1">We have your request.</h1>
          <p className="body">A person at Mada will check it’s you, using the passport details on file and your last booking, then move your account. Usually within a day.</p>
          <p className="body" style={{ fontWeight: 600 }}>We’ll reach you at {sent}.</p>
          <button type="button" className="btn primary block" onClick={onDone}>Back to sign-in</button>
        </div>
      </div>
    );
  }
  const badOld = tried && !okOf(oldKind, oldValue) ? (oldKind === 'email' ? 'That address looks incomplete. It needs an @ and a domain.' : 'Saudi mobile numbers start with 5 after +966.') : null;
  const badNew = same ? 'The new one needs to be different from the old one.' : tried && !okOf(newKind, newValue) ? (newKind === 'email' ? 'That address looks incomplete. It needs an @ and a domain.' : 'Saudi mobile numbers start with 5 after +966.') : null;
  return (
    <div className="screen">
      <TopBar onBack={onBack} />
      <form className="scroll no-dock" style={{ padding: '16px 24px 32px', gap: 14 }} onSubmit={send}>
        <h1 className="h1">Can’t use your old number or email?</h1>
        <p className="body">Tell us who you are and how to reach you now. A person at Mada checks it’s you, then moves your account.</p>
        <div className="field">
          <label htmlFor="rec-name">Your full name</label>
          <input id="rec-name" className={'input' + (tried && !name.trim() ? ' bad' : '')} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          {tried && !name.trim() && <span className="err" role="alert">Your name helps us find your account.</span>}
        </div>
        <span className="small" style={{ fontWeight: 600 }}>You signed in with</span>
        {contact(oldKind, setOldKind, oldValue, setOldValue, oldKind === 'phone' ? 'Your old number' : 'Your old email', badOld)}
        <span className="small" style={{ fontWeight: 600 }}>How we can reach you now</span>
        {contact(newKind, setNewKind, newValue, setNewValue, newKind === 'phone' ? 'Your new number' : 'Your new email', badNew)}
        <div className="field">
          <label htmlFor="rec-note">Anything that helps (optional)</label>
          <textarea id="rec-note" className="input" rows={3} maxLength={500} placeholder="For example, your last trip with us" value={note} onChange={(e) => setNote(e.target.value)} style={{ height: 96, paddingTop: 12, resize: 'none' }} />
        </div>
        <span className="tiny">We only use these details to check it’s you.</span>
        <button type="submit" className="btn primary block">Send to Mada</button>
      </form>
    </div>
  );
}

/** A full screen over everything (the recovery request opened from a sheet in Profile). */
function Overlay({ children }) {
  const host = typeof document !== 'undefined' && document.querySelector('.phone');
  const node = <div style={{ position: 'absolute', inset: 0, zIndex: 80, background: 'var(--sand)' }}>{children}</div>;
  return host ? createPortal(node, host) : node;
}

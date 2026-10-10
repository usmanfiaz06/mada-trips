import React, { useEffect, useRef, useState } from 'react';
import { useStore, buzz, HAPTIC, PEOPLE, MRZ } from '../store.jsx';
import { Icon, Sun, TopBar, Sheet } from '../ui.jsx';

const OTP = '123456';

export default function Onboarding() {
  const { s, set, toast } = useStore();
  const [step, setStep] = useState('welcome');
  const [history, setHistory] = useState([]);
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [code, setCode] = useState('');
  const [tries, setTries] = useState(0);
  const [resendIn, setResendIn] = useState(30);
  const [sheet, setSheet] = useState(null);
  const [scanState, setScanState] = useState('scanning');
  const [fields, setFields] = useState({ given: 'OMAR', surname: 'ALHARBI', number: 'A08493141', nationality: 'Saudi Arabia', dob: '11/03/1984', expiry: '22/06/2031' });
  const [manual, setManual] = useState(false);
  const [household, setHousehold] = useState([]);
  const [passportLater, setPassportLater] = useState(false);

  const goto = (next) => { setHistory((h) => [...h, step]); setStep(next); buzz(HAPTIC.tap); };
  const back = () => { setHistory((h) => { const prev = h[h.length - 1]; if (prev) setStep(prev); return h.slice(0, -1); }); };

  useEffect(() => {
    if (step !== 'otp') return undefined;
    setResendIn(30);
    const t = setInterval(() => setResendIn((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [step]);

  useEffect(() => {
    if (step !== 'camera') return undefined;
    setScanState('scanning');
    const t = setTimeout(() => {
      if (s.demo.scanFails) { setScanState('failed'); buzz(HAPTIC.soft); }
      else { buzz(HAPTIC.success); setManual(false); goto('confirm'); }
    }, 2200);
    return () => clearTimeout(t);
  }, [step, s.demo.scanFails]);

  const finish = () => {
    set({
      onboarded: true,
      guest: false,
      user: { name: fields.given ? fields.given.charAt(0) + fields.given.slice(1).toLowerCase() : 'Omar' },
      household: ['omar', ...household],
      passportSaved: !passportLater,
      tab: 'today',
      stack: [],
    });
    buzz(HAPTIC.success);
  };

  /* ---------- phone validation ---------- */
  const digits = phone.replace(/\D/g, '').replace(/^966/, '').replace(/^0/, '');
  let phoneErr = null;
  if (digits.length && !digits.startsWith('5')) phoneErr = 'Saudi mobile numbers start with 5 after +966.';
  else if (digits.length && digits.length < 9) phoneErr = `That number looks short. It needs 9 digits after +966 (you have ${digits.length}).`;
  else if (digits.length > 9) phoneErr = 'That number looks long. It needs 9 digits after +966.';
  const phoneOk = digits.length === 9 && digits.startsWith('5');
  const pretty = phoneOk ? `+966 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}` : '';

  /* ---------- otp ---------- */
  const locked = tries >= 3;
  const submitCode = (value) => {
    if (value.length !== 6 || locked) return;
    if (value === OTP) { buzz(HAPTIC.success); goto('passport'); return; }
    buzz(HAPTIC.soft);
    setTries((n) => n + 1);
    setCode('');
  };

  /* ---------- passport ---------- */
  const expiryDate = (() => {
    const m = fields.expiry.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  })();
  const expired = expiryDate && expiryDate < new Date();
  const missing = ['given', 'surname', 'number', 'dob', 'expiry'].filter((k) => !fields[k].trim());
  const badDate = fields.expiry && !expiryDate;

  const screens = {
    welcome: (
      <div className="screen dark" style={{ justifyContent: 'space-between' }}>
        <div style={{ padding: '120px 28px 0', display: 'flex', flexDirection: 'column', gap: 28 }}>
          <Sun width={84} className="breathe" />
          <h1 className="display rise" style={{ fontSize: 52, color: '#f6f2ec' }}>We'll take it from here.</h1>
          <p className="body rise d2" style={{ color: '#d6cfc3', fontSize: 18 }}>Tell us where you're going. We'll find it, book it, and stay with you until you're home.</p>
        </div>
        <div style={{ padding: '0 24px 40px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button type="button" className="btn gold block" onClick={() => goto('signin')}>Start</button>
          <button type="button" className="btn on-dark block" onClick={() => { set({ onboarded: true, guest: true, household: [], tab: 'today', stack: [] }); buzz(HAPTIC.tap); }}>Just track a flight</button>
        </div>
      </div>
    ),

    signin: (
      <div className="screen">
        <TopBar onBack={back} />
        <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 className="h1">Sign in to book and keep your trips.</h1>
          <p className="body">Your trips, documents and family stay on this phone and in your account.</p>
        </div>
        <div className="act">
          <button type="button" className="btn primary block" onClick={() => setSheet('apple')}>Continue with Apple</button>
          <button type="button" className="btn secondary block" onClick={() => setSheet('google')}>Continue with Google</button>
          <button type="button" className="btn ghost block" onClick={() => goto('phone')}>Use my phone number</button>
          <p className="act-note">Bookings stay private. We never sell your data.</p>
        </div>
        {sheet && (
          <Sheet label="Sign in" onClose={() => setSheet(null)}>
            <h2 className="h2">Continue as Omar?</h2>
            <p className="body">{sheet === 'apple' ? 'Apple shares your name and a private email that forwards to you.' : 'Google shares your name and email address.'}</p>
            <button type="button" className="btn primary block" onClick={() => { setSheet(null); goto('passport'); }}>Continue</button>
            <button type="button" className="btn ghost block" onClick={() => setSheet(null)}>Cancel</button>
          </Sheet>
        )}
      </div>
    ),

    phone: (
      <div className="screen">
        <TopBar onBack={back} />
        <form style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 16 }} onSubmit={(e) => { e.preventDefault(); if (phoneOk && !s.demo.offline) goto('otp'); }}>
          <h1 className="h1">Your mobile number</h1>
          <p className="body">We'll text a 6-digit code. Used for sign-in and urgent trip updates only.</p>
          <div className="field">
            <label htmlFor="phone">Mobile number</label>
            <div className="row">
              <span className="input" style={{ width: 92, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>+966</span>
              <input id="phone" className={'input' + (phoneTouched && phoneErr ? ' bad' : '')} inputMode="tel" autoComplete="tel-national" placeholder="5X XXX XXXX" value={phone}
                onChange={(e) => setPhone(e.target.value)} onBlur={() => setPhoneTouched(true)} />
            </div>
            {phoneTouched && phoneErr && <span className="err" role="alert">{phoneErr}</span>}
            {s.demo.offline && <span className="err" role="alert">You're offline. We'll be able to send the code once you're connected.</span>}
          </div>
          <div className="act">
            <button type="submit" className="btn primary block" disabled={!phoneOk || s.demo.offline}>Text me a code</button>
          </div>
        </form>
      </div>
    ),

    otp: (
      <div className="screen">
        <TopBar onBack={back} />
        <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h1 className="h1">Enter the code</h1>
          <p className="body">Sent to {pretty || 'your phone'}. <button type="button" className="link" onClick={back}>Change number</button></p>
          <div className="field">
            <label htmlFor="otp">6-digit code</label>
            <input id="otp" className={'input otp' + (tries && !locked ? ' bad' : '')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={locked}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); if (v.length === 6) submitCode(v); }} />
            {tries > 0 && !locked && <span className="err" role="alert">That code doesn't match. {3 - tries} {3 - tries === 1 ? 'try' : 'tries'} left.</span>}
            {locked && <span className="err" role="alert">Too many tries. Get a new code to carry on.</span>}
          </div>
          <div className="row">
            {resendIn > 0 && !locked
              ? <span className="small num">New code in 0:{String(resendIn).padStart(2, '0')}</span>
              : <button type="button" className="btn secondary small" onClick={() => { setTries(0); setCode(''); setResendIn(30); toast('New code sent.'); buzz(HAPTIC.tap); }}>Send a new code</button>}
          </div>
          <p className="tiny">Demo code: 123456</p>
        </div>
      </div>
    ),

    passport: (
      <div className="screen">
        <TopBar onBack={back} />
        <div style={{ padding: '16px 24px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="passport" style={{ height: 200 }}>
            <div className="inner">
              <div className="spread"><span className="eyebrow" style={{ color: '#d9b77a' }}>Passport</span><Icon name="scan" color="#d9b77a" /></div>
              <div className="mrz">{MRZ.omar[0]}{'\n'}{MRZ.omar[1]}</div>
            </div>
          </div>
          <h1 className="h1">Start with your passport.</h1>
          <p className="body">One scan fills in every trip from now on. Encrypted, and only opened to book for you.</p>
        </div>
        <div className="act">
          <button type="button" className="btn primary block" onClick={() => setSheet('camera')}>Scan passport</button>
          <button type="button" className="btn secondary block" onClick={() => { setManual(true); setFields({ given: '', surname: '', number: '', nationality: 'Saudi Arabia', dob: '', expiry: '' }); goto('confirm'); }}>Enter it by hand</button>
          <button type="button" className="btn ghost block" onClick={() => { setPassportLater(true); goto('household'); }}>Later</button>
        </div>
        {sheet === 'camera' && (
          <Sheet label="Camera access" onClose={() => setSheet(null)}>
            <h2 className="h2">“Mada” would like to use the camera</h2>
            <p className="body">To read your passport. Nothing is uploaded until you check the details.</p>
            <button type="button" className="btn primary block" onClick={() => { setSheet(null); goto('camera'); }}>Allow</button>
            <button type="button" className="btn ghost block" onClick={() => setSheet('denied')}>Don't allow</button>
          </Sheet>
        )}
        {sheet === 'denied' && (
          <Sheet label="No camera" onClose={() => setSheet(null)}>
            <h2 className="h2">No camera, no problem.</h2>
            <p className="body">Enter the details by hand now. You can allow the camera later in Settings.</p>
            <button type="button" className="btn primary block" onClick={() => { setSheet(null); setManual(true); setFields({ given: '', surname: '', number: '', nationality: 'Saudi Arabia', dob: '', expiry: '' }); goto('confirm'); }}>Enter it by hand</button>
            <button type="button" className="btn ghost block" onClick={() => { setSheet(null); setPassportLater(true); goto('household'); }}>Do it later</button>
          </Sheet>
        )}
      </div>
    ),

    camera: (
      <div className="camera">
        <TopBar onBack={back} backLabel="Cancel" dark />
        <div style={{ padding: '30px 0 0', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div className="viewfinder">
            {scanState === 'scanning' && <span className="scanline" />}
            <div style={{ position: 'absolute', left: 16, right: 16, bottom: 16, fontFamily: 'var(--f-mono)', fontSize: 10, color: 'rgba(233,226,216,.35)', whiteSpace: 'pre', overflow: 'hidden' }}>{MRZ.omar[0]}{'\n'}{MRZ.omar[1]}</div>
          </div>
          {scanState === 'scanning' ? (
            <div style={{ padding: '0 28px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="h3" style={{ color: '#f6f2ec' }}>Hold the photo page in the frame</span>
              <span className="small" style={{ color: '#b8b0a3' }}>Reading the two lines at the bottom…</span>
            </div>
          ) : (
            <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 12 }} role="alert">
              <span className="h2" style={{ color: '#f6f2ec' }}>We couldn't read it.</span>
              <span className="body" style={{ color: '#d6cfc3' }}>Lay the passport flat, away from bright light, with the two lines at the bottom fully in the frame.</span>
              <button type="button" className="btn gold block" onClick={() => { setScanState('scanning'); setStep('confirm'); setTimeout(() => setStep('camera'), 0); }}>Try again</button>
              <button type="button" className="btn on-dark block" onClick={() => { setManual(true); setFields({ given: '', surname: '', number: '', nationality: 'Saudi Arabia', dob: '', expiry: '' }); setStep('confirm'); }}>Enter it by hand</button>
            </div>
          )}
        </div>
      </div>
    ),

    confirm: (
      <div className="screen">
        <TopBar onBack={back} title={manual ? 'Passport details' : null} />
        <div className="scroll no-dock">
          <h1 className="h1">{manual ? 'Exactly as on the photo page.' : 'Is this right?'}</h1>
          <p className="body">Airlines need names to match the passport letter for letter, including every given name.</p>
          {[['given', 'Given names'], ['surname', 'Surname'], ['number', 'Passport number'], ['nationality', 'Nationality'], ['dob', 'Date of birth (DD/MM/YYYY)'], ['expiry', 'Expiry date (DD/MM/YYYY)']].map(([k, lbl]) => (
            <div className="field" key={k}>
              <label htmlFor={'pp-' + k}>{lbl}</label>
              <input id={'pp-' + k} className="input" value={fields[k]} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} autoCapitalize="characters" />
              {k === 'expiry' && badDate && <span className="err">Use the format DD/MM/YYYY, for example 22/06/2031.</span>}
            </div>
          ))}
          {expired && (
            <div className="notice warn" role="alert">
              <Icon name="visa" color="#7d5d27" />
              <div className="grow"><span className="h3">This passport has expired.</span><span className="small">We'll save it, but it can't be used to travel. Faisal can help you renew it.</span></div>
            </div>
          )}
        </div>
        <div className="act">
          <button type="button" className="btn primary block" disabled={missing.length > 0 || badDate} onClick={() => { buzz(HAPTIC.success); goto('household'); }}>
            {missing.length ? `Fill in ${missing.length} more` : manual ? 'Save passport' : 'Yes, save it'}
          </button>
        </div>
      </div>
    ),

    household: (
      <div className="screen">
        <TopBar onBack={back} right={<button type="button" className="link" onClick={() => goto('alerts')}>Skip</button>} />
        <div className="scroll no-dock">
          <h1 className="h1">Who do you travel with?</h1>
          <p className="body">Add them once. We'll fill in their details on every trip and watch their documents.</p>
          {['hessa', 'sara', 'ahmed', 'lina'].map((id) => {
            const p = PEOPLE[id];
            const on = household.includes(id);
            return (
              <button key={id} type="button" className={'card tap' + (on ? ' selected' : '')} aria-pressed={on ? 'true' : 'false'}
                onClick={() => { buzz(HAPTIC.select); setHousehold(on ? household.filter((x) => x !== id) : [...household, id]); }}>
                <div className="row">
                  <span className={'avatar' + (on ? ' green' : '')}>{p.initial}</span>
                  <div className="grow col"><span className="h3">{p.name}</span><span className="small">{p.role}</span></div>
                  <span className="pill" style={on ? { background: '#1e352d', color: '#f6f2ec' } : null}>{on ? 'Added' : 'Add'}</span>
                </div>
                {on && id === 'lina' && <span className="small">Before any trip, we'll ask for Lina's iqama expiry and exit and re-entry visa dates.</span>}
              </button>
            );
          })}
          <button type="button" className="btn secondary block" onClick={() => toast('In the app you scan their passport here.')}><Icon name="plus" />Someone else</button>
        </div>
        <div className="act">
          <button type="button" className="btn primary block" onClick={() => goto('alerts')}>{household.length ? `Continue with ${household.length + 1} people` : 'Just me for now'}</button>
        </div>
      </div>
    ),

    alerts: (
      <div className="screen">
        <TopBar onBack={back} />
        <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <span className="icon-btn dark" style={{ width: 64, height: 64 }}><Icon name="bell" color="#d9b77a" size={28} /></span>
          <h1 className="h1">We'll only interrupt you when it matters.</h1>
          <p className="body">Gate changes. Delays. The moment your driver arrives. Never offers.</p>
        </div>
        <div className="act">
          <button type="button" className="btn primary block" onClick={() => { set({ notifications: true }); goto('location'); }}>Allow alerts</button>
          <button type="button" className="btn ghost block" onClick={() => { set({ notifications: false }); goto('location'); }}>Not now</button>
        </div>
      </div>
    ),

    location: (
      <div className="screen">
        <TopBar onBack={back} />
        <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <span className="icon-btn dark" style={{ width: 64, height: 64 }}><Icon name="pin" color="#d9b77a" size={28} /></span>
          <h1 className="h1">Know when to leave.</h1>
          <p className="body">On travel days we time your drive to the airport. That's all we use it for.</p>
        </div>
        <div className="act">
          <button type="button" className="btn primary block" onClick={() => { set({ location: true }); finish(); }}>Allow</button>
          <button type="button" className="btn ghost block" onClick={() => { set({ location: false }); finish(); }}>Not now</button>
        </div>
      </div>
    ),
  };

  return <div key={step} className="push" style={{ position: 'absolute', inset: 0 }}>{screens[step]}</div>;
}

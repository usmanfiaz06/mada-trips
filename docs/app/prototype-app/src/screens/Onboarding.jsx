import React, { useEffect, useRef, useState } from 'react';
import { WelcomeBack } from './Account.jsx';
import { useStore, buzz, HAPTIC, PEOPLE, MRZ } from '../store.jsx';
import { Icon, Sun, TopBar, Sheet, AddPersonSheet } from '../ui.jsx';
import { checkFile, readPassport } from '../ocr.js';

const OTP = '123456';
const DEMO_FIELDS = { given: 'OMAR', surname: 'ALHARBI', number: 'A08493141', nationality: 'Saudi Arabia', dob: '11/03/1984', expiry: '22/06/2031' };
const BLANK_FIELDS = { given: '', surname: '', number: '', nationality: 'Saudi Arabia', dob: '', expiry: '' };
const hidden = { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' };

export default function Onboarding() {
  const { s, set, toast } = useStore();
  const [step, setStep] = useState(s.signinFrom ? 'signin' : 'welcome');
  const [history, setHistory] = useState([]);
  const [phone, setPhone] = useState('');
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [code, setCode] = useState('');
  const [tries, setTries] = useState(0);
  const [resendIn, setResendIn] = useState(30);
  const [sheet, setSheet] = useState(null);
  const [social, setSocial] = useState(null); // 'apple' | 'google' once they've signed in that way
  const [hideEmail, setHideEmail] = useState(true);
  const [scanState, setScanState] = useState('choose'); // choose | demo | reading | failed
  const [fields, setFields] = useState(DEMO_FIELDS);
  const [manual, setManual] = useState(false);
  const [fromPhoto, setFromPhoto] = useState(false);
  const [doubt, setDoubt] = useState([]);
  const [photo, setPhoto] = useState(null);
  const [progress, setProgress] = useState(0);
  const [fileErr, setFileErr] = useState(null);
  const [failWhy, setFailWhy] = useState(null);
  const run = useRef(0);
  const [household, setHousehold] = useState([]);
  const [passportLater, setPassportLater] = useState(false);

  const goto = (next) => { setHistory((h) => [...h, step]); setStep(next); buzz(HAPTIC.tap); };
  const back = () => {
    if (!history.length && s.signinFrom) { set({ onboarded: true, guest: true, signinFrom: null }); return; }
    setHistory((h) => { const prev = h[h.length - 1]; if (prev) setStep(prev); return h.slice(0, -1); });
  };

  useEffect(() => {
    if (step !== 'otp') return undefined;
    setResendIn(30);
    const t = setInterval(() => setResendIn((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [step]);

  // Arriving on the camera step: wait for a photo, or the demo passport.
  useEffect(() => {
    if (step !== 'camera') { run.current += 1; return; }
    setScanState('choose'); setFileErr(null);
  }, [step]);

  // The demo passport: a simulated scan of Omar's page.
  useEffect(() => {
    if (step !== 'camera' || scanState !== 'demo') return undefined;
    const t = setTimeout(() => {
      if (s.demo.scanFails) { setFailWhy(null); setScanState('failed'); buzz(HAPTIC.soft); }
      else { buzz(HAPTIC.success); setManual(false); setFromPhoto(false); setDoubt([]); setFields(DEMO_FIELDS); goto('confirm'); }
    }, 2200);
    return () => clearTimeout(t);
  }, [step, scanState, s.demo.scanFails]);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);

  const byHand = () => { setManual(true); setFromPhoto(false); setDoubt([]); setFields(BLANK_FIELDS); };

  // A real photo: read the two lines at the bottom of the page.
  const readPhoto = (file) => {
    setFileErr(null);
    const bad = checkFile(file);
    if (bad) { setFileErr(bad); buzz(HAPTIC.soft); return; }
    const mine = ++run.current;
    setPhoto(URL.createObjectURL(file));
    setProgress(0);
    setScanState('reading');
    readPassport(file, (n) => { if (run.current === mine) setProgress(n); })
      .then((r) => {
        if (run.current !== mine) return;
        if (!r.fields) { setFailWhy(null); setScanState('failed'); buzz(HAPTIC.soft); return; }
        const f = r.fields;
        setFields({ given: f.given, surname: f.surname, number: f.number, nationality: f.nationality, dob: f.dob, expiry: f.expiry });
        setDoubt(r.doubtful);
        setManual(false);
        setFromPhoto(true);
        buzz(r.doubtful.length ? HAPTIC.soft : HAPTIC.success);
        goto('confirm');
      })
      .catch((e) => {
        if (run.current !== mine) return;
        setFailWhy(/photo|open/i.test(e.message) ? e.message : 'The passport reader didn’t load. Check your connection and try again.');
        setScanState('failed');
        buzz(HAPTIC.soft);
      });
  };

  const finish = () => {
    set({
      onboarded: true,
      guest: false,
      user: { full: [fields.given, fields.surname].filter(Boolean).map((w) => w.split(' ').map((x) => x.charAt(0) + x.slice(1).toLowerCase()).join(' ')).join(' ') || undefined, name: fields.given ? fields.given.split(' ')[0].charAt(0) + fields.given.split(' ')[0].slice(1).toLowerCase() : 'Omar' },
      household: ['omar', ...household],
      passportSaved: !passportLater,
      account: { ...(s.account || {}), signedOut: false, ...(phoneOk ? { phone: { digits, at: Date.now() } } : {}), ...(social ? { methods: { ...(s.account?.methods || {}), [social]: true, phone: phoneOk } } : {}) },
      /* Back to what they were doing before signing in, if anything. */
      tab: s.signinFrom?.tab || 'today',
      stack: s.signinFrom?.name ? [{ name: s.signinFrom.name, params: s.signinFrom.params || {}, key: Date.now() }] : [],
      signinFrom: null,
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
    if (value === OTP) {
      buzz(HAPTIC.success);
      /* 50 000 4127 is the demo account that already exists: bring everything back instead of starting over. */
      if (digits.endsWith('4127') && !social) { goto('welcomeBack'); return; }
      goto('passport'); return;
    }
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
      <div className="screen dark" style={{ background: '#0f1a16' }}>
        <video className="welcome-video" src="img/welcome.mp4" poster="img/welcome.jpg" autoPlay muted loop playsInline aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(15,26,22,.45) 0%, rgba(15,26,22,0) 22%, rgba(15,26,22,0) 42%, rgba(30,53,45,.82) 66%, #1e352d 84%)' }} />
        <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 24px 40px' }}>
          <Sun width={64} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 4px' }}>
              <h1 className="display rise" style={{ fontSize: 52, color: '#f6f2ec' }}>We'll take it from here.</h1>
              <p className="body rise d2" style={{ color: '#e1dacd', fontSize: 18 }}>Tell us where you're going. We'll find it, book it, and stay with you until you're home.</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button type="button" className="btn gold block" onClick={() => goto('signin')}>Start</button>
              <button type="button" className="btn block" style={{ background: 'rgba(255,253,249,.14)', color: '#f6f2ec', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,253,249,.16)' }}
                onClick={() => { set({ onboarded: true, guest: true, household: [], tab: 'today', stack: [] }); buzz(HAPTIC.tap); }}>Just track a flight</button>
            </div>
          </div>
        </div>
      </div>
    ),

    signin: (
      <div className="screen">
        <TopBar onBack={back} />
        <div aria-hidden="true" style={{ position: 'relative', height: 250, margin: '8px 0 0' }}>
          {[['img/alula.jpg', -9, -78, '.05s'], ['img/riyadh.jpg', 8, 78, '.15s'], ['img/istanbul.jpg', 0, 0, '.25s']].map(([src, rot, x, d]) => (
            <img key={src} src={src} alt="" style={{ position: 'absolute', left: '50%', top: 18, width: 168, height: 220, marginLeft: -84 + x, objectFit: 'cover', borderRadius: 24, border: '4px solid #fffdf9', boxShadow: '0 22px 40px -20px rgba(15,26,22,.6)', transform: `rotate(${rot}deg)`, animation: `rise .7s ${d} var(--ease) both` }} />
          ))}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: -4, display: 'flex', justifyContent: 'center' }}><span className="pill" style={{ background: '#1e352d', color: '#f6f2ec', height: 32, padding: '0 14px', whiteSpace: 'nowrap', animation: 'rise .6s .5s var(--ease) both' }}><Sun width={18} />Confirmed by Faisal at Mada</span></div>
        </div>
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
        {(sheet === 'apple' || sheet === 'google') && (
          <Sheet label="Sign in" onClose={() => { setSheet(null); toast('Sign-in cancelled. Nothing was shared.'); }}>
            {s.demo.offline ? (<>
              <h2 className="h2">You’re offline.</h2>
              <p className="body">Signing in needs a connection. Your phone number works the same way once you’re back online.</p>
              <button type="button" className="btn primary block" onClick={() => setSheet(null)}>Okay</button>
            </>) : (<>
              <h2 className="h2">Continue as Omar?</h2>
              {sheet === 'apple' ? (
                <div className="col" style={{ gap: 8 }} role="radiogroup" aria-label="Email">
                  {[[false, 'Share my email', 'omar.alharbi@icloud.com'], [true, 'Hide my email', 'A private address that forwards to you']].map(([v, t, sub]) => (
                    <button key={t} type="button" role="radio" aria-checked={hideEmail === v ? 'true' : 'false'} className={'card tap well' + (hideEmail === v ? ' selected' : '')} onClick={() => setHideEmail(v)}><span className="h3" style={{ fontSize: 15 }}>{t}</span><span className="tiny">{sub}</span></button>
                  ))}
                </div>
              ) : <p className="body">Google shares your name and email address, omar.alharbi@gmail.com.</p>}
              <button type="button" className="btn primary block" onClick={() => { setSocial(sheet); setSheet(null); buzz(HAPTIC.success); goto('phone'); }}>Continue</button>
              <button type="button" className="btn ghost block" onClick={() => { setSheet(null); toast('Sign-in cancelled. Nothing was shared.'); }}>Cancel</button>
            </>)}
          </Sheet>
        )}
      </div>
    ),

    welcomeBack: (
      <div className="screen">
        <div style={{ padding: '110px 24px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <span className="avatar green rise" style={{ width: 72, height: 72, fontSize: 28 }}>O</span>
          <h1 className="display rise d1" style={{ fontSize: 44 }}>Welcome back, Omar.</h1>
          <p className="body rise d2">Your trips, your family’s passports and your saved places are all here. Nothing to set up again.</p>
          <div className="card rise d3" style={{ gap: 8 }}>
            {[['circles', 'Omar, Hessa, Sara and Ahmed'], ['visa', '4 passports, checked and encrypted'], ['trips', '1 past trip · Baku']].map(([ic, t]) => <div key={t} className="row small" style={{ color: '#1e352d' }}><Icon name={ic} size={18} />{t}</div>)}
          </div>
          <span className="tiny rise d3">New phone? For your safety, the Wallet asks for Face ID the first time you open it.</span>
        </div>
        <div className="act">
          <button type="button" className="btn primary block" onClick={() => { set({ onboarded: true, guest: false, user: { name: 'Omar' }, household: ['omar', 'hessa', 'sara', 'ahmed'], passportSaved: true, notifications: true, tab: s.signinFrom?.tab || 'today', stack: s.signinFrom?.name ? [{ name: s.signinFrom.name, params: s.signinFrom.params || {}, key: Date.now() }] : [], signinFrom: null }); buzz(HAPTIC.success); }}>Open Mada</button>
          <button type="button" className="btn ghost block" onClick={() => goto('phone')}>That’s not me</button>
        </div>
      </div>
    ),

    phone: (
      <div className="screen">
        <TopBar onBack={back} />
        <form style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 16 }} onSubmit={(e) => { e.preventDefault(); if (phoneOk && !s.demo.offline) goto('otp'); }}>
          <h1 className="h1">{social ? 'One more thing: your mobile' : 'Your mobile number'}</h1>
          <p className="body">{social ? `You’re signed in with ${social === 'apple' ? 'Apple' : 'Google'}. Gate changes and Faisal’s messages come by SMS and WhatsApp, so we need a number that’s with you.` : 'We\'ll text a 6-digit code. Used for sign-in and urgent trip updates only.'}</p>
          <div className="field">
            <label htmlFor="phone">Mobile number</label>
            <div className="row">
              <span className="input" style={{ width: 92, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>+966</span>
              <input id="phone" className={'input' + (phoneTouched && phoneErr ? ' bad' : '')} inputMode="tel" autoComplete="tel-national" placeholder="5X XXX XXXX" value={phone}
                onChange={(e) => setPhone(e.target.value)} onBlur={() => setPhoneTouched(true)} />
            </div>
            {phoneTouched && phoneErr && <span className="err" role="alert">{phoneErr}</span>}
            {s.demo.offline && <span className="err" role="alert">You're offline. We'll be able to send the code once you're connected.</span>}
            {!social && <span className="tiny">Demo: 50 000 4127 already has an account.</span>}
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
        <TopBar onBack={back} right={<button type="button" className="link" style={{ fontSize: 15, fontWeight: 600, padding: '10px 4px' }} onClick={() => { setPassportLater(true); goto('household'); }}>Later</button>} />
        <div className="scroll" style={{ padding: '8px 24px 0', gap: 16 }}>
          <div className="pp-stage" aria-hidden="true">
            <div className="pp-page">
              <div className="pp-guilloche" />
              <div className="pp-head"><span>Kingdom of Saudi Arabia</span><span>Passport · P</span></div>
              <div className="pp-main">
                <div className="pp-photo"><svg viewBox="0 0 60 76" width="100%" height="100%"><circle cx="30" cy="30" r="13" fill="#b9ad98" /><path d="M6 76c2-17 12-25 24-25s22 8 24 25z" fill="#b9ad98" /></svg></div>
                <div className="pp-fields">
                  <span><i>Surname</i>ALHARBI</span>
                  <span><i>Given names</i>OMAR</span>
                  <span className="pp-two"><span><i>No.</i>A08•••41</span><span><i>Expires</i>22 JUN 2031</span></span>
                </div>
              </div>
              <div className="pp-mrz">{MRZ.omar[0]}{'\n'}{MRZ.omar[1]}</div>
              <div className="pp-beam" />
            </div>
            <div className="pp-form">
              <div className="pp-form-head"><img src="img/airlines/SV.svg" alt="" style={{ height: 14 }} /><span>Saudia · Passenger 1</span><span className="pp-auto">Filled by your scan</span></div>
              {[['Name on ticket', 'OMAR ALHARBI', '.9s'], ['Passport', 'A08•••41 · Saudi', '1.5s'], ['Valid for this trip', 'Until June 2031', '2.1s']].map(([k, v, d]) => (
                <div key={k} className="pp-row" style={{ animationDelay: d }}>
                  <span className="pp-k">{k}</span>
                  <span className="pp-v">{v}</span>
                  <span className="pp-tick"><Icon name="check" size={12} color="#1e352d" width={2.6} /></span>
                </div>
              ))}
            </div>
          </div>
          <h1 className="h1">Scan it once. Never type it again.</h1>
          <p className="body">Every flight, hotel and visa fills itself in from now on, for you and everyone you travel with.</p>
          <div className="row small" style={{ gap: 8, color: '#3f4f48' }}><Icon name="lock" size={16} /><span>Encrypted on this phone. Opened only when Mada books for you.</span></div>
        </div>
        <div className="act">
          <button type="button" className="btn primary block" onClick={() => setSheet('camera')}><Icon name="scan" color="#d9b77a" />Scan passport</button>
          <button type="button" className="btn ghost block" onClick={() => { byHand(); goto('confirm'); }}>Enter it by hand</button>
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
            <button type="button" className="btn primary block" onClick={() => { setSheet(null); byHand(); goto('confirm'); }}>Enter it by hand</button>
            <button type="button" className="btn ghost block" onClick={() => { setSheet(null); setPassportLater(true); goto('household'); }}>Do it later</button>
          </Sheet>
        )}
      </div>
    ),

    camera: (
      <div className="camera">
        <TopBar onBack={back} backLabel="Cancel" dark />
        <div className="scroll no-dock" style={{ padding: '30px 0 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div className="viewfinder" style={{ flexShrink: 0 }}>
            {photo && scanState === 'reading' && <img src={photo} alt="Your passport photo" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 85%', opacity: 0.9 }} />}
            {(scanState === 'demo' || scanState === 'reading') && <span className="scanline" />}
            {scanState !== 'reading' && <div style={{ position: 'absolute', left: 16, right: 16, bottom: 16, fontFamily: 'var(--f-mono)', fontSize: 10, color: 'rgba(233,226,216,.35)', whiteSpace: 'pre', overflow: 'hidden' }}>{MRZ.omar[0]}{'\n'}{MRZ.omar[1]}</div>}
          </div>
          {scanState === 'choose' && (
            <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, padding: '0 4px 4px' }}>
                <span className="h3" style={{ color: '#f6f2ec' }}>Photograph the photo page</span>
                <span className="small" style={{ color: '#b8b0a3' }}>Flat on a table, no glare, with the two lines at the bottom in the shot.</span>
              </div>
              <label className="btn gold block" style={{ position: 'relative', cursor: 'pointer', boxSizing: 'border-box' }}>
                <Icon name="scan" color="#1e352d" />Take a photo
                <input type="file" accept="image/*" capture="environment" style={hidden} onChange={(e) => { readPhoto(e.target.files && e.target.files[0]); e.target.value = ''; }} />
              </label>
              <label className="btn on-dark block" style={{ position: 'relative', cursor: 'pointer', boxSizing: 'border-box' }}>
                Choose a photo
                <input type="file" accept="image/*" style={hidden} onChange={(e) => { readPhoto(e.target.files && e.target.files[0]); e.target.value = ''; }} />
              </label>
              {fileErr && <span className="small" role="alert" style={{ color: '#e6c88f', textAlign: 'center' }}>{fileErr}</span>}
              <button type="button" className="btn ghost block" style={{ color: '#d6cfc3' }} onClick={() => { setFileErr(null); setScanState('demo'); }}>Use the demo passport</button>
              <span className="tiny" style={{ color: '#8f887c', textAlign: 'center' }}>Read on this phone. The photo isn't uploaded or kept.</span>
            </div>
          )}
          {scanState === 'demo' && (
            <div style={{ padding: '0 28px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span className="h3" style={{ color: '#f6f2ec' }}>Hold the photo page in the frame</span>
              <span className="small" style={{ color: '#b8b0a3' }}>Reading the two lines at the bottom…</span>
            </div>
          )}
          {scanState === 'reading' && (
            <div style={{ padding: '0 28px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10 }} aria-live="polite">
              <span className="h3" style={{ color: '#f6f2ec' }}>Reading your passport…</span>
              <div role="progressbar" aria-label="Reading your passport" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} style={{ height: 6, borderRadius: 999, background: 'rgba(233,226,216,.14)', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${progress}%`, background: '#d9b77a', borderRadius: 999, transition: 'width .3s var(--ease)' }} />
              </div>
              <span className="small num" style={{ color: '#b8b0a3' }}>{progress < 30 ? 'Getting ready. The first scan takes a few seconds longer.' : 'Looking for the two lines at the bottom.'} {progress}%</span>
            </div>
          )}
          {scanState === 'failed' && (
            <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 12 }} role="alert">
              <span className="h2" style={{ color: '#f6f2ec' }}>We couldn't read it.</span>
              {failWhy
                ? <span className="body" style={{ color: '#d6cfc3' }}>{failWhy}</span>
                : (
                  <ul className="body" style={{ color: '#d6cfc3', margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <li>Lay the passport flat on a table.</li>
                    <li>No glare. Turn away from lamps and windows.</li>
                    <li>Get the whole photo page in, including the two lines at the bottom.</li>
                  </ul>
                )}
              <button type="button" className="btn gold block" onClick={() => { setFailWhy(null); setScanState('choose'); }}>Try again</button>
              <button type="button" className="btn on-dark block" onClick={() => { byHand(); setStep('confirm'); }}>Enter it by hand</button>
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
          {fromPhoto && (
            <div className="notice" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 16, background: '#f6f2ec' }}>
              <Icon name="scan" size={18} color="#1e352d" />
              <span className="small" style={{ color: '#1e352d' }}>Read from your photo. Check every letter.{doubt.length ? ` ${doubt.length === 1 ? 'One detail' : `${doubt.length} details`} may not have read right.` : ''}</span>
            </div>
          )}
          {[['given', 'Given names'], ['surname', 'Surname'], ['number', 'Passport number'], ['nationality', 'Nationality'], ['dob', 'Date of birth (DD/MM/YYYY)'], ['expiry', 'Expiry date (DD/MM/YYYY)']].map(([k, lbl]) => {
            const unsure = fromPhoto && doubt.includes(k);
            return (
              <div className="field" key={k}>
                <label htmlFor={'pp-' + k}>{lbl}</label>
                <input id={'pp-' + k} className="input" value={fields[k]} aria-describedby={unsure ? 'pp-' + k + '-check' : undefined}
                  style={unsure ? { borderColor: '#d9b77a', boxShadow: '0 0 0 3px rgba(217,183,122,.28)' } : undefined}
                  onChange={(e) => { setFields({ ...fields, [k]: e.target.value }); if (unsure) setDoubt(doubt.filter((x) => x !== k)); }} autoCapitalize="characters" />
                {unsure && <span id={'pp-' + k + '-check'} style={{ fontSize: 13, color: '#7d5d27', fontWeight: 600 }}>Check this. It may not have read right.</span>}
                {k === 'expiry' && badDate && <span className="err">Use the format DD/MM/YYYY, for example 22/06/2031.</span>}
              </div>
            );
          })}
          {expired && (
            <div className="notice warn" role="alert">
              <Icon name="visa" color="#7d5d27" />
              <div className="grow"><span className="h3">This passport has expired.</span><span className="small">We'll save it, but it can't be used to travel. Mada can help you renew it.</span></div>
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
          <button type="button" className="btn secondary block" onClick={() => setSheet('addPerson')}><Icon name="plus" />Someone else</button>
          {household.filter((id) => !['hessa', 'sara', 'ahmed', 'lina'].includes(id)).map((id) => <div key={id} className="card selected" style={{ flexDirection: 'row', alignItems: 'center' }}><span className="avatar green">{PEOPLE[id].initial}</span><span className="grow col" style={{ gap: 0 }}><span className="h3">{PEOPLE[id].name}</span><span className="small">{PEOPLE[id].role}</span></span><span className="pill" style={{ background: '#1e352d', color: '#f6f2ec' }}>Added</span></div>)}
          {sheet === 'addPerson' && <AddPersonSheet onClose={() => setSheet(null)} onAdded={(p) => { setHousehold((h) => [...h, p.id]); setSheet(null); }} />}
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
          <div aria-hidden="true" style={{ position: 'relative', height: 300, borderRadius: 32, overflow: 'hidden', background: 'linear-gradient(160deg, #2a4a40 0%, #1e352d 55%, #142720 100%)', padding: '22px 14px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <img src="img/istanbul.jpg" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.28 }} />
            <div style={{ position: 'relative', textAlign: 'center', color: '#f6f2ec', marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>Tuesday 9 March</div>
              <div className="num" style={{ fontSize: 54, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1 }}>07:12</div>
            </div>
            {[['Gate changed to C4', 'SV263 now boards from C4. It’s a 6-minute walk.', '.4s'], ['Your driver is here', 'Khalid is at your door in a grey Lexus.', '1.2s'], ['Leave in 15 minutes', 'Traffic to King Khalid is building.', '2s']].map(([t, b, d]) => (
              <div key={t} style={{ position: 'relative', display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 18, background: 'rgba(255,253,249,.88)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', animation: `bannerIn .6s ${d} var(--ease) both` }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: '#1e352d', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Sun width={18} /></span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}><span style={{ fontSize: 13, fontWeight: 600, color: '#1e352d' }}>{t}</span><span style={{ fontSize: 12, color: '#3f4f48' }}>{b}</span></span>
              </div>
            ))}
          </div>
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
          <div aria-hidden="true" style={{ position: 'relative', height: 300, borderRadius: 32, overflow: 'hidden', background: '#f3ece2', boxShadow: 'inset 0 0 0 1px rgba(30,53,45,.06)' }}>
            <svg width="100%" height="100%" viewBox="0 0 340 300" preserveAspectRatio="xMidYMid slice" style={{ position: 'absolute', inset: 0 }}>
              <g stroke="#e3d9ca" strokeWidth="10" fill="none" strokeLinecap="round">
                <path d="M-10 70 L360 40" /><path d="M-10 190 L360 230" /><path d="M90 -10 L60 320" /><path d="M250 -10 L280 320" /><path d="M-10 130 C 120 120, 220 160, 360 150" />
              </g>
              <path id="route" d="M58 236 C 110 230, 120 160, 170 150 S 250 90, 282 62" fill="none" stroke="#1e352d" strokeWidth="4" strokeDasharray="2 9" strokeLinecap="round" />
              <circle cx="58" cy="236" r="9" fill="#1e352d" /><circle cx="58" cy="236" r="4" fill="#f6f2ec" />
              <circle cx="282" cy="62" r="16" fill="#1e352d" />
              <path d="M290 62c0-.5-.4-.9-.9-.9h-3.4l-3.1-4.6h-1.2l1.5 4.6h-2.8l-.9-1.2h-.9l.6 2.1-.6 2.1h.9l.9-1.2h2.8l-1.5 4.6h1.2l3.1-4.6h3.4c.5 0 .9-.4.9-.9z" fill="#d9b77a" transform="translate(-4 0) scale(1.25) translate(-57 -12)" />
              <g>
                <circle r="11" fill="#d9b77a" stroke="#fffdf9" strokeWidth="3" />
                <animateMotion dur="6s" repeatCount="indefinite" rotate="0" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".4 0 .2 1"><mpath href="#route" /></animateMotion>
              </g>
              <text x="70" y="262" fontFamily="Inter Tight, sans-serif" fontSize="12" fontWeight="600" fill="#1e352d">Home</text>
              <text x="236" y="98" fontFamily="Inter Tight, sans-serif" fontSize="12" fontWeight="600" fill="#1e352d">King Khalid</text>
            </svg>
            <div style={{ position: 'absolute', left: 14, top: 14, padding: '8px 12px', borderRadius: 16, background: '#1e352d', color: '#f6f2ec', display: 'flex', flexDirection: 'column', gap: 1, boxShadow: '0 10px 24px -14px rgba(15,26,22,.7)' }}>
              <span style={{ fontSize: 11, color: '#d9b77a', fontWeight: 600 }}>LEAVE AT</span>
              <span className="num" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>07:05</span>
              <span style={{ fontSize: 11, color: '#c9c1b4' }}>31 min · traffic is light</span>
            </div>
          </div>
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

  if (s.account?.signedOut && step === 'welcome') return <WelcomeBack onSomeoneElse={() => { set((p) => ({ account: { ...(p.account || {}), signedOut: false } })); }} />;
  return <div key={step} className="push" style={{ position: 'absolute', inset: 0 }}>{screens[step]}</div>;
}

import { People, NewCircle, Friend, Saved, Join } from './screens/Social.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider, useStore, PHASES, DEMO_SWITCHES, FLIGHTS, seedTrip, withDemo, buzz, HAPTIC } from './store.jsx';
import { Dock, Icon, Sun } from './ui.jsx';
import Onboarding from './screens/Onboarding.jsx';
import Today from './screens/Today.jsx';
import Ask from './screens/Ask.jsx';
import Pay, { Waiting, commitBooking } from './screens/Pay.jsx';
import Trips, { TripDetail } from './screens/Trips.jsx';
import Disruption from './screens/Disruption.jsx';
import Wallet from './screens/Wallet.jsx';
import Circles, { Group } from './screens/Circles.jsx';
import Profile from './screens/Profile.jsx';
import Plan from './screens/Plan.jsx';
import { SCREENS as ACCOUNT_SCREENS } from './screens/Account.jsx';
import { SCREENS as TRIP_SCREENS } from './screens/TripManage.jsx';
import { SCREENS as SUPPORT_SCREENS } from './screens/Support.jsx';

const TABS = { today: Today, trips: Trips, circles: Circles, wallet: Wallet };
const STACK = { join: Join, saved: Saved, people: People, newCircle: NewCircle, friend: Friend, ask: Ask, pay: Pay, waiting: Waiting, trip: TripDetail, disruption: Disruption, group: Group, profile: Profile, plan: Plan, ...ACCOUNT_SCREENS, ...TRIP_SCREENS, ...SUPPORT_SCREENS };

/* Moves requests and refunds along over time, the way Faisal's replies and the airlines would. */
function useBackgroundProgress() {
  const { s, set, banner } = useStore();
  const prevOffline = useRef(s.demo.offline);
  useEffect(() => {
    if (prevOffline.current && !s.demo.offline) {
      set((p) => ({ requests: p.requests.map((r) => (r.status === 'queued' ? { ...r, status: 'sent', created: Date.now() } : r)) }));
    }
    prevOffline.current = s.demo.offline;
  }, [s.demo.offline]);
  useEffect(() => {
    if (s.demo.offline) return undefined;
    const t = setInterval(() => {
      const now = Date.now();
      set((p) => {
        let changed = false;
        const requests = p.requests.map((r) => {
          const age = now - (r.created || now);
          if (r.status === 'sent' && age > 4000) { changed = true; return { ...r, status: 'reviewing' }; }
          if (r.status === 'reviewing' && age > 9000) { changed = true; setTimeout(() => banner({ title: 'Mada replied', body: `Your ${r.short}: tap to see it.`, haptic: HAPTIC.knock, to: { tab: 'trips' }, kind: 'reply' }), 0); return { ...r, status: 'quote' }; }
          if (r.status === 'paid' && age > 15000) { changed = true; return { ...r, status: 'done' }; }
          return r;
        });
        const refunds = p.refunds.map((r) => {
          if (r.stage < 2 && !r.t) { changed = true; return { ...r, t: now }; }
          if (r.stage === 0 && now - r.t > 5000) { changed = true; return { ...r, stage: 1 }; }
          if (r.stage === 1 && now - r.t > 11000) { changed = true; setTimeout(() => banner({ title: 'Refund sent', body: `SAR ${Math.round(r.amount).toLocaleString('en-US')} is on its way to your card.`, haptic: HAPTIC.soft, to: { tab: 'trips' }, kind: 'money' }), 0); return { ...r, stage: 2 }; }
          return r;
        });
        let pendingBooking = p.pendingBooking;
        if (pendingBooking && now - pendingBooking.at > 6000) {
          changed = true;
          const pb = pendingBooking;
          pendingBooking = null;
          setTimeout(() => { commitBooking(set, pb); banner({ title: 'Confirmed by Faisal', body: `${pb.kind === 'stay' ? 'Your rooms are booked' : pb.kind === 'change' ? 'Your flight is changed' : 'You’re going'}. Booking ${pb.ref}.`, haptic: HAPTIC.success, to: { tab: 'trips' }, kind: 'booking' }); }, 0);
        }
        return changed ? { requests, refunds, pendingBooking } : {};
      });
    }, 1000);
    return () => clearInterval(t);
  }, [s.demo.offline]);
}

function Phone() {
  const store = useStore();
  const { s, bannerMsg, toastMsg, dismissBanner, openBanner, set } = store;
  useEffect(() => { window.__madaPush = (name, params) => store.push(name, params || {}); });
  /* An invite link (…#join/ist-8k2) opens the invite, for new and signed-in people alike. */
  useEffect(() => {
    const m = /#join\/([\w-]+)/.exec(window.location.hash || '');
    if (!m) return;
    if (s.onboarded) store.push('join', { code: m[1] }); else set({ pendingInvite: m[1] });
  }, []);
  useBackgroundProgress();
  useEffect(() => { if (s.tab !== 'wallet' && s.walletUnlocked) set({ walletUnlocked: false }); }, [s.tab]);
  const top = s.stack[s.stack.length - 1];
  const TabScreen = TABS[s.tab] || Today;
  const Top = top ? STACK[top.name] : null;
  return (
    <div className="phone" aria-label="Mada Trips app">
      <div className="app">
        {!s.onboarded ? <Onboarding /> : (
          <>
            <div style={{ position: 'absolute', inset: 0 }} {...(top ? { inert: '', 'aria-hidden': 'true' } : {})}>
              <TabScreen />
              {!top && <Dock />}
            </div>
            {s.stack.map((st, i) => {
              const C = STACK[st.name];
              const covered = i < s.stack.length - 1;
              return C ? <div key={st.key} style={{ position: 'absolute', inset: 0, zIndex: 10 + i }} {...(covered ? { inert: '', 'aria-hidden': 'true' } : {})}><C params={st.params} /></div> : null;
            })}
          </>
        )}
        {s.demo.offline && s.onboarded && (
          <div className="offline" style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 80, paddingTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }} role="status">
            <Icon name="wifiOff" size={16} color="#f6f2ec" />You're offline. Everything for your trips is on this phone.
          </div>
        )}
        {bannerMsg && (
          <button type="button" className="banner" key={bannerMsg.id} onClick={() => (bannerMsg.to ? openBanner(bannerMsg) : dismissBanner())} aria-live="polite">
            <span className="app-ic"><Sun width={24} /></span>
            <span className="col" style={{ gap: 2 }}><span className="h3" style={{ fontSize: 15 }}>{bannerMsg.title}</span><span className="small" style={{ color: '#3f4f48' }}>{bannerMsg.body}</span></span>
          </button>
        )}
        {toastMsg && <div className="toast" key={toastMsg.id} role="status">{toastMsg.text}</div>}
      </div>
    </div>
  );
}

function Demo() {
  const { s, set, hardReset, banner } = useStore();
  const [open, setOpen] = useState(false);
  /* "Skip sign-up" always starts the demo account (Omar's family). A phase jump keeps whoever is signed in,
     and only brings in the demo account when nobody is. */
  const jump = (phase, demoAccount) => {
    buzz(HAPTIC.tap);
    set((p) => {
      const signedIn = p.onboarded && !p.guest && !demoAccount;
      const acct = signedIn ? {} : withDemo(p);
      const cur = { ...p, ...acct };
      const household = cur.household.length ? cur.household : ['omar'];
      const base = { ...acct, onboarded: true, guest: false, household, passportSaved: signedIn ? p.passportSaved : true, stack: [], tab: 'today' };
      if (phase === 'none') return { ...base, phase: 'none', trip: signedIn ? p.trip : null };
      const trip = signedIn && p.trip && p.trip.flight ? { ...p.trip } : seedTrip({ ...cur, household });
      if (phase === 'travelday' || phase === 'delayed' || phase === 'cancelled') {
        /* Undo a rebooking from the disruption flow: back to the flight that was booked, same dates and seats. */
        if (trip.rebooked) { const f0 = FLIGHTS.find((x) => x.id === trip.flightId) || FLIGHTS[0]; trip.flight = { ...trip.flight, code: f0.code, dep: f0.dep, arr: f0.arr, dur: f0.dur, from: f0.from, to: f0.to }; }
        delete trip.rebooked;
      }
      return { ...base, trip, phase };
    });
    /* The banners name the flight and the driver that are actually booked. */
    const f = (s.onboarded && !s.guest && s.trip?.flight) || FLIGHTS[0];
    const arrive = s.onboarded && !s.guest && s.trip ? s.trip.pickup?.arrive : { driver: 'Ahmet', door: 'Door 3' };
    if (phase === 'delayed') setTimeout(() => banner({ title: `${f.code} may leave late`, body: 'The plane coming from Cairo is late. We have a plan ready.', to: { push: ['disruption', { kind: 'delay' }] } }), 600);
    if (phase === 'cancelled') setTimeout(() => banner({ title: `${f.airline} cancelled ${f.code}`, body: 'We’re holding seats on two other flights. Tap to choose.', to: { push: ['disruption', { kind: 'cancel' }] } }), 600);
    if (phase === 'landed') setTimeout(() => banner(arrive?.driver ? { title: `${arrive.driver} is at ${arrive.door || 'Door 3'}`, body: 'He has a sign with your name. Bags on carousel 7.', haptic: HAPTIC.soft } : { title: 'Welcome to Istanbul', body: 'Bags on carousel 7. Your ways to the hotel are in Today.', haptic: HAPTIC.soft }), 600);
    setOpen(false);
  };
  return (
    <>
      <button type="button" className="demo-fab" onClick={() => setOpen(!open)}>{open ? 'Close demo' : 'Demo'}</button>
      <aside className="demo" data-open={open ? 'true' : 'false'} aria-label="Demo controls">
        <div className="col" style={{ gap: 6 }}>
          <h2>Mada Trips · clickable prototype</h2>
          <p>Every screen works. Use these controls to jump through a trip and to trigger the hard cases. Nothing here is real: no bookings, payments or messages leave this page.</p>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <h3>Start</h3>
          <div className="demo-grid">
            <button type="button" className="demo-btn" onClick={() => { hardReset(); setOpen(false); }}>Fresh install</button>
            <button type="button" className="demo-btn" onClick={() => jump('none', true)}>Skip sign-up</button>
            <button type="button" className="demo-btn" onClick={() => { hardReset(); setTimeout(() => set({ pendingInvite: 'ist-8k2' }), 0); setOpen(false); }}>Invite link, new to Mada</button>
            <button type="button" className="demo-btn" onClick={() => { if (!s.onboarded) jump('none', true); setTimeout(() => window.__madaPush('join', { code: 'ist-8k2' }), 50); setOpen(false); }}>Invite link, signed in</button>
            <button type="button" className="demo-btn" onClick={() => { if (!s.onboarded) jump('none', true); setTimeout(() => window.__madaPush('join', { code: 'old-4q1' }), 50); setOpen(false); }}>Expired invite link</button>
          </div>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <h3>Jump to a moment</h3>
          <div className="demo-grid">
            {PHASES.filter((p) => p.id !== 'none').map((p) => (
              <button key={p.id} type="button" className="demo-btn" aria-pressed={s.onboarded && s.phase === p.id ? 'true' : 'false'} onClick={() => jump(p.id)}>{p.label}</button>
            ))}
          </div>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <h3>Make it go wrong</h3>
          <div className="demo-grid">
            {DEMO_SWITCHES.map((d) => (
              <button key={d.id} type="button" className="demo-btn" aria-pressed={s.demo[d.id] ? 'true' : 'false'} onClick={() => { buzz(HAPTIC.tap); set((p) => ({ demo: { ...p.demo, [d.id]: !p.demo[d.id] } })); }}>{d.label}</button>
            ))}
          </div>
        </div>
        <p>Sign-in code: <b>123456</b>. Passcode: any 6 digits. Vibration works on Android browsers; the app uses native haptics.</p>
      </aside>
    </>
  );
}

function App() {
  return (
    <StoreProvider>
      <div className="stage">
        <Phone />
        <Demo />
      </div>
    </StoreProvider>
  );
}

createRoot(document.getElementById('root')).render(<App />);

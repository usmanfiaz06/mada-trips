import { People, NewCircle, Friend, Saved, Join } from './screens/Social.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider, useStore, PHASES, DEMO_SWITCHES, FLIGHTS, seedTrip, withDemo, buzz, HAPTIC, outboxItems } from './store.jsx';

/* What a phone sign-up with no passport and no name leaves: signed in, and nothing else. */
const emptyAccount = () => ({
  onboarded: true, guest: false, demoSeed: false,
  user: { name: '', full: '' }, household: ['omar'], passportSaved: false, notifications: false,
  account: { signedOut: false, phone: { digits: '512345678', source: 'signup', at: Date.now() }, methods: { apple: false, google: false, phone: true } },
  tab: 'today', stack: [],
});
import { Dock, Icon, Sun, NetPill, OutboxSheet, LoadingVeil, MaintenanceScreen, UpdateScreen, SessionSheet, RateLimitSheet, ErrorBoundary, Crasher, CrashScreen, NotFound, useImageFallback } from './ui.jsx';
import { GALLERY } from './gallery.jsx';
import { initLang, setLang, useLang } from './lang.jsx';
import Onboarding from './screens/Onboarding.jsx';
import Today from './screens/Today.jsx';
import Ask from './screens/Ask.jsx';
import Pay, { Waiting, commitBooking } from './screens/Pay.jsx';
import Trips, { TripDetail } from './screens/Trips.jsx';
import Disruption, { applyDisruptionChoice } from './screens/Disruption.jsx';
import Wallet from './screens/Wallet.jsx';
import Circles, { Group } from './screens/Circles.jsx';
import Profile from './screens/Profile.jsx';
import Plan from './screens/Plan.jsx';
import City from './screens/City.jsx';
import { SCREENS as ACCOUNT_SCREENS } from './screens/Account.jsx';
import { SCREENS as TRIP_SCREENS } from './screens/TripManage.jsx';
import { SCREENS as SUPPORT_SCREENS } from './screens/Support.jsx';

const TABS = { today: Today, trips: Trips, circles: Circles, wallet: Wallet };
const STACK = { passportSetup: Onboarding, join: Join, saved: Saved, people: People, newCircle: NewCircle, friend: Friend, ask: Ask, pay: Pay, waiting: Waiting, trip: TripDetail, disruption: Disruption, group: Group, profile: Profile, plan: Plan, city: City, ...ACCOUNT_SCREENS, ...TRIP_SCREENS, ...SUPPORT_SCREENS, notFound: NotFound };

/* Moves requests and refunds along over time, the way Faisal's replies and the airlines would. */
function useBackgroundProgress() {
  const { s, set, banner, toast } = useStore();
  const prevOffline = useRef(s.demo.offline);
  useEffect(() => {
    if (prevOffline.current && !s.demo.offline) {
      /* Back online: everything in the Outbox goes, and we say how many. */
      const n = outboxItems(s).filter((x) => x.state !== 'failed' && x.ref.type !== 'outbox').length;
      if (n) setTimeout(() => toast(`Back online. Sent ${n === 1 ? '1 thing' : n + ' things'} you did offline.`), 900);
      set((p) => ({
        support: (p.support || []).map((m) => (m.queued ? { ...m, queued: false } : m)),
        tripRequests: (p.tripRequests || []).map((r) => (r.queued ? { ...r, queued: false, created: Date.now() } : r)),
        requestThreads: Object.fromEntries(Object.entries(p.requestThreads || {}).map(([k, th]) => [k, (th || []).map((m) => (m.queued ? { ...m, queued: false } : m))])),
      }));
      set((p) => ({ requests: p.requests.map((r) => (r.status === 'queued' ? { ...r, status: 'sent', created: Date.now() } : r)) }));
      if (s.disruptionQueue) { applyDisruptionChoice(set, s.disruptionQueue); setTimeout(() => banner({ title: 'Your choice reached Faisal', body: 'Sent now you’re back online. He’s confirming it with the airline.', to: { tab: 'today' } }), 0); }
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

/* The app-level things that can go wrong, layered over whatever screen is open. */
function useAppStates(s, set) {
  const outbox = !!s.outboxOpen;
  const setOutbox = (v) => set({ outboxOpen: v });
  const [maintOpen, setMaintOpen] = useState(true);
  const [crashKey, setCrashKey] = useState(0);
  const [flushing, setFlushing] = useState(0);
  const loaded = useRef(new Set());
  const prevOff = useRef(s.demo.offline);
  useEffect(() => { if (s.demo.maintenance) setMaintOpen(true); }, [s.demo.maintenance]);
  const wasCrashed = useRef(!!s.demo.crashed);
  useEffect(() => { if (wasCrashed.current && !s.demo.crashed) setCrashKey((k) => k + 1); wasCrashed.current = !!s.demo.crashed; }, [s.demo.crashed]);
  useEffect(() => { if (!s.demo.weak) loaded.current = new Set(); }, [s.demo.weak]);
  /* Reconnecting: the pill says "Sending" for a moment while the Outbox empties. */
  useEffect(() => {
    if (prevOff.current && !s.demo.offline) {
      const n = outboxItems(s).filter((x) => x.state !== 'failed' && x.ref.type !== 'outbox').length;
      if (n) { setFlushing(n); setTimeout(() => setFlushing(0), 1400); }
    }
    prevOff.current = s.demo.offline;
  }, [s.demo.offline]);
  useImageFallback(!!s.demo.imagesFail);
  return { outbox, setOutbox, maintOpen, setMaintOpen, crashKey, setCrashKey, flushing, loaded };
}

function Phone() {
  const store = useStore();
  const { s, bannerMsg, toastMsg, dismissBanner, openBanner, set } = store;
  const app = useAppStates(s, set);
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
  const navKey = `${s.tab}|${top ? top.key : ''}`;
  return (
    <div className="phone" aria-label="Mada Trips app">
      <div className={'app' + (s.demo.weak && !s.demo.offline ? ' net-weak' : '')}>
        <ErrorBoundary key={app.crashKey} fallback={() => (
          <CrashScreen
            onRestart={() => { set((p) => ({ demo: { ...p.demo, crashed: false }, tab: 'today', stack: [] })); app.setCrashKey((k) => k + 1); }}
            onTalk={() => { set((p) => ({ demo: { ...p.demo, crashed: false }, stack: [{ name: 'support', params: {}, key: Date.now() }] })); app.setCrashKey((k) => k + 1); }} />
        )}>
        <Crasher />
        {!s.onboarded ? <Onboarding /> : (
          <>
            <div style={{ position: 'absolute', inset: 0 }} {...(top ? { inert: '', 'aria-hidden': 'true' } : {})}>
              <TabScreen />
              {!top && <Dock />}
            </div>
            {s.stack.map((st, i) => {
              const C = STACK[st.name];
              const covered = i < s.stack.length - 1;
              /* A link to a screen that doesn't exist (an old or deleted link) gets the not-found screen, never a blank. */
              const Screen = C || NotFound;
              return <div key={st.key} style={{ position: 'absolute', inset: 0, zIndex: 10 + i }} {...(covered ? { inert: '', 'aria-hidden': 'true' } : {})}><Screen params={C ? st.params : { what: 'page' }} /></div>;
            })}
            {s.demo.weak && !s.demo.offline && !app.loaded.current.has(navKey) && (
              <div style={{ position: 'absolute', inset: 0, zIndex: top ? 10 + s.stack.length : 19, pointerEvents: 'none' }}>
                <div style={{ pointerEvents: 'auto' }}>
                  <LoadingVeil key={navKey} stacked={!!top}
                    onDone={() => { app.loaded.current.add(navKey); }}
                    onCancel={() => { app.loaded.current.add(navKey); if (top) store.pop(); else store.toast('Stopped. Showing what’s saved on this phone.'); }} />
                </div>
              </div>
            )}
          </>
        )}
        </ErrorBoundary>
        {s.onboarded && !s.demo.crashed && (() => {
          const items = outboxItems(s);
          const failed = items.filter((x) => x.state === 'failed').length;
          const mode = app.flushing ? 'sending' : s.demo.offline ? 'offline' : s.demo.serverDown ? 'down' : s.demo.weak ? 'weak' : s.demo.maintenance && !app.maintOpen ? 'maint' : failed ? 'held' : null;
          if (!mode) return null;
          return <NetPill mode={mode} count={app.flushing || (mode === 'held' ? failed : items.length)} label={mode === 'maint' ? 'Maintenance until 03:00 · booking paused' : undefined} onClick={() => (mode === 'maint' ? app.setMaintOpen(true) : app.setOutbox(true))} />;
        })()}
        {app.outbox && <OutboxSheet onClose={() => app.setOutbox(false)} />}
        {s.onboarded && s.demo.maintenance && app.maintOpen && <MaintenanceScreen onOpenTrips={() => { app.setMaintOpen(false); set({ tab: 'trips', stack: [] }); }} />}
        {s.onboarded && s.demo.updateRequired && <UpdateScreen onUpdate={() => { set((p) => ({ demo: { ...p.demo, updateRequired: false } })); store.toast('Updated. You’re on Mada 1.1, right where you left off.'); }} />}
        {s.onboarded && s.demo.sessionExpired && <SessionSheet onDone={() => { set((p) => ({ demo: { ...p.demo, sessionExpired: false } })); store.toast('Signed back in. Everything is where you left it.'); }} />}
        {s.demo.rateLimited && <RateLimitSheet key="rl" onDone={() => set((p) => ({ demo: { ...p.demo, rateLimited: false } }))} onClose={() => set((p) => ({ demo: { ...p.demo, rateLimited: false } }))} />}
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
  const { s, set, hardReset, banner, push, go, toast, dismissBanner } = useStore();
  const [open, setOpen] = useState(false);
  const [gal, setGal] = useState(null);
  const sRef = useRef(s);
  sRef.current = s;
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
  const toggle = (id) => { buzz(HAPTIC.tap); set((p) => ({ demo: { ...p.demo, [id]: !p.demo[id] } })); };
  /* The walkthrough: every step starts clean, then sets up one state. */
  const runStep = async (i) => {
    setGal(i);
    setOpen(false);
    toast(null);
    dismissBanner();
    const clear = Object.fromEntries(DEMO_SWITCHES.map((d) => [d.id, false]));
    const ctx = {
      get s() { return sRef.current; },
      set, push, go,
      jump: (phase, demoAcct) => jump(phase, demoAcct),
      flags: (on) => set((p) => ({ demo: { ...p.demo, ...clear, ...on } })),
    };
    set((p) => ({ demo: { ...p.demo, ...clear }, stack: [], outbox: [], pendingBooking: null, support: (p.support || []).filter((m) => !String(m.id).startsWith('g-')), requests: (p.requests || []).filter((r) => r.id !== 'g-rq'), walletUnlocked: false, outboxOpen: false, tab: 'today' }));
    await new Promise((r) => setTimeout(r, 120));
    try { await GALLERY[i].run(ctx); } catch (e) { /* a step that can't reach its screen still leaves the switches set */ }
  };
  const endGallery = () => { setGal(null); set((p) => ({ demo: { ...p.demo, ...Object.fromEntries(DEMO_SWITCHES.map((d) => [d.id, false])) }, stack: [], outbox: [], pendingBooking: null })); };
  const bar = (where) => gal !== null && (
        <div className={'gallery-bar ' + where} role="region" aria-label="When things go wrong">
          <span className="gb-count">When things go wrong · {gal + 1} of {GALLERY.length}</span>
          <span className="gb-title">{GALLERY[gal].title}</span>
          <span className="gb-note">{GALLERY[gal].note}</span>
          <div className="gb-row">
            <button type="button" onClick={() => runStep(gal - 1)} disabled={gal === 0} aria-label="Previous state">Back</button>
            <button type="button" className="next" onClick={() => (gal === GALLERY.length - 1 ? endGallery() : runStep(gal + 1))}>{gal === GALLERY.length - 1 ? 'Done' : 'Next state'}</button>
            <button type="button" onClick={endGallery} aria-label="End the walkthrough">End</button>
          </div>
        </div>
  );
  return (
    <>
      {bar('floating')}
      <button type="button" className="demo-fab" onClick={() => setOpen(!open)}>{open ? 'Close demo' : 'Demo'}</button>
      <aside className="demo" data-open={open ? 'true' : 'false'} aria-label="Demo controls" data-no-translate="">
        {bar('in-panel')}
        <div className="col" style={{ gap: 6 }}>
          <h2>Mada Trips · clickable prototype</h2>
          <p>Every screen works. Use these controls to jump through a trip and to trigger the hard cases. Nothing here is real: no bookings, payments or messages leave this page.</p>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <h3>Start</h3>
          <div className="demo-grid">
            <button type="button" className="demo-btn" onClick={() => { hardReset(); setOpen(false); }}>Fresh install</button>
            <button type="button" className="demo-btn" onClick={() => jump('none', true)}>Skip sign-up</button>
            <button type="button" className="demo-btn" onClick={() => { const keep = s.demo; hardReset(); setTimeout(() => set({ ...emptyAccount(), demo: keep }), 0); setOpen(false); }}>Empty account</button>
            <button type="button" className="demo-btn" onClick={() => { hardReset(); setTimeout(() => set({ pendingInvite: 'ist-8k2' }), 0); setOpen(false); }}>Invite link, new to Mada</button>
            <button type="button" className="demo-btn" onClick={() => { if (!s.onboarded) jump('none', true); setTimeout(() => window.__madaPush('join', { code: 'ist-8k2' }), 50); setOpen(false); }}>Invite link, signed in</button>
            <button type="button" className="demo-btn" onClick={() => { if (!s.onboarded) jump('none', true); setTimeout(() => window.__madaPush('join', { code: 'old-4q1' }), 50); setOpen(false); }}>Expired invite link</button>
            <button type="button" className="demo-btn" onClick={() => { jump('cancelled'); setTimeout(() => window.__madaPush('disruption', { kind: 'night' }), 700); setOpen(false); }}>Cancelled at night</button>
          </div>
        </div>
        <LangSwitch />
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
          <button type="button" className="demo-btn demo-gallery" onClick={() => runStep(0)}>When things go wrong · walk through all {GALLERY.length}</button>
          <div className="demo-grid">
            {DEMO_SWITCHES.filter((d) => !d.group).map((d) => (
              <button key={d.id} type="button" className="demo-btn" aria-pressed={s.demo[d.id] ? 'true' : 'false'} onClick={() => toggle(d.id)}>{d.label}</button>
            ))}
          </div>
        </div>
        {[['app', 'When the app can’t work'], ['flow', 'Inside a flow']].map(([g, h]) => (
          <div key={g} className="col" style={{ gap: 8 }}>
            <h3>{h}</h3>
            <div className="demo-grid">
              {DEMO_SWITCHES.filter((d) => d.group === g).map((d) => (
                <button key={d.id} type="button" className="demo-btn" aria-pressed={s.demo[d.id] ? 'true' : 'false'} onClick={() => toggle(d.id)}>{d.label}</button>
              ))}
              {g === 'flow' && <>
                <button type="button" className="demo-btn" onClick={() => { if (!s.onboarded) jump('none', true); setTimeout(() => set((p) => ({ pendingBooking: { kind: 'trip', flightId: 'best', travellers: (p.household || ['omar']).filter((id) => id !== 'lina'), bundle: true, search: { type: 'return', dep: 9, ret: 15, month: 'Mar' }, ref: 'K4TQ9M', total: 21380, extra: 0, at: Date.now() + 40000, closed: true, resumeStep: 2 }, tab: 'today', stack: [] })), 60); setOpen(false); }}>App closed mid-booking</button>
                <button type="button" className="demo-btn" onClick={() => { if (!s.onboarded) jump('none', true); setTimeout(() => window.__madaPush('notFound', { what: 'trip' }), 60); setOpen(false); }}>Open a deleted link</button>
              </>}
            </div>
          </div>
        ))}
        <p>Sign-in code: <b>123456</b>. Passcode: any 6 digits. Vibration works on Android browsers; the app uses native haptics.</p>
      </aside>
    </>
  );
}

/** English / العربية: the whole page turns right to left, at once. */
function LangSwitch() {
  const lang = useLang();
  return (
    <div className="col" style={{ gap: 8 }}>
      <h3>Language</h3>
      <div className="demo-grid" data-no-translate="">
        <button type="button" className="demo-btn" aria-pressed={lang === 'en' ? 'true' : 'false'} onClick={() => setLang('en')} data-testid="lang-en">English</button>
        <button type="button" className="demo-btn" lang="ar" aria-pressed={lang === 'ar' ? 'true' : 'false'} onClick={() => setLang('ar')} data-testid="lang-ar">العربية</button>
      </div>
    </div>
  );
}

function App() {
  useEffect(() => { initLang(); }, []);
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

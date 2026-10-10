/* "When things go wrong": a walkthrough of every failure state, for reviewing them in one sitting.
   Each step starts clean (every failure switch off, no screens open), sets up its moment, and says what to look at.
   Steps drive the real screens: they flip the same demo switches and tap the same buttons a person would. */
import { DEMO_SWITCHES } from './store.jsx';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const inPhone = (sel) => document.querySelector('.phone ' + sel);
const textOf = (el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
/* Taps the first button (or tappable card) whose label is exactly `label`, waiting for it to appear. */
export async function tap(label, tries = 30) {
  for (let i = 0; i < tries; i += 1) {
    const all = [...document.querySelectorAll('.phone button, .phone label.card, .phone [role="tab"]')];
    const el = all.find((b) => textOf(b) === label || (b.getAttribute('aria-label') || '') === label) || all.find((b) => textOf(b).startsWith(label));
    if (el) { el.click(); await wait(250); return true; }
    await wait(120);
  }
  return false;
}
export async function tapSel(sel, tries = 30) {
  for (let i = 0; i < tries; i += 1) { const el = inPhone(sel); if (el) { el.click(); await wait(250); return true; } await wait(120); }
  return false;
}
/* Types into a React-controlled input the way a keyboard would. */
export async function typeInto(sel, value) {
  for (let i = 0; i < 30 && !inPhone(sel); i += 1) await wait(120);
  const el = inPhone(sel);
  if (!el) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(120);
}
/* Confirms the slide-to-book with the keyboard (Enter), as a screen reader would. */
export async function pressSlider(times = 1) {
  for (let i = 0; i < 30 && !inPhone('.slider'); i += 1) await wait(120);
  const el = inPhone('.slider');
  if (!el) return;
  for (let k = 0; k < times; k += 1) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

export const FAILURE_IDS = ['offline', 'supplierDown', 'noResults', 'decline', 'priceUp', ...DEMO_SWITCHES.filter((d) => d.group).map((d) => d.id)];

const PAY = (s) => ({ kind: 'trip', flightId: 'best', travellers: (s.household || ['omar']).filter((id) => id !== 'lina'), bundle: true, search: { type: 'return', dep: 9, ret: 15, month: 'Mar' } });
const SEED_QUEUE = (p) => ({
  requests: [...(p.requests || []).filter((r) => r.id !== 'g-rq'), { id: 'g-rq', kind: 'food', short: 'dinner booking', title: 'Dinner for 4 near Galata, Wed 8 pm', detail: 'Window table if they have one', status: 'queued', created: Date.now() }],
  support: [...(p.support || []).filter((m) => m.id !== 'g-sp'), { id: 'g-sp', from: 'me', text: 'Can Sara sit by the window on the way back?', queued: true, at: Date.now() - 60000 }],
});

/* Each step: what it is, where to look, and how to get there. */
export const GALLERY = [
  { id: 'offline', title: 'Offline', note: 'A small pill in the status strip, clear of Back and of banners. Trips, Wallet, passes, itinerary and the address keep working. The badge says it’s the saved copy.',
    run: async ({ jump, flags }) => { jump('booked'); await wait(150); flags({ offline: true }); } },
  { id: 'outbox', title: 'Offline · the Outbox', note: 'Tap the pill: everything waiting to send, with its state. Queued while offline; a stopped upload shows Didn’t send, with Send again and Discard.',
    run: async ({ jump, flags, set }) => {
      jump('booked'); await wait(150);
      set((p) => ({ ...SEED_QUEUE(p), outbox: [{ id: 'g-up', kind: 'upload', title: 'Photo of Hessa’s visa', sub: 'Upload to Wallet', size: '2.4 MB', state: 'failed', why: 'Stopped at 62%. The part that went is kept.', at: Date.now() }] }));
      flags({ offline: true }); await wait(300); await tapSel('.net-pill');
    } },
  { id: 'offline-safe', title: 'Offline · itinerary still opens', note: 'Offline-safe screens open from the phone’s copy: itinerary, boarding passes, the hotel address.',
    run: async ({ jump, flags, push }) => { jump('daybefore'); await wait(150); flags({ offline: true }); await wait(100); push('itinerary'); } },
  { id: 'back-online', title: 'Back online', note: 'The pill says Sending for a moment, then a toast counts what went: “Back online. Sent 2 things you did offline.”',
    run: async ({ jump, flags, set }) => { jump('booked'); await wait(150); set((p) => SEED_QUEUE(p)); flags({ offline: true }); await wait(1600); flags({}); } },
  { id: 'weak', title: 'Weak connection', note: 'Each screen loads under a skeleton. After 4 seconds: “Still working… slower than usual”, with Cancel. Photos arrive blurred, then sharp.',
    run: async ({ jump, flags, go }) => { jump('booked'); await wait(150); flags({ weak: true }); await wait(80); go('trips'); } },
  { id: 'down-today', title: 'Server down · cached', note: 'Mada’s servers aren’t answering. Today shows the saved copy with “Last updated 14 min ago”. Nothing pretends to be live.',
    run: async ({ jump, flags }) => { jump('booked'); await wait(150); flags({ serverDown: true }); } },
  { id: 'down-search', title: 'Server down · an action', note: 'An action that needs the server says so in place, with Try again. The rest of the screen still works.',
    run: async ({ jump, flags, push }) => { jump('none', true); await wait(150); flags({ serverDown: true }); push('ask', { prefill: 'Flights to Istanbul for Eid' }); await wait(600); await tap('These 4'); } },
  { id: 'down-pay', title: 'Server down · paying', note: 'Payments can’t be reached: nothing is charged, the price stays held, Try again sits right above the slider.',
    run: async ({ jump, flags, push, s }) => { jump('none', true); await wait(150); flags({ serverDown: true }); push('pay', PAY(s)); await wait(700); await pressSlider(); } },
  { id: 'down-discover', title: 'Server down · nothing cached', note: 'Discover has no saved copy, so it gets the full calm state: what happened, what still works, Try again.',
    run: async ({ jump, flags, go }) => { jump('booked'); await wait(150); flags({ serverDown: true }); go('circles'); } },
  { id: 'maintenance', title: 'Maintenance', note: 'Planned: the end time, what still works offline, and a person on the phone. “Open my trips” keeps a small pill up top.',
    run: async ({ jump, flags }) => { jump('booked'); await wait(150); flags({ maintenance: true }); } },
  { id: 'update', title: 'Update required', note: 'What’s new in three lines, one Update button, and the reassurance that trips are safe.',
    run: async ({ jump, flags }) => { jump('booked'); await wait(150); flags({ updateRequired: true }); } },
  { id: 'session', title: 'Session expired', note: 'A sheet over the screen you were on. Sign in with the code (123456) and the message you were typing is still there.',
    run: async ({ jump, flags, push }) => { jump('booked'); await wait(150); push('support', {}); await wait(500); await typeInto('#support-msg', 'Can we add a baby seat to the car'); flags({ sessionExpired: true }); } },
  { id: 'rate', title: 'Too many tries', note: 'A short, friendly pause with a countdown. Nothing is locked; there’s a person to call.',
    run: async ({ jump, flags }) => { jump('booked'); await wait(150); flags({ rateLimited: true }); } },
  { id: 'crash', title: 'App crashed', note: 'A real error boundary. “Something broke on our side. Your trips are safe.” Restart, or talk to Mada.',
    run: async ({ jump, flags }) => { jump('booked'); await wait(150); flags({ crashed: true }); } },
  { id: 'pay-drop', title: 'Payment interrupted', note: 'Airplane mode mid-payment: nothing was charged, the price is held for the minutes left, Resume.',
    run: async ({ jump, flags, push, s }) => { jump('none', true); await wait(150); flags({ payDrops: true }); push('pay', PAY(s)); await wait(700); await pressSlider(); } },
  { id: 'double-tap', title: 'Double tap on pay', note: 'The second tap is ignored: the slider locks and says you can only be charged once.',
    run: async ({ jump, flags, push, s }) => { jump('none', true); await wait(150); flags({}); push('pay', PAY(s)); await wait(700); await pressSlider(2); } },
  { id: 'closed', title: 'App closed mid-booking', note: 'On reopen, Today shows the booking still with Faisal, and picks up where it was.',
    run: async ({ jump, set, s }) => { jump('none', true); await wait(150); set({ pendingBooking: { ...PAY(s), ref: 'K4TQ9M', total: 21380, extra: 0, at: Date.now() + 40000, closed: true, resumeStep: 2 } }); } },
  { id: 'images', title: 'Photos don’t load', note: 'Every photo falls back to a tone from its name and its initials. No broken-image icons.',
    run: async ({ jump, flags, go }) => { jump('booked'); await wait(150); flags({ imagesFail: true }); await wait(80); go('circles'); } },
  { id: 'perm-camera', title: 'Camera turned off', note: 'One design for every permission: why it helps, Open Settings, and a way to carry on without it.',
    run: async ({ jump, flags, set, go }) => { jump('booked'); await wait(150); flags({ permissionsDenied: true }); set({ walletUnlocked: true }); go('wallet'); await wait(500); await tap('Add a document'); await tap('Visa'); await tap('Scan with the camera'); } },
  { id: 'perm-contacts', title: 'Contacts turned off', note: 'Same design. The way round: share your invite link.',
    run: async ({ jump, flags, push }) => { jump('booked'); await wait(150); flags({ permissionsDenied: true }); push('people', { add: true }); await wait(500); await tap('From your contacts'); } },
  { id: 'perm-location', title: 'Location turned off', note: 'Same design. The way round: choose your city by hand.',
    run: async ({ jump, flags, go }) => { jump('booked'); await wait(150); flags({ permissionsDenied: true }); go('circles'); await wait(400); await tap('Circles'); await wait(200); await tapSel('.toggle.on-dark'); } },
  { id: 'perm-alerts', title: 'Alerts turned off', note: 'Same design, from Profile. The way round: alerts by SMS.',
    run: async ({ jump, flags, push }) => { jump('booked'); await wait(150); flags({ permissionsDenied: true }); push('profile'); await wait(500); await tapSel('.alerts-off'); } },
  { id: 'not-found', title: 'Link to something deleted', note: 'Says what happened, that nothing of yours changed, and a way back.',
    run: async ({ jump, push }) => { jump('booked'); await wait(150); push('notFound', { what: 'trip' }); } },
  { id: 'timeout', title: 'Search times out', note: 'In place, with the trip details kept. Try again, or ask Mada to search by hand.',
    run: async ({ jump, flags, push }) => { jump('none', true); await wait(150); flags({ searchTimeout: true }); push('ask', { prefill: 'Flights to Istanbul for Eid' }); await wait(600); await tap('These 4'); } },
  { id: 'supplier', title: 'One airline not answering', note: 'Same in-place design: Saudia isn’t answering, the others are. Show the others, or ask Mada.',
    run: async ({ jump, flags, push }) => { jump('none', true); await wait(150); flags({ supplierDown: true }); push('ask', { prefill: 'Flights to Istanbul for Eid' }); await wait(600); await tap('These 4'); } },
  { id: 'chat', title: 'Message didn’t send', note: 'The bubble stays, marked “Didn’t send”, with Send again right on it. The pill offers the Outbox.',
    run: async ({ jump, flags, push }) => { jump('booked'); await wait(150); flags({ sendFails: true }); push('support', {}); await wait(500); await typeInto('#support-msg', 'Is breakfast included at the hotel?'); await tapSel('.support-composer button[type="submit"]'); } },
  { id: 'upload', title: 'Upload stops midway', note: 'Stops at 62% and keeps what went. “Carry on from 62%” starts from there.',
    run: async ({ jump, flags, set, go }) => { jump('booked'); await wait(150); flags({ uploadFails: true }); set({ walletUnlocked: true }); go('wallet'); await wait(500); await tap('Add a document'); await tap('Visa'); await tap('Scan with the camera'); } },
];

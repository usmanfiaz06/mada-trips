/**
 * The app with no signal, and with almost no battery (critique item 14). Offline: say how old what's on screen is,
 * and that what's sent waits. Low battery: one dark screen with only what gets someone onto a plane, into a car and to
 * the hotel, and a way to reach Mada.
 */
export const offlineCopy = {
  // ───────────── offline ─────────────
  'off.had': 'You’re offline. This is what we had at {time}.',
  'off.saved': 'Saved at {time}',
  'off.willSend': 'Will send when you’re online',

  // ───────────── a new version of the web app ─────────────
  'off.newVersion': 'A new version is ready',
  'off.refresh': 'Refresh',

  // ───────────── a search that took too long or needs a sign-in ─────────────
  'wait.signin.title': 'Sign in to see this',
  'wait.signin.body': 'Your session ended. Sign in and you’re back on this same screen.',

  // ───────────── low battery ─────────────
  'lp.entry': 'Low battery? Just the essentials',
  'lp.suggest': 'Battery at {percent}%. Switch to the low-battery screen?',
  'lp.suggestOpen': 'Switch',
  'lp.title': 'Just the essentials',
  'lp.sub': 'Dark and simple, to save your battery.',
  'lp.flight': 'Next flight',
  'lp.flightLine': '{day} · {route} · {time}',
  'lp.leaveIn': 'Leave for the airport in {minutes} min',
  'lp.leaveAt': 'Leave for the airport at {time}',
  'lp.pass': 'Boarding pass · {name}',
  'lp.passNext': 'Next pass ({n} of {count})',
  'lp.ref': 'Booking ref {ref}',
  'lp.seat': 'Seat {seat}',
  'lp.gate': 'Gate {gate}',
  'lp.terminal': 'Terminal {terminal}',
  'lp.driver': 'Your driver',
  'lp.driverAt': 'At {time} · {place}',
  'lp.callDriver': 'Call {driver}',
  'lp.hotel': 'Your hotel · show this to the driver',
  'lp.mada': 'Mada, any hour',
  'lp.callMada': 'Call Mada',
  'lp.callback': 'Ask Mada to call me',
  'lp.callbackBody': 'Please call me back. My battery is low.',
  'lp.callbackBy': 'Mada calls you by {time}.',
  'lp.callbackSent': 'Sent. Mada calls you within 10 minutes.',
  'lp.callbackNoNet': 'No connection. Calls still work: call Mada.',
  'lp.nothing': 'No flight, car or hotel coming up.',
  'lp.back': 'Back to the full app',
} as const;

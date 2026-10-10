/**
 * When things go wrong (FLOWS.md §12): no connection, a weak one, a slow or busy server, a supplier that isn't
 * answering, an update that's needed, maintenance, a crash. COPY.md §5.6 is the standard: say what happened, what
 * still works, and the one thing to do. Calm, no alarm words, nothing that sounds like a system.
 */
export const resilienceCopy = {
  // ───────────── connection ─────────────
  'net.offline.title': 'You’re offline.',
  'net.offline.body': 'This needs a connection. Everything for your trips is still on this phone.',
  'net.offline.retryOnline': 'We’ll load it the moment you’re back.',
  'net.offline.queued': 'You’re offline. We’ll send it the moment you’re back.',
  'net.back': 'Back online.',
  'net.back.sending.one': 'Back online. Sending the 1 thing you wrote offline.',
  'net.back.sending.other': 'Back online. Sending the {count} things you wrote offline.',
  'net.weak': 'Your connection is slow right now.',

  // ───────────── freshness ─────────────
  'fresh.justNow': 'Updated just now',
  'fresh.minutes': 'Updated {minutes} min ago',
  'fresh.hours': 'Updated {hours}h ago',
  'fresh.date': 'Updated {date}',
  'fresh.offline': 'Saved on this phone · {when}',

  // ───────────── waiting ─────────────
  'slow.title': 'Still working…',
  'slow.body': 'This is slower than usual.',
  'slow.bodyWeak': 'This is slower than usual. Your connection is weak.',
  'slow.cancel': 'Stop waiting',
  'timeout.title': 'This is taking too long.',
  'timeout.body': 'The connection may be weak. Nothing you did was lost.',
  'busy.wait': 'We’re busy for a moment. Trying again in {seconds} seconds.',
  'busy.title': 'We need a few seconds.',
  'busy.body': 'We’ll try again in {seconds} seconds. You don’t need to do anything.',

  // ───────────── our side ─────────────
  'problem.inline': 'This didn’t load.',
  'problem.title': 'That didn’t work, and it’s on us.',
  'problem.body': 'Your trips and documents are safe on this phone. Try once more, or talk to Mada.',
  'problem.ref': 'Reference {ref}',
  'problem.partial.title': 'Part of this didn’t load.',
  'problem.partial.body': 'Updating Mada usually fixes it. Everything else works as normal.',
  'crash.title': 'Something broke on our side. Your trips are safe.',
  'crash.body': 'Restart Mada and you’ll be back where you were.',
  'crash.restart': 'Restart',

  // ───────────── suppliers ─────────────
  'supplierDown.title': '{supplier}’s system isn’t answering.',
  'supplierDown.body': 'We try again every minute. Talk to Mada and we’ll book it by hand.',
  'supplierDown.bodyBooking': '{agent} is booking this by hand. You don’t need to do anything.',
  'supplierDown.generic': 'The airline',
  'supplierDown.status': '{supplier} is slow to answer right now.',
  // The names suppliers go by on screen (GET /status labels), written to read well in "{supplier}’s system isn’t answering."
  'supplier.flights': 'The airline',
  'supplier.hotels': 'The hotel',
  'supplier.payments': 'The bank',
  'supplier.sms': 'The text message service',
  'supplier.whatsapp': 'WhatsApp',
  'supplier.email': 'The email service',
  'supplier.flightStatus': 'The flight tracker',
  'supplier.flightPositions': 'The flight map',
  'supplier.ai': 'The instant answers service',
  'supplier.identity': 'Apple or Google',

  // ───────────── sessions ─────────────
  'session.expired.title': 'Sign in again to carry on.',
  'session.expired.body': 'It’s been a while. Everything you typed is kept, and you’ll come back right here.',
  'session.expired.action': 'Sign in',
  'session.expired.to': 'We’ll text a code to {phone}.',

  // ───────────── versions and maintenance ─────────────
  'update.title': 'Time for the new Mada.',
  'update.body': 'This version can’t book or pay any more. The update takes about a minute. Your trips stay as they are.',
  'update.action': 'Update Mada',
  'update.offline': 'Open my trips',
  'update.soft': 'A new version of Mada is ready.',
  'update.softAction': 'Update',
  'maintenance.title': 'We’re making Mada better.',
  'maintenance.body': 'Booking is paused for a few minutes. Your trips, passes and documents still open on this phone.',
  'maintenance.until': 'Back by {time}.',
  'maintenance.banner': 'Booking is paused for a few minutes.',
  'maintenance.trips': 'Open my trips',
  'maintenance.retry': 'Check again',

  // ───────────── money and orders ─────────────
  'pay.offline.title': 'You went offline before we could book.',
  'pay.offline.body': 'Nothing was charged. We’ll pick up right where you left off.',
  'pay.offline.resume': 'Try again',
  'pay.unknown.title': 'We’re checking with your bank.',
  'pay.unknown.body': 'You won’t be charged twice. We’ll show the answer here.',
  'order.resumed': 'Your booking is still with Mada. We picked up where you left off.',

  // ───────────── outbox ─────────────
  'outbox.queued': 'Sends when you’re online',
  'outbox.sending': 'Sending…',
  'outbox.stuck': 'Not sent.',
  'outbox.retry': 'Send again',
  'outbox.discard': 'Remove',
  'outbox.title': 'Waiting to send',

  // ───────────── things that aren't there ─────────────
  'gone.title': 'This isn’t here any more.',
  'gone.body': 'It may have been cancelled or removed. Everything else is where you left it.',
  'gone.home': 'Go to Today',
  'gone.inviteTitle': 'This invite has expired.',
  'gone.inviteBody': 'Invites last 7 days. Ask whoever sent it for a new link.',

  // ───────────── the phone itself ─────────────
  'storage.full.title': 'Your phone is almost full.',
  'storage.full.body': 'We couldn’t save your trips for offline use. Free up some space and we’ll try again.',
  'perm.settings': 'Open Settings',
  'perm.camera.title': 'The camera is off for Mada.',
  'perm.camera.body': 'Turn it on in Settings to scan a passport. You can also type the details in.',
  'perm.contacts.title': 'Contacts are off for Mada.',
  'perm.contacts.body': 'Turn them on in Settings to find friends who travel with you.',
  'perm.location.title': 'Location is off for Mada.',
  'perm.location.body': 'Turn it on in Settings so we can time your drive to the airport.',
  'perm.notifications.title': 'Alerts are off for Mada.',
  'perm.notifications.body': 'Turn them on in Settings for gate changes and delays.',
  'perm.photos.title': 'Photos are off for Mada.',
  'perm.photos.body': 'Turn them on in Settings to add a document from your photos.',

  // ───────────── server-side codes (errors.ts) ─────────────
  'error.supplierDown': 'That supplier isn’t answering. Talk to Mada and we’ll do it by hand.',
  'error.maintenance': 'Booking is paused for a few minutes while we make Mada better.',
  'error.upgradeRequired': 'This version of Mada needs an update.',
  'error.idempotencyConflict': 'That was already sent with different details. Check it and send again.',
  'error.inProgress': 'We’re still on the first try. Give it a few seconds.',
  'error.timeout': 'This is taking too long. Nothing you did was lost.',
} as const;

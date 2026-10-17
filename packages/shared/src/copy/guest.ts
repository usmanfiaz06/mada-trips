/**
 * Looking around without an account, and keeping the traveller's place: the "Sign in to …" sheet that asks only at
 * an account action and brings them back to the same spot, the welcome's one sign-in line, picking up a search
 * after a restart, Mada answering in the language a message is written in, and "Translate" on words a hotel or the
 * desk wrote in the other language. Spread into en.ts; Arabic in ar/guest.ts.
 */
export const guestCopy = {
  'welcome.browse': 'Look around',
  'welcome.signin': 'Already with Mada? Sign in',

  'signin.ask.book': 'Sign in to book this',
  'signin.ask.save': 'Sign in to save this',
  'signin.ask.chat': 'Sign in to talk to Mada',
  'signin.ask.circles': 'Sign in to plan with your people',
  'signin.ask.wallet': 'Sign in to keep your documents',
  'signin.ask.trips': 'Sign in to see your trips',
  'signin.ask.bodyBook': 'Your search and the option you picked stay just as they are.',
  'signin.ask.body': 'We bring you straight back here.',
  'signin.ask.go': 'Sign in',
  'signin.ask.later': 'Keep looking',

  'resume.back': 'Back where you were.',
  'resume.pickUp': 'Pick up where you left off',
  'resume.pickUpA11y': 'Pick up your last search: {what}',

  'ask.lang.toArabic': 'عربي',
  'ask.lang.toEnglish': 'English',
  'ask.lang.a11y': 'Switch Mada to Arabic. This search stays as it is.',
  'ask.voice.note': 'You wrote in English, so Mada is answering in English.',

  'translate.show': 'Translate',
  'translate.original': 'Show the original',
  'translate.wroteIn': 'The hotel wrote this in English.',
  'translate.machine': 'Translated for you. The hotel wrote it in English.',
  'translate.none': 'We can’t translate this yet. Here it is as the hotel wrote it.',
  'translate.desk': 'Written by Mada in English.',

  'trips.board.ask': 'Flights to {city}',
  'map.credits': 'Map credits',
  'map.marker': 'On the map',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  'discover.cityFromPhone': 'Showing {city}. Change it any time.',
} as const;

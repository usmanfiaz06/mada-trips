/**
 * Language and display settings: Profile › Language (English or العربية, which restarts the app so the layout can
 * turn right to left), Western or Arabic-Indic digits, and the Hijri date alongside. Spread into en.ts; Arabic in
 * ar/language.ts.
 */
export const languageCopy = {
  'lang.title': 'Language',
  'lang.english': 'English',
  'lang.arabic': 'العربية',
  'lang.followsPhone': 'Mada follows your phone’s language until you choose one here.',
  'lang.current': 'English',
  'lang.restart.toArabic': 'Restart Mada in Arabic?',
  'lang.restart.toEnglish': 'Restart Mada in English?',
  'lang.restart.body': 'The app closes and opens again, reading the other way. Your trips, Wallet and messages stay exactly as they are.',
  'lang.restart.go': 'Restart to switch',
  'lang.restart.keep': 'Not now',
  'lang.restart.manual': 'Close Mada and open it again to finish switching.',
  'lang.display': 'Numbers and dates',
  'lang.digits': 'Arabic-Indic digits',
  'lang.digitsSub': '١٢٣ instead of 123. Airlines and banks use 123, so that’s the default.',
  'lang.hijri': 'Hijri date alongside',
  'lang.hijriSub': 'The Umm al-Qura date next to every day.',
  'lang.saved': 'Saved.',
  'lang.done': 'Done',
} as const;

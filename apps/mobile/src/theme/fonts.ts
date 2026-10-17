import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif/400Regular';
import { InterTight_400Regular } from '@expo-google-fonts/inter-tight/400Regular';
import { InterTight_500Medium } from '@expo-google-fonts/inter-tight/500Medium';
import { InterTight_600SemiBold } from '@expo-google-fonts/inter-tight/600SemiBold';
import { InterTight_700Bold } from '@expo-google-fonts/inter-tight/700Bold';
import { IBMPlexSansArabic_400Regular } from '@expo-google-fonts/ibm-plex-sans-arabic/400Regular';
import { IBMPlexSansArabic_500Medium } from '@expo-google-fonts/ibm-plex-sans-arabic/500Medium';
import { IBMPlexSansArabic_600SemiBold } from '@expo-google-fonts/ibm-plex-sans-arabic/600SemiBold';
import { IBMPlexSansArabic_700Bold } from '@expo-google-fonts/ibm-plex-sans-arabic/700Bold';
import { ReemKufi_500Medium } from '@expo-google-fonts/reem-kufi/500Medium';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { Platform } from 'react-native';
import { fontFamilies } from '@mada/shared';
import { thmanyah } from './arabic-fonts';
import type { CopyLocale } from '@mada/shared';

/*
 * Typefaces (COPY.md §7.1). Interface: Inter Tight. Display: Instrument Serif. Arabic: Thmanyah (Serif Display for
 * display, Sans for the interface) when its files are present (theme/arabic-fonts.ts); until then IBM Plex Sans Arabic
 * and Reem Kufi.
 *
 * In Arabic the Arabic files load under the same family names the styles already use, so every Text, TextInput and
 * SVG label picks them up without each screen knowing the language. The language is fixed for a launch (switching
 * restarts the app), so the mapping never changes under a mounted screen.
 */
export function fontsFor(locale: CopyLocale): Record<string, number> {
  const f = fontFamilies;
  if (locale === 'ar' && thmanyah) {
    return {
      [f.display]: thmanyah.display,
      [f.ui400]: thmanyah.ui400,
      [f.ui500]: thmanyah.ui500,
      [f.ui600]: thmanyah.ui600,
      [f.ui700]: thmanyah.ui700,
      [f.mono]: JetBrainsMono_400Regular,
    };
  }
  if (locale === 'ar') {
    return {
      [f.display]: ReemKufi_500Medium,
      [f.ui400]: IBMPlexSansArabic_400Regular,
      [f.ui500]: IBMPlexSansArabic_500Medium,
      [f.ui600]: IBMPlexSansArabic_600SemiBold,
      [f.ui700]: IBMPlexSansArabic_700Bold,
      [f.mono]: JetBrainsMono_400Regular,
    };
  }
  // On the web the same faces come as WOFF2 cut to the Latin the copy uses (scripts/web-fonts.sh): about 190 KB
  // instead of 650 KB before the first screen can draw. Native keeps the full files.
  if (Platform.OS === 'web') {
    /* eslint-disable @typescript-eslint/no-require-imports */
    return {
      [f.display]: require('../../assets/fonts/web/InstrumentSerif_400Regular.woff2'),
      [f.ui400]: require('../../assets/fonts/web/InterTight_400Regular.woff2'),
      [f.ui500]: require('../../assets/fonts/web/InterTight_500Medium.woff2'),
      [f.ui600]: require('../../assets/fonts/web/InterTight_600SemiBold.woff2'),
      [f.ui700]: require('../../assets/fonts/web/InterTight_700Bold.woff2'),
      [f.mono]: require('../../assets/fonts/web/JetBrainsMono_400Regular.woff2'),
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
  }
  return {
    [f.display]: InstrumentSerif_400Regular,
    [f.ui400]: InterTight_400Regular,
    [f.ui500]: InterTight_500Medium,
    [f.ui600]: InterTight_600SemiBold,
    [f.ui700]: InterTight_700Bold,
    [f.mono]: JetBrainsMono_400Regular,
  };
}

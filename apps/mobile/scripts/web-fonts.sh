#!/bin/sh
# The web's fonts (theme/fonts.ts): Inter Tight, Instrument Serif and JetBrains Mono as WOFF2, cut to the Latin
# letters, punctuation and symbols the English copy uses. Native apps keep the full TTFs. Run again after a font
# update or when the copy needs a character outside this list. Needs fontTools (pip install fonttools brotli).
# The fonts are under the SIL Open Font License 1.1 (no reserved names), which allows this.
set -e
cd "$(dirname "$0")/.."
SRC=../../node_modules/@expo-google-fonts
OUT=assets/fonts/web
U="U+0000-017F,U+0192,U+0218-021B,U+02BB-02BF,U+02C6-02DD,U+0300-0308,U+030A-030C,U+0327,U+03BB,U+03C6,U+2000-206F,U+20AC,U+20BA,U+20BC,U+2116,U+2122,U+2190-2199,U+21C4,U+2212,U+2215,U+2248,U+2260,U+2264,U+2265,U+2500-257F,U+25CF,U+2605,U+2713,U+2708,U+27E6-27E7,U+FB01-FB02,U+FEFF,U+FFFD"
mkdir -p "$OUT"
for f in inter-tight/400Regular/InterTight_400Regular inter-tight/500Medium/InterTight_500Medium inter-tight/600SemiBold/InterTight_600SemiBold \
  inter-tight/700Bold/InterTight_700Bold instrument-serif/400Regular/InstrumentSerif_400Regular jetbrains-mono/400Regular/JetBrainsMono_400Regular; do
  python3 -m fontTools.subset "$SRC/$f.ttf" --unicodes="$U" --layout-features='*' --flavor=woff2 --output-file="$OUT/$(basename "$f").woff2"
done

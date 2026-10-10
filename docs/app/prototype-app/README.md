# Mada Trips: working prototype

A fully stateful, clickable prototype of the app. It runs in a browser, as a phone frame beside a demo panel.

- **Live:** https://claude.ai/artifact/GNr32ZS9gKN76MumqdRt5E (private until shared from its Share menu)
- **Flows and edge cases covered:** [../FLOWS.md](../FLOWS.md)

```bash
npm install
npm run build   # dist/index.html + dist/img, one self-contained page
npm test        # walks every main flow in headless Chromium, fails on any page error
npm run test:mrz  # MRZ parser unit tests (check digits, OCR noise, TD1/TD2/TD3)
npm run test:ocr  # reads the synthetic passport photos in test/fixtures for real, in headless Chromium
```

**Passport reading.** Onboarding (camera step) and Wallet › Add › Passport read the two MRZ lines from a real photo, on the device. `src/ocr.js` lazy-loads Tesseract from `ocr/` beside the page only when someone picks a photo; `src/mrz.js` parses and checks the lines (ICAO 9303 check digits). The build copies the engine from `node_modules` and the English model from `ocr-assets/` into `dist/ocr/` (about 5 MB). Publish `dist/ocr/*` with the page. "Use the demo passport" keeps the old simulated scan.

- `src/store.jsx`: state, reference data, demo switches
- `src/ui.jsx`: shared pieces (icons, sun mark, sheets, slide-to-confirm, dock, route, airline logo)
- `src/screens/`: one file per area

**Assets**

- Airline logos come from Duffel's public airline logo library. Production uses the logos supplied with the flight content.
- The photographs are Unsplash (Unsplash License).
- Passport reading uses tesseract.js and tesseract.js-core (Apache 2.0) and the `eng` model from tessdata_fast (Apache 2.0).

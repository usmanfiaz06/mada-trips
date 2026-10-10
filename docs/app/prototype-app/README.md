# Mada Trips: working prototype

A fully stateful, clickable prototype of the app. It runs in a browser, as a phone frame beside a demo panel.

- **Live:** https://claude.ai/artifact/GNr32ZS9gKN76MumqdRt5E (private until shared from its Share menu)
- **Flows and edge cases covered:** [../FLOWS.md](../FLOWS.md)

```bash
npm install
npm run build   # dist/index.html + dist/img, one self-contained page
npm test        # walks every main flow in headless Chromium, fails on any page error
```

- `src/store.jsx`: state, reference data, demo switches
- `src/ui.jsx`: shared pieces (icons, sun mark, sheets, slide-to-confirm, dock, route, airline logo)
- `src/screens/`: one file per area

**Assets**

- Airline logos come from Duffel's public airline logo library. Production uses the logos supplied with the flight content.
- The photographs are Unsplash (Unsplash License).

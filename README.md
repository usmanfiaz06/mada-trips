# Mada Trips website

A single-page site for Mada Trips (مدى): travel, ticketing, hotels, visa support, business services, manpower, specialist supply, events and IT.

## Run it

It's a static site with no build step. Serve the folder with any static server:

```bash
npx http-server . -p 8080
# or
python3 -m http.server 8080
```

Then open http://localhost:8080.

## Deploy (Vercel)

Import the repo in Vercel with Framework Preset **Other**, no build command, output directory left empty (root). `vercel.json` sets caching and security headers; `.vercelignore` keeps the original `Assets/` source files out of the deployment. Serve it over HTTP rather than opening the file directly, because the video and fonts need it. It also works on GitHub Pages, Netlify or Vercel as-is.

## Structure

```
index.html          markup and copy
css/style.css       design tokens (brand green #1e352d, sand #e9e2d8, sun gold) and all styles
js/main.js          motion: GSAP + ScrollTrigger + Lenis (loaded from jsDelivr)
assets/brand/       logo and symbol SVGs recoloured from /Assets
assets/media/       hero video (dunes) and poster
assets/img/         photography
Assets/             original brand files as supplied
```

## Page sections

1. **Preloader.** The sun symbol's rays assemble, then a curtain lifts.
2. **Hero → card.** A full-bleed dune video that, as you scroll, collapses into a card. The card then plays four chapters: Travel, Stay, Build, Celebrate.
3. **Destinations marquee.** Moves faster and skews with scroll speed.
4. **Why Mada.** Interactive bento cards: a ticket with a flying plane, a live KSA city network, visa search with an "Approved" stamp, a talent chat, and a stay-booking card with 3D tilt.
5. **Services.** Nine service cards in a pinned horizontal scroll.
6. **How it works.** A pinned four-step sequence with a ruler timeline: typed brief, then itinerary, then live status board, then a "delivered" gauge.
7. **Vision 2030.** "2030" knocked out of the video, then an AlUla night-sky panel.
8. **About.** Bader Sulaiman Almutairi, Founder & CEO, with his portrait (`assets/img/founder.jpg`).
9. **Contact CTA.** Animated sun rays.
10. **Footer.**

Respects `prefers-reduced-motion`.

## Before going live

- **Founder quote.** The line in the About section is draft copy. Have Bader approve it.
- **Contact form.** It is front-end only and shows a confirmation without sending anything. Wire it to email, a CRM or WhatsApp.
- **Social links.** They point to `#`.
- **Stats.** The only external figure is the 150M-visits Vision 2030 tourism target. Everything else is qualitative.

## Credits

- Photography: [Unsplash](https://unsplash.com) (Unsplash License).
- Hero video: [Mixkit](https://mixkit.co), "Dunes in the Sahara desert" (Mixkit free license).
- Fonts: Inter Tight, Instrument Serif, JetBrains Mono, Reem Kufi and Mrs Saint Delafield, from Google Fonts.

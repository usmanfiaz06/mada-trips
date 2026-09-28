# Mada Trips website

A single-page site for Mada Trips (مادا): travel, ticketing, hotels, visa support, business services, manpower, specialist supply, events and IT.

## Run it

It's a static site with no build step. Serve the folder with any static server:

```bash
npx http-server . -p 8080
# or
python3 -m http.server 8080
```

Then open http://localhost:8080. Serve it over HTTP rather than opening the file directly, because the video and fonts need it.

## Deploy (Vercel)

Import the repo in Vercel with Framework Preset **Other**, no build command, output directory left empty (root). `vercel.json` sets caching and security headers.

## SEO and link previews

- Open Graph and X/Twitter tags, canonical URL and Organization/TravelAgency structured data are in the `<head>` of `index.html`.
- Link-preview images (1200×630): `og-image.jpg` for the home page, and `assets/og/events.jpg`, `services.jpg`, `about.jpg`, `contact.jpg` for the other pages.
- `sitemap.xml`, `robots.txt`, `site.webmanifest`, app icons in `assets/brand/`, and a branded `404.html`.
- **When you add a custom domain**, replace `https://mada-trips.vercel.app` with it in every `.html` page, `sitemap.xml` and `robots.txt`.
- The nav, menu and footer are repeated in each page. If you change one, change them all.

## Structure

```
index.html          home page
events.html         Mada Events (/events)
services.html       all nine services (/services)
about.html          story, values, founder (/about)
contact.html        enquiry form (/contact, accepts ?topic=Events etc.)
css/style.css       design tokens (brand green #1e352d, sand #e9e2d8, sun gold) and all styles
js/site.js          shared motion on every page: GSAP + ScrollTrigger + Lenis (jsDelivr), nav, reveals, menu
js/home.js          home-only motion: hero-to-card, services scroll, events spotlight, process, loader
js/pages.js         inner-page motion: events hero, run of show, event flow, gallery, services index
assets/brand/       logo and symbol SVGs recoloured from /Assets
assets/media/       videos (dunes, events stage, fireworks) and posters
assets/img/events/  event photography
assets/img/         photography
Assets/             original brand files as supplied
```

## Page sections

1. **Preloader.** The sun symbol's rays assemble, then a curtain lifts.
2. **Hero → card.** A full-bleed dune video that, as you scroll, collapses into a card. The card then plays four chapters: Travel, Stay, Build, Celebrate.
3. **Destinations marquee.** Moves faster and skews with scroll speed.
4. **Why Mada.** Interactive bento cards: a ticket with a flying plane, a live KSA city network, visa search with an "Approved" stamp, a talent chat, and a stay-booking card with 3D tilt.
5. **Services.** Nine service cards in a pinned horizontal scroll, each linking to its section on /services.
5b. **Events.** A dark fireworks section with a cursor spotlight and event types, leading to /events.
6. **How it works.** A pinned four-step sequence with a ruler timeline: typed brief, then itinerary, then live status board, then a "delivered" gauge.
7. **Vision 2030.** "2030" knocked out of the video, then an AlUla night-sky panel.
8. **About.** Bader Al Sulaiman, Founder & CEO, with his portrait (`assets/img/founder.jpg`).
9. **Contact CTA.** Animated sun rays.
10. **Footer.**

Respects `prefers-reduced-motion`.

## Before going live

- **Founder quote.** The line in the About section is draft copy. Have Bader approve it.
- **Phone.** +966 56 668 2662 appears in every footer, the mobile menu, /contact (call and WhatsApp buttons) and the home contact section.
- **Contact forms** (home and /contact). They are front-end only and show a confirmation without sending anything. Wire it to email, a CRM or WhatsApp.
- **Social links.** They point to `#`.
- **Stats.** The only external figure is the 150M-visits Vision 2030 tourism target. Everything else is qualitative.

## Credits

- Photography: [Unsplash](https://unsplash.com) (Unsplash License).
- Videos: [Mixkit](https://mixkit.co) (Mixkit free license): dunes, festival stage, fireworks.
- Fonts: Inter Tight, Instrument Serif, JetBrains Mono, Reem Kufi and Mrs Saint Delafield, from Google Fonts.

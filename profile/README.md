# Mada Trips: company profile

A 14-page A4 landscape profile in the Mada brand. Source is `index.html` + `profile.css`; the output is `Mada-Company-Profile.pdf`.

Rebuild the PDF after any change (from the repo root):

```bash
NODE_PATH=$(npm root -g) node profile/build.js
```

Pages: cover · Vision 2030 quote · who we are · founder · what we offer · Travel · Talent · Events · Business & Technology · how we work · why Mada · Vision 2030 · where we work · contact.

## Before printing

- **Founder quote** is the same draft line as the website. Have Bader approve it.
- **Crown Prince quote** is quoted word for word from the Saudi Vision 2030 document. The portrait (`img/mbs.jpg`) is the official Saudi Press Agency photo from Wikimedia Commons, CC BY-SA 4.0. The credit line on page 2 must stay.
- **Vision 2030 mark** on page 2 is set in type. Swap in the official logo file if you have permission to use it.
- **Web address** `madatrips.sa` is a placeholder until the domain is live.
- **Figures** used: 9 services, 55 trades, 7 disciplines, 6 industries (from the site), and the Kingdom's 150M-visits 2030 tourism target.

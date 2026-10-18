# Social media plan · November 2026

The month-one plan for Instagram, TikTok, X and LinkedIn. Researched 18 Oct 2026.

- `Mada_Social_Calendar_Nov2026.xlsx` is the working file for the team. It holds every post (hook, poster text EN/AR, captions AR/EN, keywords, hashtags, CTA, production direction) with Owner (Mehnaz, Bilal, Musa, Abdul Rehman, Usman) and Status dropdowns, a Team board and results tracking. The published playbook page has the same Owner and Status controls, stored live for the whole team and keyed on each post's Post ID. It also has the month view, platform playbook, pillars and series, guidelines, keywords, competitors, moments, KPIs, the sensitivity protocol and sources.
- `posts.py` holds every post. `strategy.py` holds the guidelines and research tables.
- `build.py` rebuilds the workbook from those two files: `python3 docs/social/build.py`. Add `--html <path>` to also write the shareable playbook page from `playbook_template.html`.

Edit the `.py` files and rebuild rather than editing the workbook's structure by hand. Fill in Owner, Status and results in the workbook itself.

## The live calendar (for the team)

The published playbook page on claude.ai is the team's live calendar. Everyone it's shared with sees the same board:

- **Add post** opens a form (title, date and platform are required). Posts can go into any month from November 2026 on.
- **Edit post** on any card changes it for everyone. Edits to the original plan are kept separately, so the plan in `posts.py` stays intact.
- Assign posts and move them through the statuses on the card. The **Team** tab shows each person's posts by stage and what's due in the next 7 days, and lets you add or remove names.
- **Export to Excel (CSV)** downloads the live calendar, including added and edited posts.

- Tap a day to open its day sheet: give it a label, a sticker, a tile colour and a photo, assign its posts, change their status (confetti on Posted) or move them. On a computer you can also drag a post onto another day; a toast offers Undo.
- Posts can carry a cover photo, shown as a polaroid on the calendar. Photos are resized in the browser before upload.

What the page stores: `posts/<post id>` (status, owner and edits for the original plan), `custom/<id>` (posts the team added), `days/<yyyy-mm-dd>` (a day's label, sticker, tile colour, photo) and `config/team` (the team list). The starting decorations and their photos come from `DAY_NOTES` in `strategy.py`; `build.py` shrinks the photos from the website's `assets/` into the page. The Excel workbook in this folder is the original plan and doesn't sync with the page.

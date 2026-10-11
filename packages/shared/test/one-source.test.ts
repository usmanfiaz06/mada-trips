import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESK_PHONE, DESK_TEL, LEGAL_UPDATED, MONTHS_AR } from '../src';

/** The website and the app must agree on the desk number and the legal date. The pages are read from the repo root,
 *  their source: platform/public is only a copy made at build time (platform/scripts/copy-site.mjs) and gitignored. */
const site = (f: string) => readFileSync(join(__dirname, '../../..', f), 'utf8');
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

describe('one source of truth', () => {
  it('the website shows the same desk number as the app', () => {
    for (const f of ['contact.html', 'support.html', 'terms.html', 'privacy.html', 'ar/contact.html', 'ar/terms.html']) {
      const html = site(f);
      expect(html, f).toContain(DESK_PHONE);
      expect(html, f).toContain(`href="${DESK_TEL}"`);
    }
  });

  it('the website terms and privacy pages carry the date the app shows', () => {
    const [y, m, d] = LEGAL_UPDATED.split('-').map(Number) as [number, number, number];
    for (const f of ['terms.html', 'privacy.html']) {
      expect(site(f), f).toContain(`Last updated: ${d} ${LONG[m - 1]} ${y}`);
      expect(site(`ar/${f}`), `ar/${f}`).toContain(`آخر تحديث: ${d} ${MONTHS_AR[m - 1]} ${y}`);
    }
  });
});

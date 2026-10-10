import { describe, expect, it } from 'vitest';
import { bannedIn, en, lintCatalogue, t, tn } from '../src/copy';
import { ERROR_CODES } from '../src/schemas/errors';

describe('the string catalogue', () => {
  it('passes every COPY.md rule (banned words, punctuation, lengths)', () => {
    const problems = lintCatalogue();
    expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
  });
  it('catches what it should', () => {
    expect(bannedIn('Oops! Something went wrong')).toEqual(expect.arrayContaining(['oops', 'something went wrong']));
    expect(bannedIn('Your AI assistant')).toEqual(expect.arrayContaining(['AI', 'assistant']));
    expect(bannedIn('We said it plainly')).toEqual([]);
    // Word boundaries: "Faisal" is not "AI", "user" doesn't hide in "users'" lookalikes like "reuse".
    expect(bannedIn('Faisal will reuse the card')).toEqual([]);
    expect(lintCatalogue({ 'notify.x.title': 'This title is far too long for any lock screen' })).toHaveLength(1);
    expect(lintCatalogue({ x: 'Done!' })).toEqual([{ key: 'x', problem: 'exclamation mark' }]);
  });
  it('fills placeholders and plurals', () => {
    expect(t('otp.sentTo', { phone: '+966 50 000 4127' })).toBe('Sent to +966 50 000 4127.');
    expect(tn('otp.wrong', 2)).toBe("That code doesn't match. 2 tries left.");
    expect(tn('otp.wrong', 1)).toBe("That code doesn't match. 1 try left.");
    expect(t('name.goNamed', { name: 'Omar' })).toBe('Let’s go, Omar');
  });
  it('has a message for every API error code', () => {
    for (const [code, v] of Object.entries(ERROR_CODES)) expect(en[v.copy], code).toBeTruthy();
  });
});

describe('the catalogue sections', () => {
  it('never define the same key twice (a later section would silently replace an earlier one)', async () => {
    const sections: Record<string, Record<string, string>> = {
      wallet: (await import('../src/copy/wallet')).walletCopy,
      circles: (await import('../src/copy/en-circles')).enCircles,
      booking: (await import('../src/copy/booking')).bookingCopy,
      desk: (await import('../src/copy/desk')).deskCopy,
      tripsToday: (await import('../src/copy/en-trips-today')).enTripsToday,
      tripsUi: (await import('../src/copy/en-trips-ui')).enTripsUi,
      tripsUi2: (await import('../src/copy/en-trips-ui2')).enTripsUi2,
      resilience: (await import('../src/copy/resilience')).resilienceCopy,
      places: (await import('../src/copy/places')).placesCopy,
      language: (await import('../src/copy/language')).languageCopy,
      auth: (await import('../src/copy/auth')).authCopy,
    };
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const [name, copy] of Object.entries(sections)) {
      for (const k of Object.keys(copy)) {
        const prev = seen.get(k);
        if (prev) clashes.push(`${k} (${prev}, ${name})`);
        seen.set(k, name);
      }
    }
    expect(clashes).toEqual([]);
  });
});

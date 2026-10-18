import { describe, expect, it } from 'vitest';
import { notReadyMessage, parseAuthSettings, wayShown, type Ways } from '@/lib/auth/providers';

/*
 * Which ways in to offer, from Supabase's GET /auth/v1/settings. A provider that's off must never be offered (its
 * /authorize answers raw JSON); unknown or mock mode keeps everything.
 */

// What staging answered (Oct 2026): only email on.
const staging = {
  external: { anonymous_users: false, apple: false, azure: false, github: false, google: false, email: true, phone: false, zoom: false },
  disable_signup: false, mailer_autoconfirm: false, phone_autoconfirm: false, sms_provider: 'twilio',
};

describe('the Supabase settings', () => {
  it('reads which ways are on', () => {
    expect(parseAuthSettings(staging)).toEqual({ google: false, apple: false, phone: false, email: true });
    expect(parseAuthSettings({ external: { google: true, apple: true, phone: true, email: true } })).toEqual({ google: true, apple: true, phone: true, email: true });
  });
  it('hides only on an explicit false; a missing key is not proof', () => {
    expect(parseAuthSettings({ external: { google: false } })).toEqual({ google: false, apple: true, phone: true, email: true });
  });
  it('gives up (shows everything) on anything that is not the settings shape', () => {
    for (const body of [null, undefined, 'nope', {}, { external: null }, { external: 'x' }, { external: {} }, { external: { google: 'yes' } }, { code: 400, msg: 'x' }]) {
      expect(parseAuthSettings(body)).toBeNull();
    }
  });
});

describe('what the screens offer', () => {
  const off = parseAuthSettings(staging)!;
  it('shows a way only when the project has it on', () => {
    expect(wayShown('supabase', off, 'google')).toBe(false);
    expect(wayShown('supabase', off, 'apple')).toBe(false);
    expect(wayShown('supabase', off, 'phone')).toBe(false);
    expect(wayShown('supabase', off, 'email')).toBe(true);
  });
  it('keeps every way while the settings are unknown (offline), and always in mock mode', () => {
    for (const w of ['google', 'apple', 'phone', 'email'] as const) {
      expect(wayShown('supabase', null, w)).toBe(true);
      expect(wayShown('mock', off, w)).toBe(true);
    }
  });
  it('says calmly what to use instead, pointing only at ways that are on', () => {
    const phoneOn: Ways = { ...off, phone: true };
    expect(notReadyMessage('google', phoneOn)).toBe('Google sign-in isn’t ready yet. Use your phone number or email.');
    expect(notReadyMessage('google', null)).toBe('Google sign-in isn’t ready yet. Use your phone number or email.');
    expect(notReadyMessage('apple', off)).toBe('Apple sign-in isn’t ready yet. Use your email.');
    expect(notReadyMessage('phone', off)).toBe('Phone number sign-in isn’t ready yet. Use your email.');
    expect(notReadyMessage('google', off)).not.toMatch(/\{|unsupported|provider/i);
  });
});

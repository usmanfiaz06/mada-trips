import { beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from '@mada/shared';
import { setTransport, type Wire } from '@/lib/api';
import { phoneChannels, usePhoneCodes } from '@/lib/auth';
import { sendViaHook } from '@/lib/auth/channel';
import { mockAuth, resetMockAuth } from '@/lib/auth/mock';
import { useGates } from '@/lib/net/gates';
import { mockTransport } from '../../src/lib/mock-api';

/*
 * Phone codes on WhatsApp or by SMS (docs/app/AUTH.md): the channels /config offers, the stand-in's choice and its
 * "not on WhatsApp" fallback, and the real path's hint + ticket around Supabase.
 */

const rnd = () => `+9665${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
const setChannels = (c: ('whatsapp' | 'sms')[] | undefined) => useGates.setState({ config: c ? { ...(useGates.getState().config ?? {
  minVersion: '0.0.0', latestVersion: '0.1.0', maintenance: { on: false, message: null, until: null }, features: {}, serverTime: '', storeUrls: { ios: '', android: '' },
}), phoneChannels: c } : null });

beforeEach(() => {
  resetMockAuth();
  usePhoneCodes.setState({ sent: {} });
  setChannels(undefined);
  setTransport((w) => mockTransport(w));
});

describe('phone code channels', () => {
  it('follows /config, the usual one first (the stand-in offers both before /config answers)', () => {
    expect(phoneChannels()).toEqual(['whatsapp', 'sms']);
    setChannels(['sms']);
    expect(phoneChannels()).toEqual(['sms']);
  });

  it('the stand-in sends on WhatsApp, by SMS when asked, and falls back for a number not on WhatsApp', async () => {
    setChannels(['whatsapp', 'sms']);
    const a = rnd();
    expect(await mockAuth.sendPhoneCode(a)).toEqual({ channel: 'whatsapp', fellBack: false });
    expect(usePhoneCodes.getState().sent[a]).toEqual({ channel: 'whatsapp', fellBack: false });
    const b = rnd();
    expect(await mockAuth.sendPhoneCode(b, 'sms')).toEqual({ channel: 'sms', fellBack: false });
    const c = `${rnd().slice(0, -4)}0000`;
    expect(await mockAuth.sendPhoneCode(c)).toEqual({ channel: 'sms', fellBack: true });
    setChannels(['sms']);
    expect(await mockAuth.sendPhoneCode(rnd(), 'whatsapp')).toEqual({ channel: 'sms', fellBack: false });
  });

  it('the real path leaves a hint, sends, then reads how it went', async () => {
    setChannels(['whatsapp', 'sms']);
    const seen: Wire[] = [];
    const ticket = '1ba7d8d0-b680-11f1-91b5-d2a30e0412c2';
    setTransport(async (w) => {
      seen.push(w);
      if (w.method === 'POST' && w.path === ROUTES.phoneChannel) return { status: 200, json: { ticket, channels: ['whatsapp', 'sms'] } };
      if (w.method === 'GET' && w.path === `${ROUTES.phoneChannel}/${ticket}`) return { status: 200, json: { sentVia: 'sms' } };
      return { status: 404, json: { error: { code: 'NOT_FOUND', message: 'x' } } };
    });
    const phone = rnd();
    let sentAfterHint = false;
    const r = await sendViaHook(phone, undefined, async () => { sentAfterHint = seen.length === 1; });
    expect(sentAfterHint).toBe(true);
    expect(seen[0]).toMatchObject({ method: 'POST', path: ROUTES.phoneChannel, body: { phone } });
    expect(r).toEqual({ channel: 'sms', fellBack: true }); // asked for WhatsApp (the usual), went by SMS
    const asked = await sendViaHook(phone, 'sms', async () => {});
    expect(seen.at(-2)).toMatchObject({ body: { phone, channel: 'sms' } });
    expect(asked).toEqual({ channel: 'sms', fellBack: false });
  });

  it('still sends when the hint can\'t be left (an older server)', async () => {
    setChannels(['whatsapp', 'sms']);
    setTransport(async () => ({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'x' } } }));
    let sent = false;
    const r = await sendViaHook(rnd(), 'sms', async () => { sent = true; });
    expect(sent).toBe(true);
    expect(r.channel).toBe('sms');
  });
});

import { create } from 'zustand';
import { PhoneChannelResponse, PhoneChannelSent, ROUTES, type PhoneCodeChannel } from '@mada/shared';
import { request } from '../api';
import { useGates } from '../net/gates';
import { AUTH_MODE } from './config';

/*
 * Phone codes travel on WhatsApp (Zoho CPaaS) or by SMS; the Core API's Send SMS hook decides (docs/app/AUTH.md,
 * "Phone codes on WhatsApp"). GET /config says which channels exist, the usual one first (phoneChannels). Supabase
 * doesn't pass a channel to the hook, so before each code the app leaves a hint (POST /auth/phone-channel) and, after,
 * reads back how the code really went (WhatsApp can fall back to SMS), so the code screen names the right one.
 */

export type PhoneChannel = PhoneCodeChannel;
export type PhoneSend = { channel: PhoneChannel; fellBack: boolean };

/** In the stand-in (mock) a number ending in these digits "isn't on WhatsApp", like the Core API's mock. */
export const MOCK_NOT_ON_WHATSAPP_SUFFIX = '0000';

const fromConfig = (c: PhoneChannel[] | undefined): PhoneChannel[] => (c?.length ? c : AUTH_MODE === 'mock' ? ['whatsapp', 'sms'] : ['sms']);

/** The channels phone codes can take, the usual one first. */
export const phoneChannels = (): PhoneChannel[] => fromConfig(useGates.getState().config?.phoneChannels);
export function usePhoneChannels(): PhoneChannel[] {
  return fromConfig(useGates((s) => s.config?.phoneChannels));
}

/** How the last code to each number went, for the code screen. */
export const usePhoneCodes = create<{ sent: Record<string, PhoneSend>; note: (phone: string, s: PhoneSend) => void }>((set) => ({
  sent: {},
  note: (phone, s) => set((st) => ({ sent: { ...st.sent, [phone]: s } })),
}));

/** The real thing: hint, send through Supabase, then ask how it went. A hint that can't be left never stops the code. */
export async function sendViaHook(phone: string, channel: PhoneChannel | undefined, send: () => Promise<void>): Promise<PhoneSend> {
  const usual = phoneChannels()[0]!;
  let ticket: string | null = null;
  try {
    ticket = (await request({ method: 'POST', path: ROUTES.phoneChannel, body: { phone, channel }, auth: false, retries: 0 }, PhoneChannelResponse)).ticket;
  } catch { /* an older server, or offline: Supabase answers for itself */ }
  await send();
  let sentVia: PhoneChannel | null = null;
  if (ticket) {
    try {
      sentVia = (await request({ method: 'GET', path: `${ROUTES.phoneChannel}/${ticket}`, auth: false, retries: 1 }, PhoneChannelSent)).sentVia;
    } catch { /* keep what we asked for */ }
  }
  const wanted = channel ?? usual;
  const used = sentVia ?? wanted;
  const result = { channel: used, fellBack: wanted === 'whatsapp' && used === 'sms' };
  usePhoneCodes.getState().note(phone, result);
  return result;
}

/** The stand-in: the asked-for channel, and SMS for a number "not on WhatsApp". */
export function sendInMock(phone: string, channel: PhoneChannel | undefined): PhoneSend {
  const channels = phoneChannels();
  const wanted = channel && channels.includes(channel) ? channel : channels[0]!;
  const off = wanted === 'whatsapp' && phone.replace(/\D/g, '').endsWith(MOCK_NOT_ON_WHATSAPP_SUFFIX) && channels.includes('sms');
  const result: PhoneSend = { channel: off ? 'sms' : wanted, fellBack: off };
  usePhoneCodes.getState().note(phone, result);
  return result;
}

import { ERROR_CODES, localeOr, t, type ErrorCode, type MemoryFact } from '@mada/shared';
import type { WireResponse } from '../api';
import type { AreaMock } from '../mock-api';

/*
 * EXPO_PUBLIC_API_MODE=mock for What Mada remembers: the same contract as platform/src/app/api/app/v1/ask/memory.
 * A signed-in traveller starts with a few things Ask heard before (in the app's language), so the screen has something
 * to show in design work and screenshots; removing them works as it does on the server.
 */

const byUser = new Map<string, MemoryFact[]>();
const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
const err = (code: ErrorCode): WireResponse => ({ status: ERROR_CODES[code].status, json: { error: { code, message: t(ERROR_CODES[code].copy) } } });
const DAY = 86_400_000;

const SEED: Record<'en' | 'ar', [MemoryFact['kind'], string, MemoryFact['source'], number][]> = {
  en: [
    ['mobility', 'Mother uses a wheelchair; a wheelchair at the Haram', 'chat', 2],
    ['seat', 'Aisle seat', 'chat', 9],
    ['home_airport', 'Flies from Jeddah', 'booking', 21],
    ['food', 'Halal meals, no seafood for the kids', 'chat', 34],
    ['contact', 'WhatsApp, not calls', 'chat', 40],
  ],
  ar: [
    ['mobility', 'الوالدة على كرسي متحرك، وتحتاج كرسي في الحرم', 'chat', 2],
    ['seat', 'مقعد على الممر', 'chat', 9],
    ['home_airport', 'السفر من جدة', 'booking', 21],
    ['food', 'أكل حلال، وبدون بحريات للعيال', 'chat', 34],
    ['contact', 'واتساب، مو اتصال', 'chat', 40],
  ],
};

function factsOf(userId: string): MemoryFact[] {
  let list = byUser.get(userId);
  if (!list) {
    const now = Date.now();
    list = SEED[localeOr() === 'ar' ? 'ar' : 'en'].map(([kind, text, source, daysAgo], i) => ({
      id: `7e5a0000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, kind, text, source,
      createdAt: new Date(now - daysAgo * DAY).toISOString(), lastUsedAt: i < 2 ? new Date(now - DAY).toISOString() : null,
    }));
    byUser.set(userId, list);
  }
  return list;
}

export function resetMemoryMock() { byUser.clear(); }

export const memoryMock: AreaMock = async (w, ctx) => {
  const path = w.path.split('?')[0] ?? '';
  if (path !== '/ask/memory' && !path.startsWith('/ask/memory/')) return null;
  if (!ctx.user) return err('UNAUTHORIZED');
  const id = ctx.user.id;
  if (w.method === 'GET' && path === '/ask/memory') return ok({ facts: factsOf(id) });
  if (w.method === 'DELETE' && path === '/ask/memory') { byUser.set(id, []); return ok({ facts: [] }); }
  if (w.method === 'DELETE') {
    const factId = path.slice('/ask/memory/'.length);
    const list = factsOf(id);
    if (!list.some((f) => f.id === factId)) return err('NOT_FOUND');
    const left = list.filter((f) => f.id !== factId);
    byUser.set(id, left);
    return ok({ facts: left });
  }
  return null;
};

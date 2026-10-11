import { afterEach, describe, expect, it, vi } from 'vitest';
import { CircleDetail, InvitePreview, ROUTES, UploadCoverResponse } from '@mada/shared';
import type { Wire } from '../../src/lib/api';
import { mockTransport } from '../../src/lib/mock-api';
import { coverInput, coverIsLight, sameCover } from '../../src/lib/cover-logic';

/* Circle covers in mock mode, the way the app meets them: drawings, photos, and your own photo checked first. */

type J = Record<string, any>;
let signedIn: Promise<(method: Wire['method'], path: string, body?: unknown) => ReturnType<typeof mockTransport>> | null = null;
const demo = () => (signedIn ??= signIn());
async function signIn() {
  await mockTransport({ method: 'POST', path: ROUTES.otpStart, body: { phone: '0500004127' } });
  const signed = (await mockTransport({ method: 'POST', path: ROUTES.otpVerify, body: { phone: '0500004127', code: '123456' } })).json as J;
  const token = signed.tokens.accessToken as string;
  return async (method: Wire['method'], path: string, body?: unknown) => mockTransport({ method, path, body, token });
}
const file = (type = 'image/jpeg', size = 120_000) => ({ __file: { name: 'cover.jpg', type, size, uri: 'data:image/jpeg;base64,AAAA' } });

afterEach(() => { vi.useRealTimers(); });

describe('circle covers (mock mode)', () => {
  it('makes a circle with a drawing on a colour, then a library photo', async () => {
    const as = await demo();
    const r = await as('POST', '/circles', { name: `Camel crew ${Date.now() % 1000}`, cover: { kind: 'icon', icon: 'camel', color: 'sand' } });
    expect(r.status).toBe(201);
    const d = CircleDetail.parse(r.json);
    expect(d.circle.cover).toEqual({ kind: 'icon', icon: 'camel', color: 'sand' });
    const p = await as('PATCH', `/circles/${d.circle.id}`, { cover: { kind: 'photo', id: 'abha-mountains' } });
    expect(CircleDetail.parse(p.json).circle.cover).toEqual({ kind: 'photo', id: 'abha-mountains' });
    expect((await as('PATCH', `/circles/${d.circle.id}`, { cover: { kind: 'icon', icon: 'kaaba', color: 'green' } })).status).toBe(400);
  });

  it('the seeded circles wear a photo or a drawing', async () => {
    const as = await demo();
    const list = (await as('GET', '/circles')).json as J;
    const family = list.circles.find((c: J) => c.name === 'Family');
    expect(family.cover).toEqual({ kind: 'icon', icon: 'family', color: 'sand' });
    expect(list.circles.find((c: J) => c.name === 'Istanbul for Eid').cover).toEqual({ kind: 'photo', id: 'istanbul' });
  });

  it('your photo: photos only, pending for you alone (the invite shows what it replaced), approved after its check', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
    const as = await demo();
    expect((await as('POST', '/circles/covers', file('application/pdf'))).status).toBe(400);
    expect((await as('POST', '/circles/covers', file('image/jpeg', 11 * 1024 * 1024))).status).toBe(400);
    const up = await as('POST', '/circles/covers', file());
    expect(up.status).toBe(201);
    const { fileId, status } = UploadCoverResponse.parse(up.json);
    expect(status).toBe('pending');
    const made = CircleDetail.parse((await as('POST', '/circles', { name: `Our own ${Date.now() % 1000}`, cover: { kind: 'icon', icon: 'heart', color: 'rose' } })).json);
    const d = CircleDetail.parse((await as('PATCH', `/circles/${made.circle.id}`, { cover: { kind: 'upload', fileId } })).json);
    expect(d.circle.cover).toMatchObject({ kind: 'upload', fileId, status: 'pending', url: 'data:image/jpeg;base64,AAAA' });
    const link = (await as('POST', `/circles/${made.circle.id}/link`, {})).json as J;
    const pv = InvitePreview.parse((await mockTransport({ method: 'GET', path: `/invites/${link.code}` })).json);
    expect(pv.circle?.cover).toEqual({ kind: 'icon', icon: 'heart', color: 'rose' });
    vi.setSystemTime(Date.now() + 13_000);
    const after = CircleDetail.parse((await as('GET', `/circles/${made.circle.id}`)).json);
    expect(after.circle.cover).toMatchObject({ kind: 'upload', status: 'approved' });
    const pv2 = InvitePreview.parse((await mockTransport({ method: 'GET', path: `/invites/${link.code}` })).json);
    expect(pv2.circle?.cover).toMatchObject({ kind: 'upload', status: 'approved' });
    // An upload that isn't yours (or doesn't exist) can't be used.
    expect((await as('PATCH', `/circles/${made.circle.id}`, { cover: { kind: 'upload', fileId: '00000000-0000-4000-8000-00000000abcd' } })).status).toBe(400);
  });

  it('helpers: what to send, what looks the same, and light covers', () => {
    const up = { kind: 'upload' as const, fileId: '00000000-0000-4000-8000-000000000001', status: 'pending' as const, url: 'file:///x.jpg' };
    expect(coverInput(up)).toEqual({ kind: 'upload', fileId: up.fileId });
    expect(coverInput(null)).toBeNull();
    expect(coverInput({ kind: 'icon', icon: 'sun', color: 'gold' })).toEqual({ kind: 'icon', icon: 'sun', color: 'gold' });
    expect(sameCover({ kind: 'icon', icon: 'sun', color: 'gold' }, { kind: 'icon', icon: 'sun', color: 'gold' })).toBe(true);
    expect(sameCover({ kind: 'icon', icon: 'sun', color: 'gold' }, { kind: 'icon', icon: 'sun', color: 'sky' })).toBe(false);
    expect(sameCover(up, { ...up, status: 'approved' })).toBe(true);
    expect(sameCover(null, null)).toBe(true);
    expect(sameCover(null, { kind: 'photo', id: 'alula' })).toBe(false);
    expect(coverIsLight({ kind: 'icon', icon: 'sun', color: 'gold' })).toBe(true);
    expect(coverIsLight({ kind: 'icon', icon: 'sun', color: 'green' })).toBe(false);
    expect(coverIsLight({ kind: 'photo', id: 'alula' })).toBe(false);
  });
});

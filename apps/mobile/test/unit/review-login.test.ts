import { beforeEach, describe, expect, it, vi } from 'vitest';

// A plain recorder, not vi.fn: a spy that returns a rejected promise is reported as a failure by itself.
type Call = Record<string, unknown>;
const request = { calls: [] as Call[], answer: (() => Promise.resolve({})) as () => Promise<unknown>,
  reset() { this.calls = []; this.answer = () => Promise.resolve({}); } };
vi.mock('../../src/lib/api', () => ({ request: (w: Call) => { request.calls.push(w); return request.answer(); } }));

const { orReviewLogin } = await import('../../src/lib/auth/review');
const { AuthError } = await import('../../src/lib/auth/types');

/* The App Review sign-in on the phone: asked only after Supabase calls a code wrong; otherwise Supabase's answer stands. */
describe('orReviewLogin', () => {
  beforeEach(() => request.reset());

  it('keeps a right code from Supabase and never asks the Core API', async () => {
    await expect(orReviewLogin(Promise.resolve({ accessToken: 'sb' }), { kind: 'email', value: 'a@b.co' }, '123456')).resolves.toEqual({ accessToken: 'sb' });
    expect(request.calls).toHaveLength(0);
  });

  it('after a wrong code, signs in with the review token', async () => {
    request.answer = () => Promise.resolve({ accessToken: 'review-token' });
    const r = await orReviewLogin(Promise.reject(new AuthError('wrong', 'Wrong code')), { kind: 'email', value: 'review@madatrips.sa' }, '246810');
    expect(r).toEqual({ accessToken: 'review-token' });
    expect(request.calls[0]).toMatchObject({ method: 'POST', path: '/auth/review', auth: false, body: { contact: { kind: 'email', value: 'review@madatrips.sa' }, code: '246810' } });
  });

  it("shows Supabase's own error when the review path says no", async () => {
    request.answer = () => Promise.reject(Object.assign(new Error('not found'), { status: 404 }));
    const wrong = new AuthError('wrong', 'Wrong code');
    await expect(orReviewLogin(Promise.reject(wrong), { kind: 'phone', value: '+966500000000' }, '111111')).rejects.toBe(wrong);
    expect(request.calls).toHaveLength(1);
  });

  it('never asks for other failures (offline, too many)', async () => {
    const offline = new AuthError('offline', 'Offline');
    await expect(orReviewLogin(Promise.reject(offline), { kind: 'email', value: 'a@b.co' }, '111111')).rejects.toBe(offline);
    expect(request.calls).toHaveLength(0);
  });
});

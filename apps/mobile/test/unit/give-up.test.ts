import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { GIVE_UP_MS, SUPPLIER_GIVE_UP_MS, waitView, type QueryLike } from '@/lib/net/give-up';
import { buildOf, isNewer } from '@/lib/net/shell';

/* No endless spinners (lib/net/give-up.ts), and how the web app knows a new build is out (lib/net/shell.ts). */

const pending: QueryLike = { status: 'pending', fetchStatus: 'fetching' };
const disabled: QueryLike = { status: 'pending', fetchStatus: 'idle' };

describe('a search gives up instead of spinning', () => {
  it('waits about 12 seconds by default, longer for live supplier searches', () => {
    expect(GIVE_UP_MS).toBe(12_000);
    expect(SUPPLIER_GIVE_UP_MS).toBeGreaterThanOrEqual(GIVE_UP_MS);
  });

  it('loads while the request runs, then says it took too long', () => {
    expect(waitView(pending, { waitedMs: 3000 })).toBe('loading');
    expect(waitView(pending, { waitedMs: 11_999 })).toBe('loading');
    expect(waitView(pending, { waitedMs: 12_000 })).toBe('timeout');
    expect(waitView(pending, { waitedMs: 500, giveUpMs: 400 })).toBe('timeout');
  });

  it('a query that can never run (disabled) gives up too, never an endless loader', () => {
    expect(waitView(disabled, { waitedMs: 1000 })).toBe('loading');
    expect(waitView(disabled, { waitedMs: 13_000 })).toBe('timeout');
  });

  it('a failed request (5xx, 4xx, no network) is an error at once', () => {
    for (const e of [new ApiError('INTERNAL', 'x', 500), new ApiError('VALIDATION', 'x', 400), new ApiError('OFFLINE', 'x', 0), new Error('boom')]) {
      expect(waitView({ status: 'error', fetchStatus: 'idle', error: e }, { waitedMs: 10 })).toBe('error');
    }
  });

  it('Try again after an error loads again', () => {
    expect(waitView({ status: 'error', fetchStatus: 'fetching', error: new ApiError('INTERNAL', 'x', 500) }, { waitedMs: 10 })).toBe('loading');
  });

  it('an ended session (401) or no session at all asks to sign in', () => {
    expect(waitView({ status: 'error', fetchStatus: 'idle', error: new ApiError('TOKEN_EXPIRED', 'x', 401) }, { waitedMs: 10 })).toBe('signin');
    expect(waitView({ status: 'error', fetchStatus: 'idle', error: new ApiError('UNAUTHORIZED', 'x', 401) }, { waitedMs: 10 })).toBe('signin');
    expect(waitView(disabled, { waitedMs: 10, signedIn: false })).toBe('signin');
  });

  it('data on screen wins, even when a refresh under it fails or is slow', () => {
    expect(waitView({ status: 'success', fetchStatus: 'fetching', data: { plans: [] } }, { waitedMs: 60_000 })).toBe('ready');
    expect(waitView({ status: 'error', fetchStatus: 'idle', data: 1, error: new ApiError('INTERNAL', 'x', 500) }, { waitedMs: 0 })).toBe('ready');
  });
});

describe('the web build id', () => {
  it('is the hash in the entry bundle the page names', () => {
    const html = '<html><head><link rel="preload" href="/_expo/static/css/x.css"></head><body><script src="/_expo/static/js/web/entry-1780b1bbd182ffce42210fbe237a34fc.js" defer></script></body></html>';
    expect(buildOf(html)).toBe('1780b1bbd182ffce42210fbe237a34fc');
    expect(buildOf('/_expo/static/js/web/entry-abc123.js')).toBe('abc123');
    expect(buildOf('<html>no bundle</html>')).toBeNull();
    expect(buildOf(null)).toBeNull();
  });

  it('a different build heard of means Refresh; the same one, or not knowing, means nothing', () => {
    expect(isNewer('aaa', 'bbb')).toBe(true);
    expect(isNewer('aaa', 'aaa')).toBe(false);
    expect(isNewer(null, 'bbb')).toBe(false);
    expect(isNewer('aaa', null)).toBe(false);
  });
});

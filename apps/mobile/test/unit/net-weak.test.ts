import { beforeEach, describe, expect, it } from 'vitest';
import { reportReached, resetNet, useNet } from '@/lib/net/state';

/* "Weak connection" is a run of slow answers, not one slow server call (live audit P1-1). */

beforeEach(() => resetNet({ connected: true }));
const weak = () => useNet.getState().weak;

describe('weak connection', () => {
  it('stays quiet for one or two slow answers', () => {
    reportReached(7500);
    expect(weak()).toBe(false);
    reportReached(9000);
    expect(weak()).toBe(false);
  });
  it('turns on after three slow answers in a row', () => {
    reportReached(7000); reportReached(8000); reportReached(9000);
    expect(weak()).toBe(true);
  });
  it('a quick answer starts the count again', () => {
    reportReached(7000); reportReached(8000); reportReached(400); reportReached(9000);
    expect(weak()).toBe(false);
  });
  it('the old 2.5 s average no longer counts as weak', () => {
    for (let i = 0; i < 5; i++) reportReached(3000);
    expect(weak()).toBe(false);
  });
});

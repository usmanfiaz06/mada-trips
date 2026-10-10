import { describe, expect, it } from 'vitest';
import {
  addDays, addMinutes, clockIn, dayLabel, daysBetween, durationLabel, headerDay, hijriLabel, isExpiredOn, isIsoDay, rangeLabel,
  relativeOrClock, todayIn, validityDaysLeft, zonedParts, zonedToInstant,
} from '../src/dates';

describe('calendar days', () => {
  it('validates real days only', () => {
    expect(isIsoDay('2027-03-09')).toBe(true);
    expect(isIsoDay('2027-02-29')).toBe(false);
    expect(isIsoDay('2028-02-29')).toBe(true);
    expect(isIsoDay('2027-3-9')).toBe(false);
    expect(isIsoDay(20270309)).toBe(false);
  });
  it('adds days across months, years and leap days', () => {
    expect(addDays('2027-03-09', 6)).toBe('2027-03-15');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(daysBetween('2027-03-09', '2027-08-06')).toBe(150);
    expect(() => addDays('nope', 1)).toThrow();
  });
  it('labels days and ranges the COPY.md way', () => {
    expect(dayLabel('2027-03-11', { today: '2027-01-01' })).toBe('Thu 11 Mar');
    expect(dayLabel('2027-03-11', { today: '2026-10-10' })).toBe('Thu 11 Mar 2027');
    expect(rangeLabel('2027-03-14', '2027-03-20')).toBe('14–20 Mar');
    expect(rangeLabel('2027-02-28', '2027-03-03')).toBe('28 Feb – 3 Mar');
    expect(rangeLabel('2027-03-14')).toBe('14 Mar');
  });
  it('formats durations and clock maths', () => {
    expect(durationLabel(220)).toBe('3h 40m');
    expect(durationLabel(45)).toBe('45m');
    expect(durationLabel(120)).toBe('2h');
    expect(addMinutes('09:40', -155)).toBe('07:05');
    expect(addMinutes('23:30', 45)).toBe('00:15');
    expect(() => durationLabel(-1)).toThrow();
  });
});

describe('Riyadh time', () => {
  const at = new Date('2026-10-10T21:30:00Z'); // 00:30 on the 11th in Riyadh
  it('reads the Riyadh calendar day and clock', () => {
    expect(zonedParts(at).date).toBe('2026-10-11');
    expect(todayIn('Asia/Riyadh', at)).toBe('2026-10-11');
    expect(todayIn('Europe/London', at)).toBe('2026-10-10');
    expect(clockIn(at)).toBe('00:30');
    expect(clockIn('2027-03-09T06:40:00Z')).toBe('09:40');
    expect(headerDay(at)).toBe('Sunday 11 Oct');
  });
  it('turns airport wall-clock times into instants', () => {
    expect(zonedToInstant('2027-03-09T09:40', 'Asia/Riyadh').toISOString()).toBe('2027-03-09T06:40:00.000Z');
    expect(zonedToInstant('2027-03-09T13:55', 'Europe/Istanbul').toISOString()).toBe('2027-03-09T10:55:00.000Z');
    // London in summer time (BST, +1).
    expect(zonedToInstant('2027-07-01T10:00', 'Europe/London').toISOString()).toBe('2027-07-01T09:00:00.000Z');
  });
  it('is relative within 2 hours, a clock time after', () => {
    const now = new Date('2027-03-09T03:00:00Z');
    expect(relativeOrClock(new Date('2027-03-09T03:42:00Z'), now)).toEqual({ kind: 'in', minutes: 42 });
    expect(relativeOrClock(new Date('2027-03-09T05:00:00Z'), now)).toEqual({ kind: 'in', minutes: 120 });
    expect(relativeOrClock(new Date('2027-03-09T05:30:00Z'), now)).toEqual({ kind: 'at', clock: '08:30' });
    expect(relativeOrClock(new Date('2027-03-09T02:50:00Z'), now)).toEqual({ kind: 'past', minutes: 10 });
  });
  it('gives a Hijri day where the runtime knows the calendar', () => {
    const h = hijriLabel(new Date('2026-10-10T09:00:00Z'));
    if (h !== null) expect(h).toMatch(/^\D+ \d{1,2}$/);
  });
});

describe('passport validity', () => {
  it('counts days left against a trip', () => {
    // Türkiye wants 150 days after landing on 9 Mar 2027.
    expect(validityDaysLeft('2027-08-14', '2027-03-09')).toBe(158);
    expect(isExpiredOn('2026-10-09', '2026-10-10')).toBe(true);
    expect(isExpiredOn('2026-10-10', '2026-10-10')).toBe(false);
  });
});

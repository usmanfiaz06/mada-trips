import { afterEach, describe, expect, it } from 'vitest';
import { dayLabel, durationLabel, headerDay, hijriDay, rangeLabel, shortDay, timeLabel, monthName } from '../src/dates';
import { formatSar } from '../src/money';
import { formatNumber, localizeDigits, ltr, pickLocale, pluralCategory, resetDisplayPrefs, setDisplayPrefs, stripIsolates } from '../src/locale';

afterEach(() => resetDisplayPrefs());

describe('locale choice', () => {
  it('reads Accept-Language and device tags', () => {
    expect(pickLocale('ar-SA,ar;q=0.9,en;q=0.8')).toBe('ar');
    expect(pickLocale('en-GB,ar;q=0.5')).toBe('en');
    expect(pickLocale('fr-FR,ar;q=0.4')).toBe('ar');
    expect(pickLocale('fr-FR')).toBe('en');
    expect(pickLocale(['ar-EG'])).toBe('ar');
    expect(pickLocale(null)).toBe('en');
    expect(pickLocale('en;q=0,ar')).toBe('ar');
  });
});

describe('Arabic plurals', () => {
  it('has the six CLDR forms', () => {
    expect([0, 1, 2, 3, 10, 11, 99, 100, 102, 103, 111].map((n) => pluralCategory(n, 'ar')))
      .toEqual(['zero', 'one', 'two', 'few', 'few', 'many', 'many', 'other', 'other', 'few', 'many']);
    expect([0, 1, 2].map((n) => pluralCategory(n, 'en'))).toEqual(['other', 'one', 'other']);
  });
});

describe('numbers and money', () => {
  it('formats riyals the Saudi way in Arabic', () => {
    expect(formatSar(864000, { locale: 'ar' })).toBe('8,640 ر.س');
    expect(formatSar(864050, { locale: 'ar' })).toBe('8,640.50 ر.س');
    expect(stripIsolates(formatSar(-64000, { locale: 'ar' }))).toBe('−640 ر.س');
    expect(formatSar(-64000, { locale: 'ar' })).toBe('⁦−640⁩ ر.س');
    expect(formatSar(864000, { locale: 'en' })).toBe('SAR 8,640');
  });
  it('follows the display locale and the digits setting', () => {
    setDisplayPrefs({ locale: 'ar' });
    expect(formatSar(864000)).toBe('8,640 ر.س');
    setDisplayPrefs({ digits: 'arab' });
    expect(formatSar(864050)).toBe('٨٬٦٤٠٫٥٠ ر.س');
    expect(formatNumber(1234567)).toBe('١٬٢٣٤٬٥٦٧');
    expect(localizeDigits('SV263', 'en')).toBe('SV263');
  });
  it('isolates codes only in Arabic', () => {
    expect(ltr('SV263', 'ar')).toBe('⁦SV263⁩');
    expect(ltr('SV263', 'en')).toBe('SV263');
  });
});

describe('dates, times and durations in Arabic', () => {
  it('uses Saudi month names, Gregorian by default', () => {
    expect(dayLabel('2027-03-11', { today: '2027-01-01', locale: 'ar' })).toBe('الخميس 11 مارس');
    expect(dayLabel('2027-03-11', { today: '2026-10-10', locale: 'ar' })).toBe('الخميس 11 مارس 2027');
    expect(shortDay('2027-03-14', 'ar')).toBe('14 مارس');
    expect(rangeLabel('2027-03-14', '2027-03-20', 'ar')).toBe('14–20 مارس');
    expect(rangeLabel('2027-02-28', '2027-03-03', 'ar')).toBe('28 فبراير – 3 مارس');
    expect(monthName(11, 'ar')).toBe('ديسمبر');
    expect(headerDay(new Date('2026-10-10T09:00:00Z'), 'Asia/Riyadh', 'ar')).toBe('السبت 10 أكتوبر');
  });
  it('shows the Hijri date alongside when asked', () => {
    const h = hijriDay('2027-03-11', { locale: 'ar' });
    if (h) {
      expect(h).toMatch(/^\d+ \S+.* \d{4}$/);
      expect(dayLabel('2027-03-11', { today: '2027-01-01', locale: 'ar', hijri: true })).toBe(`الخميس 11 مارس · ${hijriDay('2027-03-11', { locale: 'ar', year: false })}`);
    }
  });
  it('labels durations and clock times', () => {
    expect(durationLabel(220, 'ar')).toBe('3 س 40 د');
    expect(durationLabel(45, 'ar')).toBe('45 د');
    expect(durationLabel(120, 'ar')).toBe('2 س');
    expect(durationLabel(220, 'en')).toBe('3h 40m');
    expect(timeLabel('18:30', { locale: 'ar' })).toBe('18:30');
    expect(timeLabel('18:30', { locale: 'ar', hour12: true })).toBe('6:30 م');
    expect(timeLabel('09:05', { locale: 'en', hour12: true })).toBe('9:05 am');
    expect(timeLabel(new Date('2027-03-09T06:40:00Z'), { locale: 'en' })).toBe('09:40');
    setDisplayPrefs({ locale: 'ar', digits: 'arab' });
    expect(timeLabel('18:30')).toBe('١٨:٣٠');
    expect(dayLabel('2027-03-11', { today: '2027-01-01' })).toBe('الخميس ١١ مارس');
  });
});

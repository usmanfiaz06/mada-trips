import { describe, expect, it } from 'vitest';
import { clampWake, defaultWakeTime, forecastUrl, iosMajor, leaveTime, readForecast, skyOf, stepWake, wakeAt, wakeMethod, WAKE_DEFAULT } from '../../src/lib/wake-logic';

const out = { departLocal: '2027-03-09T09:40', departTz: 'Asia/Riyadh' };

describe('wake-up alarm: the time', () => {
  it('suggests 45 minutes before the pickup', () => {
    expect(defaultWakeTime(out, '07:05')).toBe('06:20');
  });
  it('suggests 200 minutes before departure with no pickup', () => {
    expect(defaultWakeTime(out, null)).toBe('06:20');
    expect(defaultWakeTime({ ...out, departLocal: '2027-03-09T14:00' }, null)).toBe('10:40');
  });
  it('leaves at the pickup, or 155 minutes before departure', () => {
    expect(leaveTime(out, '06:45')).toBe('06:45');
    expect(leaveTime(out, null)).toBe('07:05');
  });
  it('keeps a chosen time between 3 hours and 10 minutes before leaving', () => {
    expect(clampWake('06:20', '07:05')).toBe('06:20');
    expect(clampWake('07:00', '07:05')).toBe('06:55');
    expect(clampWake('03:00', '07:05')).toBe('04:05');
    expect(stepWake('06:55', 5, '07:05')).toBe('06:55');
    expect(stepWake('06:20', -5, '07:05')).toBe('06:15');
  });
  it('counts through midnight', () => {
    expect(clampWake('23:50', '01:10')).toBe('23:50');
  });
  it('rings on the morning of the flight, at the right instant in the airport’s zone', () => {
    const w = wakeAt(out, '07:05', '06:20');
    expect(w.day).toBe('2027-03-09');
    expect(w.local).toBe('2027-03-09T06:20');
    expect(w.at.toISOString()).toBe('2027-03-09T03:20:00.000Z');
  });
  it('rings the evening before for a flight just after midnight', () => {
    const late = { departLocal: '2027-03-10T00:40', departTz: 'Asia/Riyadh' };
    const leave = leaveTime(late, null); // 22:05 the evening before
    expect(leave).toBe('22:05');
    const w = wakeAt(late, leave, defaultWakeTime(late, null));
    expect(w.local).toBe('2027-03-09T21:20');
  });
  it('is off until the person turns it on', () => {
    expect(WAKE_DEFAULT.on).toBe(false);
  });
});

describe('wake-up alarm: what this phone can do', () => {
  it('reads the iOS version', () => {
    expect(iosMajor('26.0.1')).toBe(26);
    expect(iosMajor('18.6')).toBe(18);
    expect(iosMajor(34)).toBe(34);
    expect(iosMajor(undefined)).toBe(0);
  });
  it('uses the Clock app on Android', () => {
    expect(wakeMethod({ os: 'android', version: 34, alarmKit: false })).toBe('android-clock');
  });
  it('uses AlarmKit on iOS 26+ when the module is there and allowed', () => {
    expect(wakeMethod({ os: 'ios', version: '26.0', alarmKit: true })).toBe('ios-alarmkit');
    expect(wakeMethod({ os: 'ios', version: '26.1', alarmKit: true, alarmKitDenied: true })).toBe('ios-notify');
    expect(wakeMethod({ os: 'ios', version: '26.0', alarmKit: false })).toBe('ios-notify');
  });
  it('falls back to a notification on older iOS', () => {
    expect(wakeMethod({ os: 'ios', version: '18.6', alarmKit: true })).toBe('ios-notify');
  });
  it('only shows the switch on the web', () => {
    expect(wakeMethod({ os: 'web', version: undefined, alarmKit: false })).toBe('web');
  });
});

describe('wake-up alarm: the morning text', () => {
  it('reads the hour from an Open-Meteo forecast', () => {
    const json = { hourly: { time: ['2027-03-09T05:00', '2027-03-09T06:00'], temperature_2m: [17.4, 18.6], weather_code: [0, 2] } };
    expect(readForecast(json, '2027-03-09T06:20')).toEqual({ tempC: 19, sky: 'cloudy' });
    expect(readForecast(json, '2027-03-09T09:20')).toBeNull();
    expect(readForecast(null, '2027-03-09T06:20')).toBeNull();
  });
  it('turns weather codes into a few words', () => {
    expect([0, 3, 45, 61, 95, 5].map(skyOf)).toEqual(['clear', 'cloudy', 'fog', 'rain', 'storm', 'dust']);
  });
  it('knows where the home airports are, and skips the weather elsewhere', () => {
    expect(forecastUrl('RUH', '2027-03-09')).toContain('latitude=24.957');
    expect(forecastUrl('XXX', '2027-03-09')).toBeNull();
  });
});

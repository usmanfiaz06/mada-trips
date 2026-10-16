import { describe, expect, it } from 'vitest';
import {
  BookingLoyalty, BookingPrefs, airlineRequests, bookingPrefsOf, hotelRemarks, loyaltyToAttach, maskLoyalty, prefScope, prefsSummary, programmeFor, seatsTogetherOffer,
} from '../src/schemas/booking-prefs';
import { TravelPrefs } from '../src/schemas/wallet';
import { setDisplayPrefs } from '../src/locale';

const saved = TravelPrefs.parse({ seat: 'window', together: true, meal: 'veg', assist: ['wchr'], loyalty: [{ id: 'l1', program: 'alfursan', number: '48213377' }, { id: 'l2', program: 'bonvoy', number: '123456789' }], notes: '', room: 'twin', bed: 'twin', floor: 'high', quiet: true });

describe('booking prefs from the saved ones', () => {
  it('copies everything but loyalty, and older prefs without the room fields still parse', () => {
    const p = bookingPrefsOf(saved);
    expect(p).toEqual({ seat: 'window', together: true, meal: 'veg', assist: ['wchr'], room: 'twin', bed: 'twin', floor: 'high', quiet: true, notes: '' });
    const old = TravelPrefs.parse({ seat: 'aisle', together: false, meal: 'halal', assist: [], loyalty: [], notes: 'hi' });
    expect(old.room).toBe('any');
    expect(bookingPrefsOf(old).notes).toBe('hi');
    expect(bookingPrefsOf(null)).toEqual(BookingPrefs.parse({}));
  });
  it('scopes by what is booked', () => {
    expect(prefScope('trip')).toBe('flight');
    expect(prefScope('quote')).toBe('flight');
    expect(prefScope('stay')).toBe('stay');
    expect(prefScope('package')).toBe('both');
  });
  it('summarises in the reader’s language, only what applies', () => {
    const p = bookingPrefsOf(saved);
    expect(prefsSummary(p, 'flight', 3)).toEqual(['Window', 'Seats together', 'Vegetarian', 'Wheelchair to the gate']);
    expect(prefsSummary(p, 'flight', 1)).not.toContain('Seats together');
    expect(prefsSummary(p, 'stay', 3)).toEqual(['Twin room', 'Twin beds', 'High floor', 'Quiet room', 'Accessible room']);
    expect(prefsSummary(bookingPrefsOf(null), 'stay')).toEqual([]);
    expect(prefsSummary(p, 'stay', 1, 'ar')).toContain('غرفة هادية');
    setDisplayPrefs({ locale: 'en' });
  });
});

describe('what the supplier gets', () => {
  it('airline SSR codes and seat remarks; halal needs no code on a Saudi carrier', () => {
    const p = bookingPrefsOf(saved);
    expect(airlineRequests(p, { carrier: 'TK', travellers: 3 })).toEqual({ ssr: ['VGML', 'WCHR'], remarks: ['SEAT WINDOW', 'SEAT TOGETHER'] });
    expect(airlineRequests(bookingPrefsOf(null), { carrier: 'SV', travellers: 1 })).toEqual({ ssr: [], remarks: [] });
    expect(airlineRequests(bookingPrefsOf(null), { carrier: 'TK', travellers: 1 }).ssr).toEqual(['MOML']);
    expect(airlineRequests({ ...bookingPrefsOf(null), assist: ['infant', 'bassinet'], notes: 'nut allergy' }, { carrier: 'SV', travellers: 2 })).toEqual({ ssr: ['INFT', 'BSCT'], remarks: ['SEAT TOGETHER', 'NUT ALLERGY'] });
  });
  it('hotel remarks in plain words', () => {
    expect(hotelRemarks(bookingPrefsOf(saved))).toEqual(['Twin room', 'Twin beds', 'High floor', 'Quiet room, away from the lift', 'Wheelchair-accessible room']);
    expect(hotelRemarks(bookingPrefsOf(null))).toEqual([]);
    expect(hotelRemarks({ ...bookingPrefsOf(null), room: 'connecting', bed: 'king', assist: ['infant'], notes: 'late arrival' })).toEqual(['Connecting rooms', 'King bed', 'Baby cot', 'late arrival']);
  });
});

describe('paid extras are offered, never added', () => {
  it('prices seats together on flynas per person per way, off until added', () => {
    const p = bookingPrefsOf(saved);
    const o = seatsTogetherOffer(p, null, { carrier: 'XY', travellers: 4, legs: 2 });
    expect(o).toEqual({ key: 'seatsTogether', perPerson: { amount: 3500, currency: 'SAR' }, count: 4, legs: 2, total: { amount: 28000, currency: 'SAR' }, added: false });
    expect(seatsTogetherOffer(p, { seatsTogether: true }, { carrier: 'XY', travellers: 2, legs: 1 })?.added).toBe(true);
  });
  it('is not offered when the fare does not price it, for one traveller, or when sitting together is not wanted', () => {
    const p = bookingPrefsOf(saved);
    expect(seatsTogetherOffer(p, { seatsTogether: true }, { carrier: 'SV', travellers: 4, legs: 2 })).toBeNull();
    expect(seatsTogetherOffer(p, { seatsTogether: true }, { carrier: 'XY', travellers: 1, legs: 2 })).toBeNull();
    expect(seatsTogetherOffer({ ...p, together: false }, { seatsTogether: true }, { carrier: 'XY', travellers: 4, legs: 2 })).toBeNull();
  });
});

describe('loyalty numbers', () => {
  it('finds the programme by carrier and by hotel name', () => {
    expect(programmeFor({ carrier: 'SV' })).toEqual(['alfursan']);
    expect(programmeFor({ carrier: 'xy', hotelName: 'Hilton Istanbul Bosphorus' })).toEqual(['nasmiles', 'hilton']);
    expect(programmeFor({ carrier: 'MS', hotelName: 'Grand Tarabya' })).toEqual([]);
    expect(programmeFor({ hotelName: 'JW Marriott Marquis' })).toEqual(['bonvoy']);
    expect(programmeFor({ hotelName: 'Mövenpick Hotel Istanbul' })).toEqual(['accor']);
  });
  it('attaches the account holder’s saved numbers for the programmes the booking earns on', () => {
    expect(loyaltyToAttach(saved.loyalty, ['alfursan', 'hilton'], 'me', ['me', 'hessa'])).toEqual([{ personId: 'me', program: 'alfursan', number: '48213377' }]);
    expect(loyaltyToAttach(saved.loyalty, ['bonvoy'], 'me', ['hessa'])).toEqual([]);
    expect(loyaltyToAttach([], ['alfursan'], 'me', ['me'])).toEqual([]);
  });
  it('validates the format per programme and masks on screen', () => {
    expect(BookingLoyalty.safeParse({ personId: '10000000-1000-4000-8000-100000000001', program: 'alfursan', number: '12' }).success).toBe(false);
    expect(BookingLoyalty.safeParse({ personId: '10000000-1000-4000-8000-100000000001', program: 'alfursan', number: '4821 3377' }).success).toBe(true);
    expect(BookingLoyalty.safeParse({ personId: '10000000-1000-4000-8000-100000000001', program: 'accor', number: '3081123412341234' }).success).toBe(true);
    expect(maskLoyalty('4821 3377')).toBe('••••3377');
  });
});

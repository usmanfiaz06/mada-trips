import { z } from 'zod';
import {
  AgentRef, AirportCode, BookingRef, CarrierCode, FlightNumber, Id, IsoDateTime, IsoDay, LocalDateTime, Money, TimeZone,
} from './common';

export const Cabin = z.enum(['economy', 'premium', 'business', 'first']);
export type Cabin = z.infer<typeof Cabin>;

/** Live status of a flight, always with where it came from (SCOPE.md §7: every status says its source). */
export const FlightStatus = z.enum(['scheduled', 'on_time', 'delayed', 'boarding', 'departed', 'in_air', 'landed', 'cancelled', 'diverted']);
export type FlightStatus = z.infer<typeof FlightStatus>;

export const FlightSegment = z.object({
  id: Id,
  carrier: CarrierCode,
  carrierName: z.string(),
  flightNumber: FlightNumber,
  from: AirportCode,
  to: AirportCode,
  /** Local wall-clock times at each airport, with the airport's zone. "Lands 16:40 Istanbul time". */
  departLocal: LocalDateTime,
  departTz: TimeZone,
  arriveLocal: LocalDateTime,
  arriveTz: TimeZone,
  durationMin: z.number().int().positive(),
  cabin: Cabin,
  terminal: z.string().nullable(),
  gate: z.string().nullable(),
  seats: z.array(z.string()),
  baggage: z.string().nullable(),
  status: FlightStatus,
  statusSource: z.string().nullable(),
  /** Airline booking reference for this segment. */
  pnr: BookingRef.nullable(),
  direction: z.enum(['out', 'back', 'connection']),
});
export type FlightSegment = z.infer<typeof FlightSegment>;

export const Stay = z.object({
  id: Id,
  name: z.string(),
  area: z.string().nullable(),
  address: z.string().nullable(),
  checkIn: IsoDay,
  nights: z.number().int().positive(),
  rooms: z.number().int().positive(),
  price: Money,
  cancellation: z.string().nullable(),
  status: z.enum(['held', 'booked', 'cancelled']),
  confirmation: z.string().nullable(),
});
export type Stay = z.infer<typeof Stay>;

export const Pickup = z.object({
  id: Id,
  direction: z.enum(['to_airport', 'from_airport']),
  at: IsoDateTime,
  driverName: z.string().nullable(),
  car: z.string().nullable(),
  plate: z.string().nullable(),
  meetingPoint: z.string().nullable(),
  phone: z.string().nullable(),
  price: Money,
  status: z.enum(['held', 'booked', 'cancelled', 'completed']),
});
export type Pickup = z.infer<typeof Pickup>;

export const TripStatus = z.enum(['planning', 'booked', 'in_progress', 'completed', 'cancelled']);

export const Trip = z.object({
  id: Id,
  city: z.string(),
  country: z.string().nullable(),
  imageUrl: z.string().nullable(),
  startDate: IsoDay,
  endDate: IsoDay.nullable(),
  travellerIds: z.array(Id),
  segments: z.array(FlightSegment),
  stays: z.array(Stay),
  pickups: z.array(Pickup),
  status: TripStatus,
  bookingRef: BookingRef.nullable(),
  confirmedBy: AgentRef.nullable(),
  /** Booked somewhere else and imported, so Mada only tracks it. */
  imported: z.boolean(),
  createdAt: IsoDateTime,
});
export type Trip = z.infer<typeof Trip>;

/** A flight on the radar, booked with Mada or not ("Just track a flight"). */
export const TrackedFlight = z.object({
  id: Id,
  flightNumber: FlightNumber,
  carrierName: z.string().nullable(),
  date: IsoDay,
  from: AirportCode.nullable(),
  to: AirportCode.nullable(),
  departLocal: LocalDateTime.nullable(),
  arriveLocal: LocalDateTime.nullable(),
  status: FlightStatus,
  gate: z.string().nullable(),
  terminal: z.string().nullable(),
  /** "Live · airline", "FlightAware". */
  source: z.string().nullable(),
  updatedAt: IsoDateTime,
});
export type TrackedFlight = z.infer<typeof TrackedFlight>;

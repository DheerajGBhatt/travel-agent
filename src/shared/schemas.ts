import { z } from 'zod';

export const BookingRefSchema = z.string().min(1).max(20);
export const BookingIdSchema = z.coerce.number().int().positive();
export const FlightIdSchema = z.coerce.number().int().positive();
export const UserIdSchema = z.coerce.number().int().positive();
export const IataSchema = z.string().length(3).regex(/^[A-Z]{3}$/);

export const GetBookingInput = z.object({ bookingRef: BookingRefSchema });
export const CancelBookingInput = z.object({
  bookingId: BookingIdSchema,
  userId: UserIdSchema,
  reason: z.string().max(500).optional(),
});
export const RescheduleBookingInput = z.object({
  bookingId: BookingIdSchema,
  userId: UserIdSchema,
  newFlightId: FlightIdSchema,
  reason: z.string().max(500).optional(),
});
export const SeatClassSchema = z.enum(['economy', 'premium_economy', 'business', 'first']);

export const BookFlightInput = z.object({
  flightId: FlightIdSchema,
  userId: UserIdSchema,
  seatClass: SeatClassSchema,
  seatNumber: z.string().max(5).optional(),
});

export const GetFlightStatusInput = z.object({ flightId: FlightIdSchema });
export const SearchAlternateFlightsInput = z.object({
  origin: IataSchema,
  destination: IataSchema,
  afterIso: z.string().datetime(),
});
export const GetUserProfileInput = z.object({ userId: UserIdSchema });

export const ChatRequestSchema = z.object({
  sessionId: z.string().min(1).max(100),
  userId: z.string().min(1).max(100),
  message: z.string().min(1).max(4000),
});

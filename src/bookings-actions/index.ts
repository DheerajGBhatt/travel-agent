import { and, eq, ne } from 'drizzle-orm';
import { logger } from '../shared/logger.js';
import { getDb } from '../shared/db.js';
import { flightBookings, bookingModifications, flights } from '../shared/schema.js';
import {
  dispatch,
  type ApiGatewayV2HttpEvent,
  type ApiGatewayV2HttpResponse,
  type BedrockActionGroupEvent,
  type BedrockActionGroupResponse,
  type Routes,
} from '../shared/responses.js';
import {
  GetBookingInput,
  CancelBookingInput,
  RescheduleBookingInput,
  BookFlightInput,
} from '../shared/schemas.js';
import crypto from 'node:crypto';

async function getBooking(params: Record<string, string>) {
  const { bookingRef } = GetBookingInput.parse(params);
  const booking = await getDb().query.flightBookings.findFirst({
    where: eq(flightBookings.bookingRef, bookingRef),
  });
  if (!booking) {
    return {
      statusCode: 404,
      body: { success: false, error: { code: 'NOT_FOUND', message: 'Booking not found' } },
    };
  }
  return { statusCode: 200, body: { success: true, data: booking } };
}

async function cancelBooking(params: Record<string, string>) {
  const { bookingId, userId, reason } = CancelBookingInput.parse(params);
  const result = await getDb().transaction(async (tx) => {
    const updated = await tx
      .update(flightBookings)
      .set({ status: 'cancelled' })
      .where(and(eq(flightBookings.bookingId, bookingId), ne(flightBookings.status, 'cancelled')))
      .returning({
        bookingId: flightBookings.bookingId,
        bookingRef: flightBookings.bookingRef,
        status: flightBookings.status,
      });
    const row = updated[0];
    if (!row) return null;

    const audit = await tx
      .insert(bookingModifications)
      .values({
        bookingType: 'flight',
        bookingId,
        bookingRef: row.bookingRef,
        modificationType: 'cancellation',
        userId,
        reason: reason ?? null,
      })
      .returning({
        modificationId: bookingModifications.modificationId,
        modifiedAt: bookingModifications.modifiedAt,
      });
    return { booking: row, modification: audit[0] };
  });

  if (result === null) {
    return {
      statusCode: 409,
      body: {
        success: false,
        error: { code: 'INVALID_STATE', message: 'Booking already cancelled or missing' },
      },
    };
  }
  return { statusCode: 200, body: { success: true, data: result } };
}

async function rescheduleBooking(params: Record<string, string>) {
  const { bookingId, userId, newFlightId, reason } = RescheduleBookingInput.parse(params);
  const result = await getDb().transaction(async (tx) => {
    const existingRows = await tx
      .select({
        bookingId: flightBookings.bookingId,
        bookingRef: flightBookings.bookingRef,
        flightId: flightBookings.flightId,
      })
      .from(flightBookings)
      .where(eq(flightBookings.bookingId, bookingId))
      .for('update');
    const existing = existingRows[0];
    if (!existing) return null;

    const newFlightRows = await tx
      .select({ flightId: flights.flightId })
      .from(flights)
      .where(eq(flights.flightId, newFlightId))
      .limit(1);
    if (newFlightRows.length === 0) return 'flight_missing' as const;

    await tx
      .update(flightBookings)
      .set({ flightId: newFlightId, status: 'rescheduled' })
      .where(eq(flightBookings.bookingId, bookingId));

    const audit = await tx
      .insert(bookingModifications)
      .values({
        bookingType: 'flight',
        bookingId,
        bookingRef: existing.bookingRef,
        modificationType: 'reschedule',
        userId,
        oldValues: { flightId: existing.flightId },
        newValues: { flightId: newFlightId },
        reason: reason ?? null,
      })
      .returning({
        modificationId: bookingModifications.modificationId,
        modifiedAt: bookingModifications.modifiedAt,
      });
    return { bookingId, newFlightId, modification: audit[0] };
  });

  if (result === null) {
    return {
      statusCode: 404,
      body: { success: false, error: { code: 'NOT_FOUND', message: 'Booking not found' } },
    };
  }
  if (result === 'flight_missing') {
    return {
      statusCode: 404,
      body: { success: false, error: { code: 'NOT_FOUND', message: 'New flight not found' } },
    };
  }
  return { statusCode: 200, body: { success: true, data: result } };
}

function generateBookingRef(): string {
  return 'BK' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
}

async function bookFlight(params: Record<string, string>) {
  const { flightId, userId, seatClass, seatNumber } = BookFlightInput.parse(params);

  const result = await getDb().transaction(async (tx) => {
    const flightRows = await tx
      .select({
        flightId: flights.flightId,
        basePrice: flights.basePrice,
        availableSeats: flights.availableSeats,
        status: flights.status,
      })
      .from(flights)
      .where(eq(flights.flightId, flightId))
      .for('update');
    const flight = flightRows[0];
    if (!flight) return 'flight_not_found' as const;
    if (flight.status !== 'scheduled') return 'flight_not_available' as const;
    if (flight.availableSeats <= 0) return 'no_seats' as const;

    await tx
      .update(flights)
      .set({ availableSeats: flight.availableSeats - 1 })
      .where(eq(flights.flightId, flightId));

    const bookingRef = generateBookingRef();
    const inserted = await tx
      .insert(flightBookings)
      .values({
        userId,
        flightId,
        bookingRef,
        seatClass,
        seatNumber: seatNumber ?? null,
        totalPrice: flight.basePrice,
        status: 'confirmed',
      })
      .returning({
        bookingId: flightBookings.bookingId,
        bookingRef: flightBookings.bookingRef,
        seatClass: flightBookings.seatClass,
        seatNumber: flightBookings.seatNumber,
        totalPrice: flightBookings.totalPrice,
        status: flightBookings.status,
      });
    return inserted[0];
  });

  if (result === 'flight_not_found') {
    return {
      statusCode: 404,
      body: { success: false, error: { code: 'NOT_FOUND', message: 'Flight not found' } },
    };
  }
  if (result === 'flight_not_available') {
    return {
      statusCode: 409,
      body: { success: false, error: { code: 'UNAVAILABLE', message: 'Flight is not available for booking' } },
    };
  }
  if (result === 'no_seats') {
    return {
      statusCode: 409,
      body: { success: false, error: { code: 'NO_SEATS', message: 'No available seats on this flight' } },
    };
  }
  return { statusCode: 201, body: { success: true, data: result } };
}

const routes: Routes = {
  '/bookings/get': getBooking,
  '/bookings/cancel': cancelBooking,
  '/bookings/reschedule': rescheduleBooking,
  '/bookings/create': bookFlight,
};

export const handler = async (
  event: BedrockActionGroupEvent | ApiGatewayV2HttpEvent,
): Promise<BedrockActionGroupResponse | ApiGatewayV2HttpResponse> => {
  logger.info('bookings-actions invoked');
  return dispatch(event, routes);
};

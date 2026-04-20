import {
  pgTable,
  serial,
  integer,
  varchar,
  char,
  numeric,
  timestamp,
  date,
  text,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  userId: serial('user_id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  dateOfBirth: date('date_of_birth'),
  passportNumber: varchar('passport_number', { length: 50 }),
  nationality: varchar('nationality', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const airlines = pgTable('airlines', {
  airlineId: serial('airline_id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: char('code', { length: 2 }).notNull().unique(),
  logoUrl: varchar('logo_url', { length: 500 }),
});

export const airports = pgTable('airports', {
  airportId: serial('airport_id').primaryKey(),
  cityId: integer('city_id'),
  name: varchar('name', { length: 200 }).notNull(),
  code: char('code', { length: 3 }).notNull().unique(),
});

export const flights = pgTable(
  'flights',
  {
    flightId: serial('flight_id').primaryKey(),
    airlineId: integer('airline_id').references(() => airlines.airlineId),
    flightNumber: varchar('flight_number', { length: 10 }).notNull(),
    departureAirport: integer('departure_airport').references(() => airports.airportId),
    arrivalAirport: integer('arrival_airport').references(() => airports.airportId),
    departureTime: timestamp('departure_time').notNull(),
    arrivalTime: timestamp('arrival_time').notNull(),
    basePrice: numeric('base_price', { precision: 10, scale: 2 }).notNull(),
    availableSeats: integer('available_seats').notNull(),
    aircraftType: varchar('aircraft_type', { length: 50 }),
    status: varchar('status', { length: 20 }).default('scheduled'),
  },
  (t) => ({
    departureIdx: index('idx_flights_departure').on(t.departureAirport, t.departureTime),
    routeIdx: index('idx_flights_route').on(t.departureAirport, t.arrivalAirport),
  }),
);

export const flightBookings = pgTable(
  'flight_bookings',
  {
    bookingId: serial('booking_id').primaryKey(),
    userId: integer('user_id').references(() => users.userId),
    flightId: integer('flight_id').references(() => flights.flightId),
    bookingRef: varchar('booking_ref', { length: 10 }).notNull().unique(),
    seatClass: varchar('seat_class', { length: 20 }).notNull(),
    seatNumber: varchar('seat_number', { length: 5 }),
    totalPrice: numeric('total_price', { precision: 10, scale: 2 }).notNull(),
    status: varchar('status', { length: 20 }).default('confirmed'),
    bookedAt: timestamp('booked_at').defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_flight_bookings_user').on(t.userId),
  }),
);

export const flightPassengers = pgTable('flight_passengers', {
  passengerId: serial('passenger_id').primaryKey(),
  bookingId: integer('booking_id').references(() => flightBookings.bookingId),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  dateOfBirth: date('date_of_birth'),
  passportNumber: varchar('passport_number', { length: 50 }),
  seatNumber: varchar('seat_number', { length: 5 }),
});

export const bookingModifications = pgTable(
  'booking_modifications',
  {
    modificationId: serial('modification_id').primaryKey(),
    bookingType: varchar('booking_type', { length: 10 }).notNull(),
    bookingId: integer('booking_id').notNull(),
    bookingRef: varchar('booking_ref', { length: 20 }).notNull(),
    modificationType: varchar('modification_type', { length: 20 }).notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.userId),
    oldValues: jsonb('old_values'),
    newValues: jsonb('new_values'),
    priceDifference: numeric('price_difference', { precision: 10, scale: 2 }).default('0.00'),
    modifiedAt: timestamp('modified_at').defaultNow(),
    modifiedBy: varchar('modified_by', { length: 50 }).default('chatbot_agent'),
    reason: text('reason'),
  },
  (t) => ({
    refIdx: index('idx_booking_modifications_ref').on(t.bookingRef),
    typeIdx: index('idx_booking_modifications_type').on(t.modificationType),
  }),
);

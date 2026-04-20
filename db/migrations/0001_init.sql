BEGIN;

CREATE TABLE users (
  user_id        SERIAL PRIMARY KEY,
  user_uuid      VARCHAR(36) UNIQUE NOT NULL,
  user_name      VARCHAR(100) NOT NULL,
  user_email     VARCHAR(150) UNIQUE NOT NULL,
  user_phone     VARCHAR(30),
  user_passport  VARCHAR(30),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE flights (
  flight_id           SERIAL PRIMARY KEY,
  flight_number       VARCHAR(10) NOT NULL,
  flight_carrier      VARCHAR(50) NOT NULL,
  flight_origin       VARCHAR(3)  NOT NULL,
  flight_destination  VARCHAR(3)  NOT NULL,
  flight_depart_at    TIMESTAMPTZ NOT NULL,
  flight_arrive_at    TIMESTAMPTZ NOT NULL,
  flight_status       VARCHAR(20) NOT NULL DEFAULT 'scheduled'
    CHECK (flight_status IN ('scheduled','delayed','cancelled','departed','arrived')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_flights_number_depart UNIQUE (flight_number, flight_depart_at)
);

CREATE TABLE bookings (
  booking_id        SERIAL PRIMARY KEY,
  booking_ref       VARCHAR(10) UNIQUE NOT NULL,
  user_id           INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  booking_status    VARCHAR(20) NOT NULL DEFAULT 'confirmed'
    CHECK (booking_status IN ('confirmed','cancelled','rescheduled','completed')),
  booking_total     NUMERIC(12,2) NOT NULL CHECK (booking_total >= 0),
  booking_currency  VARCHAR(3) NOT NULL DEFAULT 'USD',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE booking_segments (
  segment_id        SERIAL PRIMARY KEY,
  booking_id        INT NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  flight_id         INT NOT NULL REFERENCES flights(flight_id) ON DELETE RESTRICT,
  segment_order     INT NOT NULL CHECK (segment_order > 0),
  segment_seat      VARCHAR(5),
  segment_status    VARCHAR(20) NOT NULL DEFAULT 'confirmed'
    CHECK (segment_status IN ('confirmed','cancelled','rescheduled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_booking_segments UNIQUE (booking_id, segment_order)
);

CREATE TABLE cancellations (
  cancellation_id   SERIAL PRIMARY KEY,
  booking_id        INT NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  cancelled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancel_reason     VARCHAR(500),
  refund_amount     NUMERIC(12,2) CHECK (refund_amount >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reschedules (
  reschedule_id        SERIAL PRIMARY KEY,
  booking_id           INT NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  old_segment_id       INT NOT NULL REFERENCES booking_segments(segment_id) ON DELETE RESTRICT,
  new_segment_id       INT NOT NULL REFERENCES booking_segments(segment_id) ON DELETE RESTRICT,
  rescheduled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reschedule_reason    VARCHAR(500),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email             ON users(user_email);
CREATE INDEX idx_bookings_user           ON bookings(user_id);
CREATE INDEX idx_bookings_status         ON bookings(booking_status);
CREATE INDEX idx_segments_booking        ON booking_segments(booking_id);
CREATE INDEX idx_segments_flight         ON booking_segments(flight_id);
CREATE INDEX idx_flights_route_depart    ON flights(flight_origin, flight_destination, flight_depart_at);
CREATE INDEX idx_cancellations_booking   ON cancellations(booking_id);
CREATE INDEX idx_reschedules_booking     ON reschedules(booking_id);

COMMIT;

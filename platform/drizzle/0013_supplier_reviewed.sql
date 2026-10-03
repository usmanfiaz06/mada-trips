-- Flight settlement review: tickets recorded before the IATA/Direct choice existed need a
-- director to confirm how they were bought. New sales are marked reviewed on creation;
-- existing rows default to false so they surface for a one-time check.
ALTER TABLE "bookings" ADD COLUMN "supplier_reviewed" boolean DEFAULT false NOT NULL;

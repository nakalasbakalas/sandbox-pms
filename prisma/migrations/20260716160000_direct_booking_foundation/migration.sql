-- Direct booking remains disabled by default. This migration adds immutable
-- quote snapshots and public-token/idempotency metadata to the existing hold
-- model without changing legacy reservation or folio relationships.
CREATE TABLE "PublicBookingQuote" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "roomTypeId" TEXT NOT NULL,
  "checkIn" DATE NOT NULL,
  "checkOut" DATE NOT NULL,
  "adults" INTEGER NOT NULL,
  "children" INTEGER NOT NULL DEFAULT 0,
  "ratePerNightSatang" BIGINT NOT NULL,
  "totalSatang" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'THB',
  "snapshot" JSONB NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicBookingQuote_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InventoryHold"
  ADD COLUMN "quoteId" TEXT,
  ADD COLUMN "reservationId" TEXT,
  ADD COLUMN "publicTokenHash" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "conversionIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "PublicBookingQuote_propertyId_idempotencyKey_key"
  ON "PublicBookingQuote"("propertyId", "idempotencyKey");
CREATE INDEX "PublicBookingQuote_propertyId_roomTypeId_checkIn_checkOut_idx"
  ON "PublicBookingQuote"("propertyId", "roomTypeId", "checkIn", "checkOut");
CREATE INDEX "PublicBookingQuote_createdAt_idx"
  ON "PublicBookingQuote"("createdAt");

CREATE UNIQUE INDEX "InventoryHold_reservationId_key"
  ON "InventoryHold"("reservationId");
CREATE UNIQUE INDEX "InventoryHold_publicTokenHash_key"
  ON "InventoryHold"("publicTokenHash");
CREATE UNIQUE INDEX "InventoryHold_propertyId_idempotencyKey_key"
  ON "InventoryHold"("propertyId", "idempotencyKey");
CREATE UNIQUE INDEX "InventoryHold_propertyId_conversionIdempotencyKey_key"
  ON "InventoryHold"("propertyId", "conversionIdempotencyKey");
CREATE INDEX "InventoryHold_quoteId_idx" ON "InventoryHold"("quoteId");

ALTER TABLE "PublicBookingQuote"
  ADD CONSTRAINT "PublicBookingQuote_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicBookingQuote"
  ADD CONSTRAINT "PublicBookingQuote_roomTypeId_fkey"
  FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryHold"
  ADD CONSTRAINT "InventoryHold_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "PublicBookingQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryHold"
  ADD CONSTRAINT "InventoryHold_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Quote rows are evidence of the price offered at a point in time. Corrections
-- create a new quote rather than rewriting or deleting a prior snapshot.
CREATE FUNCTION prevent_public_booking_quote_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PublicBookingQuote rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PublicBookingQuote_immutable"
BEFORE UPDATE OR DELETE ON "PublicBookingQuote"
FOR EACH ROW EXECUTE FUNCTION prevent_public_booking_quote_mutation();

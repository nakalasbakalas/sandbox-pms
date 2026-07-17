-- Backfill charge ownership from the folio reservation and add a property-scoped
-- idempotency contract for all future charge writes.
BEGIN;

ALTER TABLE "Charge"
  ADD COLUMN "propertyId" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "intentFingerprint" TEXT;

UPDATE "Charge" charge
SET "propertyId" = reservation."propertyId"
FROM "Folio" folio
JOIN "Reservation" reservation ON reservation."id" = folio."reservationId"
WHERE charge."folioId" = folio."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Charge" WHERE "propertyId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot property-scope Charge rows: folio reservation ownership is missing';
  END IF;
END $$;

ALTER TABLE "Charge" ALTER COLUMN "propertyId" SET NOT NULL;
CREATE UNIQUE INDEX "Charge_propertyId_idempotencyKey_key" ON "Charge"("propertyId", "idempotencyKey");
CREATE INDEX "Charge_propertyId_createdAt_idx" ON "Charge"("propertyId", "createdAt");
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

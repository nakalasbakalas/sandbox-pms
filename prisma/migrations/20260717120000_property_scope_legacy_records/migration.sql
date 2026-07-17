-- Attach legacy guest, payment, and audit records to their owning property.
-- Existing installations contain a single SANDBOX property, but reservation/folio
-- joins are preferred so the backfill remains correct for pre-existing test data.
BEGIN;

ALTER TABLE "Guest" ADD COLUMN "propertyId" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT r."guestId"
    FROM "Reservation" r
    GROUP BY r."guestId"
    HAVING COUNT(DISTINCT r."propertyId") > 1
  ) THEN
    RAISE EXCEPTION 'Cannot property-scope Guest rows: one or more guests are linked to reservations in multiple properties; quarantine and reconcile those guests before retrying';
  END IF;
END $$;

UPDATE "Guest" g
SET "propertyId" = owner."propertyId"
FROM (
  SELECT DISTINCT ON (r."guestId") r."guestId", r."propertyId"
  FROM "Reservation" r
  ORDER BY r."guestId", r."createdAt" ASC
) owner
WHERE owner."guestId" = g."id";

UPDATE "Guest" g
SET "propertyId" = p."id"
FROM "Property" p
WHERE g."propertyId" IS NULL AND p."code" = 'SANDBOX';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Guest" WHERE "propertyId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot property-scope Guest rows: no reservation owner or SANDBOX property exists';
  END IF;
END $$;

ALTER TABLE "Guest" ALTER COLUMN "propertyId" SET NOT NULL;
CREATE INDEX "Guest_propertyId_updatedAt_idx" ON "Guest"("propertyId", "updatedAt");
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD COLUMN "propertyId" TEXT;
UPDATE "Payment" p
SET "propertyId" = r."propertyId"
FROM "Folio" f
JOIN "Reservation" r ON r."id" = f."reservationId"
WHERE p."folioId" = f."id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Payment" WHERE "propertyId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot property-scope Payment rows: folio reservation owner is missing';
  END IF;
END $$;

ALTER TABLE "Payment" ALTER COLUMN "propertyId" SET NOT NULL;
DROP INDEX IF EXISTS "Payment_idempotencyKey_key";
DROP INDEX IF EXISTS "Payment_referenceFingerprint_key";
CREATE UNIQUE INDEX "Payment_propertyId_idempotencyKey_key" ON "Payment"("propertyId", "idempotencyKey");
CREATE UNIQUE INDEX "Payment_propertyId_referenceFingerprint_key" ON "Payment"("propertyId", "referenceFingerprint");
CREATE INDEX "Payment_propertyId_createdAt_idx" ON "Payment"("propertyId", "createdAt");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditLog" ADD COLUMN "propertyId" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT a."userId"
    FROM "AuditLog" a
    JOIN "UserPropertyMembership" m ON m."userId" = a."userId" AND m."active" = true
    GROUP BY a."userId"
    HAVING COUNT(DISTINCT m."propertyId") > 1
  ) THEN
    RAISE EXCEPTION 'Cannot property-scope AuditLog rows: one or more audit actors have active memberships in multiple properties; quarantine and reconcile those audit rows before retrying';
  END IF;
END $$;

UPDATE "AuditLog" a
SET "propertyId" = membership."propertyId"
FROM (
  SELECT DISTINCT ON (m."userId") m."userId", m."propertyId"
  FROM "UserPropertyMembership" m
  WHERE m."active" = true
  ORDER BY m."userId", m."createdAt" ASC
) membership
WHERE membership."userId" = a."userId";

UPDATE "AuditLog" a
SET "propertyId" = p."id"
FROM "Property" p
WHERE a."propertyId" IS NULL AND p."code" = 'SANDBOX';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AuditLog" WHERE "propertyId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot property-scope AuditLog rows: no membership owner or SANDBOX property exists';
  END IF;
END $$;

ALTER TABLE "AuditLog" ALTER COLUMN "propertyId" SET NOT NULL;
CREATE INDEX "AuditLog_propertyId_createdAt_idx" ON "AuditLog"("propertyId", "createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

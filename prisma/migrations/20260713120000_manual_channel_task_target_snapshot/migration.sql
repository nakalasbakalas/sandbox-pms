-- Preserve the exact OTA room/rate target shown to an operator for every task
-- revision. Mapping edits must never silently retarget already-issued work.
ALTER TABLE "ManualChannelTask"
ADD COLUMN "targetExternalRoomTypeId" TEXT,
ADD COLUMN "targetExternalRoomTypeName" TEXT,
ADD COLUMN "targetExternalRatePlanId" TEXT;

-- A historical row does not contain enough evidence to reconstruct the exact
-- target shown to its operator. Never infer it from today's mapping: mark the
-- target unverified so completion fails closed and reconciliation supersedes it
-- with a fresh current-value/current-mapping revision.
UPDATE "ManualChannelTask"
SET
  "targetExternalRoomTypeId" = 'legacy-unverified:' || "roomTypeId",
  "targetExternalRoomTypeName" = 'Legacy task target unverified',
  "targetExternalRatePlanId" = NULL;

ALTER TABLE "ManualChannelTask"
ALTER COLUMN "targetExternalRoomTypeId" SET NOT NULL,
ALTER COLUMN "targetExternalRoomTypeName" SET NOT NULL;

ALTER TABLE "ManualChannelTask"
ADD CONSTRAINT "ManualChannelTask_targetExternalRoomTypeId_check"
  CHECK (length(btrim("targetExternalRoomTypeId")) > 0),
ADD CONSTRAINT "ManualChannelTask_targetExternalRoomTypeName_check"
  CHECK (length(btrim("targetExternalRoomTypeName")) > 0);

-- Completed, ignored, and already-past imported rows are evidence only. Keep
-- unresolved NEEDS_REVIEW/ERROR rows actionable when their stay is active,
-- future, or undated so the cutover cannot strand a live booking or
-- cancellation behind Gmail message-id deduplication. New rows are actionable
-- by default; service mutations still fail closed for every archived row.
ALTER TABLE "BookingEmailEvent"
ADD COLUMN "legacyReadOnly" BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE "BookingEmailEvent"
SET "legacyReadOnly" = TRUE
WHERE "status" IN ('PROCESSED', 'IGNORED')
   OR "processedAt" IS NOT NULL
   OR "rejectedAt" IS NOT NULL
   OR ("checkOut" IS NOT NULL AND "checkOut" < CURRENT_DATE);

CREATE INDEX "BookingEmailEvent_propertyId_legacyReadOnly_status_receivedAt_idx"
ON "BookingEmailEvent"("propertyId", "legacyReadOnly", "status", "receivedAt");

-- Older runtime versions closed a folio as soon as it reached zero balance.
-- Active stays need an open folio so staff can post incidentals after a
-- prepayment and throughout the stay. Checkout closes a settled folio; an
-- explicitly overridden unpaid checkout remains open until later settlement.
UPDATE "Folio" AS folio
SET "status" = 'OPEN'
FROM "Reservation" AS reservation
WHERE folio."reservationId" = reservation."id"
  AND reservation."status" IN ('PENDING', 'CONFIRMED', 'HOLD', 'CHECKED_IN')
  AND folio."status" = 'CLOSED';

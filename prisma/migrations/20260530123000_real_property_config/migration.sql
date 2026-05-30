ALTER TABLE "Property"
  ADD COLUMN "publicWebsite" TEXT,
  ADD COLUMN "lineId" TEXT,
  ADD COLUMN "lineUrl" TEXT,
  ADD COLUMN "supportHours" TEXT,
  ADD COLUMN "reservationAlertEmail" TEXT,
  ADD COLUMN "inventoryMinimumRate" DOUBLE PRECISION,
  ADD COLUMN "taxConfiguration" JSONB,
  ADD COLUMN "policies" JSONB,
  ADD COLUMN "operationalSettings" JSONB,
  ADD COLUMN "sourceNotes" JSONB;

ALTER TABLE "Property"
  ALTER COLUMN "defaultCheckOut" SET DEFAULT '12:00';

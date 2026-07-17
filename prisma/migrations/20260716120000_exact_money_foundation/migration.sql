-- Add exact-money shadow columns without removing or changing the legacy Float contract.
-- Values that PostgreSQL cannot safely represent as satang remain NULL for reconciliation.
ALTER TABLE "Property"
  ADD COLUMN "taxRateBasisPoints" INTEGER,
  ADD COLUMN "extraGuestFeeSatang" BIGINT,
  ADD COLUMN "childFeeSatang" BIGINT,
  ADD COLUMN "inventoryMinimumRateSatang" BIGINT;

ALTER TABLE "RoomType" ADD COLUMN "baseRateSatang" BIGINT;

ALTER TABLE "Reservation"
  ADD COLUMN "ratePerNightSatang" BIGINT,
  ADD COLUMN "totalAmountSatang" BIGINT,
  ADD COLUMN "depositAmountSatang" BIGINT;

ALTER TABLE "RoomDateInventory" ADD COLUMN "rateSatang" BIGINT;

ALTER TABLE "Folio"
  ADD COLUMN "subtotalSatang" BIGINT,
  ADD COLUMN "taxSatang" BIGINT,
  ADD COLUMN "totalSatang" BIGINT,
  ADD COLUMN "paidSatang" BIGINT,
  ADD COLUMN "balanceSatang" BIGINT;

ALTER TABLE "Charge"
  ADD COLUMN "amountSatang" BIGINT,
  ADD COLUMN "totalSatang" BIGINT;

ALTER TABLE "Payment"
  ADD COLUMN "amountSatang" BIGINT,
  ADD COLUMN "idempotencyKey" TEXT;

ALTER TABLE "BookingEmailEvent" ADD COLUMN "amountSatang" BIGINT;
ALTER TABLE "HotelOpsTask" ADD COLUMN "rateAmountSatang" BIGINT;

ALTER TABLE "RateRule"
  ADD COLUMN "adjustmentSatang" BIGINT,
  ADD COLUMN "adjustmentBasisPoints" INTEGER;

ALTER TABLE "RateCalendar" ADD COLUMN "rateSatang" BIGINT;

UPDATE "Property"
SET
  "taxRateBasisPoints" = CASE WHEN "taxRate" BETWEEN -21474836.48 AND 21474836.47 THEN ROUND("taxRate" * 100)::INTEGER END,
  "extraGuestFeeSatang" = CASE WHEN "extraGuestFee" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("extraGuestFee" * 100)::BIGINT END,
  "childFeeSatang" = CASE WHEN "childFee" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("childFee" * 100)::BIGINT END,
  "inventoryMinimumRateSatang" = CASE WHEN "inventoryMinimumRate" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("inventoryMinimumRate" * 100)::BIGINT END;

UPDATE "RoomType"
SET "baseRateSatang" = CASE WHEN "baseRate" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("baseRate" * 100)::BIGINT END;

UPDATE "Reservation"
SET
  "ratePerNightSatang" = CASE WHEN "ratePerNight" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("ratePerNight" * 100)::BIGINT END,
  "totalAmountSatang" = CASE WHEN "totalAmount" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("totalAmount" * 100)::BIGINT END,
  "depositAmountSatang" = CASE WHEN "depositAmount" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("depositAmount" * 100)::BIGINT END;

UPDATE "RoomDateInventory"
SET "rateSatang" = CASE WHEN "rate" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("rate" * 100)::BIGINT END;

UPDATE "Folio"
SET
  "subtotalSatang" = CASE WHEN "subtotal" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("subtotal" * 100)::BIGINT END,
  "taxSatang" = CASE WHEN "tax" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("tax" * 100)::BIGINT END,
  "totalSatang" = CASE WHEN "total" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("total" * 100)::BIGINT END,
  "paidSatang" = CASE WHEN "paid" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("paid" * 100)::BIGINT END,
  "balanceSatang" = CASE WHEN "balance" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("balance" * 100)::BIGINT END;

UPDATE "Charge"
SET
  "amountSatang" = CASE WHEN "amount" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("amount" * 100)::BIGINT END,
  "totalSatang" = CASE WHEN "total" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("total" * 100)::BIGINT END;

UPDATE "Payment"
SET "amountSatang" = CASE WHEN "amount" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("amount" * 100)::BIGINT END;

UPDATE "BookingEmailEvent"
SET "amountSatang" = CASE WHEN "amount" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("amount" * 100)::BIGINT END;

UPDATE "HotelOpsTask"
SET "rateAmountSatang" = CASE WHEN "rateAmount" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("rateAmount" * 100)::BIGINT END;

UPDATE "RateRule"
SET
  "adjustmentBasisPoints" = CASE WHEN "adjustmentType" = 'PERCENTAGE' AND "adjustment" BETWEEN -21474836.48 AND 21474836.47 THEN ROUND("adjustment" * 100)::INTEGER END,
  "adjustmentSatang" = CASE WHEN "adjustmentType" <> 'PERCENTAGE' AND "adjustment" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("adjustment" * 100)::BIGINT END;

UPDATE "RateCalendar"
SET "rateSatang" = CASE WHEN "rate" BETWEEN -90071992547409.91 AND 90071992547409.91 THEN ROUND("rate" * 100)::BIGINT END;

CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- Expand-only exact-money foundation.
-- Lite reads and PMS writes use integer satang as the exact-money authority.
-- Existing Float columns remain in dual-write rollback parity during the pilot.
-- Satang columns stay nullable so invalid legacy values are surfaced by reconciliation
-- before any production cutover is attempted.

BEGIN;

-- Add nullable integer shadow columns and integer basis points.
ALTER TABLE "Property"
ADD COLUMN "taxRateBps" INTEGER,
ADD COLUMN "extraGuestFeeSatang" INTEGER,
ADD COLUMN "childFeeSatang" INTEGER,
ADD COLUMN "inventoryMinimumRateSatang" INTEGER;

ALTER TABLE "RoomType"
ADD COLUMN "baseRateSatang" INTEGER;

ALTER TABLE "Reservation"
ADD COLUMN "ratePerNightSatang" INTEGER,
ADD COLUMN "totalAmountSatang" INTEGER,
ADD COLUMN "depositAmountSatang" INTEGER;

ALTER TABLE "RoomDateInventory"
ADD COLUMN "rateSatang" INTEGER;

ALTER TABLE "Folio"
ADD COLUMN "subtotalSatang" INTEGER,
ADD COLUMN "taxSatang" INTEGER,
ADD COLUMN "totalSatang" INTEGER,
ADD COLUMN "paidSatang" INTEGER,
ADD COLUMN "balanceSatang" INTEGER;

ALTER TABLE "Charge"
ADD COLUMN "amountSatang" INTEGER,
ADD COLUMN "totalSatang" INTEGER;

ALTER TABLE "Payment"
ADD COLUMN "amountSatang" INTEGER;

ALTER TABLE "BookingEmailEvent"
ADD COLUMN "amountSatang" INTEGER;

-- Backfill representable nonnegative values with PostgreSQL numeric rounding.
-- Non-finite, negative, or int4-out-of-range legacy values deliberately remain NULL;
-- the read-only reconciliation command reports them and exits nonzero.
UPDATE "Property"
SET
  "taxRateBps" = CASE
    WHEN "taxRate"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    WHEN ROUND("taxRate"::numeric * 100) BETWEEN 0 AND 10000
      THEN ROUND("taxRate"::numeric * 100)::integer
    ELSE NULL
  END,
  "extraGuestFeeSatang" = CASE
    WHEN "extraGuestFee"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    WHEN ROUND("extraGuestFee"::numeric * 100) BETWEEN 0 AND 2147483647
      THEN ROUND("extraGuestFee"::numeric * 100)::integer
    ELSE NULL
  END,
  "childFeeSatang" = CASE
    WHEN "childFee"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    WHEN ROUND("childFee"::numeric * 100) BETWEEN 0 AND 2147483647
      THEN ROUND("childFee"::numeric * 100)::integer
    ELSE NULL
  END,
  "inventoryMinimumRateSatang" = CASE
    WHEN "inventoryMinimumRate" IS NULL THEN NULL
    WHEN "inventoryMinimumRate"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    WHEN ROUND("inventoryMinimumRate"::numeric * 100) BETWEEN 0 AND 2147483647
      THEN ROUND("inventoryMinimumRate"::numeric * 100)::integer
    ELSE NULL
  END;

UPDATE "RoomType"
SET "baseRateSatang" = CASE
  WHEN "baseRate"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
  WHEN ROUND("baseRate"::numeric * 100) BETWEEN 0 AND 2147483647
    THEN ROUND("baseRate"::numeric * 100)::integer
  ELSE NULL
END;

UPDATE "Reservation"
SET
  "ratePerNightSatang" = CASE
    WHEN "ratePerNight"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    WHEN ROUND("ratePerNight"::numeric * 100) BETWEEN 0 AND 2147483647
      THEN ROUND("ratePerNight"::numeric * 100)::integer
    ELSE NULL
  END,
  "totalAmountSatang" = CASE
    WHEN "totalAmount"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    WHEN ROUND("totalAmount"::numeric * 100) BETWEEN 0 AND 2147483647
      THEN ROUND("totalAmount"::numeric * 100)::integer
    ELSE NULL
  END,
  "depositAmountSatang" = CASE
    WHEN "depositAmount"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    WHEN ROUND("depositAmount"::numeric * 100) BETWEEN 0 AND 2147483647
      THEN ROUND("depositAmount"::numeric * 100)::integer
    ELSE NULL
  END;

UPDATE "RoomDateInventory"
SET "rateSatang" = CASE
  WHEN "rate" IS NULL THEN NULL
  WHEN "rate"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
  WHEN ROUND("rate"::numeric * 100) BETWEEN 0 AND 2147483647
    THEN ROUND("rate"::numeric * 100)::integer
  ELSE NULL
END;

UPDATE "Folio"
SET
  "subtotalSatang" = CASE
    WHEN "subtotal"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    WHEN ROUND("subtotal"::numeric * 100) BETWEEN 0 AND 2147483647
      THEN ROUND("subtotal"::numeric * 100)::integer
    ELSE NULL
  END,
  "taxSatang" = CASE
    WHEN "tax"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    WHEN ROUND("tax"::numeric * 100) BETWEEN 0 AND 2147483647
      THEN ROUND("tax"::numeric * 100)::integer
    ELSE NULL
  END,
  "totalSatang" = CASE
    WHEN "total"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    WHEN ROUND("total"::numeric * 100) BETWEEN 0 AND 2147483647
      THEN ROUND("total"::numeric * 100)::integer
    ELSE NULL
  END,
  "paidSatang" = CASE
    WHEN "paid"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    WHEN ROUND("paid"::numeric * 100) BETWEEN 0 AND 2147483647
      THEN ROUND("paid"::numeric * 100)::integer
    ELSE NULL
  END,
  "balanceSatang" = CASE
    WHEN "balance"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    WHEN ROUND("balance"::numeric * 100) BETWEEN -2147483648 AND 2147483647
      THEN ROUND("balance"::numeric * 100)::integer
    ELSE NULL
  END;

UPDATE "Charge"
SET
  "amountSatang" = CASE
    WHEN "amount"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    WHEN ROUND("amount"::numeric * 100) BETWEEN 0 AND 2147483647
      THEN ROUND("amount"::numeric * 100)::integer
    ELSE NULL
  END,
  "totalSatang" = CASE
    WHEN "total"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
    WHEN ROUND("total"::numeric * 100) BETWEEN 0 AND 2147483647
      THEN ROUND("total"::numeric * 100)::integer
    ELSE NULL
  END;

UPDATE "Payment"
SET "amountSatang" = CASE
  WHEN "amount"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
  WHEN ROUND("amount"::numeric * 100) BETWEEN 0 AND 2147483647
    THEN ROUND("amount"::numeric * 100)::integer
  ELSE NULL
END;

-- Provider emails may describe signed adjustments, so keep this shadow signed.
UPDATE "BookingEmailEvent"
SET "amountSatang" = CASE
  WHEN "amount" IS NULL THEN NULL
  WHEN "amount"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
  WHEN ROUND("amount"::numeric * 100) BETWEEN -2147483648 AND 2147483647
    THEN ROUND("amount"::numeric * 100)::integer
  ELSE NULL
END;

-- Domain checks are intentionally limited to facts already enforced by PMS writes.
-- PostgreSQL INTEGER itself enforces the int4 safe range.
ALTER TABLE "Property"
ADD CONSTRAINT "Property_taxRateBps_range_check"
  CHECK ("taxRateBps" IS NULL OR "taxRateBps" BETWEEN 0 AND 10000),
ADD CONSTRAINT "Property_extraGuestFeeSatang_nonnegative_check"
  CHECK ("extraGuestFeeSatang" IS NULL OR "extraGuestFeeSatang" >= 0),
ADD CONSTRAINT "Property_childFeeSatang_nonnegative_check"
  CHECK ("childFeeSatang" IS NULL OR "childFeeSatang" >= 0),
ADD CONSTRAINT "Property_inventoryMinimumRateSatang_nonnegative_check"
  CHECK ("inventoryMinimumRateSatang" IS NULL OR "inventoryMinimumRateSatang" >= 0);

ALTER TABLE "RoomType"
ADD CONSTRAINT "RoomType_baseRateSatang_nonnegative_check"
  CHECK ("baseRateSatang" IS NULL OR "baseRateSatang" >= 0);

ALTER TABLE "Reservation"
ADD CONSTRAINT "Reservation_ratePerNightSatang_nonnegative_check"
  CHECK ("ratePerNightSatang" IS NULL OR "ratePerNightSatang" >= 0),
ADD CONSTRAINT "Reservation_totalAmountSatang_nonnegative_check"
  CHECK ("totalAmountSatang" IS NULL OR "totalAmountSatang" >= 0),
ADD CONSTRAINT "Reservation_depositAmountSatang_nonnegative_check"
  CHECK ("depositAmountSatang" IS NULL OR "depositAmountSatang" >= 0);

ALTER TABLE "RoomDateInventory"
ADD CONSTRAINT "RoomDateInventory_rateSatang_nonnegative_check"
  CHECK ("rateSatang" IS NULL OR "rateSatang" >= 0);

ALTER TABLE "Folio"
ADD CONSTRAINT "Folio_subtotalSatang_nonnegative_check"
  CHECK ("subtotalSatang" IS NULL OR "subtotalSatang" >= 0),
ADD CONSTRAINT "Folio_taxSatang_nonnegative_check"
  CHECK ("taxSatang" IS NULL OR "taxSatang" >= 0),
ADD CONSTRAINT "Folio_totalSatang_nonnegative_check"
  CHECK ("totalSatang" IS NULL OR "totalSatang" >= 0),
ADD CONSTRAINT "Folio_paidSatang_nonnegative_check"
  CHECK ("paidSatang" IS NULL OR "paidSatang" >= 0),
ADD CONSTRAINT "Folio_balanceSatang_int4_range_check"
  CHECK ("balanceSatang" IS NULL OR "balanceSatang" BETWEEN -2147483648 AND 2147483647);

ALTER TABLE "Charge"
ADD CONSTRAINT "Charge_amountSatang_nonnegative_check"
  CHECK ("amountSatang" IS NULL OR "amountSatang" >= 0),
ADD CONSTRAINT "Charge_totalSatang_nonnegative_check"
  CHECK ("totalSatang" IS NULL OR "totalSatang" >= 0);

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_amountSatang_nonnegative_check"
  CHECK ("amountSatang" IS NULL OR "amountSatang" >= 0);

ALTER TABLE "BookingEmailEvent"
ADD CONSTRAINT "BookingEmailEvent_amountSatang_int4_range_check"
  CHECK ("amountSatang" IS NULL OR "amountSatang" BETWEEN -2147483648 AND 2147483647);

COMMIT;

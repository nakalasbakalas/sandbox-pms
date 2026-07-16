-- Complete the exact-money inventory-rate shadow and keep provider storage
-- extensible. Runtime validation still limits enabled adapters to providers
-- the application explicitly supports.

BEGIN;

ALTER TABLE "RateCalendar"
ADD COLUMN "rateSatang" INTEGER;

UPDATE "RateCalendar"
SET "rateSatang" = CASE
  WHEN "rate"::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
  WHEN ROUND("rate"::numeric * 100) BETWEEN 0 AND 2147483647
    THEN ROUND("rate"::numeric * 100)::integer
  ELSE NULL
END;

ALTER TABLE "RateCalendar"
ADD CONSTRAINT "RateCalendar_rateSatang_nonnegative_check"
  CHECK ("rateSatang" IS NULL OR "rateSatang" >= 0);

ALTER TABLE "ManualChannelConnection"
DROP CONSTRAINT IF EXISTS "ManualChannelConnection_providerCode_check";

ALTER TABLE "ManualChannelTask"
DROP CONSTRAINT IF EXISTS "ManualChannelTask_sourceProviderCode_check";

COMMIT;

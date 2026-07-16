DO $assertions$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Property"
    WHERE "id" = 'valid'
      AND "taxRateBps" = 750
      AND "extraGuestFeeSatang" = 12345
      AND "childFeeSatang" = 6789
      AND "inventoryMinimumRateSatang" = 99999
  ) THEN
    RAISE EXCEPTION 'Property satang backfill mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "RoomType" WHERE "id" = 'valid' AND "baseRateSatang" = 150055
  ) THEN
    RAISE EXCEPTION 'RoomType satang backfill mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Reservation"
    WHERE "id" = 'valid'
      AND "ratePerNightSatang" = 100001
      AND "totalAmountSatang" = 200002
      AND "depositAmountSatang" = 60001
  ) THEN
    RAISE EXCEPTION 'Reservation satang backfill mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "RoomDateInventory" WHERE "id" = 'valid' AND "rateSatang" = 123456
  ) THEN
    RAISE EXCEPTION 'RoomDateInventory satang backfill mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "RateCalendar" WHERE "id" = 'valid' AND "rateSatang" = 234567
  ) THEN
    RAISE EXCEPTION 'RateCalendar satang backfill mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Folio"
    WHERE "id" = 'valid'
      AND "subtotalSatang" = 10001
      AND "taxSatang" = 701
      AND "totalSatang" = 10702
      AND "paidSatang" = 5000
      AND "balanceSatang" = 5702
  ) THEN
    RAISE EXCEPTION 'Folio satang backfill mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Charge" WHERE "id" = 'valid' AND "amountSatang" = 1234 AND "totalSatang" = 2468
  ) THEN
    RAISE EXCEPTION 'Charge satang backfill mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Payment" WHERE "id" = 'valid' AND "amountSatang" = 5001
  ) THEN
    RAISE EXCEPTION 'Payment satang backfill mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "BookingEmailEvent" WHERE "id" = 'valid' AND "amountSatang" = -1234
  ) THEN
    RAISE EXCEPTION 'BookingEmailEvent satang backfill mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Property"
    WHERE "id" = 'invalid'
      AND "taxRateBps" IS NULL
      AND "extraGuestFeeSatang" IS NULL
      AND "childFeeSatang" IS NULL
      AND "inventoryMinimumRateSatang" IS NULL
  ) THEN
    RAISE EXCEPTION 'Invalid Property values were not quarantined';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname IN (
      'ManualChannelConnection_providerCode_check',
      'ManualChannelTask_sourceProviderCode_check'
    )
  ) THEN
    RAISE EXCEPTION 'Provider storage is still constrained to the initial adapters';
  END IF;
END
$assertions$;

INSERT INTO "ManualChannelConnection" ("providerCode") VALUES ('future_certified_provider');
INSERT INTO "ManualChannelTask" ("sourceProviderCode") VALUES ('future_certified_provider');

DELETE FROM "Property" WHERE "id" = 'invalid';
DELETE FROM "RoomType" WHERE "id" = 'invalid';
DELETE FROM "Reservation" WHERE "id" = 'invalid';
DELETE FROM "RoomDateInventory" WHERE "id" = 'invalid';
DELETE FROM "RateCalendar" WHERE "id" = 'invalid';
DELETE FROM "Folio" WHERE "id" = 'invalid';
DELETE FROM "Charge" WHERE "id" = 'invalid';
DELETE FROM "Payment" WHERE "id" = 'invalid';

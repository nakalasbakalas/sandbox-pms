-- Persist the exact inclusive total supplied by a verified booking-email event.
-- This prevents later non-pricing edits from silently rebuilding an OTA total
-- from a rounded nightly rate plus local occupancy supplements.
ALTER TABLE "Reservation"
ADD COLUMN "providerTotalSatang" INTEGER,
ADD COLUMN "providerTotalCurrency" TEXT;

ALTER TABLE "Reservation"
ADD CONSTRAINT "Reservation_providerTotalSatang_check"
  CHECK ("providerTotalSatang" IS NULL OR "providerTotalSatang" > 0),
ADD CONSTRAINT "Reservation_providerTotal_pair_check"
  CHECK (("providerTotalSatang" IS NULL) = ("providerTotalCurrency" IS NULL)),
ADD CONSTRAINT "Reservation_providerTotalCurrency_check"
  CHECK ("providerTotalCurrency" IS NULL OR "providerTotalCurrency" ~ '^[A-Z]{3}$');

-- The bounded pre-Lite booking-email import is evidence only. Mark every row
-- that exists at cutover read-only so staff cannot apply stale parser output.
-- Rows ingested after this migration retain the FALSE column default and enter
-- the normal review queue.
UPDATE "BookingEmailEvent"
SET "legacyReadOnly" = TRUE;

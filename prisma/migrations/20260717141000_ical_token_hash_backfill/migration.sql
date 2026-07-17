-- iCal export tokens are bearer credentials. Convert every legacy raw token to
-- the same SHA-256 base64url digest used by server/ical-feed.mjs, and remove the
-- raw value in the same row update.
BEGIN;

UPDATE "Channel"
SET "config" =
  ("config" - 'exportToken')
  ||
  CASE
    WHEN jsonb_typeof("config"->'exportToken') = 'string' THEN
      jsonb_build_object(
        'exportTokenHash',
        rtrim(
          translate(
            encode(
              sha256(convert_to("config"->>'exportToken', 'UTF8')),
              'base64'
            ),
            '+/',
            '-_'
          ),
          '='
        )
      )
    ELSE '{}'::jsonb
  END
WHERE jsonb_typeof("config") = 'object'
  AND "config" ? 'exportToken';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Channel"
    WHERE jsonb_typeof("config") = 'object'
      AND "config" ? 'exportToken'
  ) THEN
    RAISE EXCEPTION 'Raw iCal export tokens remain after migration';
  END IF;
END $$;

COMMIT;

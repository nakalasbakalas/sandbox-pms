UPDATE "Channel"
SET
  "config" = "config" - 'importUrl',
  "syncEnabled" = false
WHERE "config" ? 'importUrl';

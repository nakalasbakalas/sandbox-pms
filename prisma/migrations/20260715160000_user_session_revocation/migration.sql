-- Session versions let the backend invalidate previously issued stateless
-- session tokens after security-sensitive account changes.

BEGIN;

ALTER TABLE "User"
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

COMMIT;

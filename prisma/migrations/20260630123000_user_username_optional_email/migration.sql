-- Add a required username login identifier while allowing staff users without email addresses.
ALTER TABLE "User" ADD COLUMN "username" TEXT;

UPDATE "User"
SET "username" = LOWER("email")
WHERE "username" IS NULL;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_username_idx" ON "User"("username");

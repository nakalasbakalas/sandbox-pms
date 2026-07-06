ALTER TABLE "User"
ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lockedAt" TIMESTAMP(3);

CREATE INDEX "User_lockedAt_idx" ON "User"("lockedAt");

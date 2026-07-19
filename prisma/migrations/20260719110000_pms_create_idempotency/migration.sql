CREATE TABLE "PmsCreateAttempt" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "intentFingerprint" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "resultFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PmsCreateAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PmsCreateAttempt_propertyId_idempotencyKey_key"
ON "PmsCreateAttempt"("propertyId", "idempotencyKey");

CREATE INDEX "PmsCreateAttempt_propertyId_operation_createdAt_idx"
ON "PmsCreateAttempt"("propertyId", "operation", "createdAt");

ALTER TABLE "PmsCreateAttempt"
ADD CONSTRAINT "PmsCreateAttempt_propertyId_fkey"
FOREIGN KEY ("propertyId") REFERENCES "Property"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChannelMutationAttempt" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "intentFingerprint" TEXT NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelMutationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelMutationAttempt_propertyId_idempotencyKey_key"
ON "ChannelMutationAttempt"("propertyId", "idempotencyKey");

CREATE INDEX "ChannelMutationAttempt_propertyId_operation_createdAt_idx"
ON "ChannelMutationAttempt"("propertyId", "operation", "createdAt");

ALTER TABLE "ChannelMutationAttempt"
ADD CONSTRAINT "ChannelMutationAttempt_propertyId_fkey"
FOREIGN KEY ("propertyId") REFERENCES "Property"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

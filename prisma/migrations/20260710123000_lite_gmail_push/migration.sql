-- CreateEnum
CREATE TYPE "BookingEmailPushDeliveryStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'COALESCED',
  'FAILED'
);

-- AlterTable
ALTER TABLE "BookingEmailSource"
ADD COLUMN "lastReconciledAt" TIMESTAMP(3),
ADD COLUMN "lastPushAt" TIMESTAMP(3),
ADD COLUMN "lastErrorAt" TIMESTAMP(3),
ADD COLUMN "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "syncLeaseOwner" TEXT,
ADD COLUMN "syncLeaseUntil" TIMESTAMP(3),
ADD COLUMN "watchHistoryId" TEXT,
ADD COLUMN "watchRenewedAt" TIMESTAMP(3),
ADD COLUMN "watchExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BookingEmailPushDelivery" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "pubsubMessageId" TEXT NOT NULL,
  "subscription" TEXT NOT NULL,
  "notificationHistoryId" TEXT NOT NULL,
  "emailAddress" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "status" "BookingEmailPushDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BookingEmailPushDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BookingEmailPushDelivery_attempts_check" CHECK ("attempts" >= 0)
);

-- CreateIndex
CREATE INDEX "BookingEmailSource_provider_enabled_watchExpiresAt_idx"
ON "BookingEmailSource"("provider", "enabled", "watchExpiresAt");

-- CreateIndex
CREATE INDEX "BookingEmailSource_syncLeaseUntil_idx"
ON "BookingEmailSource"("syncLeaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "BookingEmailPushDelivery_pubsubMessageId_key"
ON "BookingEmailPushDelivery"("pubsubMessageId");

-- CreateIndex
CREATE INDEX "BookingEmailPushDelivery_status_availableAt_idx"
ON "BookingEmailPushDelivery"("status", "availableAt");

-- CreateIndex
CREATE INDEX "BookingEmailPushDelivery_sourceId_status_publishedAt_idx"
ON "BookingEmailPushDelivery"("sourceId", "status", "publishedAt");

-- CreateIndex
CREATE INDEX "BookingEmailPushDelivery_claimedAt_idx"
ON "BookingEmailPushDelivery"("claimedAt");

-- AddForeignKey
ALTER TABLE "BookingEmailPushDelivery"
ADD CONSTRAINT "BookingEmailPushDelivery_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "BookingEmailSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

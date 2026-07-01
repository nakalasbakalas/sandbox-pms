-- Persist staff acknowledgment state separately from notification provider delivery status.
ALTER TABLE "HotelOpsNotification"
  ADD COLUMN "readAt" TIMESTAMP(3),
  ADD COLUMN "readBy" TEXT,
  ADD COLUMN "dismissedAt" TIMESTAMP(3),
  ADD COLUMN "dismissedBy" TEXT;

CREATE INDEX "HotelOpsNotification_propertyId_dismissedAt_createdAt_idx"
  ON "HotelOpsNotification"("propertyId", "dismissedAt", "createdAt");

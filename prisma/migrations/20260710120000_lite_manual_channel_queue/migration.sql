-- AddEnumValue
ALTER TYPE "BookingSource" ADD VALUE IF NOT EXISTS 'TRIP_COM';

-- CreateEnum
CREATE TYPE "ManualChannelDeliveryMode" AS ENUM ('MANUAL', 'CHANNEX');

-- CreateEnum
CREATE TYPE "ManualChannelTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SUPERSEDED', 'FAILED');

-- AlterTable
ALTER TABLE "Reservation"
ADD COLUMN "providerCode" TEXT,
ADD COLUMN "externalReservationId" TEXT,
ADD COLUMN "externalReferenceKey" TEXT;

-- AlterTable
ALTER TABLE "BookingEmailEvent"
ADD COLUMN "providerCode" TEXT,
ADD COLUMN "externalReservationId" TEXT;

-- Preserve provider-scoped attribution for existing OTA reservations without
-- assigning a unique external key until legacy collisions have been reviewed.
UPDATE "Reservation"
SET
  "providerCode" = CASE
    WHEN "source" = 'BOOKING_COM' THEN 'booking_com'
    WHEN "source" = 'AGODA' THEN 'agoda'
    ELSE "providerCode"
  END,
  "externalReservationId" = CASE
    WHEN "source" IN ('BOOKING_COM', 'AGODA') THEN "channelRef"
    ELSE "externalReservationId"
  END
WHERE "source" IN ('BOOKING_COM', 'AGODA');

-- CreateTable
CREATE TABLE "ManualChannelConnection" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "providerCode" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "deliveryMode" "ManualChannelDeliveryMode" NOT NULL DEFAULT 'MANUAL',
  "externalPropertyId" TEXT,
  "extranetUrl" TEXT,
  "credentialRef" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ManualChannelConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManualChannelConnection_providerCode_check"
    CHECK ("providerCode" IN ('booking_com', 'agoda', 'trip_com'))
);

-- CreateTable
CREATE TABLE "ManualChannelRoomMapping" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "roomTypeId" TEXT NOT NULL,
  "externalRoomTypeId" TEXT NOT NULL,
  "externalRoomTypeName" TEXT NOT NULL,
  "externalRatePlanId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ManualChannelRoomMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualChannelTask" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "roomTypeId" TEXT NOT NULL,
  "stayDate" DATE NOT NULL,
  "desiredAvailability" INTEGER NOT NULL,
  "confirmedAvailability" INTEGER,
  "status" "ManualChannelTaskStatus" NOT NULL DEFAULT 'PENDING',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "activeKey" TEXT,
  "triggerType" TEXT NOT NULL,
  "sourceProviderCode" TEXT,
  "sourceReservationId" TEXT,
  "sourceBookingEmailEventId" TEXT,
  "supersedesTaskId" TEXT,
  "createdBy" TEXT NOT NULL,
  "completedBy" TEXT,
  "completedAt" TIMESTAMP(3),
  "completionNotes" TEXT,
  "lastAttemptAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ManualChannelTask_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManualChannelTask_desiredAvailability_check" CHECK ("desiredAvailability" >= 0),
  CONSTRAINT "ManualChannelTask_confirmedAvailability_check"
    CHECK ("confirmedAvailability" IS NULL OR "confirmedAvailability" >= 0),
  CONSTRAINT "ManualChannelTask_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "ManualChannelTask_sourceProviderCode_check"
    CHECK ("sourceProviderCode" IS NULL OR "sourceProviderCode" IN ('booking_com', 'agoda', 'trip_com')),
  CONSTRAINT "ManualChannelTask_activeKey_check"
    CHECK (
      ("status" IN ('PENDING', 'IN_PROGRESS', 'FAILED') AND "activeKey" IS NOT NULL)
      OR ("status" IN ('COMPLETED', 'SUPERSEDED') AND "activeKey" IS NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_externalReferenceKey_key" ON "Reservation"("externalReferenceKey");

-- CreateIndex
CREATE INDEX "Reservation_propertyId_providerCode_externalReservationId_idx"
ON "Reservation"("propertyId", "providerCode", "externalReservationId");

-- CreateIndex
CREATE INDEX "BookingEmailEvent_propertyId_providerCode_externalReservationId_idx"
ON "BookingEmailEvent"("propertyId", "providerCode", "externalReservationId");

-- CreateIndex
CREATE UNIQUE INDEX "ManualChannelConnection_propertyId_providerCode_key"
ON "ManualChannelConnection"("propertyId", "providerCode");

-- CreateIndex
CREATE INDEX "ManualChannelConnection_propertyId_enabled_idx"
ON "ManualChannelConnection"("propertyId", "enabled");

-- CreateIndex
CREATE INDEX "ManualChannelConnection_deliveryMode_enabled_idx"
ON "ManualChannelConnection"("deliveryMode", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ManualChannelRoomMapping_connectionId_roomTypeId_key"
ON "ManualChannelRoomMapping"("connectionId", "roomTypeId");

-- CreateIndex
CREATE INDEX "ManualChannelRoomMapping_roomTypeId_active_idx"
ON "ManualChannelRoomMapping"("roomTypeId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ManualChannelTask_activeKey_key" ON "ManualChannelTask"("activeKey");

-- CreateIndex
CREATE UNIQUE INDEX "ManualChannelTask_supersedesTaskId_key" ON "ManualChannelTask"("supersedesTaskId");

-- CreateIndex
CREATE INDEX "ManualChannelTask_propertyId_status_stayDate_idx"
ON "ManualChannelTask"("propertyId", "status", "stayDate");

-- CreateIndex
CREATE INDEX "ManualChannelTask_connectionId_roomTypeId_stayDate_createdAt_idx"
ON "ManualChannelTask"("connectionId", "roomTypeId", "stayDate", "createdAt");

-- CreateIndex
CREATE INDEX "ManualChannelTask_sourceReservationId_idx" ON "ManualChannelTask"("sourceReservationId");

-- CreateIndex
CREATE INDEX "ManualChannelTask_sourceBookingEmailEventId_idx" ON "ManualChannelTask"("sourceBookingEmailEventId");

-- AddForeignKey
ALTER TABLE "ManualChannelConnection"
ADD CONSTRAINT "ManualChannelConnection_propertyId_fkey"
FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualChannelRoomMapping"
ADD CONSTRAINT "ManualChannelRoomMapping_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "ManualChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualChannelRoomMapping"
ADD CONSTRAINT "ManualChannelRoomMapping_roomTypeId_fkey"
FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualChannelTask"
ADD CONSTRAINT "ManualChannelTask_propertyId_fkey"
FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualChannelTask"
ADD CONSTRAINT "ManualChannelTask_connectionId_fkey"
FOREIGN KEY ("connectionId") REFERENCES "ManualChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualChannelTask"
ADD CONSTRAINT "ManualChannelTask_roomTypeId_fkey"
FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualChannelTask"
ADD CONSTRAINT "ManualChannelTask_sourceReservationId_fkey"
FOREIGN KEY ("sourceReservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualChannelTask"
ADD CONSTRAINT "ManualChannelTask_sourceBookingEmailEventId_fkey"
FOREIGN KEY ("sourceBookingEmailEventId") REFERENCES "BookingEmailEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualChannelTask"
ADD CONSTRAINT "ManualChannelTask_supersedesTaskId_fkey"
FOREIGN KEY ("supersedesTaskId") REFERENCES "ManualChannelTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

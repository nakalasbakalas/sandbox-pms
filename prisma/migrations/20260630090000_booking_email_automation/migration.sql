-- CreateEnum
CREATE TYPE "BookingEmailProvider" AS ENUM ('GMAIL', 'IMAP', 'FORWARDED_MAILBOX', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "BookingEmailEventStatus" AS ENUM ('NEEDS_REVIEW', 'PROCESSED', 'ERROR', 'IGNORED');

-- CreateEnum
CREATE TYPE "BookingEmailEventType" AS ENUM ('NEW_BOOKING', 'MODIFICATION', 'CANCELLATION', 'PAYMENT_NOTICE', 'GUEST_MESSAGE', 'UNKNOWN');

-- CreateTable
CREATE TABLE "BookingEmailSource" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "BookingEmailProvider" NOT NULL DEFAULT 'GMAIL',
    "mailbox" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autoProcessSafeEvents" BOOLEAN NOT NULL DEFAULT false,
    "reviewThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "query" TEXT,
    "credentialsRef" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncCursor" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingEmailSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingEmailEvent" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceName" TEXT,
    "sourceMailbox" TEXT,
    "sourceMessageId" TEXT,
    "threadId" TEXT,
    "rawEmailUrl" TEXT,
    "sender" TEXT NOT NULL,
    "recipient" TEXT,
    "subject" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "eventType" "BookingEmailEventType" NOT NULL DEFAULT 'UNKNOWN',
    "status" "BookingEmailEventStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "channelRef" TEXT,
    "guestName" TEXT,
    "checkIn" DATE,
    "checkOut" DATE,
    "roomType" TEXT,
    "amount" DOUBLE PRECISION,
    "currency" TEXT,
    "paymentStatus" TEXT,
    "proposedAction" TEXT,
    "completedAction" TEXT,
    "reviewReason" TEXT,
    "errorReason" TEXT,
    "parsedDetails" JSONB,
    "rawHeaders" JSONB,
    "rawText" TEXT,
    "reservationId" TEXT,
    "duplicateOfEventId" TEXT,
    "processedAt" TIMESTAMP(3),
    "processedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingEmailEvent_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "sourceEmailEventId" TEXT;

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN "sourceEmailEventId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "referenceFingerprint" TEXT;
ALTER TABLE "Payment" ADD COLUMN "sourceEmailEventId" TEXT;

-- AlterTable
ALTER TABLE "GuestDocument" ADD COLUMN "reservationId" TEXT;
ALTER TABLE "GuestDocument" ADD COLUMN "sourceEmailEventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BookingEmailSource_propertyId_mailbox_key" ON "BookingEmailSource"("propertyId", "mailbox");
CREATE INDEX "BookingEmailSource_propertyId_enabled_idx" ON "BookingEmailSource"("propertyId", "enabled");
CREATE INDEX "BookingEmailSource_provider_idx" ON "BookingEmailSource"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "BookingEmailEvent_sourceId_sourceMessageId_key" ON "BookingEmailEvent"("sourceId", "sourceMessageId");
CREATE INDEX "BookingEmailEvent_propertyId_status_receivedAt_idx" ON "BookingEmailEvent"("propertyId", "status", "receivedAt");
CREATE INDEX "BookingEmailEvent_sourceId_receivedAt_idx" ON "BookingEmailEvent"("sourceId", "receivedAt");
CREATE INDEX "BookingEmailEvent_reservationId_idx" ON "BookingEmailEvent"("reservationId");
CREATE INDEX "BookingEmailEvent_eventType_status_idx" ON "BookingEmailEvent"("eventType", "status");
CREATE INDEX "BookingEmailEvent_channelRef_idx" ON "BookingEmailEvent"("channelRef");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_sourceEmailEventId_key" ON "Reservation"("sourceEmailEventId");
CREATE INDEX "Charge_sourceEmailEventId_idx" ON "Charge"("sourceEmailEventId");
CREATE UNIQUE INDEX "Payment_referenceFingerprint_key" ON "Payment"("referenceFingerprint");
CREATE UNIQUE INDEX "Payment_sourceEmailEventId_key" ON "Payment"("sourceEmailEventId");
CREATE INDEX "Payment_reference_idx" ON "Payment"("reference");
CREATE INDEX "GuestDocument_reservationId_idx" ON "GuestDocument"("reservationId");
CREATE INDEX "GuestDocument_sourceEmailEventId_idx" ON "GuestDocument"("sourceEmailEventId");

-- AddForeignKey
ALTER TABLE "BookingEmailSource" ADD CONSTRAINT "BookingEmailSource_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingEmailEvent" ADD CONSTRAINT "BookingEmailEvent_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BookingEmailEvent" ADD CONSTRAINT "BookingEmailEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "BookingEmailSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BookingEmailEvent" ADD CONSTRAINT "BookingEmailEvent_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BookingEmailEvent" ADD CONSTRAINT "BookingEmailEvent_duplicateOfEventId_fkey" FOREIGN KEY ("duplicateOfEventId") REFERENCES "BookingEmailEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_sourceEmailEventId_fkey" FOREIGN KEY ("sourceEmailEventId") REFERENCES "BookingEmailEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_sourceEmailEventId_fkey" FOREIGN KEY ("sourceEmailEventId") REFERENCES "BookingEmailEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_sourceEmailEventId_fkey" FOREIGN KEY ("sourceEmailEventId") REFERENCES "BookingEmailEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GuestDocument" ADD CONSTRAINT "GuestDocument_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GuestDocument" ADD CONSTRAINT "GuestDocument_sourceEmailEventId_fkey" FOREIGN KEY ("sourceEmailEventId") REFERENCES "BookingEmailEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

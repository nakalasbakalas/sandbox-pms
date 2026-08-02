ALTER TYPE "BookingSource" ADD VALUE IF NOT EXISTS 'TRIP';
ALTER TYPE "ChannelProvider" ADD VALUE IF NOT EXISTS 'TRIP';

ALTER TABLE "BookingEmailEvent"
  ADD COLUMN "automationDecision" JSONB,
  ADD COLUMN "managerReviewNotifiedAt" TIMESTAMP(3);

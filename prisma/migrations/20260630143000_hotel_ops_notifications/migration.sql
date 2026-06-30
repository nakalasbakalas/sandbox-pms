-- Hotel Ops notification persistence for in-app delivery and email intents.
CREATE TYPE "HotelOpsNotificationType" AS ENUM ('TASK_UPDATE', 'APPROVAL_REQUEST', 'TREND_ALERT', 'NEEDS_HUMAN', 'EMERGENCY_STOP');
CREATE TYPE "HotelOpsNotificationChannel" AS ENUM ('IN_APP', 'EMAIL');
CREATE TYPE "HotelOpsNotificationStatus" AS ENUM ('RECORDED', 'PENDING_PROVIDER', 'SENT', 'FAILED');

CREATE TABLE "HotelOpsNotification" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "taskId" TEXT,
    "trendAlertId" TEXT,
    "type" "HotelOpsNotificationType" NOT NULL,
    "channel" "HotelOpsNotificationChannel" NOT NULL,
    "status" "HotelOpsNotificationStatus" NOT NULL DEFAULT 'RECORDED',
    "recipientRole" "HotelOpsRole",
    "recipientUserId" TEXT,
    "recipientAddress" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actionUrl" TEXT,
    "metadata" JSONB,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HotelOpsNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HotelOpsNotification_propertyId_status_createdAt_idx" ON "HotelOpsNotification"("propertyId", "status", "createdAt");
CREATE INDEX "HotelOpsNotification_taskId_createdAt_idx" ON "HotelOpsNotification"("taskId", "createdAt");
CREATE INDEX "HotelOpsNotification_trendAlertId_createdAt_idx" ON "HotelOpsNotification"("trendAlertId", "createdAt");
CREATE INDEX "HotelOpsNotification_type_channel_idx" ON "HotelOpsNotification"("type", "channel");

ALTER TABLE "HotelOpsNotification" ADD CONSTRAINT "HotelOpsNotification_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HotelOpsNotification" ADD CONSTRAINT "HotelOpsNotification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "HotelOpsTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HotelOpsNotification" ADD CONSTRAINT "HotelOpsNotification_trendAlertId_fkey" FOREIGN KEY ("trendAlertId") REFERENCES "HotelOpsTrendAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hotel Ops AI Command Center persistence.
CREATE TYPE "HotelOpsPlatform" AS ENUM ('booking', 'agoda', 'trip', 'expedia', 'all', 'unknown');
CREATE TYPE "HotelOpsTaskType" AS ENUM ('READ_RESERVATIONS', 'READ_GUEST_MESSAGES', 'DRAFT_GUEST_REPLY', 'SEND_GUEST_REPLY', 'READ_RATES', 'UPDATE_RATE', 'READ_AVAILABILITY', 'UPDATE_AVAILABILITY', 'CLOSE_ROOM', 'OPEN_ROOM', 'UPDATE_DESCRIPTION', 'UPDATE_PHOTOS', 'SCAN_BOOKINGS', 'GENERATE_RECOMMENDATION', 'NO_OP_CLARIFY', 'FORBIDDEN');
CREATE TYPE "HotelOpsRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'FORBIDDEN');
CREATE TYPE "HotelOpsTaskStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DENIED', 'CANCELLED', 'NEEDS_HUMAN');
CREATE TYPE "HotelOpsSourceChannel" AS ENUM ('web', 'line', 'whatsapp', 'telegram', 'email', 'system');
CREATE TYPE "HotelOpsRole" AS ENUM ('OWNER', 'HOTEL_MANAGER', 'STAFF', 'VIEWER', 'SYSTEM');
CREATE TYPE "HotelOpsApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED');
CREATE TYPE "HotelOpsTrendAlertType" AS ENUM ('HIGH_DEMAND', 'LOW_DEMAND', 'CANCELLATION_SPIKE', 'WEEKEND_SPIKE', 'ROOM_IMBALANCE', 'OTA_IMBALANCE', 'INFO');
CREATE TYPE "HotelOpsAlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "HotelOpsTrendAlertStatus" AS ENUM ('CREATED', 'ACKNOWLEDGED', 'RECOMMENDATION_APPROVED', 'RESOLVED');

CREATE TABLE "HotelOpsTask" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "requesterLabel" TEXT,
    "rawMessage" TEXT NOT NULL,
    "sourceChannel" "HotelOpsSourceChannel" NOT NULL DEFAULT 'web',
    "taskType" "HotelOpsTaskType" NOT NULL,
    "platform" "HotelOpsPlatform" NOT NULL DEFAULT 'unknown',
    "hotelId" TEXT NOT NULL,
    "roomType" TEXT,
    "dateStart" DATE,
    "dateEnd" DATE,
    "rateAmount" DOUBLE PRECISION,
    "rateCurrency" TEXT,
    "availabilityRooms" INTEGER,
    "availabilityStatus" TEXT,
    "message" TEXT,
    "riskLevel" "HotelOpsRiskLevel" NOT NULL,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "missingFields" TEXT[],
    "rationale" TEXT NOT NULL,
    "status" "HotelOpsTaskStatus" NOT NULL DEFAULT 'DRAFT',
    "idempotencyKey" TEXT NOT NULL,
    "permissionDecision" JSONB,
    "proofScreenshots" JSONB,
    "executionSummary" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotelOpsTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HotelOpsTaskApproval" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "requiredRole" "HotelOpsRole" NOT NULL,
    "status" "HotelOpsApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "notes" TEXT,

    CONSTRAINT "HotelOpsTaskApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HotelOpsTaskLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HotelOpsTaskLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HotelOpsTrendAlert" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "alertType" "HotelOpsTrendAlertType" NOT NULL,
    "severity" "HotelOpsAlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "platform" "HotelOpsPlatform",
    "roomType" TEXT,
    "dateStart" DATE,
    "dateEnd" DATE,
    "metrics" JSONB NOT NULL,
    "recommendedAction" JSONB,
    "status" "HotelOpsTrendAlertStatus" NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotelOpsTrendAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HotelOpsEmergencyStop" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotelOpsEmergencyStop_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HotelOpsTask_idempotencyKey_key" ON "HotelOpsTask"("idempotencyKey");
CREATE INDEX "HotelOpsTask_propertyId_status_createdAt_idx" ON "HotelOpsTask"("propertyId", "status", "createdAt");
CREATE INDEX "HotelOpsTask_taskType_riskLevel_idx" ON "HotelOpsTask"("taskType", "riskLevel");
CREATE INDEX "HotelOpsTask_requesterUserId_createdAt_idx" ON "HotelOpsTask"("requesterUserId", "createdAt");
CREATE INDEX "HotelOpsTaskApproval_taskId_status_idx" ON "HotelOpsTaskApproval"("taskId", "status");
CREATE INDEX "HotelOpsTaskApproval_status_requestedAt_idx" ON "HotelOpsTaskApproval"("status", "requestedAt");
CREATE INDEX "HotelOpsTaskLog_taskId_createdAt_idx" ON "HotelOpsTaskLog"("taskId", "createdAt");
CREATE INDEX "HotelOpsTaskLog_action_createdAt_idx" ON "HotelOpsTaskLog"("action", "createdAt");
CREATE INDEX "HotelOpsTrendAlert_propertyId_status_createdAt_idx" ON "HotelOpsTrendAlert"("propertyId", "status", "createdAt");
CREATE INDEX "HotelOpsTrendAlert_alertType_severity_idx" ON "HotelOpsTrendAlert"("alertType", "severity");
CREATE UNIQUE INDEX "HotelOpsEmergencyStop_propertyId_key" ON "HotelOpsEmergencyStop"("propertyId");

ALTER TABLE "HotelOpsTask" ADD CONSTRAINT "HotelOpsTask_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HotelOpsTaskApproval" ADD CONSTRAINT "HotelOpsTaskApproval_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "HotelOpsTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HotelOpsTaskLog" ADD CONSTRAINT "HotelOpsTaskLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "HotelOpsTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HotelOpsTrendAlert" ADD CONSTRAINT "HotelOpsTrendAlert_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HotelOpsEmergencyStop" ADD CONSTRAINT "HotelOpsEmergencyStop_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

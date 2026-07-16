-- Persistent housekeeping operations and idempotent property business-date close.
CREATE TYPE "HousekeepingTaskKind" AS ENUM (
  'TURNOVER', 'CLEANING', 'INSPECTION', 'DEEP_CLEAN', 'LINEN', 'MAINTENANCE_FOLLOW_UP', 'OTHER'
);
CREATE TYPE "HousekeepingTaskStatus" AS ENUM (
  'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'
);
CREATE TYPE "HousekeepingPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "HousekeepingIssueCategory" AS ENUM (
  'HOUSEKEEPING', 'MAINTENANCE', 'SAFETY', 'DAMAGE', 'SUPPLY', 'OTHER'
);
CREATE TYPE "HousekeepingIssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "HousekeepingIssueStatus" AS ENUM (
  'OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'
);
CREATE TYPE "NightAuditStatus" AS ENUM ('RUNNING', 'BLOCKED', 'COMPLETED', 'FAILED');

CREATE TABLE "HousekeepingTask" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "kind" "HousekeepingTaskKind" NOT NULL,
  "status" "HousekeepingTaskStatus" NOT NULL DEFAULT 'OPEN',
  "priority" "HousekeepingPriority" NOT NULL DEFAULT 'NORMAL',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "scheduledFor" DATE,
  "assignedToUserId" TEXT,
  "createdBy" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HousekeepingTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HousekeepingTaskStatusLog" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "fromStatus" "HousekeepingTaskStatus",
  "toStatus" "HousekeepingTaskStatus" NOT NULL,
  "changedBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HousekeepingTaskStatusLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HousekeepingIssue" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "taskId" TEXT,
  "category" "HousekeepingIssueCategory" NOT NULL,
  "severity" "HousekeepingIssueSeverity" NOT NULL DEFAULT 'MEDIUM',
  "status" "HousekeepingIssueStatus" NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "assignedToUserId" TEXT,
  "reportedBy" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HousekeepingIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HousekeepingIssueStatusLog" (
  "id" TEXT NOT NULL,
  "issueId" TEXT NOT NULL,
  "fromStatus" "HousekeepingIssueStatus",
  "toStatus" "HousekeepingIssueStatus" NOT NULL,
  "changedBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HousekeepingIssueStatusLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NightAuditRun" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "status" "NightAuditStatus" NOT NULL DEFAULT 'RUNNING',
  "initiatedBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "overrideReason" TEXT,
  "unresolvedArrivals" INTEGER NOT NULL DEFAULT 0,
  "unresolvedDepartures" INTEGER NOT NULL DEFAULT 0,
  "inHouseReservations" INTEGER NOT NULL DEFAULT 0,
  "openFolios" INTEGER NOT NULL DEFAULT 0,
  "housekeepingBlockers" INTEGER NOT NULL DEFAULT 0,
  "unpostedRoomCharges" INTEGER NOT NULL DEFAULT 0,
  "chargesTotalSatang" BIGINT NOT NULL DEFAULT 0,
  "paymentsTotalSatang" BIGINT NOT NULL DEFAULT 0,
  "balanceTotalSatang" BIGINT NOT NULL DEFAULT 0,
  "blockers" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NightAuditRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NightAuditAttempt" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "NightAuditStatus" NOT NULL,
  "initiatedBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "overrideReason" TEXT,
  "outcome" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NightAuditAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HousekeepingTask_propertyId_status_scheduledFor_idx"
  ON "HousekeepingTask"("propertyId", "status", "scheduledFor");
CREATE INDEX "HousekeepingTask_roomId_status_idx" ON "HousekeepingTask"("roomId", "status");
CREATE INDEX "HousekeepingTask_assignedToUserId_status_idx"
  ON "HousekeepingTask"("assignedToUserId", "status");
CREATE INDEX "HousekeepingTaskStatusLog_taskId_createdAt_idx"
  ON "HousekeepingTaskStatusLog"("taskId", "createdAt");
CREATE INDEX "HousekeepingIssue_propertyId_status_severity_idx"
  ON "HousekeepingIssue"("propertyId", "status", "severity");
CREATE INDEX "HousekeepingIssue_roomId_status_idx" ON "HousekeepingIssue"("roomId", "status");
CREATE INDEX "HousekeepingIssue_taskId_idx" ON "HousekeepingIssue"("taskId");
CREATE INDEX "HousekeepingIssue_assignedToUserId_status_idx"
  ON "HousekeepingIssue"("assignedToUserId", "status");
CREATE INDEX "HousekeepingIssueStatusLog_issueId_createdAt_idx"
  ON "HousekeepingIssueStatusLog"("issueId", "createdAt");
CREATE UNIQUE INDEX "NightAuditRun_propertyId_businessDate_key"
  ON "NightAuditRun"("propertyId", "businessDate");
CREATE INDEX "NightAuditRun_propertyId_status_businessDate_idx"
  ON "NightAuditRun"("propertyId", "status", "businessDate");
CREATE UNIQUE INDEX "NightAuditAttempt_propertyId_idempotencyKey_key"
  ON "NightAuditAttempt"("propertyId", "idempotencyKey");
CREATE INDEX "NightAuditAttempt_runId_createdAt_idx"
  ON "NightAuditAttempt"("runId", "createdAt");

ALTER TABLE "HousekeepingTask"
  ADD CONSTRAINT "HousekeepingTask_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "HousekeepingTask_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HousekeepingTask_assignedToUserId_fkey"
  FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HousekeepingTaskStatusLog"
  ADD CONSTRAINT "HousekeepingTaskStatusLog_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "HousekeepingTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HousekeepingIssue"
  ADD CONSTRAINT "HousekeepingIssue_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "HousekeepingIssue_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HousekeepingIssue_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "HousekeepingTask"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "HousekeepingIssue_assignedToUserId_fkey"
  FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "HousekeepingIssueStatusLog"
  ADD CONSTRAINT "HousekeepingIssueStatusLog_issueId_fkey"
  FOREIGN KEY ("issueId") REFERENCES "HousekeepingIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NightAuditRun"
  ADD CONSTRAINT "NightAuditRun_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NightAuditAttempt"
  ADD CONSTRAINT "NightAuditAttempt_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "NightAuditAttempt_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "NightAuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 1 autonomous operations foundation is storage-only and shadow-only.
-- No provider acknowledgement or compensation tables are introduced until
-- credentialed outbound writes and read-back verification are implemented.

BEGIN;

-- Legacy Channel.credentials must never be copied into another column. Abort
-- before changing the table if any row contains non-empty credential JSON so
-- an operator can quarantine and rotate it outside the migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Channel"
    WHERE "credentials" IS NOT NULL
      AND "credentials" <> '{}'::jsonb
  ) THEN
    RAISE EXCEPTION 'Autonomy migration blocked: Channel.credentials contains non-empty JSON; quarantine and rotate legacy credentials before retrying';
  END IF;
END $$;

ALTER TABLE "Channel"
  ADD COLUMN "credentialRef" TEXT,
  ADD COLUMN "credentialStatus" JSONB;

UPDATE "Channel"
SET "credentialStatus" = jsonb_build_object(
  'state', 'not_configured',
  'source', 'legacy_empty',
  'secretStored', false
)
WHERE "credentials" = '{}'::jsonb;

-- Keep the legacy column available only so the previous application build can
-- be used for an emergency app rollback after this additive migration. New
-- Prisma clients ignore it, and the database rejects every non-empty value.
ALTER TABLE "Channel"
  ALTER COLUMN "credentials" SET DEFAULT '{}'::jsonb,
  ADD CONSTRAINT "Channel_credentials_must_be_empty"
    CHECK ("credentials" = '{}'::jsonb);

ALTER TABLE "Channel"
  ADD CONSTRAINT "Channel_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "AutonomyMode" AS ENUM ('OBSERVE', 'SHADOW', 'PROHIBITED');
CREATE TYPE "ProviderSourceTrust" AS ENUM (
  'SIGNED_OTA_WEBHOOK',
  'AUTHENTICATED_CHANNEL_WEBHOOK',
  'AUTHENTICATED_OTA_API',
  'PROVIDER_ACKNOWLEDGEMENT',
  'STRUCTURED_OTA_EMAIL',
  'VALIDATED_PROVIDER_ATTACHMENT',
  'FREE_TEXT_GUEST_EMAIL',
  'STAFF_COMMAND',
  'AI_INTERPRETATION'
);
CREATE TYPE "ExternalProviderEventStatus" AS ENUM (
  'RECEIVED', 'NORMALIZED', 'SHADOW_EVALUATED', 'REJECTED', 'DEAD_LETTERED'
);
CREATE TYPE "AutonomyRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');
CREATE TYPE "AgentDecisionOutcome" AS ENUM ('OBSERVED', 'SHADOW_ELIGIBLE', 'BLOCKED', 'NEEDS_REVIEW');
CREATE TYPE "ActionExecutionMode" AS ENUM ('SHADOW_NOOP');
CREATE TYPE "ActionExecutionStatus" AS ENUM ('RECORDED', 'BLOCKED', 'FAILED');
CREATE TYPE "ReconciliationIssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "ReconciliationIssueStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');
CREATE TYPE "DeadLetterStatus" AS ENUM ('OPEN', 'RETRY_SCHEDULED', 'RESOLVED', 'DISCARDED');

CREATE TABLE "AutonomyPolicy" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "channelId" TEXT,
  "provider" TEXT NOT NULL,
  "taskType" TEXT NOT NULL,
  "mode" "AutonomyMode" NOT NULL DEFAULT 'OBSERVE',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "minimumSourceTrust" "ProviderSourceTrust" NOT NULL,
  "minimumConfidenceBasisPoints" INTEGER NOT NULL DEFAULT 10000,
  "limits" JSONB NOT NULL,
  "requiredProof" JSONB,
  "rollbackMethod" TEXT,
  "approvalRole" "UserRole",
  "quietHours" JSONB,
  "emergencyStopCovered" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutonomyPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutonomyPolicy_minimumConfidenceBasisPoints_check"
    CHECK ("minimumConfidenceBasisPoints" >= 0 AND "minimumConfidenceBasisPoints" <= 10000)
);

CREATE TABLE "ExternalProviderEvent" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "channelId" TEXT,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "providerReferenceId" TEXT,
  "eventVersion" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "sourceTrust" "ProviderSourceTrust" NOT NULL,
  "status" "ExternalProviderEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "idempotencyKey" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "normalizedPayload" JSONB NOT NULL,
  "sanitizedEvidence" JSONB,
  "sourceTimestamp" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalProviderEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalProviderEvent_retryCount_check" CHECK ("retryCount" >= 0)
);

CREATE TABLE "ProviderSyncCursor" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "cursor" TEXT,
  "cursorHash" TEXT,
  "lastSourceTimestamp" TIMESTAMP(3),
  "lastSuccessfulSyncAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "consecutiveFailureCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" TEXT,
  "lastErrorSummary" TEXT,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderSyncCursor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProviderSyncCursor_failureCount_check" CHECK ("consecutiveFailureCount" >= 0)
);

CREATE TABLE "ProviderSnapshot" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "channelId" TEXT,
  "externalEventId" TEXT,
  "provider" TEXT NOT NULL,
  "snapshotType" TEXT NOT NULL,
  "providerReferenceId" TEXT,
  "correlationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "sanitizedEvidence" JSONB,
  "sourceTimestamp" TIMESTAMP(3) NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutonomyRun" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "policyId" TEXT,
  "externalEventId" TEXT,
  "runType" TEXT NOT NULL,
  "triggerType" TEXT NOT NULL,
  "mode" "AutonomyMode" NOT NULL DEFAULT 'OBSERVE',
  "status" "AutonomyRunStatus" NOT NULL DEFAULT 'PENDING',
  "correlationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "triggeredBy" TEXT NOT NULL,
  "managementSummary" JSONB,
  "errorSummary" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutonomyRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentDecision" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "policyId" TEXT,
  "externalEventId" TEXT,
  "agentType" TEXT NOT NULL,
  "decisionType" TEXT NOT NULL,
  "outcome" "AgentDecisionOutcome" NOT NULL,
  "confidenceBasisPoints" INTEGER NOT NULL,
  "rationale" TEXT NOT NULL,
  "proposedAction" JSONB,
  "policyEvaluation" JSONB NOT NULL,
  "correlationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentDecision_confidenceBasisPoints_check"
    CHECK ("confidenceBasisPoints" >= 0 AND "confidenceBasisPoints" <= 10000)
);

CREATE TABLE "ActionExecution" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "decisionId" TEXT NOT NULL,
  "provider" TEXT,
  "actionType" TEXT NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "mode" "ActionExecutionMode" NOT NULL DEFAULT 'SHADOW_NOOP',
  "status" "ActionExecutionStatus" NOT NULL DEFAULT 'RECORDED',
  "candidatePayload" JSONB,
  "result" JSONB,
  "providerRequestSent" BOOLEAN NOT NULL DEFAULT false,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "correlationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActionExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActionExecution_shadow_no_provider_request_check"
    CHECK ("mode" <> 'SHADOW_NOOP' OR "providerRequestSent" = false),
  CONSTRAINT "ActionExecution_retryCount_check" CHECK ("retryCount" >= 0)
);

CREATE TABLE "ReconciliationIssue" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "channelId" TEXT,
  "externalEventId" TEXT,
  "snapshotId" TEXT,
  "provider" TEXT NOT NULL,
  "issueType" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "severity" "ReconciliationIssueSeverity" NOT NULL,
  "status" "ReconciliationIssueStatus" NOT NULL DEFAULT 'OPEN',
  "pmsAggregateType" TEXT,
  "pmsAggregateId" TEXT,
  "providerReferenceId" TEXT,
  "summary" TEXT NOT NULL,
  "sanitizedEvidence" JSONB,
  "correlationId" TEXT NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "acknowledgedBy" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,
  "resolutionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReconciliationIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeadLetterEvent" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "channelId" TEXT,
  "externalEventId" TEXT,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT,
  "providerReferenceId" TEXT,
  "eventVersion" TEXT,
  "failureStage" TEXT NOT NULL,
  "errorCode" TEXT NOT NULL,
  "errorSummary" TEXT NOT NULL,
  "sanitizedPayload" JSONB,
  "sanitizedEvidence" JSONB,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3),
  "status" "DeadLetterStatus" NOT NULL DEFAULT 'OPEN',
  "correlationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,
  "resolutionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeadLetterEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeadLetterEvent_retryCount_check" CHECK ("retryCount" >= 0)
);

CREATE UNIQUE INDEX "AutonomyPolicy_propertyId_provider_taskType_version_key"
  ON "AutonomyPolicy"("propertyId", "provider", "taskType", "version");
CREATE INDEX "AutonomyPolicy_propertyId_enabled_mode_idx"
  ON "AutonomyPolicy"("propertyId", "enabled", "mode");
CREATE INDEX "AutonomyPolicy_channelId_enabled_idx" ON "AutonomyPolicy"("channelId", "enabled");

CREATE UNIQUE INDEX "ExternalProviderEvent_propertyId_provider_providerEventId_eventVersion_key"
  ON "ExternalProviderEvent"("propertyId", "provider", "providerEventId", "eventVersion");
CREATE UNIQUE INDEX "ExternalProviderEvent_propertyId_idempotencyKey_key"
  ON "ExternalProviderEvent"("propertyId", "idempotencyKey");
CREATE INDEX "ExternalProviderEvent_propertyId_status_receivedAt_idx"
  ON "ExternalProviderEvent"("propertyId", "status", "receivedAt");
CREATE INDEX "ExternalProviderEvent_channelId_sourceTimestamp_idx"
  ON "ExternalProviderEvent"("channelId", "sourceTimestamp");
CREATE INDEX "ExternalProviderEvent_correlationId_idx" ON "ExternalProviderEvent"("correlationId");

CREATE UNIQUE INDEX "ProviderSyncCursor_propertyId_channelId_key"
  ON "ProviderSyncCursor"("propertyId", "channelId");
CREATE INDEX "ProviderSyncCursor_propertyId_lastSuccessfulSyncAt_idx"
  ON "ProviderSyncCursor"("propertyId", "lastSuccessfulSyncAt");

CREATE UNIQUE INDEX "ProviderSnapshot_propertyId_idempotencyKey_key"
  ON "ProviderSnapshot"("propertyId", "idempotencyKey");
CREATE INDEX "ProviderSnapshot_propertyId_provider_snapshotType_capturedAt_idx"
  ON "ProviderSnapshot"("propertyId", "provider", "snapshotType", "capturedAt");
CREATE INDEX "ProviderSnapshot_channelId_sourceTimestamp_idx"
  ON "ProviderSnapshot"("channelId", "sourceTimestamp");
CREATE INDEX "ProviderSnapshot_externalEventId_idx" ON "ProviderSnapshot"("externalEventId");
CREATE INDEX "ProviderSnapshot_correlationId_idx" ON "ProviderSnapshot"("correlationId");

CREATE UNIQUE INDEX "AutonomyRun_propertyId_idempotencyKey_key"
  ON "AutonomyRun"("propertyId", "idempotencyKey");
CREATE INDEX "AutonomyRun_propertyId_status_createdAt_idx"
  ON "AutonomyRun"("propertyId", "status", "createdAt");
CREATE INDEX "AutonomyRun_externalEventId_idx" ON "AutonomyRun"("externalEventId");
CREATE INDEX "AutonomyRun_correlationId_idx" ON "AutonomyRun"("correlationId");

CREATE UNIQUE INDEX "AgentDecision_propertyId_idempotencyKey_key"
  ON "AgentDecision"("propertyId", "idempotencyKey");
CREATE INDEX "AgentDecision_propertyId_outcome_createdAt_idx"
  ON "AgentDecision"("propertyId", "outcome", "createdAt");
CREATE INDEX "AgentDecision_runId_createdAt_idx" ON "AgentDecision"("runId", "createdAt");
CREATE INDEX "AgentDecision_externalEventId_idx" ON "AgentDecision"("externalEventId");
CREATE INDEX "AgentDecision_correlationId_idx" ON "AgentDecision"("correlationId");

CREATE UNIQUE INDEX "ActionExecution_propertyId_idempotencyKey_key"
  ON "ActionExecution"("propertyId", "idempotencyKey");
CREATE INDEX "ActionExecution_propertyId_status_createdAt_idx"
  ON "ActionExecution"("propertyId", "status", "createdAt");
CREATE INDEX "ActionExecution_runId_createdAt_idx" ON "ActionExecution"("runId", "createdAt");
CREATE INDEX "ActionExecution_decisionId_idx" ON "ActionExecution"("decisionId");
CREATE INDEX "ActionExecution_correlationId_idx" ON "ActionExecution"("correlationId");

CREATE UNIQUE INDEX "ReconciliationIssue_propertyId_fingerprint_key"
  ON "ReconciliationIssue"("propertyId", "fingerprint");
CREATE INDEX "ReconciliationIssue_propertyId_status_severity_detectedAt_idx"
  ON "ReconciliationIssue"("propertyId", "status", "severity", "detectedAt");
CREATE INDEX "ReconciliationIssue_channelId_status_idx"
  ON "ReconciliationIssue"("channelId", "status");
CREATE INDEX "ReconciliationIssue_externalEventId_idx"
  ON "ReconciliationIssue"("externalEventId");
CREATE INDEX "ReconciliationIssue_snapshotId_idx" ON "ReconciliationIssue"("snapshotId");
CREATE INDEX "ReconciliationIssue_correlationId_idx" ON "ReconciliationIssue"("correlationId");

CREATE UNIQUE INDEX "DeadLetterEvent_externalEventId_key" ON "DeadLetterEvent"("externalEventId");
CREATE UNIQUE INDEX "DeadLetterEvent_propertyId_idempotencyKey_key"
  ON "DeadLetterEvent"("propertyId", "idempotencyKey");
CREATE INDEX "DeadLetterEvent_propertyId_status_nextRetryAt_idx"
  ON "DeadLetterEvent"("propertyId", "status", "nextRetryAt");
CREATE INDEX "DeadLetterEvent_channelId_status_idx" ON "DeadLetterEvent"("channelId", "status");
CREATE INDEX "DeadLetterEvent_correlationId_idx" ON "DeadLetterEvent"("correlationId");

ALTER TABLE "AutonomyPolicy"
  ADD CONSTRAINT "AutonomyPolicy_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AutonomyPolicy_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExternalProviderEvent"
  ADD CONSTRAINT "ExternalProviderEvent_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ExternalProviderEvent_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderSyncCursor"
  ADD CONSTRAINT "ProviderSyncCursor_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProviderSyncCursor_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProviderSnapshot"
  ADD CONSTRAINT "ProviderSnapshot_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProviderSnapshot_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProviderSnapshot_externalEventId_fkey"
  FOREIGN KEY ("externalEventId") REFERENCES "ExternalProviderEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutonomyRun"
  ADD CONSTRAINT "AutonomyRun_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AutonomyRun_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "AutonomyPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AutonomyRun_externalEventId_fkey"
  FOREIGN KEY ("externalEventId") REFERENCES "ExternalProviderEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AgentDecision"
  ADD CONSTRAINT "AgentDecision_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AgentDecision_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AutonomyRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AgentDecision_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "AutonomyPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AgentDecision_externalEventId_fkey"
  FOREIGN KEY ("externalEventId") REFERENCES "ExternalProviderEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ActionExecution"
  ADD CONSTRAINT "ActionExecution_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ActionExecution_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "AutonomyRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ActionExecution_decisionId_fkey"
  FOREIGN KEY ("decisionId") REFERENCES "AgentDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReconciliationIssue"
  ADD CONSTRAINT "ReconciliationIssue_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ReconciliationIssue_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ReconciliationIssue_externalEventId_fkey"
  FOREIGN KEY ("externalEventId") REFERENCES "ExternalProviderEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ReconciliationIssue_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "ProviderSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DeadLetterEvent"
  ADD CONSTRAINT "DeadLetterEvent_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DeadLetterEvent_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DeadLetterEvent_externalEventId_fkey"
  FOREIGN KEY ("externalEventId") REFERENCES "ExternalProviderEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

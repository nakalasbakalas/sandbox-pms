-- Add property membership without changing the existing global User.role contract.
CREATE TABLE "UserPropertyMembership" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "role" "UserRole",
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserPropertyMembership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserPropertyMembership_userId_propertyId_key"
  ON "UserPropertyMembership"("userId", "propertyId");
CREATE INDEX "UserPropertyMembership_propertyId_active_idx"
  ON "UserPropertyMembership"("propertyId", "active");
CREATE INDEX "UserPropertyMembership_userId_active_idx"
  ON "UserPropertyMembership"("userId", "active");

ALTER TABLE "UserPropertyMembership"
  ADD CONSTRAINT "UserPropertyMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPropertyMembership"
  ADD CONSTRAINT "UserPropertyMembership_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing users remain compatible and are assigned to the current Sandbox property.
INSERT INTO "UserPropertyMembership" ("id", "userId", "propertyId", "role", "active")
SELECT CONCAT('legacy_', MD5(u."id" || ':' || p."id")), u."id", p."id", u."role", u."active"
FROM "User" u
JOIN "Property" p ON p."code" = 'SANDBOX'
ON CONFLICT ("userId", "propertyId") DO NOTHING;

-- PostgreSQL sequence-backed outbox supports monotonic SSE catch-up IDs.
CREATE TABLE "DomainEvent" (
  "id" BIGSERIAL NOT NULL,
  "propertyId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DomainEvent_propertyId_id_idx" ON "DomainEvent"("propertyId", "id");
CREATE INDEX "DomainEvent_propertyId_eventType_createdAt_idx" ON "DomainEvent"("propertyId", "eventType", "createdAt");
CREATE INDEX "DomainEvent_aggregateType_aggregateId_id_idx" ON "DomainEvent"("aggregateType", "aggregateId", "id");

ALTER TABLE "DomainEvent"
  ADD CONSTRAINT "DomainEvent_propertyId_fkey"
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

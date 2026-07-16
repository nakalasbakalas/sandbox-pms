CREATE TYPE "AccountingFolioType" AS ENUM ('GUEST', 'MASTER', 'COMPANY', 'HOUSE');
CREATE TYPE "AccountingFolioStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "AccountingChargeKind" AS ENUM ('CHARGE', 'REVERSAL');
CREATE TYPE "AccountingPaymentKind" AS ENUM ('PAYMENT', 'REFUND', 'REVERSAL');
CREATE TYPE "CashShiftStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "CashMovementType" AS ENUM ('CASH_IN', 'CASH_OUT');
CREATE TYPE "HouseAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');
CREATE TYPE "AccountsReceivableEntryKind" AS ENUM ('TRANSFER', 'SETTLEMENT', 'REVERSAL');

CREATE TABLE "AccountingFolio" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "folioNumber" TEXT NOT NULL,
  "type" "AccountingFolioType" NOT NULL DEFAULT 'GUEST',
  "currency" TEXT NOT NULL DEFAULT 'THB',
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "status" "AccountingFolioStatus" NOT NULL DEFAULT 'OPEN',
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "auditEvidence" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AccountingFolio_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingCharge" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "folioId" TEXT NOT NULL,
  "kind" "AccountingChargeKind" NOT NULL DEFAULT 'CHARGE',
  "description" TEXT NOT NULL,
  "amountSatang" BIGINT NOT NULL,
  "originalChargeId" TEXT,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "auditEvidence" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingCharge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingPayment" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "folioId" TEXT NOT NULL,
  "kind" "AccountingPaymentKind" NOT NULL DEFAULT 'PAYMENT',
  "method" "PaymentMethod" NOT NULL,
  "amountSatang" BIGINT NOT NULL,
  "reference" TEXT,
  "cashShiftId" TEXT,
  "originalPaymentId" TEXT,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "auditEvidence" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountingPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashShift" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "cashierId" TEXT NOT NULL,
  "status" "CashShiftStatus" NOT NULL DEFAULT 'OPEN',
  "currency" TEXT NOT NULL DEFAULT 'THB',
  "openingFloatSatang" BIGINT NOT NULL,
  "expectedCloseSatang" BIGINT,
  "actualCloseSatang" BIGINT,
  "varianceSatang" BIGINT,
  "openedBy" TEXT NOT NULL,
  "closedBy" TEXT,
  "closeReason" TEXT,
  "auditEvidence" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "closeIdempotencyKey" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CashMovement" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "cashShiftId" TEXT NOT NULL,
  "type" "CashMovementType" NOT NULL,
  "amountSatang" BIGINT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "auditEvidence" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HouseAccount" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'THB',
  "status" "HouseAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdBy" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "auditEvidence" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HouseAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountsReceivableEntry" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "houseAccountId" TEXT NOT NULL,
  "folioId" TEXT,
  "kind" "AccountsReceivableEntryKind" NOT NULL,
  "amountSatang" BIGINT NOT NULL,
  "originalEntryId" TEXT,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "auditEvidence" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountsReceivableEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalEntry" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "entryNumber" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "description" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "auditEvidence" JSONB,
  "idempotencyKey" TEXT NOT NULL,
  "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalLine" (
  "id" TEXT NOT NULL,
  "journalEntryId" TEXT NOT NULL,
  "accountCode" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "debitSatang" BIGINT NOT NULL DEFAULT 0,
  "creditSatang" BIGINT NOT NULL DEFAULT 0,
  "folioId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountingFolio_propertyId_folioNumber_key" ON "AccountingFolio"("propertyId", "folioNumber");
CREATE UNIQUE INDEX "AccountingFolio_propertyId_idempotencyKey_key" ON "AccountingFolio"("propertyId", "idempotencyKey");
CREATE INDEX "AccountingFolio_propertyId_reservationId_status_idx" ON "AccountingFolio"("propertyId", "reservationId", "status");
CREATE INDEX "AccountingFolio_reservationId_isPrimary_idx" ON "AccountingFolio"("reservationId", "isPrimary");
CREATE UNIQUE INDEX "AccountingFolio_one_primary_per_reservation" ON "AccountingFolio"("reservationId") WHERE "isPrimary" = true;
CREATE UNIQUE INDEX "AccountingCharge_propertyId_idempotencyKey_key" ON "AccountingCharge"("propertyId", "idempotencyKey");
CREATE INDEX "AccountingCharge_propertyId_folioId_createdAt_idx" ON "AccountingCharge"("propertyId", "folioId", "createdAt");
CREATE INDEX "AccountingCharge_originalChargeId_idx" ON "AccountingCharge"("originalChargeId");
CREATE UNIQUE INDEX "AccountingPayment_propertyId_idempotencyKey_key" ON "AccountingPayment"("propertyId", "idempotencyKey");
CREATE INDEX "AccountingPayment_propertyId_folioId_createdAt_idx" ON "AccountingPayment"("propertyId", "folioId", "createdAt");
CREATE INDEX "AccountingPayment_cashShiftId_idx" ON "AccountingPayment"("cashShiftId");
CREATE INDEX "AccountingPayment_originalPaymentId_idx" ON "AccountingPayment"("originalPaymentId");
CREATE UNIQUE INDEX "CashShift_propertyId_idempotencyKey_key" ON "CashShift"("propertyId", "idempotencyKey");
CREATE UNIQUE INDEX "CashShift_propertyId_closeIdempotencyKey_key" ON "CashShift"("propertyId", "closeIdempotencyKey");
CREATE INDEX "CashShift_propertyId_cashierId_status_idx" ON "CashShift"("propertyId", "cashierId", "status");
CREATE UNIQUE INDEX "CashShift_one_open_per_cashier" ON "CashShift"("propertyId", "cashierId") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "CashMovement_propertyId_idempotencyKey_key" ON "CashMovement"("propertyId", "idempotencyKey");
CREATE INDEX "CashMovement_propertyId_cashShiftId_createdAt_idx" ON "CashMovement"("propertyId", "cashShiftId", "createdAt");
CREATE UNIQUE INDEX "HouseAccount_propertyId_accountNumber_key" ON "HouseAccount"("propertyId", "accountNumber");
CREATE UNIQUE INDEX "HouseAccount_propertyId_idempotencyKey_key" ON "HouseAccount"("propertyId", "idempotencyKey");
CREATE INDEX "HouseAccount_propertyId_status_idx" ON "HouseAccount"("propertyId", "status");
CREATE UNIQUE INDEX "AccountsReceivableEntry_propertyId_idempotencyKey_key" ON "AccountsReceivableEntry"("propertyId", "idempotencyKey");
CREATE INDEX "AccountsReceivableEntry_propertyId_houseAccountId_createdAt_idx" ON "AccountsReceivableEntry"("propertyId", "houseAccountId", "createdAt");
CREATE INDEX "AccountsReceivableEntry_folioId_idx" ON "AccountsReceivableEntry"("folioId");
CREATE INDEX "AccountsReceivableEntry_originalEntryId_idx" ON "AccountsReceivableEntry"("originalEntryId");
CREATE UNIQUE INDEX "JournalEntry_propertyId_entryNumber_key" ON "JournalEntry"("propertyId", "entryNumber");
CREATE UNIQUE INDEX "JournalEntry_propertyId_idempotencyKey_key" ON "JournalEntry"("propertyId", "idempotencyKey");
CREATE INDEX "JournalEntry_propertyId_businessDate_postedAt_idx" ON "JournalEntry"("propertyId", "businessDate", "postedAt");
CREATE INDEX "JournalLine_journalEntryId_idx" ON "JournalLine"("journalEntryId");
CREATE INDEX "JournalLine_accountCode_idx" ON "JournalLine"("accountCode");
CREATE INDEX "JournalLine_folioId_idx" ON "JournalLine"("folioId");

ALTER TABLE "AccountingFolio" ADD CONSTRAINT "AccountingFolio_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingFolio" ADD CONSTRAINT "AccountingFolio_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingCharge" ADD CONSTRAINT "AccountingCharge_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "AccountingFolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingCharge" ADD CONSTRAINT "AccountingCharge_originalChargeId_fkey" FOREIGN KEY ("originalChargeId") REFERENCES "AccountingCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingPayment" ADD CONSTRAINT "AccountingPayment_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "AccountingFolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingPayment" ADD CONSTRAINT "AccountingPayment_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingPayment" ADD CONSTRAINT "AccountingPayment_originalPaymentId_fkey" FOREIGN KEY ("originalPaymentId") REFERENCES "AccountingPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HouseAccount" ADD CONSTRAINT "HouseAccount_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountsReceivableEntry" ADD CONSTRAINT "AccountsReceivableEntry_houseAccountId_fkey" FOREIGN KEY ("houseAccountId") REFERENCES "HouseAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountsReceivableEntry" ADD CONSTRAINT "AccountsReceivableEntry_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "AccountingFolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountsReceivableEntry" ADD CONSTRAINT "AccountsReceivableEntry_originalEntryId_fkey" FOREIGN KEY ("originalEntryId") REFERENCES "AccountsReceivableEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "AccountingFolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mirror every legacy operational folio as the primary Accounting V2 folio.
-- Legacy rows and Reservation.folio stay intact until the compatibility period ends.
INSERT INTO "AccountingFolio" (
  "id", "propertyId", "reservationId", "folioNumber", "type", "currency", "isPrimary", "status",
  "actorId", "reason", "idempotencyKey", "createdAt", "updatedAt"
)
SELECT
  'v2_' || f."id",
  r."propertyId",
  f."reservationId",
  'LEGACY-' || f."id",
  'GUEST'::"AccountingFolioType",
  COALESCE(p."currency", 'THB'),
  true,
  CASE WHEN f."status" = 'OPEN' THEN 'OPEN'::"AccountingFolioStatus" ELSE 'CLOSED'::"AccountingFolioStatus" END,
  'SYSTEM_MIGRATION',
  'Mirror legacy operational folio',
  'legacy-folio:' || f."id",
  f."createdAt",
  f."updatedAt"
FROM "Folio" f
JOIN "Reservation" r ON r."id" = f."reservationId"
JOIN "Property" p ON p."id" = r."propertyId";

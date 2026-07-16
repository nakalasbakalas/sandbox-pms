-- Add an immutable, auditable payment-reversal entry type while preserving the
-- Float column required by the 30-day rollback window. Reversal service code
-- must write the negative Float value from the authoritative negative satang.
-- Nullable satang remains the explicit compatibility state for quarantined
-- legacy payment rows; new service writes must always provide satang.

BEGIN;

CREATE TYPE "PaymentEntryKind" AS ENUM ('PAYMENT', 'REVERSAL');

ALTER TABLE "Payment"
ADD COLUMN "entryKind" "PaymentEntryKind" NOT NULL DEFAULT 'PAYMENT',
ADD COLUMN "reversesPaymentId" TEXT,
ADD COLUMN "reversalReason" TEXT,
ADD COLUMN "clientRequestId" TEXT;

ALTER TABLE "Charge"
ADD COLUMN "clientRequestId" TEXT,
ADD COLUMN "voidRequestId" TEXT,
ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidedBy" TEXT;

-- A zero payment is not a valid operational payment. Preserve the Float row as
-- legacy evidence, but quarantine its exact-money shadow for reconciliation.
UPDATE "Payment"
SET "amountSatang" = NULL
WHERE "entryKind" = 'PAYMENT'
  AND "amountSatang" = 0;

ALTER TABLE "Payment"
DROP CONSTRAINT "Payment_amountSatang_nonnegative_check";

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_entry_kind_shape_check"
  CHECK (
    CASE "entryKind"
      WHEN 'PAYMENT' THEN
        "reversesPaymentId" IS NULL
        AND "reversalReason" IS NULL
        AND (
          "amountSatang" IS NULL
          OR ("amountSatang" > 0 AND "amount" > 0)
        )
      WHEN 'REVERSAL' THEN
        "reversesPaymentId" IS NOT NULL
        AND "amountSatang" IS NOT NULL
        AND "amountSatang" < 0
        AND "amount" < 0
        AND "reversalReason" IS NOT NULL
        AND length(btrim("reversalReason")) > 0
      ELSE FALSE
    END
  ),
ADD CONSTRAINT "Payment_amount_dual_write_parity_check"
  CHECK (
    CASE
      WHEN "amountSatang" IS NULL THEN TRUE
      WHEN "amount"::text IN ('NaN', 'Infinity', '-Infinity') THEN FALSE
      WHEN ROUND("amount"::numeric * 100) BETWEEN -2147483648 AND 2147483647
        THEN ROUND("amount"::numeric * 100)::integer = "amountSatang"
      ELSE FALSE
    END
  ),
ADD CONSTRAINT "Payment_clientRequestId_nonblank_check"
  CHECK ("clientRequestId" IS NULL OR length(btrim("clientRequestId")) > 0);

ALTER TABLE "Charge"
ADD CONSTRAINT "Charge_clientRequestId_nonblank_check"
  CHECK ("clientRequestId" IS NULL OR length(btrim("clientRequestId")) > 0),
ADD CONSTRAINT "Charge_void_metadata_shape_check"
  CHECK (
    ("voidRequestId" IS NULL OR length(btrim("voidRequestId")) > 0)
    AND ("voidedBy" IS NULL OR length(btrim("voidedBy")) > 0)
    AND (
      ("voidRequestId" IS NULL AND "voidedAt" IS NULL AND "voidedBy" IS NULL)
      OR "void" = TRUE
    )
  );

CREATE UNIQUE INDEX "Payment_clientRequestId_key"
ON "Payment"("clientRequestId");

CREATE INDEX "Payment_reversesPaymentId_idx"
ON "Payment"("reversesPaymentId");

CREATE UNIQUE INDEX "Charge_clientRequestId_key"
ON "Charge"("clientRequestId");

CREATE UNIQUE INDEX "Charge_voidRequestId_key"
ON "Charge"("voidRequestId");

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_reversesPaymentId_fkey"
FOREIGN KEY ("reversesPaymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
